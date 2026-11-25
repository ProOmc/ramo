/**
 * The memory subsystem's public surface.
 *
 * One facade over a file-backed memory dir: MEMORY.md (the source of truth),
 * daily notes, topics, git history. The worker talks to one object; the
 * isolated-chat gate stays in two places on purpose.
 */

import fs from "node:fs";
import path from "node:path";

import type { Capability } from "../kernel/types.js";

import { memoryCapabilities } from "./capabilities.js";
import {
	pendingCommands,
	writeOutcome,
	type MemoryCommand,
	type MemoryCommandOutcome,
} from "./commands.js";
import { listDreams, revertDream, runDream, type DreamModel, type DreamResult } from "./dream.js";
import { daysWithEntries } from "./daily.js";
import {
	appendDailyEntry,
	ensureLayout,
	estimateTokens,
	findSecret,
	injectionCap,
	memoryPaths,
	memoryTier,
	readFileSafe,
	searchMarkdown,
	writeAtomic,
	type MemoryPaths,
	type MemoryTierName,
} from "./file.js";
import { MEMORY_TOOLS_LINE, selectPrompt } from "./prompt.js";
import { retainTurn, type RetainResult } from "./retain.js";
import { buildProjection, type MemoryUiProjection, type MemoryUiSearch } from "./ui.js";

export interface MemorySystemOptions {
	/** `<dataDir>/memory`. */
	dir: string;
	/** The loopback base URL of the local model service. */
	endpoint: () => string;
	/** The session this worker is on; recorded as provenance. */
	sessionId: () => string | null;
	/**
	 * The tier of the selected model: `fast`, `standard` or `deep`.
	 *
	 * It is resolved lazily per call because the model can change between turns.
	 * It is an explicit profile field, never derived from the context window.
	 */
	memoryTier?: () => string | null;
	/** The model a dream may use; dreaming falls back to code-only stages when null. */
	dreamModel?: () => DreamModel | null;
	/** Prefer this model for consolidation; falls back to the dream model. */
	dreamConsolidator?: () => DreamModel | null;
	/** Ask the user to confirm something before acting. */
	confirm?: (question: string) => Promise<boolean>;
	/** The project the projection carries, if any. */
	projectPath?: () => string | null;
}

export function retentionAllowed(isolated: boolean): boolean {
	return !isolated;
}

export interface RetainOptions {
	isolated?: boolean;
	at?: Date;
	model?: DreamModel | null;
	signal?: AbortSignal;
}

export class MemorySystem {
	readonly paths: MemoryPaths;
	private options: MemorySystemOptions;
	private initialized = false;
	private lastRender: MemoryUiProjection | null = null;
	private lastSearch: MemoryUiSearch | null = null;
	private lastCommand: { id: string; action: string; ok: boolean; reason: string; at: string } | null = null;

	constructor(options: MemorySystemOptions) {
		this.options = options;
		this.paths = memoryPaths(options.dir);
	}

	async initialize(): Promise<void> {
		ensureLayout(this.paths.dir);
		this.refresh();
		this.initialized = true;
	}

	get ready(): boolean {
		return this.initialized;
	}
	get dir(): string {
		return this.paths.dir;
	}

	private tier(): MemoryTierName {
		return memoryTier(this.options.memoryTier?.() ?? null);
	}

	private render(): MemoryUiProjection {
		return buildProjection({
			paths: this.paths,
			search: this.lastSearch,
			dreams: listDreams(this.paths),
			tier: this.tier(),
			lastRenderedAt: new Date().toISOString(),
		});
	}

	/** Write ui.json; failures here must never bubble into callers. */
	refresh(): MemoryUiProjection {
		const projection = this.render();
		this.lastRender = projection;
		try {
			const dir = path.dirname(this.paths.ui);
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(this.paths.ui, `${JSON.stringify(projection)}\n`, "utf-8");
		} catch {
			// The interface projection is rebuilt by the next change.
		}
		return projection;
	}

