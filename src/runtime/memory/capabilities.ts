/**
 * The memory capabilities.
 *
 * Memory is a capability set available to both Chat and Work. The names are
 * kept so the prompt barely changes; only what they do changed, from a fact
 * store to a prose memory file plus daily notes.
 *
 * Judgment stays with the model. Two invariants live in code: never silently
 * lose data, never record a secret.
 */

import fs from "node:fs";
import type { Capability, CapabilityResult, JsonObject, JsonValue } from "../kernel/types.js";
import type { MemoryPaths } from "./file.js";
import {
	MEMORY_TIERS,
	appendDailyEntry,
	estimateTokens,
	findSecret,
	memoryTier,
	readFileSafe,
	searchMarkdown,
	writeAtomic,
} from "./file.js";
import { listDreams, revertDream, runDream, type DreamModel } from "./dream.js";

export interface MemoryCapabilityOptions {
	paths: MemoryPaths;
	/** The model a dream may use. Resolves lazily on each call. */
	dreamModel: () => DreamModel | null;
	/** The model a consolidation pass may use; preferred over the dream model. */
	dreamConsolidator?: () => DreamModel | null;
	sessionId: () => string | null;
	/** The selected profile's memory tier; the dream gate uses its hard cap. */
	tier?: () => string | null;
	confirm?: (question: string) => Promise<boolean>;
	/** Called after each write that changes the hot file, for the projection. */
	onRendered?: () => void;
}

function text(value: JsonValue | undefined): string {
	return typeof value === "string" ? value : "";
}

function formatHits(dir: string, query: string): string {
	const hits = searchMarkdown(dir, query, 12);
	if (hits.length === 0) return `Nothing under ${dir} matched "${query}".`;
	const lines = hits.map((hit) => {
		const context = `${hit.path}:${hit.lineNumber}`;
		const snippet = hit.line.trim().replace(/^-\s+/, "");
		return `${context} — ${snippet}`;
	});
	return [query, "", ...lines].join("\n");
}

function loadHot(paths: MemoryPaths): string {
	return readFileSafe(paths.hot) ?? "# Memory\n\nEmpty.\n";
}

function hotBullets(md: string): { line: number; text: string }[] {
	const out: { line: number; text: string }[] = [];
	String(md ?? "")
		.split(/\r?\n/)
		.forEach((raw, index) => {
			const line = raw.trimEnd();
			const bullet = /^\s*-\s+(.*\S)\s*$/.exec(line);
			if (!bullet) return;
			out.push({ line: index + 1, text: bullet[1].trim() });
		});
	return out;
}

function forgetLineIn(markdown: string, needle: string): string {
	const norm = normalize(needle);
	const lines = markdown.split(/\r?\n/);
	const next = lines.filter((line) => !(/^\s*-\s+/.test(line) && (normalize(line).includes(norm) || norm.includes(normalize(line)))));
	return next.join("\n");
}

