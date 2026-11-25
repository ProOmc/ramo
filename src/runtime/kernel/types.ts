/**
 * Ramo kernel contracts.
 *
 * These types are Ramo's own. They were derived from the agent-loop contracts in
 * Pi 1.4.0 (`third_party/pi/packages/agent/src/types.ts` and
 * `third_party/pi/packages/ai/src/types.ts`, MIT licensed, Copyright (c) 2025 Mario
 * Zechner) and renamed to Ramo's vocabulary. See `src/runtime/kernel/README.md`
 * for the full provenance and the list of changes.
 *
 * Vocabulary:
 * - a *turn* is one assistant response plus the tool calls and results it caused;
 * - a *capability* is a tool Ramo exposes to the model;
 * - the *transcript* is the ordered message history visible to the model.
 */

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ImageBlock {
	type: "image";
	/** Base64 encoded image bytes. Never a remote URL. */
	data: string;
	mimeType: string;
	name?: string;
}

export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
	/** Which provider field carried the reasoning, so the next request can replay it. */
	thinkingSignature?: string;
}

export interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments: JsonObject;
	/** Set when the model's argument text was not a valid JSON object. */
	argumentsError?: string;
}

export type AssistantBlock = TextBlock | ThinkingBlock | ToolCallBlock;
export type UserBlock = TextBlock | ImageBlock;
export type ResultBlock = TextBlock | ImageBlock;

export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted";

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	/** Wall-clock time the model actually spent on this turn, in milliseconds. */
	promptMs?: number;
	/** Time spent generating output tokens, in milliseconds. */
	outputMs?: number;
	loadMs?: number;
	timeToFirstChunkMs?: number;
	/** promptTokens / (promptMs / 1000) — tokens per second. Undefined when inputs are zero. */
	promptTps?: number;
	/** output / (outputMs / 1000) — tokens per second. Undefined when inputs are zero. */
	outputTps?: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

/**
 * System instructions and capability declarations at one point in the transcript.
 *
 * The leading system message carries the prompt. Later system messages change it:
 * `content` adds instructions, and `capabilitiesAdded`/`capabilitiesRemoved` change
 * the callable set. Replaying every system message in order yields the current
 * prompt and capability set.
 */
export interface SystemMessage {
	role: "system";
	content: string;
	/** Complete definitions of capabilities that become available at this point. */
	capabilitiesAdded?: ToolDeclaration[];
	/** Capabilities that stop being available at this point. */
	capabilitiesRemoved?: ToolReference[];
	timestamp: number;
}

export interface UserMessage {
	role: "user";
	content: string | UserBlock[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: AssistantBlock[];
	/** Ramo provider identifier. Always "ramo" for local inference. */
	provider: string;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	thinkingLevel?: ThinkingLevel;
	timestamp: number;
	durationMs?: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: ResultBlock[];
	details?: JsonValue;
	usage?: Usage;
	isError: boolean;
	timestamp: number;
	durationMs?: number;
}

export type TranscriptMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

/** The message role names used on the wire with the OpenAI-compatible gateway. */
export type WireRole = "system" | "user" | "assistant" | "tool";

/** A capability declaration as the model sees it. */
export interface ToolDeclaration {
	name: string;
	description: string;
	/** JSON Schema describing the accepted arguments. */
	parameters: JsonObject;
}

export interface ToolReference {
	name: string;
}

/** Reasoning level requested for a response. */
export type ThinkingLevel = "off" | "low" | "medium" | "high";

/** How a batch of capability calls from one assistant message is executed. */
export type CapabilityExecutionMode = "sequential" | "parallel";

/**
 * A capability Ramo exposes to the model.
 *
 * `execute` must throw on failure or return a result marked `isError`; describing a
 * failure only in `content` is a bug, because the model cannot distinguish it from
 * success.
 */
export interface Capability<TDetails = JsonValue> {
	name: string;
	/** Human-readable label for the interface. */
	label: string;
	description: string;
	parameters: JsonObject;
	execute(
		toolCallId: string,
		params: JsonObject,
		signal?: AbortSignal,
		onUpdate?: (partial: CapabilityResult<TDetails>) => void,
	): Promise<CapabilityResult<TDetails>>;
	/** Overrides the run-wide execution mode for this capability. */
	executionMode?: CapabilityExecutionMode;
	/**
	 * Whether the capability only reads.
	 *
	 * A read-only capability runs without approval in every permission mode.
	 */
	readOnly?: boolean;
}

export interface CapabilityResult<TDetails = JsonValue> {
	content: ResultBlock[];
	details: TDetails;
	structuredContent?: JsonValue;
	usage?: Usage;
	/** Reports a failure without throwing. */
	isError?: boolean;
	/** Hint that the kernel should stop after the current capability batch. */
	terminate?: boolean;
}

/** The transcript and callable capabilities visible to one run. */
export interface TurnContext {
	messages: TranscriptMessage[];
	capabilities?: Capability<any>[];
}

/** Streaming events produced by one model response. */
export type ResponseEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallBlock; partial: AssistantMessage }
	| { type: "done"; reason: StopReason; message: AssistantMessage }
	| { type: "error"; reason: StopReason; error: AssistantMessage };