	/**
	 * The text the system prompt carries: the tools line, the identity core and
	 * as much of MEMORY.md as the selected model's tier allows.
	 *
	 * The cap is enforced here rather than requested from the model. What is left
	 * out is named as one `memory_recall` away, so the model knows the rest is
	 * available instead of assuming the file is complete.
	 */
	promptSection(): string {
		const md = readFileSafe(this.paths.hot) ?? "";
		const selected = selectPrompt(md, {
			budget: injectionCap(this.tier()),
			toolsLine: MEMORY_TOOLS_LINE,
		});
		if (md.trim()) return selected.text;
		return `${selected.text}\n\n_The memory file is empty; retained conversations will fill it._`;
	}

	capabilities(): Capability[] {
		return memoryCapabilities({
			paths: this.paths,
			dreamModel: () => this.options.dreamModel?.() ?? null,
			dreamConsolidator: () => this.options.dreamConsolidator?.() ?? null,
			sessionId: () => this.options.sessionId(),
			tier: () => this.tier(),
			confirm: this.options.confirm,
			onRendered: () => {
				this.refresh();
			},
		});
	}

	/** Retain a completed turn. Returns null when the turn was ineligible or the model failed. */
	async retain(userText: string, sessionId: string | null, options: RetainOptions = {}): Promise<RetainResult | null> {
		if (!retentionAllowed(options.isolated ?? false)) return null;
		const model = options.model === undefined ? this.options.dreamModel?.() ?? null : options.model;
		if (!model || !userText.trim()) return null;
		const result = await retainTurn({
			paths: this.paths,
			model,
			userText,
			sessionId,
			at: options.at ?? new Date(),
			signal: options.signal,
		});
		this.refresh();
		return result;
	}

	async dream(trigger = "manual", signal?: AbortSignal, model?: DreamModel | null): Promise<DreamResult> {
		const result = await runDream({
			paths: this.paths,
			model: model === undefined ? this.options.dreamConsolidator?.() ?? this.options.dreamModel?.() ?? null : model,
			signal,
			trigger,
			tier: this.tier(),
		});
		this.refresh();
		return result;
	}

	revert(dreamId: string): { ok: boolean; reason: string } {
		const result = dreamId ? revertDream(this.paths, dreamId) : { ok: false, reason: "a dream id is required" };
		this.refresh();
		return result;
	}

	dreams(): ReturnType<typeof listDreams> {
		return listDreams(this.paths);
	}

	status(): {
		facts: number;
		notes: number;
		lastRenderedAt: string | null;
		lastDreamAt: string | null;
		estimatedTokens: number;
		tier: MemoryTierName;
		budget: number;
		injectedTokens: number;
	} {
		const md = readFileSafe(this.paths.hot) ?? "";
		const daily = daysWithEntries(this.paths);
		const tier = this.tier();
		const state = (() => {
			try {
				return JSON.parse(fs.readFileSync(path.join(this.paths.dir, "state.json"), "utf-8")) as { lastDreamAt?: string | null };
			} catch {
				return {} as { lastDreamAt?: string | null };
			}
		})();
		return {
			facts: (md.match(/^\s*-\s+/gm) ?? []).length,
			notes: daily.length,
			lastRenderedAt: null,
			lastDreamAt: state.lastDreamAt ?? null,
			estimatedTokens: estimateTokens(md),
			tier,
			budget: injectionCap(tier),
			injectedTokens: estimateTokens(this.promptSection()),
		};
	}

	/** Facts retained since the last consolidation; used by the backlog trigger. */
	unconsolidatedCount(): number {
		const state = (() => {
			try {
				return JSON.parse(fs.readFileSync(path.join(this.paths.dir, "state.json"), "utf-8")) as { lastDreamAt?: string | null };
			} catch {
				return {} as { lastDreamAt?: string | null };
			}
		})();
		const lastDream = state.lastDreamAt ? Date.parse(state.lastDreamAt) : 0;
		let count = 0;
		for (const day of daysWithEntries(this.paths)) {
			const file = path.join(this.paths.daily, `${day}.md`);
			const text = readFileSafe(file) ?? "";
			for (const line of text.split(/\r?\n/)) {
				if (!/^\s*-\s+\S/.test(line)) continue;
				const at = Date.parse(`${day}T00:00:00Z`);
				if (Number.isFinite(at) && at >= lastDream) count += 1;
			}
		}
		return count;
	}

