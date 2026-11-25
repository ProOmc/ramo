/**
 * Ramo context policy: token estimation, the compaction trigger, and the
 * summary that replaces older turns.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/coding-agent/src/core/compaction/compaction.ts`,
 * MIT licensed, Copyright (c) 2025 Mario Zechner). The trigger, the token
 * estimates and the summary format are preserved, because the summary format is
 * what the model reads to continue the work.
 *
 * Changes: this is Ramo's own implementation. The compaction record and the
 * context reconstruction live in Ramo's own session store.
 */

import type { TranscriptMessage } from "./types.js";

/** The estimated characters an image block occupies in the context. */
const ESTIMATED_IMAGE_CHARS = 4800;

export interface CompactionSettings {
	enabled: boolean;
	/** Tokens kept free for the answer. */
	reserveTokens: number;
	/** Tokens of recent work kept verbatim after a compaction. */
	keepRecentTokens: number;
}

/** The default compaction policy. */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
};

/** The prompt used to summarize a conversation into a checkpoint. */
export const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/** The prompt used to fold new messages into an existing checkpoint. */
export const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

function estimateContentChars(content: string | { type: string; text?: string }[]): number {
	if (typeof content === "string") return content.length;
	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && block.text) chars += block.text.length;
		else if (block.type === "image") chars += ESTIMATED_IMAGE_CHARS;
	}
	return chars;
}

/**
 * Estimate the tokens one message occupies.
 *
 * The estimate is deliberately conservative: it over-counts rather than
 * under-counts, so a compaction triggers before the context overflows.
 */
export function estimateTokens(message: TranscriptMessage): number {
	let chars = 0;
	switch (message.role) {
		case "system":
			chars = estimateContentChars(message.content);
			if (message.capabilitiesAdded) chars += JSON.stringify(message.capabilitiesAdded).length;
			return Math.ceil(chars / 4);
		case "user":
			return Math.ceil(estimateContentChars(message.content) / 4);
		case "assistant": {
			for (const block of message.content) {
				if (block.type === "text") chars += block.text.length;
				else if (block.type === "thinking") chars += block.thinking.length;
				else chars += JSON.stringify(block.arguments).length;
			}
			return Math.ceil(chars / 4);
		}
		case "toolResult": {
			for (const block of message.content) {
				if (block.type === "text") chars += block.text.length;
				else chars += ESTIMATED_IMAGE_CHARS;
			}
			return Math.ceil(chars / 4);
		}
		default:
			return 0;
	}
}

/** The tokens a list of messages occupies. */
export function estimateMessagesTokens(messages: TranscriptMessage[]): number {
	return messages.reduce((total, message) => total + estimateTokens(message), 0);
}

/** Whether the context is large enough to warrant a compaction. */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	if (!settings.enabled) return false;
	return contextTokens > contextWindow - settings.reserveTokens;
}

/**
 * Whether a message may start a cut.
 *
 * A tool result must never start a cut: it has to follow the tool call it
 * answers. A user message, an assistant message or a summary may.
 */
function isCutPoint(message: TranscriptMessage): boolean {
	return message.role === "user" || message.role === "assistant";
}

/**
 * Find where to cut the transcript.
 *
 * The cut keeps the recent work and drops the older turns, which are replaced by
 * the summary. The walk goes backwards from the newest message and accumulates
 * the estimated size until the budget is reached; the cut then lands on the
 * closest cut point at or after that message, so a turn is never split in half.
 *
 * This mirrors Pi 1.4.0's `findCutPoint` (`third_party/pi/packages/coding-agent/
 * src/core/compaction/compaction.ts:446-501`), which walks the session entries
 * backwards and cuts at a user or assistant message.
 */
export function findCutPoint(messages: TranscriptMessage[], keepRecentTokens: number): number {
	const cutPoints: number[] = [];
	for (let index = 0; index < messages.length; index++) {
		if (isCutPoint(messages[index])) cutPoints.push(index);
	}
	if (cutPoints.length === 0) return 0;

	let accumulated = 0;
	let cutIndex = cutPoints[0];
	for (let index = messages.length - 1; index >= 0; index--) {
		const tokens = estimateTokens(messages[index]);
		if (tokens === 0) continue;
		accumulated += tokens;
		if (accumulated >= keepRecentTokens) {
			// Prefer the closest cut point at or after this message. When the
			// trailing tool results exceed the budget by themselves, their
			// preceding assistant message is kept instead of the first message.
			cutIndex = cutPoints.find((candidate) => candidate >= index) ?? cutPoints[cutPoints.length - 1];
			break;
		}
	}
	return cutIndex;
}

/**
 * Rebuild the model context after a compaction.
 *
 * The summary replaces the dropped turns, and the kept recent messages follow it.
 * The system message is replayed so the prompt and the capability set survive.
 */
export function buildCompactedContext(
	allMessages: TranscriptMessage[],
	cutIndex: number,
	summary: string,
	systemContent: string,
): TranscriptMessage[] {
	const kept = allMessages.slice(cutIndex);
	return [
		{ role: "system", content: systemContent, timestamp: Date.now() },
		{ role: "user", content: summary, timestamp: Date.now() },
		...kept,
	];
}

/**
 * The compaction policy for a model context size.
 *
 * Ramo keeps a quarter of the window free for the answer and an eighth for
 * recent work, so a long task compacts before it overflows.
 */
export function compactionPolicy(context = 65536): CompactionSettings {
	const size = Math.max(1024, Number(context) || 65536);
	return {
		enabled: true,
		reserveTokens: Math.min(16384, Math.floor(size / 4)),
		keepRecentTokens: Math.min(8192, Math.floor(size / 8)),
	};
}