function normalize(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function writeTopic(file: string, title: string, entry: string): void {
	const heading = `# ${title}\n\n`;
	try {
		const current = readFileSafe(file);
		writeAtomic(file, current ? `${current}\n${entry}\n` : `${heading}${entry}\n`);
	} catch {
		writeAtomic(file, `${heading}${entry}\n`);
	}
}

/** Show the six-section file, verbatim, with an issue if the cap is exceeded. */
export function formatHot(paths: MemoryPaths): string {
	const md = loadHot(paths);
	const tokens = estimateTokens(md);
	const budget = MEMORY_TIERS.standard;
	const note = tokens > budget.target ? `\n_~${tokens} tokens; the file is meant to stay under ~${budget.target} tokens, hard cap ${budget.max}._` : "";
	return `${md.trimEnd()}\n${note}`;
}

function formatNotesListing(paths: MemoryPaths): string {
	const files: { path: string; description: string }[] = [];
	try {
		for (const entry of fs.readdirSync(paths.topics, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const text = readFileSafe(`${paths.topics}/${entry.name}`) ?? "";
			const firstMeaningful = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0 && !line.startsWith("#"));
			files.push({ path: `topics/${entry.name}`, description: firstMeaningful ?? entry.name });
		}
	} catch {
		return "No topic files have been written yet.";
	}
	if (files.length === 0) return "No notes yet. Long-term detail accumulates here after each dream.";
	return files.map((entry) => `- ${entry.path} — ${entry.description.slice(0, 140)}`).join("\n");
}

/** Build the seven memory capabilities. */
export function memoryCapabilities(options: MemoryCapabilityOptions): Capability[] {
	const recall: Capability = {
		name: "memory_recall",
		label: "Recall memory",
		description:
			"Search the user's memory files (the always-loaded MEMORY.md plus daily notes and saved topics) for a question. Returns matching lines as prose.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "What to look for, in the user's words." },
				limit: { type: "number", description: "How many matching lines to return. Default 12." },
			},
			required: ["query"],
			additionalProperties: false,
		},
		readOnly: true,
		async execute(toolCallId, params) {
			const query = text(params.query).trim();
			if (!query) throw new Error("memory_recall needs a query");
			const hits = searchMarkdown(options.paths.dir, query, Number.isFinite(Number(params.limit)) ? Number(params.limit) : 12);
			const lines = hits.map((hit) => `${hit.path}:${hit.lineNumber} — ${hit.line.trim().replace(/^-\s+/, "")}`);
			const content = lines.length > 0 ? lines.join("\n") : `Nothing matched "${query}".`;
			return {
				content: [{ type: "text", text: content }],
				details: { hits: hits.map((hit) => ({ path: hit.path, line: hit.lineNumber, score: hit.score })) } as unknown as JsonValue,
			};
		},
	};

	const save: Capability = {
		name: "memory_save",
		label: "Save to memory",
		description:
			"Record one thing the user asked you to remember. Appends to today's daily note; the nightly consolidation promotes durable items into MEMORY.md. Never records secrets — name them instead.",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "What to remember, in plain prose." },
			},
			required: ["text"],
			additionalProperties: false,
		},
		async execute(toolCallId, params) {
			const sentence = text(params.text).replace(/\s+/g, " ").trim();
			if (sentence.length < 4) throw new Error("memory_save needs something to remember");
			if (findSecret(sentence)) throw new Error("memory_save never records passwords, keys or tokens; name it instead.");
			const when = new Date();
			appendDailyEntry(options.paths.dir, sentence, when);
			options.onRendered?.();
			return {
				content: [{ type: "text", text: `Saved to today's note (${when.toISOString().slice(0, 10)}): ${sentence}` }],
				details: { saved: true },
			};
		},
	};

	const noteList: Capability = {
		name: "memory_note_list",
		label: "List memory notes",
		description: "List the topic notes memory keeps. Read one with memory_note_read.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		readOnly: true,
		async execute() {
			return {
				content: [{ type: "text", text: formatNotesListing(options.paths) }],
				details: { notes: [] },
			};
		},
	};

	const noteRead: Capability = {
		name: "memory_note_read",
		label: "Read a memory note",
		description: "Read one topic note. Use memory_note_list to find which one.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "A topic path such as topics/projects.md." },
			},
			additionalProperties: false,
		},
		readOnly: true,
		async execute(toolCallId, params) {
			const wanted = text(params.path).trim().replace(/\\/g, "/");
			const safe = wanted.includes("..") ? "" : wanted.replace(/^\/+/, "");
			if (!safe.endsWith(".md")) throw new Error("memory_note_read takes a path such as topics/projects.md");
			const file = `${options.paths.dir}/${safe.startsWith("topics/") ? safe : `topics/${safe}`}`;
			const content = readFileSafe(file);
			if (content === null) throw new Error(`No note at ${file}. Call memory_note_list first.`);
			return { content: [{ type: "text", text: content }], details: { path: safe } };
		},
	};

	const forget: Capability = {
		name: "memory_forget",
		label: "Forget a memory",
		description:
			"Remove the named line(s) from MEMORY.md. The backup copy and the git history keep this reversible; ask first on sensitive entries.",
		parameters: {
			type: "object",
			properties: {
				text: { type: "string", description: "Some text of the memory to forget, matching a line in MEMORY.md." },
				reason: { type: "string", description: "Why it is forgotten." },
			},
			required: ["text"],
			additionalProperties: false,
		},
		async execute(toolCallId, params) {
			const needle = text(params.text).replace(/\s+/g, " ").trim();
			if (needle.length < 4) throw new Error("memory_forget needs what to forget");
			const hotPath = options.paths.hot;
			const current = readFileSafe(hotPath) ?? "";
			const before = hotBullets(current);
			const remove = before.filter((entry) => normalize(entry.text).includes(normalize(needle)));
			if (remove.length === 0) {
				const loose = before.filter((entry) => normalize(needle).includes(normalize(entry.text)));
				if (loose.length === 1) remove.push(loose[0]);
			}
			if (remove.length === 0) throw new Error(`No line in MEMORY.md matches: ${needle}`);
			if (options.confirm) {
				const agreed = await options.confirm(`Forget ${remove.length} line(s): "${remove[0].text.slice(0, 120)}"?`);
				if (!agreed) return { content: [{ type: "text", text: "The user did not confirm, so nothing was forgotten." }], details: { removed: 0 } };
			}
			const cleaned = current
				.split(/\r?\n/)
				.filter((line) => !remove.some((entry) => normalize(line).includes(normalize(entry.text))))
				.join("\n");
			const secret = findSecret(needle);
			void secret;
			writeAtomic(hotPath, cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`);
			appendDailyEntry(
				options.paths.dir,
					`forgotten in MEMORY.md: ${remove.map((entry) => entry.text).join(" | ")} (reason: ${text(params.reason).trim() || "the user asked"})`,
			);
			options.onRendered?.();
			return {
				content: [{ type: "text", text: `Removed ${remove.length} line(s) from MEMORY.md. A dated copy stays under history/ and the change is in git.` }],
				details: { removed: remove.length },
			};
		},
	};

	const dream: Capability = {
		name: "memory_dream",
		label: "Consolidate memory",
		description:
			"Run a consolidation NOW: promote only what will stay relevant for a long time into MEMORY.md. Writes a dated backup and a changelog every time.",
		parameters: {
			type: "object",
			properties: {
				revert: { type: "string", description: "Revert the dream with this id instead of dreaming." },
			},
			additionalProperties: false,
		},
		async execute(toolCallId, params, signal) {
			const revertId = text(params.revert).trim();
			if (revertId) {
				const reverted = revertDream(options.paths, revertId);
				return { content: [{ type: "text", text: reverted.reason }], details: { reverted: reverted.ok } };
			}
			const model = options.dreamConsolidator?.() ?? options.dreamModel();
			const result = await runDream({
				paths: options.paths,
				model,
				signal,
				trigger: "capability",
				tier: memoryTier(options.tier?.() ?? "standard"),
			});
			options.onRendered?.();
			const lines = [
				`Dream ${result.id}: ${result.status}${result.reason ? ` (${result.reason})` : ""}.`,
				...(result.changelog.length ? ["Changelog:", ...result.changelog] : []),
				...(result.compaction
					? [
							`Facts: ${result.compaction.factCount} (${result.compaction.atomCount} atoms + ${result.compaction.ruleCount} rules); ` +
								`ledger ~${result.compaction.ledgerTokens} tokens; result ~${result.compaction.compressedTokens} tokens ` +
								`(target ${result.compaction.targetTokens}, cap ${result.compaction.maxTokens}).`,
						]
					: []),
				...(result.journalPath ? [`journal: ${result.journalPath}`] : []),
			];
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					id: result.id,
					status: result.status,
					changelog: result.changelog,
					...(result.compaction ? { compaction: result.compaction as unknown as JsonValue } : {}),
				} as unknown as JsonObject,
			};
		},
	};

	const dreams: Capability = {
		name: "memory_dreams",
		label: "List memory dreams",
		description: "List consolidation passes with their id, model and status.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		readOnly: true,
		async execute() {
			const entries = listDreams(options.paths);
			const lines = entries.map((entry) => `- ${entry.id} (${entry.startedAt}) ${entry.model} — ${entry.status}${entry.changelog.length ? `, ${entry.changelog.length} change(s)` : ""}`);
			const joined = lines.length > 0 ? lines.join("\n") : "No dream has run yet.";
			return { content: [{ type: "text", text: joined }], details: { dreams: entries as unknown as JsonValue } };
		},
	};

	return [recall, save, noteList, noteRead, forget, dream, dreams];
}

