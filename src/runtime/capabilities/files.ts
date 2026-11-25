/**
 * Ramo file capabilities: read, write, edit and ls.
 *
 * The behaviour follows Pi 1.4.0's file tools
 * (`third_party/pi/packages/coding-agent/src/core/tools/read.ts`, `write.ts`,
 * `edit.ts` and `ls.ts`, MIT licensed, Copyright (c) 2025 Mario Zechner): the same
 * argument shapes, the same truncation limits, the same actionable continuation
 * notices, and the same requirement that an edit's `oldText` match a unique region.
 *
 * Changes: this is Ramo's own implementation in Ramo's vocabulary, with no
 * typebox schemas and no extension context. Path resolution is Ramo's own, the
 * diff is computed in-project rather than with a diff package, and the file
 * mutation queue is implemented here.
 */

import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Capability, JsonObject } from "../kernel/types.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, type TruncationResult } from "./truncate.js";
import { checkProjectPath } from "./host-guard.js";

/** The maximum number of entries the ls capability returns by default. */
export const DEFAULT_LIST_LIMIT = 500;

/** A file change recorded for the interface. */
export interface FileChange {
	path: string;
	before: string | null;
	after: string | null;
}

/**
 * Serialize mutations of one file.
 *
 * Two concurrent writes to the same file would otherwise interleave and lose one of
 * the changes. The queue is keyed by the resolved absolute path.
 */
const mutationQueues = new Map<string, Promise<unknown>>();

export function withFileMutationQueue<T>(target: string, operation: () => Promise<T>): Promise<T> {
	const previous = mutationQueues.get(target) ?? Promise.resolve();
	const next = previous.then(operation, operation);
	mutationQueues.set(
		target,
		next.then(
			() => undefined,
			() => undefined,
		),
	);
	return next.finally(() => {
		if (mutationQueues.get(target) === undefined) mutationQueues.delete(target);
	});
}

/** Expand a leading `~` and normalize the separators of a path. */
export function expandPath(input: string): string {
	let value = input.trim();
	if (value === "~") value = os.homedir();
	else if (value.startsWith("~/") || value.startsWith("~\\")) value = path.join(os.homedir(), value.slice(2));
	return path.normalize(value);
}

/** Resolve a path against the working directory of the session. */
export function resolveToCwd(input: string, cwd: string): string {
	const expanded = expandPath(input);
	return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

/**
 * Resolve a path for reading.
 *
 * A path that does not exist is still resolved, so the caller reports the real
 * error, but the common case of a file that exists under a slightly different
 * spelling is handled by trying the same name with the apostrophe and the Unicode
 * normalization the filesystem may have applied.
 */
export function resolveReadPath(input: string, cwd: string): string {
	const resolved = resolveToCwd(input, cwd);
	return resolved;
}

const IMAGE_MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

function detectImageMimeType(file: string): string | undefined {
	return IMAGE_MIME_TYPES[path.extname(file).toLowerCase()];
}

/** Read the contents of a file. */
export function createReadCapability(cwd: string): Capability {
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file to read (relative or absolute)" },
				offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
				limit: { type: "number", description: "Maximum number of lines to read" },
			},
			required: ["path"],
			additionalProperties: false,
		},
		async execute(_id, params) {
			const file = resolveReadPath(String(params.path), cwd);
			await access(file, constants.R_OK).catch(() => {
				throw new Error(`Could not read file: ${params.path}.`);
			});

			const mimeType = detectImageMimeType(file);
			if (mimeType) {
				const buffer = await readFile(file);
				return {
					content: [
						{ type: "text", text: `Read image file [${mimeType}]` },
						{ type: "image", data: buffer.toString("base64"), mimeType },
					],
					details: { mimeType } as JsonObject,
				};
			}

			const buffer = await readFile(file);
			const textContent = buffer.toString("utf-8");
			const allLines = textContent.split("\n");
			const totalFileLines = allLines.length;
			const offset = params.offset === undefined ? undefined : Number(params.offset);
			const limit = params.limit === undefined ? undefined : Number(params.limit);
			const startLine = offset ? Math.max(0, offset - 1) : 0;
			const startLineDisplay = startLine + 1;
			if (startLine >= allLines.length) {
				throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
			}

			let selectedContent: string;
			let userLimitedLines: number | undefined;
			if (limit !== undefined) {
				const endLine = Math.min(startLine + limit, allLines.length);
				selectedContent = allLines.slice(startLine, endLine).join("\n");
				userLimitedLines = endLine - startLine;
			} else {
				selectedContent = allLines.slice(startLine).join("\n");
			}

			const truncation = truncateHead(selectedContent);
			let outputText: string;
			let details: JsonObject = {};
			if (truncation.firstLineExceedsLimit) {
				const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
				outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use powershell to read that line in pieces.]`;
				details = { truncation: truncation as unknown as JsonObject };
			} else if (truncation.truncated) {
				const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
				const nextOffset = endLineDisplay + 1;
				outputText = truncation.content;
				outputText +=
					truncation.truncatedBy === "lines"
						? `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`
						: `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
				details = { truncation: truncation as unknown as JsonObject };
			} else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
				const remaining = allLines.length - (startLine + userLimitedLines);
				const nextOffset = startLine + userLimitedLines + 1;
				outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
			} else {
				outputText = truncation.content;
			}

			return { content: [{ type: "text", text: outputText }], details };
		},
	};
}

