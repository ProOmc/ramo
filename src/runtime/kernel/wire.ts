/**
 * Conversion between the Ramo transcript and the OpenAI-compatible wire format.
 *
 * The local gateway accepts the OpenAI chat-completions shape, so the transcript is
 * translated here. Derived from Pi 1.4.0's message transformation
 * (`third_party/pi/packages/ai/src/api/transform-messages.ts` and
 * `openai-completions.ts`, MIT licensed, Copyright (c) 2025 Mario Zechner), with
 * Ramo's own vocabulary and without the provider-specific branches.
 */

import type { TranscriptMessage, WireContentPart, WireMessage, WireToolCall } from "./types.js";

/** The provider fields that may carry reasoning on an assistant message. */
const REASONING_FIELDS = new Set(["reasoning_content", "reasoning", "reasoning_text"]);

/** The text of a message, without images. */
export function messageText(message: TranscriptMessage): string {
	if (message.role === "user") {
		if (typeof message.content === "string") return message.content;
		return message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	if (message.role === "assistant") {
		return message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("");
	}
	if (message.role === "toolResult") {
		return message.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	return message.content;
}

/**
 * Translate the transcript into the messages the gateway accepts.
 *
 * Capability results become `tool` messages that name the call they answer, so the
 * model can match a result to its request.
 */
export function toWireMessages(messages: TranscriptMessage[]): WireMessage[] {
	const wire: WireMessage[] = [];
	for (const message of messages) {
		if (message.role === "system") {
			wire.push({ role: "system", content: message.content });
			continue;
		}
		if (message.role === "user") {
			if (typeof message.content === "string") {
				wire.push({ role: "user", content: message.content });
				continue;
			}
			const parts: WireContentPart[] = message.content.map((block) =>
				block.type === "text"
					? { type: "text", text: block.text }
					: { type: "image_url", image_url: { url: `data:${block.mimeType};base64,${block.data}` } },
			);
			wire.push({ role: "user", content: parts });
			continue;
		}
		if (message.role === "assistant") {
			const text = messageText(message);
			const toolCalls: WireToolCall[] = message.content
				.filter((block): block is Extract<typeof block, { type: "toolCall" }> => block.type === "toolCall")
				.map((block) => ({
					id: block.id,
					type: "function" as const,
					function: { name: block.name, arguments: JSON.stringify(block.arguments) },
				}));
			const thinking = message.content
				.filter((block): block is Extract<typeof block, { type: "thinking" }> => block.type === "thinking")
				.map((block) => block.thinking)
				.join("\n\n");
			const reasoningField = message.content.find(
				(block): block is Extract<typeof block, { type: "thinking" }> =>
					block.type === "thinking" && !!block.thinkingSignature && REASONING_FIELDS.has(block.thinkingSignature),
			)?.thinkingSignature;
			const entry: WireMessage = {
				role: "assistant",
				content: toolCalls.length > 0 && text.length === 0 ? null : text,
				...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
				...(thinking.length > 0 && reasoningField ? { [reasoningField]: thinking } : {}),
			};
			wire.push(entry);
			continue;
		}
		wire.push({
			role: "tool",
			content: messageText(message),
			tool_call_id: message.toolCallId,
			name: message.toolName,
		});
	}
	return wire;
}
