/**
 * Ramo search capabilities: find and grep.
 *
 * The behaviour follows Pi 1.4.0's search tools
 * (`third_party/pi/packages/coding-agent/src/core/tools/find.ts` and `grep.ts`,
 * MIT licensed, Copyright (c) 2025 Mario Zechner): the same argument shapes, the
 * same output format, and the same use of the bundled `fd` and `ripgrep` binaries.
 *
 * Changes: Ramo owns the binary lookup. Pi downloaded missing tools at runtime;
 * Ramo ships `fd` and `rg` with the application and never reaches the network
 * for them.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import type { Capability, JsonObject } from "../kernel/types.js";
import { binariesDirectory } from "../paths.js";
import { resolveToCwd } from "./files.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead, truncateLine } from "./truncate.js";

/** The maximum number of results find returns by default. */
export const DEFAULT_FIND_LIMIT = 1000;
/** The maximum number of matches grep returns by default. */
export const DEFAULT_GREP_LIMIT = 100;

const BINARY_NAMES = { fd: "fd.exe", rg: "rg.exe" } as const;

/**
 * Locate a bundled search binary.
 *
 * The binaries ship next to the runtime in the `node` directory. Nothing is
 * downloaded: Ramo runs offline.
 */
export function findSearchBinary(name: keyof typeof BINARY_NAMES): string | undefined {
	const fileName = BINARY_NAMES[name];
	const directory = binariesDirectory();
	const candidates = [
		path.join(directory, fileName),
		path.join(directory, "..", "node", fileName),
		path.join(directory, "..", "..", "vendor", "node", fileName),
	];
	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch {
			// Keep looking.
		}
	}
	return undefined;
}

/** Run a search binary and collect its output lines. */
async function runSearch(
	binary: string,
	args: string[],
	signal: AbortSignal | undefined,
): Promise<{ lines: string[]; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
		const reader = createInterface({ input: child.stdout! });
		const lines: string[] = [];
		let stderr = "";
		let settled = false;

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			reader.close();
			signal?.removeEventListener("abort", onAbort);
			fn();
		};

		const onAbort = () => {
			if (!child.killed) child.kill();
			finish(() => reject(new Error("Operation aborted")));
		};

		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		reader.on("line", (line) => lines.push(line));
		child.on("error", (error) => finish(() => reject(new Error(`Failed to run ${path.basename(binary)}: ${error.message}`))));
		child.on("close", (code) => {
			finish(() => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}
				resolve({ lines, stderr, code });
			});
		});

		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** Relativize a result path against the search root. */
function relativize(resultPath: string, root: string): string {
	const relative = path.relative(root, resultPath);
	if (relative && !relative.startsWith("..")) return relative.replace(/\\/g, "/");
	return resultPath;
}