/** Events emitted by the kernel while a run progresses. */
export type KernelEvent =
	| { type: "run_start" }
	| { type: "run_end"; messages: TranscriptMessage[] }
	| { type: "turn_start" }
	| { type: "turn_end"; message: TranscriptMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: TranscriptMessage }
	| { type: "message_update"; message: TranscriptMessage; responseEvent: ResponseEvent }
	| { type: "message_end"; message: TranscriptMessage }
	| { type: "capability_start"; toolCallId: string; toolName: string; args: JsonObject }
	| {
			type: "capability_update";
			toolCallId: string;
			toolName: string;
			args: JsonObject;
			partialResult: unknown;
	  }
	| {
			type: "capability_end";
			toolCallId: string;
			toolName: string;
			result: unknown;
			isError: boolean;
			durationMs?: number;
	  };

/** Result of a capability call after the permission hooks ran. */
export interface CapabilityOutcome {
	toolCall: ToolCallBlock;
	result: CapabilityResult<any>;
	isError: boolean;
	durationMs?: number;
}

/** Returned from the permission check to stop a capability call. */
export interface PermissionDecision {
	block?: boolean;
	reason?: string;
	/** Hint that the kernel should stop after the current capability batch. */
	terminate?: boolean;
}

export interface PermissionContext {
	assistantMessage: AssistantMessage;
	toolCall: ToolCallBlock;
	args: JsonObject;
	context: TurnContext;
}

/** Returned from the result hook to adjust a finished capability call. */
export interface ResultAdjustment {
	content?: ResultBlock[];
	details?: JsonValue;
	structuredContent?: JsonValue;
	isError?: boolean;
	usage?: Usage;
	terminate?: boolean;
}

export interface ResultContext {
	assistantMessage: AssistantMessage;
	toolCall: ToolCallBlock;
	args: JsonObject;
	result: CapabilityResult<any>;
	isError: boolean;
	context: TurnContext;
}

/** Context handed to a completed-turn callback. */
export interface TurnCompletion {
	message: AssistantMessage;
	toolResults: ToolResultMessage[];
	context: TurnContext;
	newMessages: TranscriptMessage[];
}

/** Decision returned by a completed-turn callback. */
export type TurnDecision = { action: "continue" } | { action: "end" };

/** Runtime state the kernel may replace before the next request. */
export interface TurnUpdate {
	context?: TurnContext;
	messages?: TranscriptMessage[];
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

/**
 * Configuration for one kernel run.
 *
 * `convertToLlm` turns the transcript into the messages the gateway accepts. It must
 * not throw: a thrown error interrupts the run without a normal event sequence.
 */
/** Just-in-time schema discovery for tools whose schemas were not sent this turn. */
export interface ToolDiscoveryConfig {
	/** Every active declaration, so an unloaded tool name can be resolved. */
	declarations: () => ToolDeclaration[];
	/** Names already served a schema as a tool result; a second miss is a normal error. */
	served: Set<string>;
	/** Tools declared with a minimal schema; the first call loads the full schema. */
	lazyNames: ReadonlySet<string>;
	/** Formats the full schema plus one example for the retry result. */
	describe: (declaration: ToolDeclaration) => string;
}

export interface LoopConfig {
	model: string;
	thinkingLevel?: ThinkingLevel;
	maxTokens?: number;
	temperature?: number;
	/**
	 * What the request is for.
	 *
	 * A summary request carries no capabilities: the model is asked to write a
	 * checkpoint, not to act.
	 */
	purpose?: "turn" | "summary";
	convertToLlm: (messages: TranscriptMessage[]) => WireMessage[];
	/**
	 * The capabilities the model may call.
	 *
	 * The resolver is read when the request is built, not when the
	 * configuration is made, so a capability set that changes during a run is
	 * the set the next request offers.
	 */
	capabilities?: () => ToolDeclaration[];
	/** Just-in-time schema return for unloaded tools (lazy discovery, spec §2.3). */
	discovery?: ToolDiscoveryConfig;
	/** Applied to the transcript before every request, for example to compact it. */
	transformContext?: (messages: TranscriptMessage[], signal?: AbortSignal) => Promise<TranscriptMessage[]>;
	/** Called after a completed turn and its results, before `turn_end`. */
	finishTurn?: (turn: TurnCompletion, signal?: AbortSignal) => TurnDecision | void | Promise<TurnDecision | void>;
	/** Called immediately before every request, including the first. */
	prepareRequest?: (
		request: { context: TurnContext; model: string; thinkingLevel: ThinkingLevel },
		signal?: AbortSignal,
	) => TurnUpdate | void | Promise<TurnUpdate | void>;
	/** Called after `turn_end` when the kernel will continue. */
	prepareNextTurn?: (turn: TurnCompletion) => TurnUpdate | undefined | Promise<TurnUpdate | undefined>;
	/** Messages injected while the kernel is working. */
	getSteeringMessages?: () => Promise<TranscriptMessage[]>;
	/** Messages processed after the kernel would otherwise stop. */
	getFollowUpMessages?: () => Promise<TranscriptMessage[]>;
	/** How capability calls from one assistant message are executed. */
	capabilityExecution?: CapabilityExecutionMode;
	/** Called before a capability runs, after its arguments are validated. */
	beforeCapability?: (
		context: PermissionContext,
		signal?: AbortSignal,
	) => Promise<PermissionDecision | undefined>;
	/** Called after a capability finishes, before its result is emitted. */
	afterCapability?: (context: ResultContext, signal?: AbortSignal) => Promise<ResultAdjustment | undefined>;
}

/** One message sent to the OpenAI-compatible gateway. */
export interface WireMessage {
	role: WireRole;
	/** Null when the assistant message carries only capability calls. */
	content: string | WireContentPart[] | null;
	name?: string;
	tool_call_id?: string;
	tool_calls?: WireToolCall[];
	reasoning_content?: string;
}

export type WireContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } };

export interface WireToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}
