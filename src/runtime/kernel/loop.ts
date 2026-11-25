/**
 * The Ramo kernel turn loop.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/agent/src/agent-loop.ts`, MIT
 * licensed, Copyright (c) 2025 Mario Zechner). The behaviour is preserved: a turn is
 * one assistant response plus its capability calls and results; capability batches
 * run in parallel unless a capability forces sequential execution; a response cut off
 * by the output token limit fails its capability calls instead of running them with
 * truncated arguments; steering and follow-up messages are drained at the same
 * points.
 *
 * Changes from the upstream file:
 * - the vocabulary is Ramo's own (turn, capability, transcript);
 * - the provider call is injected as a `respond` function instead of reaching into
 *   Pi's model registry, so the kernel has no model-provider dependency at all;
 * - the capability registry and the permission hooks live in the kernel configuration
 *   rather than in an extension system;
 * - schema validation is Ramo's own, without typebox.
 */

import { coerceCapabilityArguments, getCapabilityStateChanges, getCurrentCapabilities, toDeclaration, validateCapabilityArguments } from "./schema.js";
import { EventStream } from "./stream.js";
import type {
	AssistantMessage,
	Capability,
	CapabilityOutcome,
	CapabilityResult,
	JsonObject,
	KernelEvent,
	LoopConfig,
	PermissionDecision,
	ResponseEvent,
	ResultAdjustment,
	ToolCallBlock,
	ToolDeclaration,
	ToolResultMessage,
	TranscriptMessage,
	TurnCompletion,
	TurnContext,
	TurnDecision,
	TurnUpdate,
} from "./types.js";

export type KernelEventSink = (event: KernelEvent) => Promise<void> | void;

/**
 * Performs one model request.
 *
 * The function receives the transcript and returns the response events. Failures
 * must be reported through the stream rather than by throwing, so the kernel always
 * produces a normal event sequence.
 */
export type RespondFn = (
	messages: TranscriptMessage[],
	config: LoopConfig,
	signal: AbortSignal | undefined,
) => AsyncIterable<ResponseEvent> & { result(): Promise<AssistantMessage> };

/**
 * Start a kernel run with new prompt messages.
 *
 * The prompt is appended to the context and events are emitted for it.
 */
export function runKernel(
	prompts: TranscriptMessage[],
	context: TurnContext,
	config: LoopConfig,
	signal: AbortSignal | undefined,
	respond: RespondFn,
): EventStream<KernelEvent, TranscriptMessage[]> {
	const stream = createKernelStream();
	void runKernelLoop(prompts, context, config, async (event) => {
		stream.push(event);
	}, signal, respond).then((messages) => {
		stream.end(messages);
	});
	return stream;
}

/**
 * Continue a kernel run from the current transcript without adding a message.
 *
 * The last message in the transcript must be a user or tool-result message, or the
 * provider will reject the request.
 */
export function runKernelContinue(
	context: TurnContext,
	config: LoopConfig,
	signal: AbortSignal | undefined,
	respond: RespondFn,
): EventStream<KernelEvent, TranscriptMessage[]> {
	if (context.messages.length === 0) throw new Error("Cannot continue: no messages in the transcript");
	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}
	const stream = createKernelStream();
	void runKernelLoopContinue(context, config, async (event) => {
		stream.push(event);
	}, signal, respond).then((messages) => {
		stream.end(messages);
	});
	return stream;
}

export async function runKernelLoop(
	prompts: TranscriptMessage[],
	context: TurnContext,
	config: LoopConfig,
	emit: KernelEventSink,
	signal: AbortSignal | undefined,
	respond: RespondFn,
): Promise<TranscriptMessage[]> {
	const initialMessages = declareCapabilityChanges(context, prompts);
	const newMessages: TranscriptMessage[] = [...initialMessages];
	const currentContext: TurnContext = {
		...context,
		messages: [...context.messages, ...initialMessages],
	};

	await emit({ type: "run_start" });
	await emit({ type: "turn_start" });
	for (const message of initialMessages) {
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
	}

	await runTurns(currentContext, newMessages, config, signal, emit, respond);
	return newMessages;
}

