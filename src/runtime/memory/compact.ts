/**
 * Deterministic compaction helpers for the nightly dream.
 *
 * The dream is split into two calls with one job each: a merge call that only
 * adds the delta, then a compression call that only shortens the (larger)
 * file. Everything in this module is code-owned and model-free:
 *
 * - atom extraction: every exact number, threshold, date, ID and URL;
 * - the verbatim ledger: the atoms (and the negation anchors of polarity
 *   rules) laid out as a table that is carried word-for-word into the hot file,
 *   so the generative step never has to reproduce a value;
 * - the budget plan: the ledger is measured first and the prose budget is what
 *   is left, so an infeasible cap is reported with the real number instead of
 *   facts being silently dropped;
 * - section chunking: compression runs on 2-4 sections in parallel, never on
 *   already-compressed output (no cascade);
 * - the fidelity check: a code gate that rejects an output which loses a
 *   ledger fact, invents a number or moves a value away from its neighbours.
 *
 * The ledger is the only thing copied verbatim. Prose is rewritten under a
 * hard budget and is expected to carry no digits at all.
 */

import { MEMORY_TIERS, estimateTokens, type MemoryTierName } from "./file.js";

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

const NEGATION_PATTERN = /\b(never|not|no|without|cannot|can't|don't|doesn't|isn't|aren't|won't|refuse[sd]?|instead)\b/i;

/** Words that never count as a fact's neighbours. Kept small on purpose. */
const STOPWORDS = new Set([
	"the", "and", "for", "with", "that", "this", "from", "into", "over", "under",
	"about", "after", "before", "when", "then", "than", "but", "not", "never",
	"no", "without", "are", "was", "were", "has", "have", "had", "does", "did",
	"doing", "his", "her", "its", "their", "our", "your", "you", "they", "them",
	"she", "he", "it", "we", "us", "i", "a", "an", "of", "to", "in", "on", "at",
	"by", "as", "is", "be", "been", "being", "or", "if", "so", "up", "out", "can",
	"could", "would", "should", "will", "may", "might", "must", "also", "just",
	"only", "very", "more", "most", "much", "many", "some", "any", "all", "one",
	"two", "new", "old", "now", "per", "each", "other", "same", "such", "own",
	"how", "what", "why", "where", "who", "which", "there", "here", "these",
	"those", "get", "got", "make", "made", "use", "used", "still", "yet",
]);

export interface AtomOccurrence {
	/** The comparison key: punctuation-stripped, encoding-artifact tolerant. */
	key: string;
	/** The token as written, used in error messages and the ledger. */
	display: string;
	kind: "number" | "url";
	lineIndex: number;
	line: string;
	section: string;
	/** The previous/next atom on the same line, if any. */
	previous: string | null;
	next: string | null;
}

export interface LedgerArea {
	name: string;
	atoms: string[];
	displays: string[];
}

export interface PolarityRule {
	marker: string;
	anchors: string[];
	section: string;
}

export interface Ledger {
	/** Distinct atom keys, first-seen order. */
	atoms: string[];
	occurrences: AtomOccurrence[];
	areas: LedgerArea[];
	rules: PolarityRule[];
	/** The table that goes into the hot file verbatim. */
	text: string;
	/** Distinct atoms plus distinct polarity rules. */
	factCount: number;
}

export interface BudgetPlan {
	factCount: number;
	atomCount: number;
	ruleCount: number;
	ledgerTokens: number;
	skeletonTokens: number;
	/** Ledger plus headings/explainer: the floor a faithful file needs. */
	minimumTokens: number;
	/** A terse prose allowance on top of the floor. */
	neededTokens: number;
	targetTokens: number;
	maxTokens: number;
	proseBudget: number;
	feasible: boolean;
	targetFeasible: boolean;
	reason: string;
}

export interface ProseSection {
	name: string;
	body: string;
	tokens: number;
}

export interface ProseChunk {
	sections: ProseSection[];
	text: string;
	tokens: number;
}

export interface FidelityReport {
	ok: boolean;
	reasons: string[];
	atomsExpected: number;
	atomsPresent: number;
	atomsAbsent: string[];
	unknownAtoms: string[];
	rulesAbsent: string[];
	contextViolations: string[];
}

