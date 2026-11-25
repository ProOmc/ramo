/**
 * Ramo's model transport.
 *
 * Ramo talks to one local OpenAI-compatible gateway, which forwards to Ollama or
 * llama.cpp. This module owns that transport: it builds the request, reads the
 * server-sent event stream, accumulates the streamed fragments into one assistant
 * message, and reports failures through the event stream instead of by throwing.
 *
 * It replaces Pi's provider layer (`third_party/pi/packages/ai/src/api/openai-completions.ts`).
 * Pi supported about eighty-five cloud providers with provider-specific quirks;
 * Ramo runs locally only, so the transport is one narrow, complete implementation
 * of the OpenAI chat-completions streaming shape instead of a provider matrix.
 *
 * Two behaviours are carried over from Pi's provider layer, because the local
 * gateway can stall and a stalled model must not hang a task for minutes:
 * the wait for the response headers is bounded, and a transport failure is
 * retried. The bound covers only the headers: once the model starts answering,
 * the stream is never cut off by a deadline, because a long answer is normal.
 */

import { EventStream } from "../kernel/stream.js";
import type {
	AssistantBlock,
	AssistantMessage,
	ResponseEvent,
	TextBlock,
	ThinkingBlock,
	ToolCallBlock,
	Usage,
} from "../kernel/types.js";

/** A local model profile selected in Ramo. */
export interface ModelProfile {
	id: string;
	label?: string;
	model: string;
	context: number;
	outputTokens: number;
	vision: boolean;
	/**
	 * The memory tier of the profile: `fast`, `standard` or `deep`.
	 *
	 * Declared per profile on purpose. It is not derived from `context`, because
	 * the desktop declares the same context for Fast and Smart.
	 */
	memoryTier?: string;
}

/** The local gateway connection details the worker receives at startup. */
export interface ModelConnection {
	baseUrl: string;
	token: string;
}

/** How the request body is adjusted before it is sent. */
export type PayloadTransform = (payload: Record<string, unknown>) => Record<string, unknown>;

export interface StreamRequest {
	profile: ModelProfile;
	messages: unknown[];
	tools?: { type: "function"; function: { name: string; description: string; parameters: unknown } }[];
	maxTokens?: number;
	temperature?: number;
	/** Applied to the request body before it is sent, for example to set the thinking mode. */
	transformPayload?: PayloadTransform;
}

export interface StreamOptions {
	signal?: AbortSignal;
	/** Overrides the wait for the response headers. Used by the tests. */
	headerTimeoutMs?: number;
	/** Overrides how many times a failed request is sent again. */
	maxAttempts?: number;
}

/**
 * How long the local model may take to start answering.
 *
 * A cold model has to load its weights before the first token, so the bound is
 * generous. It applies to the response headers only: once the stream has
 * started, the answer is allowed to run as long as it needs.
 */
export const HEADER_TIMEOUT_MS = 120_000;

/** How many times a failed request is sent again before the task is failed. */
export const MAX_ATTEMPTS = 3;

/** How long to wait before a failed request is sent again. */
const RETRY_DELAY_MS = 750;

/** A chunk of the OpenAI-compatible stream, as the local gateway forwards it. */
interface WireChunk {
	id?: string;
	model?: string;
	choices?: {
		index?: number;
		delta?: {
			content?: string | null;
			reasoning_content?: string;
			reasoning?: string;
			reasoning_text?: string;
			tool_calls?: {
				index?: number;
				id?: string;
				type?: string;
				function?: { name?: string; arguments?: string };
			}[];
		};
		finish_reason?: string | null;
	}[];
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
}

const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function mapStopReason(reason: string | null | undefined): AssistantMessage["stopReason"] {
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "tool_calls":
		case "function_call":
			return "toolUse";
		case "content_filter":
			return "error";
		default:
			return "stop";
	}
}

/**
 * Parse the streamed argument text of one capability call.
 *
 * A truncated or malformed argument string yields an empty argument object and a
 * description of the problem, so the kernel reports the failure instead of running
 * the call with silently wrong arguments.
 */