export async function runKernelLoopContinue(
	context: TurnContext,
	config: LoopConfig,
	emit: KernelEventSink,
	signal: AbortSignal | undefined,
	respond: RespondFn,
): Promise<TranscriptMessage[]> {
	if (context.messages.length === 0) throw new Error("Cannot continue: no messages in the transcript");
	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}
	const newMessages: TranscriptMessage[] = [];
	const currentContext: TurnContext = { ...context };

	await emit({ type: "run_start" });
	await emit({ type: "turn_start" });

	await runTurns(currentContext, newMessages, config, signal, emit, respond);
	return newMessages;
}

function createKernelStream(): EventStream<KernelEvent, TranscriptMessage[]> {
	return new EventStream<KernelEvent, TranscriptMessage[]>(
		(event: KernelEvent) => event.type === "run_end",
		(event: KernelEvent) => (event.type === "run_end" ? event.messages : []),
	);
}

/** The main loop, shared by the prompt and continuation entry points. */
async function runTurns(
	initialContext: TurnContext,
	newMessages: TranscriptMessage[],
	initialConfig: LoopConfig,
	signal: AbortSignal | undefined,
	emit: KernelEventSink,
	respond: RespondFn,
): Promise<void> {
	let currentContext = initialContext;
	let config = initialConfig;
	let lastCompletedTurn: TurnCompletion | undefined;
	let explicitContinuation = false;
	let pendingMessages: TranscriptMessage[] = (await config.getSteeringMessages?.()) || [];
	// Loop guard: a repeat of the same tool-call batch, or too many calls in one
	// answer, is stopped with a short result instead of spinning forever.
	let previousBatchSignature = "";
	let identicalBatches = 0;
	let totalToolCalls = 0;
	let guardRounds = 0;

	while (true) {
		let hasMoreCapabilityCalls = true;

		while (hasMoreCapabilityCalls || pendingMessages.length > 0) {
			let preparedMessages: TranscriptMessage[] = [];
			if (lastCompletedTurn) {
				const nextTurn = await config.prepareNextTurn?.(lastCompletedTurn);
				if (nextTurn) {
					currentContext = nextTurn.context ?? currentContext;
					preparedMessages = nextTurn.messages ?? [];
					config = {
						...config,
						model: nextTurn.model ?? config.model,
						thinkingLevel: nextTurn.thinkingLevel ?? config.thinkingLevel,
					};
				}
				// Preparation can be long-running, for example compaction. Pick up
				// steering queued while it ran, but only poll again when the earlier
				// poll returned nothing.
				if (pendingMessages.length === 0) pendingMessages = (await config.getSteeringMessages?.()) || [];
				await emit({ type: "turn_start" });
			}

			for (const message of declareCapabilityChanges(currentContext, [...preparedMessages, ...pendingMessages])) {
				await emit({ type: "message_start", message });
				await emit({ type: "message_end", message });
				currentContext.messages.push(message);
				newMessages.push(message);
			}
			pendingMessages = [];

			const requestUpdate = await config.prepareRequest?.(
				{
					context: currentContext,
					model: config.model,
					thinkingLevel: config.thinkingLevel ?? "off",
				},
				signal,
			);
			if (requestUpdate) {
				currentContext = requestUpdate.context ?? currentContext;
				config = {
					...config,
					model: requestUpdate.model ?? config.model,
					thinkingLevel: requestUpdate.thinkingLevel ?? config.thinkingLevel,
				};
			}

			const message = await streamResponse(currentContext, config, signal, emit, respond);
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
				lastCompletedTurn = { message, toolResults: [], context: currentContext, newMessages };
				await config.finishTurn?.(lastCompletedTurn, signal);
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({ type: "run_end", messages: newMessages });
				return;
			}

			const capabilityCalls = message.content.filter((block): block is ToolCallBlock => block.type === "toolCall");

			const toolResults: ToolResultMessage[] = [];
			hasMoreCapabilityCalls = false;
			let guardedTurn = false;
			if (capabilityCalls.length > 0) {
				const signature = capabilityCalls
					.map((call) => `${call.name}:${JSON.stringify(call.arguments)}`)
					.join("|");
				identicalBatches = signature === previousBatchSignature ? identicalBatches + 1 : 0;
				previousBatchSignature = signature;
				totalToolCalls += capabilityCalls.length;
				const repeated = identicalBatches >= 2;
				const exhausted = totalToolCalls > 24;
				guardedTurn = repeated || exhausted;
				// A "length" stop means the output was cut off by the token limit, so
				// every capability call in the message may carry truncated arguments.
				// Fail them all instead of executing potentially broken calls.
				const batch =
					repeated || exhausted
						? await failRepeatedBatch(
								capabilityCalls,
								exhausted
									? "Stopped: too many tool calls in this answer. Answer from what you have."
									: "Stopped: the same tool call was repeated. Answer from what you have or ask the user.",
								emit,
							)
						: message.stopReason === "length"
							? await failCallsFromTruncatedMessage(capabilityCalls, emit)
							: await executeCapabilityCalls(currentContext, message, config, signal, emit);
				toolResults.push(...batch.messages);
				hasMoreCapabilityCalls = !batch.terminate;

				for (const result of toolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
				}
			}

			lastCompletedTurn = { message, toolResults, context: currentContext, newMessages };
			const decision = await config.finishTurn?.(lastCompletedTurn, signal);
			await emit({ type: "turn_end", message, toolResults });

			// A guarded loop gets one forced answer turn: the model is told to
			// stop calling tools and answer from what it has. If it loops again,
			// the run ends rather than spinning forever. The instruction is a
			// turn control message, not a canned answer — all visible answer text
			// still comes from the model.
			if (guardedTurn) {
				guardRounds += 1;
				if (guardRounds >= 2) {
					await emit({ type: "run_end", messages: newMessages });
					return;
				}
				currentContext.messages.push({
					role: "user",
					content: "Stop calling tools now. Answer the user in plain text from what you have already done. Do not make another tool call.",
					timestamp: Date.now(),
				});
			}

			if (decision?.action === "end") {
				await emit({ type: "run_end", messages: newMessages });
				return;
			}

			explicitContinuation = decision?.action === "continue";
			pendingMessages = (await config.getSteeringMessages?.()) || [];
			if (hasMoreCapabilityCalls || pendingMessages.length > 0) explicitContinuation = false;
		}

		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			explicitContinuation = false;
			pendingMessages = followUpMessages;
			continue;
		}

		if (explicitContinuation) {
			explicitContinuation = false;
			continue;
		}

		break;
	}

	await emit({ type: "run_end", messages: newMessages });
}