interface SourceLine {
	text: string;
	section: string;
	index: number;
}

function sourceLines(markdown: string): SourceLine[] {
	const out: SourceLine[] = [];
	let section = "";
	String(markdown ?? "").split(/\r?\n/).forEach((text, index) => {
		const heading = /^##\s+(.+?)\s*$/.exec(text);
		if (heading) section = heading[1].trim();
		out.push({ text, section, index });
	});
	return out;
}

/**
 * Turn one whitespace token into a comparable atom key.
 *
 * Encoding damage and decorative qualifiers are dropped; the digits, letters
 * and internal punctuation that make the value distinct are kept. `≤$350`,
 * `~$350` and a mojibake-prefixed `$350` all compare as `$350`; `4B` and `4`
 * stay different.
 */
export function atomKey(token: string): string | null {
	let value = String(token ?? "").replace(/[^A-Za-z0-9$.,/:%+\-]/g, "");
	value = value.replace(/^[.,/:%+\-]+/, "");
	value = value.replace(/[.,/:+\-]+$/, "");
	if (!/[0-9]/.test(value)) return null;
	return value;
}

/** Every number/URL occurrence in a document, in order, with its line context. */
export function extractAtoms(markdown: string): AtomOccurrence[] {
	const occurrences: AtomOccurrence[] = [];
	for (const line of sourceLines(markdown)) {
		const raw = line.text;
		if (!raw.trim()) continue;
		const found: { key: string; display: string; kind: "number" | "url"; at: number }[] = [];
		const urlPattern = new RegExp(URL_PATTERN.source, "gi");
		let urlMatch: RegExpExecArray | null;
		while ((urlMatch = urlPattern.exec(raw)) !== null) {
			const url = urlMatch[0].replace(/[.,;:!?)\]]+$/, "");
			found.push({ key: `url:${url}`, display: url, kind: "url", at: urlMatch.index });
		}
		const masked = raw.replace(new RegExp(URL_PATTERN.source, "gi"), (value) => " ".repeat(value.length));
		const wordPattern = /\S+/g;
		let wordMatch: RegExpExecArray | null;
		while ((wordMatch = wordPattern.exec(masked)) !== null) {
			const key = atomKey(wordMatch[0]);
			if (!key) continue;
			found.push({ key, display: wordMatch[0], kind: "number", at: wordMatch.index });
		}
		found.sort((left, right) => left.at - right.at);
		found.forEach((entry, index) => {
			occurrences.push({
				key: entry.key,
				display: entry.display,
				kind: entry.kind,
				lineIndex: line.index,
				line: raw.trim(),
				section: line.section,
				previous: found[index - 1]?.key ?? null,
				next: found[index + 1]?.key ?? null,
			});
		});
	}
	return occurrences;
}

function contentWords(text: string, exclude: Set<string> = new Set()): string[] {
	const out: string[] = [];
	for (const token of String(text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
		if (token.length < 3) continue;
		if (/[0-9]/.test(token)) continue;
		if (STOPWORDS.has(token)) continue;
		if (exclude.has(token)) continue;
		out.push(token);
	}
	return out;
}

/** The negation rules a compressed file must keep, as marker plus anchors. */
export function polarityRules(markdown: string): PolarityRule[] {
	const out: PolarityRule[] = [];
	const seen = new Set<string>();
	for (const line of sourceLines(markdown)) {
		const text = line.text.trim();
		if (!/^\s*[-*]\s+\S/.test(text)) continue;
		const match = NEGATION_PATTERN.exec(text);
		if (!match) continue;
		const marker = match[0].toLowerCase();
		// Anchor on the words the negation governs, not on the start of the line:
		// "does not want to switch" keeps "want, switch"; "never below $140" keeps
		// "below, explicit, permission".
		const after = text.slice(match.index + match[0].length);
		const anchors = contentWords(after, new Set([marker, ...marker.split(/\s+/)])).slice(0, 3);
		if (anchors.length === 0) continue;
		const key = `${marker}|${anchors.join(",")}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ marker, anchors, section: line.section });
	}
	return out;
}

function cleanCell(value: string): string {
	return String(value ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

/** The value as written, without the punctuation the sentence wrapped it in. */
function cleanDisplay(raw: string, kind: "number" | "url"): string {
	if (kind === "url") return raw;
	let value = raw;
	let previous = "";
	while (value !== previous) {
		previous = value;
		value = value
			.replace(/^[([{'"*`]+/, "")
			.replace(/[.,;:!?)\]}"'`]+$/, "");
	}
	return value;
}