export function parseToolArguments(text: string): { arguments: Record<string, unknown>; error?: string } {
	const trimmed = text.trim();
	if (!trimmed) return { arguments: {} };
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return { arguments: {}, error: `arguments were a ${Array.isArray(parsed) ? "list" : typeof parsed}, not an object` };
		}
		return { arguments: parsed as Record<string, unknown> };
	} catch (error) {
		return {
			arguments: {},
			error: `arguments were not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Send one request and wait for the response headers.
 *
 * The wait is bounded, because a local model that has stalled must not hold a
 * task open indefinitely. The bound covers the headers only: the stream that
 * follows is never cut off, because a long answer is normal.
 */
async function sendOnce(
	payload: Record<string, unknown>,
	connection: ModelConnection,
	signal?: AbortSignal,
	headerTimeoutMs: number = HEADER_TIMEOUT_MS,
): Promise<Response> {
	const headerWait = AbortSignal.timeout(headerTimeoutMs);
	const requestSignal = signal ? AbortSignal.any([signal, headerWait]) : headerWait;
	try {
		return await fetch(`${connection.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${connection.token}`,
			},
			body: JSON.stringify(payload),
			signal: requestSignal,
		});
	} catch (error) {
		if (signal?.aborted) throw error;
		if (headerWait.aborted) {
			throw new Error(`The local model did not start answering within ${Math.round(headerTimeoutMs / 1000)} seconds.`);
		}
		throw error;
	}
}

/** Wait before the next attempt, unless the task is stopped in the meantime. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new Error("Request was aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Send the request, and send it again when the transport fails.
 *
 * A local gateway can drop a connection while a model is loading. That is a
 * transport failure rather than an answer, so the request is sent again. The
 * task is never retried after the user stopped it, and a refusal by the model
 * itself is not retried.
 */
export async function sendWithRetry(
	payload: Record<string, unknown>,
	connection: ModelConnection,
	signal?: AbortSignal,
	options: { headerTimeoutMs?: number; maxAttempts?: number } = {},
): Promise<Response> {
	const attempts = Math.max(1, options.maxAttempts ?? MAX_ATTEMPTS);
	let failure: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await sendOnce(payload, connection, signal, options.headerTimeoutMs);
			if (response.ok || response.status < 500 || response.status === 429) return response;
			const detail = (await response.text().catch(() => "")).slice(0, 2000);
			failure = new Error(`Local model returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
		} catch (error) {
			if (signal?.aborted) throw error;
			failure = error;
		}
		if (attempt < attempts) await wait(RETRY_DELAY_MS * attempt, signal);
	}
	throw failure instanceof Error ? failure : new Error(String(failure));
}

/**
 * Stream one assistant response from the local gateway.
 *
 * The returned stream always yields a final assistant message: on failure the
 * message carries `stopReason: "error"` and an error message, and on cancellation it
 * carries `stopReason: "aborted"`.
 */