	/** Apply every command in the inbox; returns the outcomes. */
	async drainCommands(): Promise<MemoryCommandOutcome[]> {
		const commands = pendingCommands(this.paths.dir);
		const outcomes: MemoryCommandOutcome[] = [];
		for (const command of commands) {
			const outcome = await this.applyCommand(command).catch((error) => ({
				id: command.id,
				action: command.action,
				ok: false,
				reason: error instanceof Error ? error.message : String(error),
				at: new Date().toISOString(),
			}));
			writeOutcome(this.paths.dir, outcome);
			outcomes.push(outcome);
		}
		return outcomes;
	}

	async applyCommand(command: MemoryCommand): Promise<MemoryCommandOutcome> {
		const now = new Date();
		let ok = true;
		let reason = "";
		try {
			switch (command.action) {
				case "edit-fact": {
					const needle = String(command.text ?? "").replace(/\s+/g, " ").trim();
					const replace = String(command.replace ?? "").replace(/\s+/g, " ").trim();
					if (!needle || !replace) throw new Error("An edit needs both the line to find and the replacement text.");
					const current = readFileSafe(this.paths.hot) ?? "";
					const edited = editLineInMemory(current, needle, replace);
					if (!edited) throw new Error(`No line in MEMORY.md matches: ${needle}`);
					const secret = findSecret(replace);
					if (secret) throw new Error(`Refusing to save a credential (${secret}); edit the credential line directly instead.`);
					writeAtomic(this.paths.hot, edited);
					reason = "Saved. The edit is real — MEMORY.md is the file.";
					break;
				}
				case "add-fact": {
					const text = String(command.text ?? "").replace(/\s+/g, " ").trim();
					if (text.length < 4) throw new Error("A line needs some text.");
					const secret = findSecret(text);
					if (secret) throw new Error(`Refusing to record a credential (${secret}); do not put secrets in memory.`);
					appendDailyEntry(this.paths.dir, text, now);
					reason = `Saved to today's note (${now.toISOString().slice(0, 10)}).`;
					break;
				}
				case "write-hot": {
					const content = String(command.content ?? "").replace(/\r\n?/g, "\n");
					if (content.trim().length === 0) throw new Error("MEMORY.md cannot be saved empty.");
					const secret = findSecret(content);
					if (secret) throw new Error(`Refusing to save a credential (${secret}) into MEMORY.md.`);
					writeAtomic(this.paths.hot, content.endsWith("\n") ? content : `${content}\n`);
					reason = "Saved. Deletions in this file are real.";
					break;
				}
				case "forget-fact": {
					const needle = String(command.text ?? "").replace(/\s+/g, " ").trim();
					if (needle.length < 4) throw new Error("A forget needs the memory line to remove.");
					const current = readFileSafe(this.paths.hot) ?? "";
					const removed = removeLinesInMemory(current, needle);
					if (removed.count === 0) throw new Error(`No line in MEMORY.md matches: ${needle}`);
					writeAtomic(this.paths.hot, removed.markdown);
					appendDailyEntry(this.paths.dir, `forgotten: ${needle}`, now);
					reason = `Removed ${removed.count} line(s) from MEMORY.md. A dated copy stays under history/ and the change is in git.`;
					break;
				}
				case "dream": {
					const result = await this.dream("interface");
					reason = `Dream ${result.id}: ${result.status}${result.reason ? ` (${result.reason})` : ""}.`;
					break;
				}
				case "revert-dream": {
					const dreamId = String(command.dreamId ?? "").trim();
					if (!dreamId) throw new Error("A dream id is required to revert.");
					const reverted = revertDream(this.paths, dreamId);
					if (!reverted.ok) throw new Error(reverted.reason);
					reason = reverted.reason;
					break;
				}
				case "search": {
					const query = String(command.query ?? "").trim();
					if (!query) throw new Error("A search needs a query.");
					this.lastSearch = makeSearch(this.paths, query, 12, "memory query");
					reason = `${this.lastSearch.facts.length} match(es).`;
					break;
				}
				default:
					ok = false;
					reason = `Unknown command: ${String(command.action)}.`;
			}
		} catch (error) {
			ok = false;
			reason = error instanceof Error ? error.message : String(error);
		}
		this.lastCommand = { id: command.id, action: command.action, ok, reason, at: now.toISOString() };
		this.refresh();
		return { id: command.id, action: command.action, ok, reason, at: now.toISOString() };
	}