/** Build the deterministic verbatim ledger from a memory document. */
export function buildLedger(markdown: string): Ledger {
	const occurrences = extractAtoms(markdown);
	const seen = new Set<string>();
	const areas: LedgerArea[] = [];
	const byArea = new Map<string, LedgerArea>();
	for (const occurrence of occurrences) {
		if (seen.has(occurrence.key)) continue;
		seen.add(occurrence.key);
		const name = occurrence.section || "General";
		let area = byArea.get(name);
		if (!area) {
			area = { name, atoms: [], displays: [] };
			byArea.set(name, area);
			areas.push(area);
		}
		area.atoms.push(occurrence.key);
		area.displays.push(cleanDisplay(occurrence.display, occurrence.kind));
	}
	const rules = polarityRules(markdown);
	const table: string[] = ["| area | exact values |", "| --- | --- |"];
	for (const area of areas) {
		if (area.atoms.length === 0) continue;
		table.push(`| ${cleanCell(area.name)} | ${area.displays.map(cleanCell).join(", ")} |`);
	}
	if (rules.length) {
		table.push("", "| polarity | keep these words (negation) |", "| --- | --- |");
		for (const rule of rules) {
			table.push(`| ${cleanCell(rule.marker)} | ${rule.anchors.map(cleanCell).join(", ")} |`);
		}
	}
	return {
		atoms: [...seen],
		occurrences,
		areas,
		rules,
		text: table.join("\n"),
		factCount: seen.size + rules.length,
	};
}

/** Measure the ledger against a tier. A cap the facts cannot fit is reported, never hidden. */
export function planBudget(ledger: Ledger, skeletonText: string, tier: MemoryTierName = "standard"): BudgetPlan {
	const budget = MEMORY_TIERS[tier];
	const ledgerTokens = estimateTokens(ledger.text);
	const skeletonTokens = estimateTokens(skeletonText);
	const minimumTokens = ledgerTokens + skeletonTokens;
	const feasible = minimumTokens <= budget.max;
	const targetFeasible = minimumTokens <= budget.target;
	const bound = targetFeasible ? budget.target : budget.max;
	const proseBudget = feasible ? Math.max(0, bound - minimumTokens) : 0;
	let reason = "";
	if (!feasible) {
		reason =
			`the ${ledger.factCount} distinct facts need ~${minimumTokens} tokens in a verbatim ledger plus headings ` +
			`(~${ledgerTokens} ledger + ~${skeletonTokens} skeleton), over the ${budget.max}-token hard cap for the ${tier} tier; ` +
			`a lossless compaction to that cap is infeasible (a readable file needs at least ~${minimumTokens + 120} tokens)`;
	} else if (!targetFeasible) {
		reason =
			`the verbatim ledger and headings need ~${minimumTokens} tokens, so the ${budget.target}-token target is infeasible; ` +
			`compressing to the ${budget.max}-token hard cap instead`;
	}
	return {
		factCount: ledger.factCount,
		atomCount: ledger.atoms.length,
		ruleCount: ledger.rules.length,
		ledgerTokens,
		skeletonTokens,
		minimumTokens,
		neededTokens: feasible ? minimumTokens : minimumTokens + 120,
		targetTokens: budget.target,
		maxTokens: budget.max,
		proseBudget,
		feasible,
		targetFeasible,
		reason,
	};
}

/** Every `##` heading in the file, in order, without duplicates. */
export function sectionNames(markdown: string): string[] {
	const out: string[] = [];
	for (const raw of String(markdown ?? "").split(/\r?\n/)) {
		const heading = /^##\s+(.+?)\s*$/.exec(raw);
		if (!heading) continue;
		const name = heading[1].trim();
		if (!out.includes(name)) out.push(name);
	}
	return out;
}