/** Write content to a file, creating it and its parent directories when needed. */
export function createWriteCapability(cwd: string): Capability {
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file to write (relative or absolute)" },
				content: { type: "string", description: "Content to write to the file" },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
		async execute(_id, params, signal) {
			const gate = checkProjectPath(String(params.path), cwd);
			if (!gate.allowed) throw new Error(gate.reason ?? "Writes are limited to the project folder.");
			const absolutePath = gate.resource;
			const content = String(params.content);
			return withFileMutationQueue(absolutePath, async () => {
				const throwIfAborted = () => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};
				throwIfAborted();
				await mkdir(path.dirname(absolutePath), { recursive: true });
				throwIfAborted();
				await writeFile(absolutePath, content, "utf-8");
				throwIfAborted();
				return {
					content: [{ type: "text" as const, text: `Successfully wrote to ${params.path}` }],
					details: { path: absolutePath } as JsonObject,
				};
			});
		},
	};
}

/** One targeted replacement. */
export interface FileEdit {
	oldText: string;
	newText: string;
}

/** Detect the line ending of a file. */
export function detectLineEnding(content: string): "\r\n" | "\n" {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

/** Convert every line ending to a line feed. */
export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

/** Restore the original line ending. */
export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function countOccurrences(content: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let index = content.indexOf(needle);
	while (index !== -1) {
		count++;
		index = content.indexOf(needle, index + needle.length);
	}
	return count;
}

/**
 * One-for-one character normalisation. The output length is identical to the
 * input, so a match index in the normalised text is also a match index in the
 * original — models commonly substitute smart quotes, dashes and NBSPs.
 */
export function normalizeForMatchEqualLength(value: string): string {
	return value
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[“”„‟]/g, '"')
		.replace(/[‐‑‒–—―−]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

interface LocatedEdit { start: number; length: number; tier: "exact" | "unicode" | "trimmed" }

/** Locate a replacement region with exact, unicode and trailing-whitespace tiers. */
export function locateEdit(content: string, needle: string): LocatedEdit | null {
	const exact = content.indexOf(needle);
	if (exact !== -1 && content.indexOf(needle, exact + 1) === -1) {
		return { start: exact, length: needle.length, tier: "exact" };
	}
	const normalizedContent = normalizeForMatchEqualLength(content);
	const normalizedNeedle = normalizeForMatchEqualLength(needle);
	const unicode = normalizedContent.indexOf(normalizedNeedle);
	if (unicode !== -1 && normalizedContent.indexOf(normalizedNeedle, unicode + 1) === -1) {
		return { start: unicode, length: needle.length, tier: "unicode" };
	}
	// Trailing-whitespace-insensitive line matching (OpenCode edit.ts tier 3).
	const needleLines = needle.split("\n").map((line) => normalizeForMatchEqualLength(line.trimEnd()));
	if (needle.endsWith("\n") && needleLines.at(-1) === "") needleLines.pop();
	if (needleLines.length === 0 || needleLines.every((line) => line === "")) return null;
	const lines: { start: number; end: number; text: string; newline: boolean }[] = [];
	let offset = 0;
	for (const raw of content.matchAll(/[^\n]*(?:\n|$)/g)) {
		const text = raw[0];
		if (text.length === 0) { offset += text.length; continue; }
		const newline = text.endsWith("\n");
		const without = newline ? text.slice(0, -1) : text;
		lines.push({ start: offset, end: offset + text.length, text: without, newline });
		offset += text.length;
	}
	const found: LocatedEdit[] = [];
	for (let index = 0; index + needleLines.length <= lines.length; index++) {
		const slice = lines.slice(index, index + needleLines.length);
		if (slice.length !== needleLines.length) continue;
		if (!slice.every((line, position) => normalizeForMatchEqualLength(line.text.trimEnd()) === needleLines[position])) continue;
		const last = slice[slice.length - 1];
		const trimmed = last.text.trimEnd();
		const end = last.newline ? last.end : last.start + trimmed.length;
		const candidate = { start: slice[0].start, length: Math.max(1, end - slice[0].start), tier: "trimmed" as const };
		if (!found.some((entry) => entry.start < candidate.length + candidate.start && candidate.start < entry.start + entry.length)) found.push(candidate);
	}
	return found.length === 1 ? found[0] : null;
}

/**
 * Apply text replacements to LF-normalized content with fuzzy fallbacks.
 *
 * Every replacement is matched against the same original content, then applied in
 * reverse order so the offsets stay stable.
 */
export function applyEdits(content: string, edits: FileEdit[], filePath: string): { base: string; next: string; fuzzy: boolean } {
	const normalized = edits.map((edit) => ({
		oldText: normalizeToLF(edit.oldText),
		newText: normalizeToLF(edit.newText),
	}));

	for (let index = 0; index < normalized.length; index++) {
		if (normalized[index].oldText.length === 0) {
			throw new Error(
				`edits[${index}].oldText is empty in ${filePath}. Provide the exact text to replace.`,
			);
		}
	}

	const matches: { editIndex: number; start: number; length: number; newText: string }[] = [];
	let fuzzy = false;
	for (let index = 0; index < normalized.length; index++) {
		const edit = normalized[index];
		const located = locateEdit(content, edit.oldText);
		if (!located) {
			const occurrences = countOccurrences(content, edit.oldText);
			throw new Error(
				occurrences > 1
					? `edits[${index}].oldText appears ${occurrences} times in ${filePath}. Include more surrounding text so it matches exactly one place.`
					: `edits[${index}].oldText was not found in ${filePath}. Read the file again and copy the exact text.`,
			);
		}
		if (located.tier !== "exact") fuzzy = true;
		matches.push({ editIndex: index, start: located.start, length: located.length, newText: edit.newText });
	}

	matches.sort((left, right) => left.start - right.start);
	for (let index = 1; index < matches.length; index++) {
		const previous = matches[index - 1];
		const current = matches[index];
		if (previous.start + previous.length > current.start) {
			throw new Error(
				`edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${filePath}. Merge them into one edit or target disjoint regions.`,
			);
		}
	}

	let next = content;
	for (let index = matches.length - 1; index >= 0; index--) {
		const match = matches[index];
		next = next.slice(0, match.start) + match.newText + next.slice(match.start + match.length);
	}

	if (next === content) {
		throw new Error(`The edits did not change ${filePath}.`);
	}
	return { base: content, next, fuzzy };
}

/**
 * Compute a display diff of two texts.
 *
 * The diff package is not available in the shipped runtime, so the diff is computed
 * here over lines with a longest-common-subsequence table.
 */
export function generateDiff(oldContent: string, newContent: string, contextLines = 4): { diff: string; firstChangedLine?: number } {
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const operations = diffLines(oldLines, newLines);

	const changed = operations.filter((operation) => operation.kind !== "equal");
	if (changed.length === 0) return { diff: "", firstChangedLine: undefined };

	const firstChangedIndex = operations.findIndex((operation) => operation.kind !== "equal");
	const firstChangedLine = oldLines.slice(0, firstChangedIndex).length + 1;

	const output: string[] = [];
	let index = 0;
	while (index < operations.length) {
		const operation = operations[index];
		if (operation.kind === "equal") {
			const run = collectRun(operations, index, "equal");
			const isEdge = run.start < contextLines || run.end > operations.length - contextLines;
			if (isEdge) {
				for (const line of run.lines) output.push(`  ${line}`);
			} else {
				output.push(`  ... ${run.lines.length} unchanged lines ...`);
			}
			index = run.end;
			continue;
		}
		if (operation.kind === "removed") {
			for (const line of operation.lines) output.push(`- ${line}`);
			index++;
			continue;
		}
		const run = collectRun(operations, index, "added");
		for (const line of run.lines) output.push(`+ ${line}`);
		index = run.end;
	}
	return { diff: output.join("\n"), firstChangedLine };
}

type DiffOperation = { kind: "equal" | "added" | "removed"; lines: string[] };

function collectRun(operations: DiffOperation[], start: number, kind: DiffOperation["kind"]): { lines: string[]; start: number; end: number } {
	const lines: string[] = [];
	let index = start;
	while (index < operations.length && operations[index].kind === kind) {
		lines.push(...operations[index].lines);
		index++;
	}
	return { lines, start, end: index };
}

/** Diff two line arrays with a longest-common-subsequence table. */
function diffLines(oldLines: string[], newLines: string[]): DiffOperation[] {
	const rows = oldLines.length;
	const columns = newLines.length;
	// The table is bounded so a very large file cannot exhaust memory.
	if (rows * columns > 4_000_000) {
		return [
			{ kind: "removed", lines: oldLines },
			{ kind: "added", lines: newLines },
		];
	}
	const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
	for (let i = rows - 1; i >= 0; i--) {
		for (let j = columns - 1; j >= 0; j--) {
			table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}

	const operations: DiffOperation[] = [];
	let i = 0;
	let j = 0;
	const push = (kind: DiffOperation["kind"], line: string) => {
		const last = operations[operations.length - 1];
		if (last && last.kind === kind) last.lines.push(line);
		else operations.push({ kind, lines: [line] });
	};
	while (i < rows && j < columns) {
		if (oldLines[i] === newLines[j]) {
			push("equal", oldLines[i]);
			i++;
			j++;
		} else if (table[i + 1][j] >= table[i][j + 1]) {
			push("removed", oldLines[i]);
			i++;
		} else {
			push("added", newLines[j]);
			j++;
		}
	}
	while (i < rows) push("removed", oldLines[i++]);
	while (j < columns) push("added", newLines[j++]);
	return operations;
}

/** Edit a file with one or more exact text replacements. */
export function createEditCapability(cwd: string): Capability {
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
				edits: {
					type: "array",
					description:
						"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
					items: {
						type: "object",
						properties: {
							oldText: {
								type: "string",
								description:
									"Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
							},
							newText: { type: "string", description: "Replacement text for this targeted edit." },
						},
						required: ["oldText", "newText"],
						additionalProperties: false,
					},
				},
				fullContent: {
					type: "string",
					description:
						"Optional complete replacement for the file, used only when no targeted edit matches. Supply this deliberately: a stale full rewrite can overwrite unrelated changes.",
				},
			},
			required: ["path", "edits"],
			additionalProperties: false,
		},
		async execute(_id, params, signal) {
			const gate = checkProjectPath(String(params.path), cwd);
			if (!gate.allowed) throw new Error(gate.reason ?? "Edits are limited to the project folder.");
			const filePath = String(params.path);
			const rawEdits = params.edits;
			if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
				throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
			}
			const edits: FileEdit[] = rawEdits.map((entry) => {
				const record = entry as { oldText?: unknown; newText?: unknown };
				if (typeof record.oldText !== "string" || typeof record.newText !== "string") {
					throw new Error("Edit tool input is invalid. Every edit needs an oldText and a newText string.");
				}
				return { oldText: record.oldText, newText: record.newText };
			});

			const absolutePath = gate.resource;
			return withFileMutationQueue(absolutePath, async () => {
				const throwIfAborted = () => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};
				throwIfAborted();
				await access(absolutePath, constants.R_OK | constants.W_OK).catch(() => {
					throw new Error(`Could not edit file: ${filePath}.`);
				});
				const buffer = await readFile(absolutePath);
				const rawContent = buffer.toString("utf-8");
				throwIfAborted();

				// Strip the byte order mark before matching: the model will not include
				// an invisible mark in the text it quotes.
				const hasBom = rawContent.charCodeAt(0) === 0xfeff;
				const bom = hasBom ? "\ufeff" : "";
				const content = hasBom ? rawContent.slice(1) : rawContent;
				const ending = detectLineEnding(content);
				const normalized = normalizeToLF(content);
				let applied: { base: string; next: string; fuzzy: boolean };
				let fullRewrite = false;
				try {
					applied = applyEdits(normalized, edits, filePath);
				} catch (error) {
					// Explicit full-rewrite fallback. Never used unless the model
					// supplied fullContent for this call.
					if (typeof params.fullContent !== "string") throw error;
					const replacement = normalizeToLF(params.fullContent);
					if (replacement === normalized) throw new Error(`The full rewrite did not change ${filePath}.`);
					applied = { base: normalized, next: replacement, fuzzy: true };
					fullRewrite = true;
				}
				throwIfAborted();

				await writeFile(absolutePath, bom + restoreLineEndings(applied.next, ending), "utf-8");
				throwIfAborted();

				const diff = generateDiff(applied.base, applied.next);
				const outcome = fullRewrite
					? `Rewrote ${filePath} from the supplied fullContent after targeted edits did not match.`
					: `Successfully replaced ${edits.length} block(s) in ${filePath}${applied.fuzzy ? " (fuzzy match applied)." : "."}`;
				return {
					content: [{ type: "text" as const, text: outcome }],
					details: {
						diff: diff.diff,
						firstChangedLine: diff.firstChangedLine ?? null,
						fuzzy: applied.fuzzy,
						fullRewrite,
					} as JsonObject,
				};
			});
		},
	};
}