/**
 * Declare capability loadout changes to the model.
 *
 * The executable set is what the kernel can run; the transcript's system messages
 * declare what the model may call. Before each request the difference is announced
 * with a system message, so the replayed transcript always yields exactly the
 * executable set.
 */
function declareCapabilityChanges(
	context: TurnContext,
	pendingMessages: TranscriptMessage[],
): TranscriptMessage[] {
	let systemIndex = -1;
	for (let index = pendingMessages.length - 1; index >= 0; index--) {
		if (pendingMessages[index].role === "system") {
			systemIndex = index;
			break;
		}
	}
	const pending = systemIndex === -1 ? undefined : (pendingMessages[systemIndex] as TranscriptMessage & { role: "system" });
	const baseline = pending
		? pendingMessages.map((message, index) =>
				index === systemIndex ? withCapabilityChanges(pending, { capabilitiesAdded: [], capabilitiesRemoved: [] }) : message,
			)
		: pendingMessages;
	const changes = getCapabilityStateChanges(
		getCurrentCapabilities([...context.messages, ...baseline]),
		(context.capabilities ?? []).map((capability) => toDeclaration(capability)),
	);
	const unchanged = changes.capabilitiesAdded.length === 0 && changes.capabilitiesRemoved.length === 0;

	if (pending) {
		if (unchanged && !pending.capabilitiesAdded?.length && !pending.capabilitiesRemoved?.length) return pendingMessages;
		return baseline.map((message, index) =>
			index === systemIndex ? withCapabilityChanges(pending, changes) : message,
		);
	}
	if (unchanged) return pendingMessages;
	const update = withCapabilityChanges(
		{ role: "system", content: "", timestamp: Date.now() },
		changes,
	);
	const insertIndex = pendingMessages.findIndex((message) => message.role !== "system");
	const index = insertIndex === -1 ? pendingMessages.length : insertIndex;
	return [...pendingMessages.slice(0, index), update, ...pendingMessages.slice(index)];
}