function parseSections(markdown: string): { name: string; lines: string[] }[] {
	const out: { name: string; lines: string[] }[] = [];
	let current: { name: string; lines: string[] } = { name: "", lines: [] };
	for (const raw of String(markdown ?? "").split(/\r?\n/)) {
		if (/^#\s+\S/.test(raw) && !/^##\s/.test(raw)) continue;
		if (/^\s*---CHANGELOG---\s*$/i.test(raw)) break;
		const heading = /^##\s+(.+?)\s*$/.exec(raw);
		if (heading) {
			if (current.name || current.lines.some((line) => line.trim())) out.push(current);
			current = { name: heading[1].trim(), lines: [] };
			continue;
		}
		current.lines.push(raw);
	}
	if (current.name || current.lines.some((line) => line.trim())) out.push(current);
	return out;
}

/**
 * The prose that the compressor may rewrite.
 *
 * Ledger table rows are removed (the table is code-built). A `## Facts`
 * section that held only a table disappears; a canonical `## Facts` section
 * with prose keeps its prose under `Facts summary`.
 */
export function splitProseSections(markdown: string): ProseSection[] {
	const out: ProseSection[] = [];
	for (const section of parseSections(markdown)) {
		const name = section.name.trim();
		if (!name) continue;
		const kept = section.lines.filter((line) => !/^\s*\|/.test(line));
		const body = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
		if (!body) continue;
		const isFacts = /^facts\b/i.test(name);
		out.push({
			name: isFacts ? "Facts summary" : name,
			body,
			tokens: estimateTokens(body),
		});
	}
	return out;
}

/** Group sections into 2-4 chunks in source order. */
export function groupIntoChunks(sections: ProseSection[], requested = 4): ProseChunk[] {
	if (sections.length === 0) return [];
	const wanted = Number.isFinite(requested) ? Math.floor(requested) : 4;
	const n = Math.max(1, Math.min(4, Math.max(2, wanted), sections.length));
	const groups: ProseSection[][] = [];
	let index = 0;
	for (let chunk = 0; chunk < n; chunk += 1) {
		const remainingChunks = n - chunk;
		const left = sections.length - index;
		const take = chunk === n - 1
			? left
			: Math.max(1, Math.min(left - (remainingChunks - 1), Math.round(left / remainingChunks)));
		groups.push(sections.slice(index, index + take));
		index += take;
	}
	return groups.map((group) => ({
		sections: group,
		text: group.map((section) => `## ${section.name}\n${section.body}`).join("\n\n"),
		tokens: group.reduce((sum, section) => sum + section.tokens, 0),
	}));
}

/** Split a chunk answer back into its sections; a missing heading is a failure, not a guess. */
export function parseChunkOutput(
	text: string,
	names: string[],
): { ok: boolean; bodies: Map<string, string>; reason: string } {
	const cleaned = String(text ?? "")
		.replace(/^\s*```[a-z]*\s*/i, "")
		.replace(/\s*```\s*$/i, "")
		.trim();
	const blocks: { name: string; body: string[] }[] = [];
	let current: { name: string; body: string[] } | null = null;
	for (const raw of cleaned.split(/\r?\n/)) {
		const heading = /^##\s+(.+?)\s*$/.exec(raw);
		if (heading) {
			current = { name: heading[1].trim(), body: [] };
			blocks.push(current);
			continue;
		}
		if (current) current.body.push(raw);
	}
	const bodies = new Map<string, string>();
	for (const block of blocks) {
		const body = block.body.join("\n").trim();
		if (!body) continue;
		const wanted = names.find((name) => name.toLowerCase() === block.name.toLowerCase())
			?? (names.length === 1 ? names[0] : undefined);
		if (wanted && !bodies.has(wanted)) bodies.set(wanted, body);
	}
	if (names.length === 1 && !bodies.has(names[0]) && cleaned && blocks.length === 0) {
		bodies.set(names[0], cleaned);
	}
	const missing = names.filter((name) => !bodies.has(name));
	return {
		ok: missing.length === 0,
		bodies,
		reason: missing.length ? `the compressed answer is missing section(s): ${missing.join(", ")}` : "",
	};
}

/** Everything that must survive: every ledger atom and every polarity rule. */
export function checkFidelity(source: string, output: string, ledger?: Ledger): FidelityReport {
	const sourceAtoms = extractAtoms(source);
	const expected = ledger ?? buildLedger(source);
	const sourceKeys = new Set(sourceAtoms.map((occurrence) => occurrence.key));
	const outputAtoms = extractAtoms(output);
	const outputKeys = new Set(outputAtoms.map((occurrence) => occurrence.key));
	const absent = expected.atoms.filter((key) => !outputKeys.has(key));
	const unknown = [...outputKeys].filter((key) => !sourceKeys.has(key));

	const outputLines = String(output ?? "").split(/\r?\n/);
	const lowerLines = outputLines.map((line) => line.toLowerCase());
	const rulesAbsent = expected.rules
		.filter((rule) => !lowerLines.some((line) => line.includes(rule.marker) && rule.anchors.some((anchor) => line.includes(anchor))))
		.map((rule) => `${rule.marker}: ${rule.anchors.join(", ")}`);

	// Context binding for values that survived in prose (the table is exempt:
	// it is code-built from the same source and its rows keep the values).
	const sourceByKey = new Map<string, AtomOccurrence[]>();
	const keysByLine = new Map<number, Set<string>>();
	for (const occurrence of sourceAtoms) {
		const list = sourceByKey.get(occurrence.key) ?? [];
		list.push(occurrence);
		sourceByKey.set(occurrence.key, list);
		const set = keysByLine.get(occurrence.lineIndex) ?? new Set<string>();
		set.add(occurrence.key);
		keysByLine.set(occurrence.lineIndex, set);
	}
	const contextViolations: string[] = [];
	for (const [lineIndex, line] of outputLines.entries()) {
		if (/^\s*\|/.test(line)) continue;
		const atoms = outputAtoms.filter((occurrence) => occurrence.lineIndex === lineIndex);
		if (atoms.length === 0) continue;
		const words = new Set(contentWords(line));
		const lineKeys = new Set(atoms.map((atom) => atom.key));
		for (const atom of atoms) {
			const candidates = sourceByKey.get(atom.key) ?? [];
			const anchored = candidates.some((candidate) => contentWords(candidate.line).some((word) => words.has(word)));
			if (!anchored) {
				contextViolations.push(`"${atom.display}" lost its source neighbours in: ${JSON.stringify(line.trim().slice(0, 90))}`);
				continue;
			}
			if (lineKeys.size < 2) continue;
			const paired = candidates.some((candidate) => {
				const neighbours = keysByLine.get(candidate.lineIndex) ?? new Set<string>();
				return [...lineKeys].some((key) => key !== atom.key && neighbours.has(key));
			});
			if (!paired) {
				contextViolations.push(`"${atom.display}" is next to atoms it never shared a source line with: ${JSON.stringify(line.trim().slice(0, 90))}`);
			}
		}
	}

	const reasons: string[] = [];
	if (absent.length) reasons.push(`the output lost ${absent.length} verbatim fact(s): ${absent.slice(0, 8).join(", ")}`);
	if (unknown.length) reasons.push(`the output contains ${unknown.length} value(s) absent from the source: ${unknown.slice(0, 8).join(", ")}`);
	if (rulesAbsent.length) reasons.push(`the output lost ${rulesAbsent.length} polarity rule(s): ${rulesAbsent.slice(0, 4).join("; ")}`);
	if (contextViolations.length) reasons.push(`the output moved ${contextViolations.length} value(s) away from their neighbours: ${contextViolations.slice(0, 4).join("; ")}`);
	return {
		ok: reasons.length === 0,
		reasons,
		atomsExpected: expected.atoms.length,
		atomsPresent: expected.atoms.filter((key) => outputKeys.has(key)).length,
		atomsAbsent: absent,
		unknownAtoms: unknown,
		rulesAbsent,
		contextViolations,
	};
}