	recall(query: string, limit = 12): MemoryUiSearch {
		this.lastSearch = makeSearch(this.paths, query, limit, "memory recall");
		this.refresh();
		return this.lastSearch;
	}

	/** Count of facts in MEMORY.md, for the low-pace two-phase hop. */
	get facts(): number {
		const md = readFileSafe(this.paths.hot) ?? "";
		return (md.match(/^\s*-\s+/gm) ?? []).length;
	}
}

/** Replace a bullet line that fuzzy-matches `needle` with `replace`, preserving order. */
function editLineInMemory(markdown: string, needle: string, replace: string): string | null {
	const lines = markdown.split(/\r?\n/);
	const norm = normalise(needle);
	let replaced = 0;
	const next = lines.map((line) => {
		if (!/^\s*-\s+/.test(line)) return line;
		const content = normalise(line);
		if (content === norm || (norm.length >= 6 && content.includes(norm))) {
			replaced += 1;
			return replace.startsWith("- ") ? replace : `- ${replace}`;
		}
		return line;
	});
	return replaced === 0 ? null : next.join("\n") + "\n";
}

function removeLinesInMemory(markdown: string, needle: string): { markdown: string; count: number } {
	const lines = markdown.split(/\r?\n/);
	const norm = normalise(needle);
	const keep = lines.filter((line) => {
		if (!/^\s*-\s+/.test(line)) return true;
		const content = normalise(line);
		return !(content.includes(norm) || norm.includes(content));
	});
	return { markdown: keep.join("\n") + "\n", count: lines.length - keep.length };
}

function normalise(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Build the search section the interface renders. */
function makeSearch(paths: MemoryPaths, query: string, limit: number, at: string): MemoryUiSearch {
	const hits = searchMarkdown(paths.dir, query, limit);
	return {
		query,
		at,
		facts: hits.map((hit, index) => ({
			id: `${hit.path}:${hit.lineNumber}`,
			text: hit.line.trim().replace(/^-\s+/, ""),
			rank: index + 1,
			arms: ["text"],
			raised: [],
			lowered: [],
			superseded: false,
		})),
		arms: [{ arm: "text", status: "available", reason: "Okapi BM25 over memory lines", candidates: hits.length }],
		interval: null,
		history: false,
	};
}

export { MemoryPaths };
export {
	appendDailyEntry,
	backupHot,
	ensureLayout,
	estimateTokens,
	findSecret,
	hotBudget,
	injectionCap,
	MEMORY_TIERS,
	memoryPaths,
	memoryTier,
	readDailySince,
	searchMarkdown,
	writeAtomic,
} from "./file.js";
export type { MemoryTierBudget, MemoryTierName } from "./file.js";
export { MEMORY_TOOLS_LINE, selectPrompt } from "./prompt.js";
export { listDailyNotes, daysWithEntries } from "./daily.js";
export { runDream, listDreams, revertDream, parseDreamAnswer, dreamSectionNames } from "./dream.js";
export type { DreamAnswer, DreamCompaction, DreamModel, DreamRequest, DreamResult } from "./dream.js";
export {
	atomKey,
	buildLedger,
	checkFidelity,
	extractAtoms,
	groupIntoChunks,
	parseChunkOutput,
	planBudget,
	polarityRules,
	sectionNames,
	splitProseSections,
} from "./compact.js";
export type { BudgetPlan, FidelityReport, Ledger, ProseChunk, ProseSection } from "./compact.js";
export { retainTurn, looksLikeQuestion, looksLikeMetaInstruction } from "./retain.js";
export { memoryCapabilities } from "./capabilities.js";
export { buildProjection } from "./ui.js";
export { migrateLegacyStoreToHotFile } from "./migrate.js";