/** Find files whose name matches a glob pattern. */
export function createFindCapability(cwd: string): Capability {
	return {
		name: "find",
		label: "find",
		description: `Find files by name pattern. The pattern is a glob such as '*.ts' or '**/*.spec.ts'. Results are relative to the search directory. Maximum ${DEFAULT_FIND_LIMIT} results by default.`,
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Glob pattern to match against file names, e.g. '*.ts' or '**/*.spec.ts'" },
				path: { type: "string", description: "Directory to search in (default: current directory)" },
				limit: { type: "number", description: `Maximum number of results (default: ${DEFAULT_FIND_LIMIT})` },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
		async execute(_id, params, signal) {
			const binary = findSearchBinary("fd");
			if (!binary) throw new Error("The bundled file finder (fd) is missing from this installation.");
			const searchPath = resolveToCwd(params.path ? String(params.path) : ".", cwd);
			const effectiveLimit = params.limit === undefined ? DEFAULT_FIND_LIMIT : Number(params.limit);
			let pattern = String(params.pattern);

			const args: string[] = ["--glob", "--color=never", "--hidden"];
			// `fd` ignores `.gitignore` outside a repository unless told otherwise, so
			// the flag is only set outside a repository.
			let insideGitRepo = false;
			for (let current = searchPath; ; ) {
				if (fs.existsSync(path.join(current, ".git"))) {
					insideGitRepo = true;
					break;
				}
				const parent = path.dirname(current);
				if (parent === current) break;
				current = parent;
			}
			if (!insideGitRepo) args.push("--no-require-git");
			args.push("--max-results", String(effectiveLimit));

			if (pattern.includes("/")) {
				args.push("--full-path");
				if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") pattern = `**/${pattern}`;
				if (process.platform === "win32") pattern = pattern.replaceAll("/", "[/\\\\]");
			}
			args.push("--", pattern, searchPath);

			const result = await runSearch(binary, args, signal);
			const output = result.lines.join("\n");
			if (result.code !== 0 && !output) {
				throw new Error(result.stderr.trim() || `The file finder exited with code ${result.code}`);
			}
			if (!output) {
				return { content: [{ type: "text" as const, text: "No files found matching pattern" }], details: {} as JsonObject };
			}

			const relativized = result.lines.map((line) => relativize(line.trim(), searchPath));
			const resultLimitReached = relativized.length >= effectiveLimit;
			const truncation = truncateHead(relativized.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
			let outputText = truncation.content;
			const notices: string[] = [];
			const details: JsonObject = {};
			if (resultLimitReached) {
				notices.push(`${effectiveLimit} results limit reached`);
				details.resultLimitReached = effectiveLimit;
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation as unknown as JsonObject;
			}
			if (notices.length > 0) outputText += `\n\n[${notices.join(". ")}]`;

			return { content: [{ type: "text" as const, text: outputText }], details };
		},
	};
}

/** Search file contents for a pattern. */
export function createGrepCapability(cwd: string): Capability {
	return {
		name: "grep",
		label: "grep",
		description: `Search file contents for a pattern. The pattern is a regular expression unless literal is true. Results are reported as path:line with the matching line. Maximum ${DEFAULT_GREP_LIMIT} matches by default.`,
		parameters: {
			type: "object",
			properties: {
				pattern: { type: "string", description: "Search pattern (regex or literal string)" },
				path: { type: "string", description: "Directory or file to search (default: current directory)" },
				glob: { type: "string", description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" },
				ignoreCase: { type: "boolean", description: "Case-insensitive search (default: false)" },
				literal: { type: "boolean", description: "Treat pattern as literal string instead of regex (default: false)" },
				context: { type: "number", description: "Number of lines to show before and after each match (default: 0)" },
				limit: { type: "number", description: `Maximum number of matches to return (default: ${DEFAULT_GREP_LIMIT})` },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
		async execute(_id, params, signal) {
			const binary = findSearchBinary("rg");
			if (!binary) throw new Error("The bundled search tool (rg) is missing from this installation.");
			const searchPath = resolveToCwd(params.path ? String(params.path) : ".", cwd);
			const contextValue = params.context && Number(params.context) > 0 ? Number(params.context) : 0;
			const effectiveLimit = Math.max(1, params.limit === undefined ? DEFAULT_GREP_LIMIT : Number(params.limit));
			const isDirectory = fs.existsSync(searchPath) && fs.statSync(searchPath).isDirectory();

			const args: string[] = ["--no-config", "--json", "--line-number", "--color=never", "--hidden"];
			if (params.ignoreCase) args.push("--ignore-case");
			if (params.literal) args.push("--fixed-strings");
			if (params.glob) args.push("--glob", String(params.glob));
			args.push("--", String(params.pattern), searchPath);

			const result = await runSearch(binary, args, signal);

			const matches: { filePath: string; lineNumber: number }[] = [];
			let matchLimitReached = false;
			for (const line of result.lines) {
				if (!line.trim()) continue;
				if (matches.length >= effectiveLimit) {
					matchLimitReached = true;
					break;
				}
				let event: { type?: string; data?: { path?: { text?: string }; line_number?: number } };
				try {
					event = JSON.parse(line) as typeof event;
				} catch {
					continue;
				}
				if (event.type !== "match") continue;
				const filePath = event.data?.path?.text;
				const lineNumber = event.data?.line_number;
				if (!filePath || typeof lineNumber !== "number") continue;
				matches.push({ filePath, lineNumber });
			}

			if (matches.length === 0 && result.code !== 0 && result.code !== 1) {
				throw new Error(result.stderr.trim() || `The search tool exited with code ${result.code}`);
			}
			if (matches.length === 0) {
				return { content: [{ type: "text" as const, text: "No matches found" }], details: {} as JsonObject };
			}

			const formatPath = (filePath: string): string => {
				if (isDirectory) {
					const relative = path.relative(searchPath, filePath);
					if (relative && !relative.startsWith("..")) return relative.replace(/\\/g, "/");
				}
				return path.basename(filePath);
			};

			const fileCache = new Map<string, string[]>();
			const readLines = (filePath: string): string[] => {
				let lines = fileCache.get(filePath);
				if (!lines) {
					try {
						lines = fs
							.readFileSync(filePath, "utf-8")
							.replace(/\r\n/g, "\n")
							.replace(/\r/g, "\n")
							.split("\n");
					} catch {
						lines = [];
					}
					fileCache.set(filePath, lines);
				}
				return lines;
			};

			const outputLines: string[] = [];
			let linesTruncated = false;
			for (const match of matches) {
				const relativePath = formatPath(match.filePath);
				const lines = readLines(match.filePath);
				if (!lines.length) {
					outputLines.push(`${relativePath}:${match.lineNumber}: (unable to read file)`);
					continue;
				}
				const start = contextValue > 0 ? Math.max(1, match.lineNumber - contextValue) : match.lineNumber;
				const end = contextValue > 0 ? Math.min(lines.length, match.lineNumber + contextValue) : match.lineNumber;
				for (let current = start; current <= end; current++) {
					const lineText = lines[current - 1] ?? "";
					const sanitized = lineText.replace(/\r/g, "");
					const truncated = truncateLine(sanitized);
					if (truncated.wasTruncated) linesTruncated = true;
					if (current === match.lineNumber) outputLines.push(`${relativePath}:${current}: ${truncated.text}`);
					else outputLines.push(`${relativePath}-${current}- ${truncated.text}`);
				}
			}

			const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
			let outputText = truncation.content;
			const notices: string[] = [];
			const details: JsonObject = {};
			if (matchLimitReached) {
				notices.push(`${effectiveLimit} matches limit reached`);
				details.matchLimitReached = effectiveLimit;
			}
			if (linesTruncated) {
				notices.push("some lines were truncated");
				details.linesTruncated = true;
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation as unknown as JsonObject;
			}
			if (notices.length > 0) outputText += `\n\n[${notices.join(". ")}]`;

			return { content: [{ type: "text" as const, text: outputText }], details };
		},
	};
}