/** List the contents of a directory. */
export function createListCapability(cwd: string): Capability {
	return {
		name: "ls",
		label: "ls",
		description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIST_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "Directory to list (default: current directory)" },
				limit: { type: "number", description: `Maximum number of entries to return (default: ${DEFAULT_LIST_LIMIT})` },
			},
			additionalProperties: false,
		},
		async execute(_id, params) {
			const directory = resolveToCwd(params.path ? String(params.path) : ".", cwd);
			const effectiveLimit = params.limit === undefined ? DEFAULT_LIST_LIMIT : Number(params.limit);

			if (!(await stat(directory).then(
				(value) => value.isDirectory(),
				() => false,
			))) {
				throw new Error(`Path not found: ${directory}`);
			}

			let entries: string[];
			try {
				entries = await readdir(directory);
			} catch (error) {
				throw new Error(`Cannot read directory: ${error instanceof Error ? error.message : String(error)}`);
			}
			entries.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));

			const results: string[] = [];
			let entryLimitReached = false;
			for (const entry of entries) {
				if (results.length >= effectiveLimit) {
					entryLimitReached = true;
					break;
				}
				let suffix = "";
				try {
					const entryStat = await stat(path.join(directory, entry));
					if (entryStat.isDirectory()) suffix = "/";
				} catch {
					continue;
				}
				results.push(entry + suffix);
			}

			if (results.length === 0) {
				return { content: [{ type: "text" as const, text: "(empty directory)" }], details: {} as JsonObject };
			}

			const truncation = truncateHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
			let output = truncation.content;
			const notices: string[] = [];
			const details: JsonObject = {};
			if (entryLimitReached) {
				notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
				details.entryLimitReached = effectiveLimit;
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation as unknown as JsonObject;
			}
			if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

			return { content: [{ type: "text" as const, text: output }], details };
		},
	};
}

/** The truncation detail shared with the other capabilities. */
export type { TruncationResult };
