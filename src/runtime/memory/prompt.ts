/**
 * Selection of the memory text that is injected into the system prompt.
 *
 * MEMORY.md is the source of truth and is never rewritten here. This module
 * only decides which part of it a model with a given budget can see. The
 * identity core is always kept; the rest is included by priority until the
 * budget is reached, and whatever is left out is named as one `memory_recall`
 * away rather than silently dropped.
 */

import { estimateTokens } from "./file.js";

/** The tools line that opens the memory section of the system prompt. */
export const MEMORY_TOOLS_LINE =
	"Use `memory_recall` before saying you do not know something about the user, `memory_save` when the user asks you to remember something, and `memory_forget` when the user asks to forget. Edit MEMORY.md directly in the memory tab only when the user really wants to hand-edit it. Do not invent facts beyond what the file holds.";

/** Muse is a separate assistant; the boundary is stated on every injection. */
export const MUSE_BOUNDARY_LINE =
	"Muse is a different assistant from Ramo. Anything about Muse stays in its own section and is never treated as Ramo's own memory.";

const OMITTED_NOTE =
	"_Part of MEMORY.md is not shown here so the prompt stays inside this model's memory budget. Call `memory_recall` for anything else about the user before saying you do not know._";

export interface SelectedPrompt {
	/** The complete memory section, ready to be appended to the system prompt. */
	text: string;
	/** Estimated tokens of `text`. Never above `budget`. */
	tokens: number;
	budget: number;
	/** Whether any section was dropped or shortened. */
	truncated: boolean;
	/** Sections that were included, whole or in part. */
	kept: string[];
	/** Sections that were dropped or shortened. */
	omitted: string[];
	/** Estimated tokens of the memory file before selection. */
	sourceTokens: number;
}

interface Section {
	name: string;
	lines: string[];
	priority: number;
	core: boolean;
}

/**
 * Priority when the file does not fit. Commitments are promises the agent owes
 * the user, facts are what the user said, projects are live state. The Muse
 * section goes last because it is not memory about the user.
 */
function sectionPriority(name: string): number {
	if (/^commitments?\b/i.test(name)) return 1;
	if (/^facts?\b/i.test(name)) return 2;
	if (/^projects?\b/i.test(name)) return 3;
	if (/^notes about muse\b/i.test(name)) return 5;
	return 4;
}

function isCore(name: string): boolean {
	return /^about you\b/i.test(name) || /^preferences?\b/i.test(name);
}

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && !lines[start].trim()) start += 1;
	while (end > start && !lines[end - 1].trim()) end -= 1;
	return lines.slice(start, end);
}

/** Split the file into its preamble and its `##` sections. `# Memory` is dropped. */
function parseMemory(markdown: string): { preamble: string[]; sections: Section[] } {
	const preamble: string[] = [];
	const sections: Section[] = [];
	let current: Section | null = null;
	for (const raw of String(markdown ?? "").split(/\r?\n/)) {
		if (/^#\s+\S/.test(raw) && !/^##\s/.test(raw)) continue;
		const heading = /^##\s+(.+?)\s*$/.exec(raw);
		if (heading) {
			current = {
				name: heading[1].trim(),
				lines: [],
				priority: sectionPriority(heading[1]),
				core: isCore(heading[1]),
			};
			sections.push(current);
			continue;
		}
		if (current) current.lines.push(raw);
		else preamble.push(raw);
	}
	return { preamble: trimBlankEdges(preamble), sections };
}

function render(
	header: string[],
	preamble: string[],
	sections: Section[],
	chosen: Map<Section, string[]>,
	note: string | null,
): string {
	const body: string[] = [...header];
	if (preamble.length) body.push("", ...preamble);
	for (const section of sections) {
		const lines = chosen.get(section);
		if (!lines) continue;
		body.push("", `## ${section.name}`);
		const trimmed = trimBlankEdges(lines);
		if (trimmed.length) body.push(...trimmed);
	}
	if (note) body.push("", note);
	return trimBlankEdges(body).join("\n");
}

/**
 * Select the part of `markdown` that fits in `budget` estimated tokens.
 *
 * The whole section (headers, tools line, Muse boundary) counts toward the
 * budget, so the result is what the model actually sees.
 */
export function selectPrompt(
	markdown: string,
	options: { budget: number; toolsLine?: string },
): SelectedPrompt {
	const budget = Math.max(1, Math.floor(Number(options.budget) || 1));
	const sourceTokens = estimateTokens(markdown);
	const { preamble, sections } = parseMemory(markdown);
	const header = [
		"# Memory",
		"",
		options.toolsLine ?? MEMORY_TOOLS_LINE,
		"",
		MUSE_BOUNDARY_LINE,
	];
	const all = new Map<Section, string[]>(
		sections.map((section): [Section, string[]] => [section, [...section.lines]]),
	);
	const whole = render(header, preamble, sections, all, null);
	if (estimateTokens(whole) <= budget) {
		return {
			text: whole,
			tokens: estimateTokens(whole),
			budget,
			truncated: false,
			kept: sections.map((section) => section.name),
			omitted: [],
			sourceTokens,
		};
	}

	// Truncating. The identity core is kept first, then the rest by priority.
	const chosen = new Map<Section, string[]>();
	const omitted: string[] = [];
	for (const section of sections) {
		if (section.core) chosen.set(section, [...section.lines]);
	}
	let current = render(header, preamble, sections, chosen, OMITTED_NOTE);
	// The core is small in practice, but a hard cap is still a hard cap.
	while (estimateTokens(current) > budget) {
		const core = sections
			.filter((section) => section.core)
			.reverse()
			.find((section) => (chosen.get(section)?.length ?? 0) > 0);
		if (!core) break;
		const lines = chosen.get(core) as string[];
		while (lines.length > 0 && !(lines[lines.length - 1] ?? "").trim()) lines.pop();
		if (lines.length > 0) lines.pop();
		current = render(header, preamble, sections, chosen, OMITTED_NOTE);
	}

	const indexOf = new Map<Section, number>(
		sections.map((section, index): [Section, number] => [section, index]),
	);
	const ranked = sections
		.filter((section) => !section.core)
		.sort((left, right) => left.priority - right.priority || (indexOf.get(left) ?? 0) - (indexOf.get(right) ?? 0));
	for (const section of ranked) {
		const lines: string[] = [];
		chosen.set(section, lines);
		let complete = true;
		for (const line of section.lines) {
			lines.push(line);
			if (estimateTokens(render(header, preamble, sections, chosen, OMITTED_NOTE)) > budget) {
				lines.pop();
				complete = false;
				break;
			}
		}
		if (lines.every((line) => !line.trim())) {
			chosen.delete(section);
			omitted.push(section.name);
		} else if (!complete) {
			omitted.push(section.name);
		}
	}

	const text = render(header, preamble, sections, chosen, OMITTED_NOTE);
	const tokens = estimateTokens(text);
	return {
		text,
		tokens,
		budget,
		truncated: true,
		kept: sections.filter((section) => chosen.has(section)).map((section) => section.name),
		omitted,
		sourceTokens,
	};
}