/** Copy a system message with its capability fields replaced. Empty lists omit the field. */
function withCapabilityChanges(
	message: TranscriptMessage & { role: "system" },
	changes: { capabilitiesAdded: ToolDeclaration[]; capabilitiesRemoved: { name: string }[] },
): TranscriptMessage & { role: "system" } {
	const { capabilitiesAdded: _added, capabilitiesRemoved: _removed, ...rest } = message;
	return {
		...rest,
		...(changes.capabilitiesAdded.length > 0 ? { capabilitiesAdded: changes.capabilitiesAdded } : {}),
		...(changes.capabilitiesRemoved.length > 0 ? { capabilitiesRemoved: changes.capabilitiesRemoved } : {}),
	};
}

/** Stream one assistant response and fold it into the transcript. */
async function streamResponse(
	context: TurnContext,
	config: LoopConfig,
	signal: AbortSignal | undefined,
	emit: KernelEventSink,
	respond: RespondFn,
): Promise<AssistantMessage> {
	let messages = context.messages;
	if (config.transformContext) messages = await config.transformContext(messages, signal);

	const response = respond(messages, config, signal);
	const result = async () => Object.assign(await response.result(), { thinkingLevel: config.thinkingLevel ?? "off" });

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				await emit({ type: "message_start", message: { ...partialMessage } });
				break;

			case "text_start":
			case "text_delta":
			case "text_end":
			case "thinking_start":
			case "thinking_delta":
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_delta":
			case "toolcall_end":
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					await emit({
						type: "message_update",
						responseEvent: event,
						message: { ...partialMessage },
					});
				}
				break;

			case "done":
			case "error": {
				const finalMessage = await result();
				if (addedPartial) context.messages[context.messages.length - 1] = finalMessage;
				else context.messages.push(finalMessage);
				if (!addedPartial) await emit({ type: "message_start", message: { ...finalMessage } });
				await emit({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	const finalMessage = await result();
	if (addedPartial) context.messages[context.messages.length - 1] = finalMessage;
	else {
		context.messages.push(finalMessage);
		await emit({ type: "message_start", message: { ...finalMessage } });
	}
	await emit({ type: "message_end", message: finalMessage });
	return finalMessage;
}

/**
 * Fail every capability call from a response that hit the output token limit.
 *
 * Streamed arguments are finalized with a best-effort salvage parser, so a
 * truncated response can yield calls whose arguments parse but are silently
 * incomplete. None of them are safe to run, so each is reported as an error and the
 * model can re-issue it.
 */
async function failCallsFromTruncatedMessage(
	calls: ToolCallBlock[],
	emit: KernelEventSink,
): Promise<ExecutedBatch> {
	const messages: ToolResultMessage[] = [];
	for (const call of calls) {
		await emit({ type: "capability_start", toolCallId: call.id, toolName: call.name, args: call.arguments });
		const finalized: CapabilityOutcome = {
			toolCall: call,
			result: createErrorResult(
				`Capability "${call.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the call with complete arguments.`,
			),
			isError: true,
		};
		await emitCapabilityEnd(finalized, emit);
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		messages.push(toolResultMessage);
	}
	return { messages, terminate: false };
}

/**
 * Stop a runaway tool loop. Small models can repeat one tool call indefinitely;
 * this turns the repeated calls into a short, bounded error and ends the batch
 * so the model's next turn can answer the user instead.
 */
async function failRepeatedBatch(calls: ToolCallBlock[], reason: string, emit: KernelEventSink): Promise<ExecutedBatch> {
	const messages: ToolResultMessage[] = [];
	for (const call of calls) {
		await emit({ type: "capability_start", toolCallId: call.id, toolName: call.name, args: call.arguments });
		const finalized: CapabilityOutcome = {
			toolCall: call,
			result: { ...createErrorResult(reason), terminate: true },
			isError: true,
		};
		await emitCapabilityEnd(finalized, emit);
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		messages.push(toolResultMessage);
	}
	return { messages, terminate: true };
}

/** Execute the capability calls from one assistant message. */
async function executeCapabilityCalls(
	currentContext: TurnContext,
	assistantMessage: AssistantMessage,
	config: LoopConfig,
	signal: AbortSignal | undefined,
	emit: KernelEventSink,
): Promise<ExecutedBatch> {
	const calls = assistantMessage.content.filter((block): block is ToolCallBlock => block.type === "toolCall");
	const hasSequential = calls.some(
		(call) => currentContext.capabilities?.find((capability) => capability.name === call.name)?.executionMode === "sequential",
	);
	if (config.capabilityExecution === "sequential" || hasSequential) {
		return executeSequential(currentContext, assistantMessage, calls, config, signal, emit);
	}
	return executeParallel(currentContext, assistantMessage, calls, config, signal, emit);
}

type ExecutedBatch = {
	messages: ToolResultMessage[];
	terminate: boolean;
};

async function executeSequential(
	currentContext: TurnContext,
	assistantMessage: AssistantMessage,
	calls: ToolCallBlock[],
	config: LoopConfig,
	signal: AbortSignal | undefined,
	emit: KernelEventSink,
): Promise<ExecutedBatch> {
	const finalizedCalls: CapabilityOutcome[] = [];
	const messages: ToolResultMessage[] = [];

	for (const call of calls) {
		await emit({ type: "capability_start", toolCallId: call.id, toolName: call.name, args: call.arguments });

		const preparation = await prepareCall(currentContext, assistantMessage, call, config, signal);
		let finalized: CapabilityOutcome;
		if (preparation.kind === "immediate") {
			finalized = { toolCall: call, result: preparation.result, isError: preparation.isError };
		} else {
			const executed = await executePrepared(preparation, signal, emitCapabilityUpdate(call, emit));
			finalized = await finalizeCall(currentContext, assistantMessage, preparation, executed, config, signal);
		}

		await emitCapabilityEnd(finalized, emit);
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		finalizedCalls.push(finalized);
		messages.push(toolResultMessage);

		if (signal?.aborted) break;
	}

	return { messages, terminate: shouldTerminateBatch(finalizedCalls) };
}

async function executeParallel(
	currentContext: TurnContext,
	assistantMessage: AssistantMessage,
	calls: ToolCallBlock[],
	config: LoopConfig,
	signal: AbortSignal | undefined,
	emit: KernelEventSink,
): Promise<ExecutedBatch> {
	const finalizedCalls: (CapabilityOutcome | (() => Promise<CapabilityOutcome>))[] = [];

	for (const call of calls) {
		await emit({ type: "capability_start", toolCallId: call.id, toolName: call.name, args: call.arguments });

		const preparation = await prepareCall(currentContext, assistantMessage, call, config, signal);
		if (preparation.kind === "immediate") {
			const finalized: CapabilityOutcome = {
				toolCall: call,
				result: preparation.result,
				isError: preparation.isError,
			};
			await emitCapabilityEnd(finalized, emit);
			finalizedCalls.push(finalized);
			if (signal?.aborted) break;
			continue;
		}

		finalizedCalls.push(async () => {
			if (signal?.aborted) {
				const finalized: CapabilityOutcome = {
					toolCall: call,
					result: createErrorResult("Operation aborted"),
					isError: true,
				};
				await emitCapabilityEnd(finalized, emit);
				return finalized;
			}
			const executed = await executePrepared(preparation, signal, emitCapabilityUpdate(call, emit));
			const finalized = await finalizeCall(currentContext, assistantMessage, preparation, executed, config, signal);
			await emitCapabilityEnd(finalized, emit);
			return finalized;
		});
		if (signal?.aborted) break;
	}

	const ordered = await Promise.all(
		finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
	);
	const messages: ToolResultMessage[] = [];
	for (const finalized of ordered) {
		const toolResultMessage = createToolResultMessage(finalized);
		await emitToolResultMessage(toolResultMessage, emit);
		messages.push(toolResultMessage);
	}

	return { messages, terminate: shouldTerminateBatch(ordered) };
}

type PreparedCall = {
	kind: "prepared";
	toolCall: ToolCallBlock;
	capability: Capability<any>;
	args: JsonObject;
};

type ImmediateOutcome = {
	kind: "immediate";
	result: CapabilityResult<any>;
	isError: boolean;
};

type ExecutedOutcome = {
	result: CapabilityResult<any>;
	isError: boolean;
	durationMs: number;
};

type CapabilityUpdateSink = (partialResult: CapabilityResult<any>) => Promise<void> | void;

function shouldTerminateBatch(finalizedCalls: CapabilityOutcome[]): boolean {
	return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}

async function prepareCall(
	currentContext: TurnContext,
	assistantMessage: AssistantMessage,
	call: ToolCallBlock,
	config: LoopConfig,
	signal: AbortSignal | undefined,
	capabilities: readonly Capability<any>[] = currentContext.capabilities ?? [],
): Promise<PreparedCall | ImmediateOutcome> {
	const capability = capabilities.find((entry) => entry.name === call.name);
	// Lazy discovery (spec §2.3): indexed tools are declared with a tiny schema
	// so real function-calling models can emit a call. The first call returns
	// the full schema as a normal tool result for a retry; later calls execute.
	// Marking the name served keeps a repeat miss from looping.
	const discovery = config.discovery;
	if (discovery && discovery.lazyNames.has(call.name) && !discovery.served.has(call.name)) {
		const declaration = discovery.declarations().find((entry) => entry.name === call.name);
		if (declaration) {
			discovery.served.add(call.name);
			const text =
				`Full schema for ${call.name} loaded. Call ${call.name} directly with your real arguments. ` +
				`Do not ask for this schema again.\n\n${discovery.describe(declaration)}`;
			return {
				kind: "immediate",
				result: { content: [{ type: "text", text }], details: { discovered: true } },
				isError: false,
			};
		}
	}
	if (!capability) {
		return {
			kind: "immediate",
			result: createErrorResult(`Capability ${call.name} not found`),
			isError: true,
		};
	}

	try {
		const declaration = toDeclaration(capability);
		const coerced = coerceCapabilityArguments(declaration, call.arguments);
		const validatedArgs = validateCapabilityArguments(declaration, { ...call, arguments: coerced });
		if (config.beforeCapability) {
			const decision: PermissionDecision | undefined = await config.beforeCapability(
				{ assistantMessage, toolCall: call, args: validatedArgs, context: currentContext },
				signal,
			);
			if (signal?.aborted) {
				return { kind: "immediate", result: createErrorResult("Operation aborted"), isError: true };
			}
			if (decision?.block) {
				const result = createErrorResult(decision.reason || "Capability execution was blocked");
				if (decision.terminate === true) result.terminate = true;
				return { kind: "immediate", result, isError: true };
			}
		}
		if (signal?.aborted) {
			return { kind: "immediate", result: createErrorResult("Operation aborted"), isError: true };
		}
		return { kind: "prepared", toolCall: call, capability, args: validatedArgs };
	} catch (error) {
		return {
			kind: "immediate",
			result: createErrorResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}
}

function emitCapabilityUpdate(call: ToolCallBlock, emit: KernelEventSink): CapabilityUpdateSink {
	return (partialResult) =>
		emit({
			type: "capability_update",
			toolCallId: call.id,
			toolName: call.name,
			args: call.arguments,
			partialResult,
		});
}

/**
 * Run one capability call through the same steps as a model-issued call: argument
 * preparation, schema validation, the permission check, execution and the result
 * hook. Emits no events and adds no messages.
 *
 * Never rejects for capability failures: unknown capabilities, validation errors,
 * blocked calls and thrown errors come back as `isError: true`.
 */
export async function runCapabilityCall(
	call: ToolCallBlock,
	options: {
		capabilities: readonly Capability<any>[];
		assistantMessage: AssistantMessage;
		context: TurnContext;
		signal?: AbortSignal;
		config: LoopConfig;
		onUpdate?: CapabilityUpdateSink;
	},
): Promise<CapabilityOutcome> {
	const preparation = await prepareCall(
		options.context,
		options.assistantMessage,
		call,
		options.config,
		options.signal,
		options.capabilities,
	);
	if (preparation.kind === "immediate") {
		return { toolCall: call, result: preparation.result, isError: preparation.isError };
	}
	const executed = await executePrepared(preparation, options.signal, options.onUpdate ?? (() => {}));
	return finalizeCall(options.context, options.assistantMessage, preparation, executed, options.config, options.signal);
}

async function executePrepared(
	prepared: PreparedCall,
	signal: AbortSignal | undefined,
	onUpdate: CapabilityUpdateSink,
): Promise<ExecutedOutcome> {
	const updateEvents: Promise<void>[] = [];
	let acceptingUpdates = true;
	const startedAt = Date.now();
	const elapsed = () => Date.now() - startedAt;

	try {
		const result = await prepared.capability.execute(
			prepared.toolCall.id,
			prepared.args,
			signal,
			(partialResult) => {
				if (!acceptingUpdates) return;
				updateEvents.push(Promise.resolve(onUpdate(partialResult)));
			},
		);
		const durationMs = elapsed();
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		return { result, isError: result.isError === true, durationMs };
	} catch (error) {
		const durationMs = elapsed();
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		return {
			result: createErrorResult(error instanceof Error ? error.message : String(error)),
			isError: true,
			durationMs,
		};
	} finally {
		acceptingUpdates = false;
	}
}

async function finalizeCall(
	currentContext: TurnContext,
	assistantMessage: AssistantMessage,
	prepared: PreparedCall,
	executed: ExecutedOutcome,
	config: LoopConfig,
	signal: AbortSignal | undefined,
): Promise<CapabilityOutcome> {
	let result = executed.result;
	let isError = executed.isError;

	if (config.afterCapability) {
		try {
			const adjustment: ResultAdjustment | undefined = await config.afterCapability(
				{
					assistantMessage,
					toolCall: prepared.toolCall,
					args: prepared.args,
					result,
					isError,
					context: currentContext,
				},
				signal,
			);
			if (adjustment) {
				// Structured content not replaced along with the content may no longer match it.
				const structuredContent =
					adjustment.structuredContent ?? (adjustment.content ? undefined : result.structuredContent);
				result = {
					...result,
					content: adjustment.content ?? result.content,
					details: adjustment.details ?? result.details,
					usage: adjustment.usage ?? result.usage,
					terminate: adjustment.terminate ?? result.terminate,
				};
				if (structuredContent === undefined) delete result.structuredContent;
				else result.structuredContent = structuredContent;
				isError = adjustment.isError ?? isError;
			}
		} catch (error) {
			result = createErrorResult(error instanceof Error ? error.message : String(error));
			isError = true;
		}
	}

	return { toolCall: prepared.toolCall, result, isError, durationMs: executed.durationMs };
}

function createErrorResult(message: string): CapabilityResult<any> {
	return { content: [{ type: "text", text: message }], details: {} };
}

async function emitCapabilityEnd(finalized: CapabilityOutcome, emit: KernelEventSink): Promise<void> {
	await emit({
		type: "capability_end",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		result: finalized.result,
		isError: finalized.isError,
		...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
	});
}

function createToolResultMessage(finalized: CapabilityOutcome): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		// Untyped capabilities can return a result without content; normalize so the
		// undefined never enters the transcript or a provider payload.
		content: finalized.result.content ?? [],
		details: finalized.result.details,
		usage: finalized.result.usage,
		isError: finalized.isError,
		...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
		timestamp: Date.now(),
	};
}

async function emitToolResultMessage(toolResultMessage: ToolResultMessage, emit: KernelEventSink): Promise<void> {
	await emit({ type: "message_start", message: toolResultMessage });
	await emit({ type: "message_end", message: toolResultMessage });
}

/** Re-exported so the kernel host can build the decision type without importing twice. */
export type { TurnDecision };