export function streamResponse(
	request: StreamRequest,
	connection: ModelConnection,
	options: StreamOptions = {},
): EventStream<ResponseEvent, AssistantMessage> {
	const stream = new EventStream<ResponseEvent, AssistantMessage>(
		(event) => event.type === "done" || event.type === "error",
		(event) => {
			if (event.type === "done") return event.message;
			if (event.type === "error") return event.error;
			throw new Error("Unexpected event type for final result");
		},
	);

	void (async () => {
		const startedAt = Date.now();
		let firstTokenAt: number | null = null;
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			provider: "ramo",
			model: request.profile.model,
			usage: emptyUsage(),
			stopReason: "pending",
			timestamp: startedAt,
		};

		const blocks = output.content as AssistantBlock[];
		// The blocks live in maps rather than plain variables: they are created
		// inside the stream handlers, and a map read is not narrowed away by the
		// compiler the way a captured variable would be.
		const textBlocks = new Map<number, TextBlock>();
		const thinkingBlocks = new Map<number, ThinkingBlock>();
		const callBlocks = new Map<number, ToolCallBlock>();
		const partialArguments = new Map<number, string>();
		let sawFinishReason = false;
		// Set when the gateway sent a usage chunk. The fallback below only runs
		// then, because there is nothing to base token rates on otherwise.
		let sawUsageChunk = false;

		const contentIndex = (block: AssistantBlock) => blocks.indexOf(block);

		const ensureTextBlock = (): TextBlock => {
			const existing = textBlocks.get(0);
			if (existing) return existing;
			const block: TextBlock = { type: "text", text: "" };
			textBlocks.set(0, block);
			blocks.push(block);
			stream.push({ type: "text_start", contentIndex: contentIndex(block), partial: output });
			return block;
		};

		const ensureThinkingBlock = (signature: string): ThinkingBlock => {
			const existing = thinkingBlocks.get(0);
			if (existing) return existing;
			const block: ThinkingBlock = { type: "thinking", thinking: "", thinkingSignature: signature };
			thinkingBlocks.set(0, block);
			blocks.push(block);
			stream.push({ type: "thinking_start", contentIndex: contentIndex(block), partial: output });
			return block;
		};

		const ensureCallBlock = (index: number, id: string | undefined, name: string | undefined) => {
			let block = callBlocks.get(index);
			if (!block) {
				block = { type: "toolCall", id: id ?? "", name: name ?? "", arguments: {} };
				callBlocks.set(index, block);
				blocks.push(block);
				stream.push({ type: "toolcall_start", contentIndex: contentIndex(block), partial: output });
			}
			if (!block.id && id) block.id = id;
			if (!block.name && name) block.name = name;
			return block;
		};

		try {
			let payload: Record<string, unknown> = {
				model: request.profile.id,
				messages: request.messages,
				stream: true,
				stream_options: { include_usage: true },
			};
			if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens;
			if (request.temperature !== undefined) payload.temperature = request.temperature;
			if (request.tools && request.tools.length > 0) payload.tools = request.tools;
			if (request.transformPayload) payload = request.transformPayload(payload);

			const response = await sendWithRetry(payload, connection, options.signal, {
				headerTimeoutMs: options.headerTimeoutMs,
				maxAttempts: options.maxAttempts,
			});

			if (!response.ok) {
				const detail = (await response.text().catch(() => "")).slice(0, 2000);
				throw new Error(`Local model returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
			}
			if (!response.body) throw new Error("Local model returned an empty response stream");

			stream.push({ type: "start", partial: output });

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			const consumeLine = (line: string) => {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) return;
				const data = trimmed.slice(5).trim();
				if (!data || data === "[DONE]") return;
				let chunk: WireChunk;
				try {
					chunk = JSON.parse(data) as WireChunk;
				} catch {
					return;
				}
				if (chunk.usage) {
					sawUsageChunk = true;
					const input = chunk.usage.prompt_tokens ?? 0;
					const outputTokens = chunk.usage.completion_tokens ?? 0;
					const u = chunk.usage as Record<string, unknown> & { prompt_eval_duration?: unknown; eval_duration?: unknown; load_duration?: unknown };
					const promptMs = Number.isFinite(Number(u.prompt_eval_duration)) ? Math.round(Number(u.prompt_eval_duration) / 1_000_000) : undefined;
					const outputMs = Number.isFinite(Number(u.eval_duration)) ? Math.round(Number(u.eval_duration) / 1_000_000) : undefined;
					const loadMs = Number.isFinite(Number(u.load_duration)) ? Math.round(Number(u.load_duration) / 1_000_000) : undefined;
					output.usage = {
						...emptyUsage(),
						input,
						output: outputTokens,
						totalTokens: chunk.usage.total_tokens ?? input + outputTokens,
						promptMs,
						outputMs,
						loadMs,
						timeToFirstChunkMs: firstTokenAt === null ? undefined : Math.max(0, firstTokenAt - startedAt),
						promptTps: promptMs && promptMs > 0 ? input / (promptMs / 1000) : undefined,
						outputTps: outputMs && outputMs > 0 ? outputTokens / (outputMs / 1000) : undefined,
					};
				}
				const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
				if (!choice) return;
				if (choice.finish_reason) {
					output.stopReason = mapStopReason(choice.finish_reason);
					sawFinishReason = true;
				}
				const delta = choice.delta;
				if (!delta) return;
				if (delta.content !== undefined || delta.reasoning_content !== undefined) {
					if (firstTokenAt === null && String(delta.content ?? delta.reasoning_content ?? '').length > 0) firstTokenAt = Date.now();
				}

				// Reasoning must be handled before the text: some gateways aggregate
				// both into one delta, and the thinking block has to come first.
				for (const field of REASONING_FIELDS) {
					const value = delta[field];
					if (typeof value !== "string" || value.length === 0) continue;
					const block = ensureThinkingBlock(field);
					block.thinking += value;
					stream.push({ type: "thinking_delta", contentIndex: contentIndex(block), delta: value, partial: output });
					break;
				}

				if (typeof delta.content === "string" && delta.content.length > 0) {
					const block = ensureTextBlock();
					block.text += delta.content;
					stream.push({
						type: "text_delta",
						contentIndex: contentIndex(block),
						delta: delta.content,
						partial: output,
					});
				}

				for (const call of delta.tool_calls ?? []) {
					const index = typeof call.index === "number" ? call.index : 0;
					const block = ensureCallBlock(index, call.id, call.function?.name);
					const fragment = call.function?.arguments;
					if (typeof fragment === "string" && fragment.length > 0) {
						partialArguments.set(index, (partialArguments.get(index) ?? "") + fragment);
						const parsed = parseToolArguments(partialArguments.get(index) as string);
						block.arguments = parsed.arguments as ToolCallBlock["arguments"];
						// A fragment in the middle of the argument text is not valid
						// JSON yet. The error belongs to that fragment only, so it is
						// cleared as soon as a later fragment completes the object.
						if (parsed.error) block.argumentsError = parsed.error;
						else delete block.argumentsError;
						stream.push({
							type: "toolcall_delta",
							contentIndex: contentIndex(block),
							delta: fragment,
							partial: output,
						});
					}
				}
			};

			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let newline = buffer.indexOf("\n");
				while (newline !== -1) {
					consumeLine(buffer.slice(0, newline));
					buffer = buffer.slice(newline + 1);
					newline = buffer.indexOf("\n");
				}
				if (buffer.length > 32 * 1024 * 1024) throw new Error("Model stream frame exceeds 32 MiB");
			}
			if (buffer.trim()) consumeLine(buffer);

			if (options.signal?.aborted) throw new Error("Request was aborted");

			// llama.cpp's OpenAI-compatible endpoint reports token counts in usage
			// but no timing fields, so Ollama turns carry promptMs/outputMs/… from
			// the server while llama.cpp turns carry none. Whenever the server did
			// not supply a timing field, fall back to wall-clock measurements of the
			// stream itself — the same strategy Cherry Studio uses: startedAt is the
			// moment the request was sent, firstTokenAt is the first streamed
			// content chunk, and now is the moment the stream ended. Time to first
			// token covers prompt processing, so promptMs inherits it. Server values
			// always win; only the missing ones are synthesized.
			if (sawUsageChunk && firstTokenAt !== null) {
				const now = Date.now();
				const server = output.usage;
				const timeToFirstChunkMs = server.timeToFirstChunkMs ?? Math.max(0, firstTokenAt - startedAt);
				const promptMs = server.promptMs ?? timeToFirstChunkMs;
				const outputMs = server.outputMs ?? Math.max(0, now - firstTokenAt);
				output.usage = {
					...server,
					timeToFirstChunkMs,
					promptMs,
					outputMs,
					promptTps: server.promptTps ?? (promptMs > 0 ? server.input / (promptMs / 1000) : undefined),
					outputTps: server.outputTps ?? (outputMs > 0 ? server.output / (outputMs / 1000) : undefined),
				};
			}

			// Close the open blocks so the transcript holds final content.
			const finishedText = textBlocks.get(0);
			const finishedThinking = thinkingBlocks.get(0);
			if (finishedText) {
				stream.push({
					type: "text_end",
					contentIndex: contentIndex(finishedText),
					content: finishedText.text,
					partial: output,
				});
			}
			if (finishedThinking) {
				stream.push({
					type: "thinking_end",
					contentIndex: contentIndex(finishedThinking),
					content: finishedThinking.thinking,
					partial: output,
				});
			}
			for (const [index, block] of callBlocks) {
				const parsed = parseToolArguments(partialArguments.get(index) ?? "");
				block.arguments = parsed.arguments as ToolCallBlock["arguments"];
				if (parsed.error) block.argumentsError = parsed.error;
				else delete block.argumentsError;
				stream.push({ type: "toolcall_end", contentIndex: contentIndex(block), toolCall: block, partial: output });
			}

			if (!sawFinishReason) {
				output.stopReason = callBlocks.size > 0 ? "toolUse" : "stop";
			}
			output.durationMs = Date.now() - startedAt;
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			output.durationMs = Date.now() - startedAt;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}
