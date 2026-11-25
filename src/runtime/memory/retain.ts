/**
 * The retainer.
 *
 * The model is the judge; the code never rejects its content for any reason
 * except credentials. "Grounding" (quote present, hypothetical excluded,
 * certainty from wording) is an instruction to the model, carried in the
 * system prompt, not a code gate.
 *
 * What the retainer does is small: it turns a completed turn into zero or
 * more prose lines appended to today's daily note. The nightly dream reads
 * the daily notes and decides what is evergreen.
 */

import fs from "node:fs";
import path from "node:path";

import { findSecret, readDailySince, type MemoryPaths } from "./file.js";
import type { DreamModel } from "./dream.js";

export type RetainModel = DreamModel;

export interface RetainResult {
	added: number;
	lines: string[];
}

const SYSTEM_PROMPT = `You read one turn from a local AI assistant and record what is worth keeping, for future sessions.

Return one JSON object, always: {"items": ["..."]}.

Rules:
- Zero or more items. An empty list is correct when nothing was learned.
- Each item is one short line of prose, in the third person, like "Prefers amber over teal for the terminal theme." Write plain facts only.
- Record what is true for the user's current situation, and let old material fade on its own. If the user corrected something today, say so plainly: "The terminal theme is amber (was teal)."
- Quotes: keep figures, names, dates and thresholds exactly as the user stated them. Do not round or rephrase them.
- The user's raw numbers are part of the signal; keep them exactly as stated, never normalised.
- Never record passwords, keys, tokens or any credential; name them only as existing.
- Do not record what the user asked you to do. Record what the user said about themselves, their life, their work, their preferences or their decisions.
- Never record a question, not even a question about the user's own life ("What RAM should I buy?", "Should I sell the 32GB kit?"). A question asks; it does not state a fact. If the only content is a question, return {"items":[]}.
- Never record an instruction about how to write these notes, or any meta-commentary about the retainer, the records or the memory file.
- Ignore greetings and thanks.
- Ignore hypothetical or conditional statements ("if I moved", "suppose I", "I would"): they are not facts.
- If the user hedges ("maybe", "perhaps", "I think"), keep the hedge in the line.
Use only what the user actually said, not what you think.`;

const EXAMPLES = [
	{ role: "user" as const, content: "My name is Mira Chen. I'm a sound designer. I drink green tea every morning, not coffee." },
	{ role: "assistant" as const, content: '{"items":["My name is Mira Chen.","The user is a sound designer.","The user drinks green tea, not coffee, and prefers it over coffee."]}' },
	{ role: "user" as const, content: "If I moved to Seattle I'd try that coffee place down the street, maybe." },
	{ role: "assistant" as const, content: '{"items":[]}' },
];

export interface RetainOptions {
	paths: MemoryPaths;
	model: RetainModel;
	userText: string;
	sessionId?: string | null;
	isolated?: boolean;
	at?: Date;
	signal?: AbortSignal;
}

export async function retainTurn(options: RetainOptions): Promise<RetainResult | null> {
	if (options.isolated) return null;
	const text = options.userText.trim();
	if (!text || !options.model) return null;

	// Enforce only the credential promise and the question filter. Everything
	// else below is a model call.
	const answer = await options.model.complete({
		system: SYSTEM_PROMPT,
		prompt: `The user said this in their last message:\n\n"""\n${text}\n"""\n\nReturn the JSON object now.`,
		examples: EXAMPLES,
		signal: options.signal,
		json: true,
	});

	let items: string[] = [];
	try {
		const match = /\{[\s\S]*\}/.exec(answer.text);
		if (!match) return { added: 0, lines: [] };
		const body = JSON.parse(match[0]) as { items?: unknown };
		items = Array.isArray(body.items) ? body.items.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean) : [];
	} catch {
		return { added: 0, lines: [] };
	}
	const kept = items.filter((line) => !findSecret(line) && !looksLikeQuestion(line) && !looksLikeMetaInstruction(line));
	if (kept.length === 0) return { added: 0, lines: [] };

	const file = path.join(options.paths.dir, "notes", "daily", `${dayOfFile(options.at ?? new Date())}.md`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const time = timeString(options.at ?? new Date());
	const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
	const header = existing.length === 0 ? `# Daily note — ${dayOfFile(options.at ?? new Date())}\n\nTrimmed raw input for the dream. Never injected wholesale.\n\n` : "";
	const lesson = kept.map((line) => `- ${dayOfFile(options.at ?? new Date())} ${time} ${line}`).join("\n");
	fs.appendFileSync(file, `${header}${lesson}\n`, "utf-8");
	return { added: kept.length, lines: kept };
}

function dayOfFile(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function timeString(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

/**
 * Bug 3: a user's question is not a fact the user stated.
 *
 * This is a code-owned guard on top of the instruction in the system prompt,
 * because the retainer still returned questions in the step-2 run. It is
 * deliberately conservative: it only drops a line that ends in a question mark
 * or opens with a question word followed by a pronoun/auxiliary, so a stated
 * preference such as "Do not disturb mode stays on" survives.
 */
export function looksLikeQuestion(line: string): boolean {
	const text = String(line ?? "").trim();
	if (!text) return false;
	if (/\?\s*$/.test(text)) return true;
	const opener = /^(what|why|how|when|where|who|whom|whose|which|can|could|would|will|should|shall|do|does|did|is|are|am|was|were|have|has|had|may|might|must)\s+(i|you|we|they|he|she|it|the|a|an|my|your|his|her|their|our|this|that|these|those|there|any|some|many|much|often|long|far|about)\b/i;
	if (!opener.test(text)) return false;
	// "Do not ..." is a preference, not a question.
	if (/^do\s+not\b/i.test(text) || /^don't\b/i.test(text)) return false;
	return true;
}

/** The step-2 leak: the retainer's own instruction stored as a memory line. */
export function looksLikeMetaInstruction(line: string): boolean {
	const text = String(line ?? "");
	return /raw numbers are part of the signal|do not normalize (them|the numbers) in the records|never record (a )?question|return \{"items"/i.test(text);
}
