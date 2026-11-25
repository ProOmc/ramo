/**
 * The Ramo worker.
 *
 * The worker is the process that owns one conversation. The desktop service
 * sends it requests; it reports progress back. Everything it does goes through
 * the Ramo kernel: the turn loop, the capability registry, the permission
 * checks, the context policy and the session file.
 *
 * This file replaces the worker that hosted Pi's coding agent
 * (`third_party/pi/packages/coding-agent`, MIT licensed, Copyright (c) 2025
 * Mario Zechner). The worker-to-parent protocol is unchanged, because the
 * interface and the native host depend on its method names, event names and
 * payload shapes.
 *
 * What the old worker had and this one does not:
 * - no settings manager, no package manager, no extension system and no
 *   interactive terminal: the capabilities, the permissions, the skills, the
 *   prompt templates and the context are read by the kernel directly;
 * - no Pi session manager: the session is Ramo's own JSON Lines tree;
 * - no Pi model registry: the model is one local profile reached through
 *   Ramo's own transport.
 */

import fs from "node:fs";
import path from "node:path";
import generation from "./generation.cjs";
import vision from "./vision.cjs";
import { KernelHost, type HostEvent, type PermissionMode, type RepairConfig } from "./kernel/host.js";
import { SessionStore, importSession } from "./kernel/session.js";
import { expandPromptTemplate, loadPromptTemplates, type PromptTemplate } from "./kernel/prompts.js";
import { loadSkills, type Skill } from "./kernel/skills.js";
import type { ResourceDiagnostic } from "./kernel/resources.js";
import { streamResponse, type ModelProfile } from "./model/client.js";
import {
	createEditCapability,
	createListCapability,
	createReadCapability,
	createWriteCapability,
} from "./capabilities/files.js";
import { createFindCapability, createGrepCapability } from "./capabilities/search.js";
import { createPowerShellCapability, backgroundJobsSnapshot } from "./capabilities/shell.js";
import { createAgentSendCapability } from "./capabilities/agent-send.js";
import { createBrowserCapabilities } from "./capabilities/browser.js";
import { createCodemodeCapability } from "./capabilities/codemode.js";
import { createToolInfoCapability } from "./capabilities/tool-discovery.js";
import { McpRegistry } from "./capabilities/mcp.js";
import { MemorySystem, memoryTier, retentionAllowed } from "./memory/index.js";
import type { DreamModel } from "./memory/dream.js";
import { setRuntimeRoot } from "./paths.js";
import type { RespondFn } from "./kernel/loop.js";
import type {
	Capability,
	CapabilityResult,
	JsonObject,
	ThinkingLevel,
	TranscriptMessage,
	UserBlock,
} from "./kernel/types.js";

/** The runtime lives next to the worker; the search binaries live in `node/`. */
setRuntimeRoot(path.dirname(process.argv[1] ?? process.cwd()));

/** A capability the interface owns and the worker calls back into. */
interface HostToolDeclaration {
	name: string;
	description?: string;
	parameters?: JsonObject;
}

/** The generation options the interface asked for. */
interface GenerationOptions {
	outputTokens?: number;
	temperature?: number;
}

/** The connection details the service supplies at startup. */
interface WorkerConfig {
	dataDir: string;
	baseUrl: string;
	token: string;
	profiles: ModelProfile[];
}

/** The state the interface reads. */
interface Snapshot {
	sessionId?: string;
	cwd: string;
	mode: "assistant" | "project";
	permission: PermissionMode;
	trusted: boolean;
	busy: boolean;
	model?: string;
	thinking: string;
	messages: TranscriptMessage[];
	contextMessageCount: number;
	sessionName?: string;
	generation: { mode: string; outputTokens: number | null; contextWindow: number };
	context: { tokens: number | null; contextWindow: number; percent: number | null };
	compaction: ({ enabled: boolean; reserveTokens: number; keepRecentTokens: number; count: number }) | null;
	stats: { userMessages: number; assistantMessages: number; toolResults: number; totalMessages: number; toolCalls: number };
	changes: { path: string; before: string | null; after: string | null }[];
}

let config: WorkerConfig = { dataDir: "", baseUrl: "", token: "", profiles: [] };
let host: KernelHost | null = null;
let cwd = "";
let permission: PermissionMode = "ask";
let trusted = false;
let opening = false;
let capabilityTools: HostToolDeclaration[] = [];
let capabilityMode: "assistant" | "project" = "project";
let capabilityContext = "";
let capabilityConfig: Record<string, unknown> = {};
let generationOptions: GenerationOptions = {};
let selectedProfile: ModelProfile | null = null;
/**
 * The port of the local service, carried by the profile the desktop sent.
 *
 * Zero means the interface did not name one, and then no background inference
 * runs: a session opened without an endpoint is not asked to make calls it was
 * never given a destination for.
 */
let selectedPort = 0;
let activeToolNames: string[] | null = null;
/**
 * Whether this session may not see the user's personal memory.
 *
 * A separate conversation in Chat is isolated: it does not get the memory
 * capabilities and the prompt carries no memory section. A project-bound
 * conversation and the main conversation both see the same global store,
 * because memory is an application-wide capability rather than a feature of
 * one view.
 */
let memoryIsolation = false;
let skills: Skill[] = [];
let prompts: PromptTemplate[] = [];
let resourceDiagnostics: string[] = [];
let seq = 0;

const pendingUI = new Map<string, (value: unknown) => void>();
const pendingHost = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const mcp = new McpRegistry();

const send = (packet: Record<string, unknown>): void => {
	if (process.connected) process.send?.(packet);
};

const emit = (event: Record<string, unknown>): void => {
	send({ kind: "event", event: { sessionId: host?.store.id, ...event } });
};

const sessionDir = (): string => path.join(config.dataDir, "sessions");
const agentDir = (): string => path.join(config.dataDir, "agent");
/** Memory is global to the application, not to a project or a chat. */
const memoryDir = (): string => path.join(config.dataDir, "memory");
/** The Agent Hub bridge: a marker file in the data directory makes this
 * conversation the shared bridge thread. */
const agentBridge = (): boolean => {
	try { return fs.existsSync(path.join(config.dataDir, "agent-bridge.on")); } catch { return false; }
};

/**
 * The memory subsystem, created once per worker process.
 *
 * It is deliberately outside the session: a fact learned in Chat is available in
 * Work, and a project switch does not start a second store.
 */
let memory: MemorySystem | null = null;
/** Retention is serialised, so two turns cannot write facts out of order. */
let retainQueue: Promise<unknown> = Promise.resolve();
let dreaming = false;
/** The watcher on the interface's command inbox. */
let memoryWatcher: fs.FSWatcher | null = null;

function ensureMemory(): MemorySystem {
	if (memory) return memory;
	memory = new MemorySystem({
		dir: memoryDir(),
		endpoint: () => `http://127.0.0.1:${selectedPort}`,
		sessionId: () => host?.store.id ?? null,
		memoryTier: () => selectedProfile?.memoryTier ?? null,
		dreamModel: () => dreamModel(),
		dreamConsolidator: () => dreamConsolidatorModel(),
	});
	return memory;
}

/**
 * Load the memory store and watch the interface's command inbox.
 *
 * The renderer is sandboxed and the worker-to-parent protocol is a fixed
 * boundary, so the interface sends commands as files and reads the
 * projection this subsystem writes. The native host only moves a file into
 * the inbox; the worker is the only executor and the only writer.
 */
async function startMemory(): Promise<void> {
	const system = ensureMemory();
	try {
		await system.initialize();
	} catch {
		// A memory problem must never stop the worker from starting.
	}
	watchMemoryInbox(system);
	// At init the port is normally not known yet, so this is usually a no-op.
	// It exists so a worker that is started with a port already selected does
	// not wait for the first prompt to detect the semantic arm.
	// No embedding arm in the file-backed memory; nothing to sync.
}

/** Apply the commands waiting in the inbox, whenever one arrives. */
function watchMemoryInbox(system: MemorySystem): void {
	if (memoryWatcher) return;
	const dir = path.join(memoryDir(), "inbox");
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {
		return;
	}
	let draining = false;
	const drain = async (): Promise<void> => {
		if (draining) return;
		draining = true;
		try {
			// A command may arrive while another is being applied, so the drain
			// repeats until the inbox is empty.
			for (let round = 0; round < 32; round += 1) {
				const outcomes = await system.drainCommands();
				if (outcomes.length === 0) break;
			}
		} catch {
			// A failed command is reported in the projection. It never stops
			// the watcher.
		} finally {
			draining = false;
		}
	};
	try {
		memoryWatcher = fs.watch(dir, (_event, name) => {
			if (name && !String(name).endsWith(".json")) return;
			void drain();
		});
		memoryWatcher.on("error", () => {
			memoryWatcher?.close();
			memoryWatcher = null;
		});
	} catch {
		memoryWatcher = null;
	}
	void drain();
}

/**
 * The model a background pass may use.
 *
 * Background inference goes straight to the local service rather than through
 * the session's gateway. Two reasons. On a single local GPU a consolidation
 * pass must never queue in front of the user's next turn, and the gateway's
 * chat route is the session's own path: sharing it would make every background
 * pass look like an extra turn to anything watching that route. The embedding
 * arm already reaches the local service directly for the same kind of reason.
 *
 * The port is the one the interface put in the profile, so this needs no new
 * protocol field. With no port there is no endpoint and therefore no background
 * model; the dream still runs its deterministic stages.
 *
 * Two request fields matter, and both were found by measurement rather than by
 * assumption:
 *
 * - `think: false`. The local models are thinking models, and a thinking model
 *   spends the whole token budget in `message.thinking`. With a small budget
 *   the answer never arrives and `message.content` comes back empty, so the
 *   extractor parses nothing and the turn is silently not retained. The
 *   renderer's own model service already disables thinking for structured work
 *   for the same reason.
 * - `json: true` on the request. The extractor asks for one JSON object; the
 *   dream asks for a markdown file and must not be put in JSON mode. The call
 *   site decides. `maxTokens` and `think` override the adapter defaults per
 *   phase: the merge may think, compression runs thinking-off under a hard cap.
 */
/**
 * The dreamer's model: thinking ON, maximum budget, because judgement quality
 * is the whole point and it runs overnight. The retainer's model is the
 * cheap firing-and-forget adapter above; this one is not for chat-time work.
 * /api/chat with think default true is Ollama; llama-server defaults
 *    reasoning
 * ON for its template too, so no matter which transport answers, thinking is
 * on. Bonsai templates only accept xhigh/medium/low, hence "medium".
 */
function dreamConsolidatorModel(): DreamModel | null {
	const profile = selectedProfile;
	if (!profile || !selectedPort) return null;
	const endpointOllama = `http://127.0.0.1:${selectedPort}/api/chat`;
	const endpointV1 = `http://127.0.0.1:${selectedPort}/v1/chat/completions`;
	return {
		id: profile.model,
		async complete({ system, prompt, examples, signal, maxTokens, think, json }) {
			const messages = [
				{ role: "system", content: system },
				...(examples ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
				{ role: "user", content: prompt },
			];
			try {
				const ollamaResponse = await fetch(endpointOllama, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: profile.model,
						stream: false,
						think: think ?? true,
						...(json === true ? { format: "json" } : {}),
						options: {
							temperature: 0,
							num_predict: maxTokens ?? Math.min(8192, profile.outputTokens),
						},
						messages,
					}),
					signal: signal ?? AbortSignal.timeout(45 * 60 * 1000),
				});
				if (!ollamaResponse.ok) throw new Error(`ollama answered HTTP ${ollamaResponse.status}`);
				const ollamaBody = (await ollamaResponse.json()) as {
					message?: { content?: string };
					prompt_eval_count?: number;
					eval_count?: number;
				};
				return {
					text: String(ollamaBody?.message?.content ?? ""),
					usage: {
						input: Number(ollamaBody?.prompt_eval_count ?? 0),
						output: Number(ollamaBody?.eval_count ?? 0),
					},
				};
			} catch (ollamaError) {
				const openAIResponse = await fetch(endpointV1, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: profile.model,
						stream: false,
						temperature: 0,
						max_tokens: maxTokens ?? Math.min(16384, profile.outputTokens),
						...(json === true ? { response_format: { type: "json_object" } } : {}),
						// The 35B / Qwen3.6 template reads enable_thinking from
						// chat_template_kwargs, not reasoning_effort. The fallback
						// budget is the wall-clock timeout around the call.
						chat_template_kwargs: { enable_thinking: think ?? true },
						messages,
					}),
					signal: signal ?? AbortSignal.timeout(45 * 60 * 1000),
				});
				if (!openAIResponse.ok) {
					const detail = await openAIResponse.text().catch(() => "");
					throw new Error(`The local service answered HTTP ${openAIResponse.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
				}
				const openAIBody = (await openAIResponse.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				const choice = openAIBody?.choices?.[0];
				return {
					text: String(choice?.message?.content ?? ""),
					usage: {
						input: Number(openAIBody?.usage?.prompt_tokens ?? 0),
						output: Number(openAIBody?.usage?.completion_tokens ?? 0),
					},
				};
			}
		},
	};
}

function dreamModel(): DreamModel | null {
	const profile = selectedProfile;
	if (!profile || !selectedPort) return null;
	// Two transports serve one family: plain Ollama answers on /api/chat with
	// think:false; llama.cpp routers answer on /v1/chat/completions with the
	// thinking switch their template reads (reasoning_effort:"none" for the
	// Bonsai/Qwen3.8 family, chat_template_kwargs.enable_thinking:false for
	// the Qwen3.6 family — both are sent). Try Ollama first (small models
	// that path serves cheaply), then fall back to the OpenAI-style endpoint.
	const endpointOllama = `http://127.0.0.1:${selectedPort}/api/chat`;
	const endpointV1 = `http://127.0.0.1:${selectedPort}/v1/chat/completions`;
	return {
		id: profile.model,
		async complete({ system, prompt, examples, signal, maxTokens, think, json }) {
			const messages = [
				{ role: "system", content: system },
				...(examples ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
				{ role: "user", content: prompt },
			];
			try {
				const ollamaResponse = await fetch(endpointOllama, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: profile.model,
						stream: false,
						think: think ?? false,
						...(json === true ? { format: "json" } : {}),
						options: { temperature: 0, num_predict: maxTokens ?? Math.min(1600, profile.outputTokens) },
						messages,
					}),
					signal: signal ?? AbortSignal.timeout(180_000),
				});
				if (!ollamaResponse.ok) throw new Error(`ollama answered HTTP ${ollamaResponse.status}`);
				const ollamaBody = (await ollamaResponse.json()) as {
					message?: { content?: string };
					prompt_eval_count?: number;
					eval_count?: number;
				};
				return {
					text: String(ollamaBody?.message?.content ?? ""),
					usage: {
						input: Number(ollamaBody?.prompt_eval_count ?? 0),
						output: Number(ollamaBody?.eval_count ?? 0),
					},
				};
			} catch (ollamaError) {
				// Fall through to the llama-server-style OpenAI endpoint. The 4B/9B
				// via Ollama serve this too, just slower; the 35B on Bonsami answers
				// here. Both speak the same JSON shape.
				const openAIResponse = await fetch(endpointV1, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						model: profile.model,
						stream: false,
						temperature: 0,
						max_tokens: maxTokens ?? Math.min(4096, profile.outputTokens),
						...(json === true ? { response_format: { type: "json_object" } } : {}),
						// The Bonsai/Qwen3.8 template reads reasoning_effort ("none"
						// = thinking off); the Qwen3.6 / 35B template reads
						// chat_template_kwargs.enable_thinking (boolean) and ignores
						// reasoning_effort entirely. Send both — each is inert where
						// its template does not know it — so retention stays
						// thinking-off whichever family answers.
						reasoning_effort: "none",
						chat_template_kwargs: { enable_thinking: think ?? false },
						messages,
					}),
					signal: signal ?? AbortSignal.timeout(180_000),
				});
				if (!openAIResponse.ok) {
					const detail = await openAIResponse.text().catch(() => "");
					throw new Error(`The local service answered HTTP ${openAIResponse.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
				}
				const openAIBody = (await openAIResponse.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				const choice = openAIBody?.choices?.[0];
				return {
					text: String(choice?.message?.content ?? ""),
					usage: {
						input: Number(openAIBody?.usage?.prompt_tokens ?? 0),
						output: Number(openAIBody?.usage?.completion_tokens ?? 0),
					},
				};
			}
		},
	};
}

/**
 * Retain a completed turn, then consider a dream.
 *
 * Both are background work: the user already has the answer, so neither may
 * delay the next prompt. A failure is reported through `memory` state rather
 * than thrown, because a memory problem must never break a conversation.
 */
function scheduleRetention(text: string, options: { isolated: boolean; sessionId: string | null }): void {
	const system = memory;
	if (!system || !text.trim()) return;
	// An isolated conversation reads nothing and writes nothing. The decision is
	// taken when the turn is scheduled, not inside the queued callback: a surface
	// switch between the two must not turn an isolated turn into a write.
	if (!retentionAllowed(options.isolated)) return;
	// Capture the whole identity now. The queue is shared and serialised, so by
	// the time this runs the user may have switched model, surface or session,
	// or disposed the session. Nothing below may read a global: the model (and
	// its endpoint), the session and the message time belong to the turn that
	// scheduled this work, not to whatever is open when it drains.
	const identity = {
		sessionId: options.sessionId,
		model: dreamModel(),
		at: new Date(),
	};
	retainQueue = retainQueue
		.then(async () => {
			await system.retain(text, identity.sessionId, { model: identity.model, at: identity.at });
			// The backlog trigger: enough unconsolidated facts justify a pass.
			const backlog = system.unconsolidatedCount();
			if (dreaming || backlog < 20) return;
			dreaming = true;
			try {
				await system.dream("backlog", undefined, identity.model);
			} finally {
				dreaming = false;
			}
		})
		.catch(() => undefined);
}

/** Ask the interface a question and wait for the answer. */
function question(
	method: string,
	params: Record<string, unknown> = {},
	options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<unknown> {
	return new Promise((resolve) => {
		const id = String(++seq);
		const finish = (value: unknown): void => {
			if (timer) clearTimeout(timer);
			pendingUI.delete(id);
			resolve(value);
		};
		const timer = options.timeout ? setTimeout(() => finish(undefined), options.timeout) : undefined;
		pendingUI.set(id, finish);
		emit({ type: "ui_request", id, method, ...params });
		if (options.signal) options.signal.addEventListener("abort", () => finish(undefined), { once: true });
	});
}

/** The profile a request selected, normalised for the kernel. */
function normaliseProfile(profile: ModelProfile): ModelProfile {
	return {
		id: String(profile.id),
		model: String(profile.model ?? profile.id),
		label: profile.label,
		context: Math.max(4096, Math.floor(Number(profile.context) || 16384)),
		outputTokens: Math.max(
			128,
			Math.min(generation.OUTPUT_TOKENS, Math.floor(Number(profile.outputTokens) || generation.OUTPUT_TOKENS)),
		),
		vision: profile.vision === true,
		memoryTier: memoryTier(profile.memoryTier),
	};
}

/** The reasoning level of a request, in the kernel's vocabulary. */
function toKernelThinking(value: unknown, fallback: ThinkingLevel): ThinkingLevel {
	if (value === undefined || value === null || value === "") return fallback;
	const text = String(value);
	if (["off", "low", "medium", "high"].includes(text)) return text as ThinkingLevel;
	return generation.piThinking(text) as ThinkingLevel;
}

/**
 * The model request.
 *
 * The kernel hands over the transcript and the capability set; the worker turns
 * them into one request to the local gateway.
 */
const respond: RespondFn = (messages, loopConfig, signal) => {
	if (!selectedProfile) throw new Error("Choose an Ramo model");
	const declarations = loopConfig.capabilities?.() ?? [];
	const tools = declarations.map((declaration) => ({
		type: "function" as const,
		function: {
			name: declaration.name,
			description: declaration.description,
			parameters: declaration.parameters,
		},
	}));
	return streamResponse(
		{
			profile: selectedProfile,
			messages: loopConfig.convertToLlm(messages),
			...(tools.length > 0 ? { tools } : {}),
			maxTokens: selectedProfile.outputTokens,
			...(Number.isFinite(generationOptions.temperature)
				? { temperature: Math.max(0, Math.min(2, Number(generationOptions.temperature))) }
				: {}),
			transformPayload: (payload) => generation.requestPolicy(payload, host?.thinking ?? "off"),
		},
		{ baseUrl: config.baseUrl, token: config.token },
		{ signal },
	);
};

/** A capability the interface owns. The worker asks the interface to run it. */
function hostToolCapability(tool: HostToolDeclaration): Capability {
	return {
		name: tool.name,
		label: tool.name,
		description: String(tool.description ?? `${tool.name}, an Ramo capability.`),
		parameters: tool.parameters ?? { type: "object", properties: {}, additionalProperties: true },
		// The interface decides what these capabilities may do; they are not
		// project commands, so they never need a second approval.
		readOnly: true,
		async execute(_id, args, signal) {
			const result = await new Promise<unknown>((resolve, reject) => {
				const id = `host-${++seq}`;
				const onAbort = (): void => {
					clearTimeout(timer);
					pendingHost.delete(id);
					reject(new Error("Tool cancelled"));
				};
				const timer = setTimeout(() => {
					pendingHost.delete(id);
					reject(new Error("Ramo capability timed out"));
				}, 90_000);
				pendingHost.set(id, {
					resolve: (value) => {
						clearTimeout(timer);
						signal?.removeEventListener("abort", onAbort);
						resolve(value);
					},
					reject: (error) => {
						clearTimeout(timer);
						signal?.removeEventListener("abort", onAbort);
						reject(error);
					},
				});
				signal?.addEventListener("abort", onAbort, { once: true });
				send({ kind: "hostTool", id, name: tool.name, args });
			});
			const text = typeof result === "string" ? result : JSON.stringify(result);
			const details: JsonObject = { result: (typeof result === "object" && result !== null ? result : { text }) as never };
			return { content: [{ type: "text", text }], details };
		},
	};
}

/**
 * The capabilities of the working directory.
 *
 * Chat and the project-bound conversation share them. The unified surface
 * offers the same files, search and shell everywhere, and the model decides
 * when a turn needs them.
 */
function workCapabilities(): Capability[] {
	return [
		createReadCapability(cwd),
		createWriteCapability(cwd),
		createEditCapability(cwd),
		createListCapability(cwd),
		createFindCapability(cwd),
		createGrepCapability(cwd),
		createPowerShellCapability(cwd, { sessionId: host?.store.id, model: selectedProfile?.id, emit: (event) => emit(event) }),
		createAgentSendCapability(),
		...createBrowserCapabilities({ baseUrl: config.baseUrl, token: config.token, profiles: config.profiles as never, logDir: path.join(config.dataDir, "browser-actions") }),
	];
}

/** The one-line tool-description capability, backed by the full active registry. */
const toolInfoCapability = createToolInfoCapability({
	declarations: () =>
		knownCapabilities()
			.filter((capability) => capability.name !== "tool_info")
			.map((capability) => ({
				name: capability.name,
				description: capability.description,
				parameters: capability.parameters,
			})),
});

/** Every capability the session knows, whether it is active or not. */
function knownCapabilities(): Capability[] {
	const capabilities: Capability[] = [];
	// The work capabilities belong to the surface, not to one mode of it. The
	// working directory is the conversation's folder in Chat and the chosen
	// project in a project-bound conversation, and the same tools work in both.
	capabilities.push(...workCapabilities());
	// Memory is offered to every conversation: they all share one store.
	//
	// The Chat surface used to declare its own `memory_recall` and
	// `memory_save`, backed by the renderer's previous store. Those
	// declarations are gone, so the worker's versions are the only ones: one
	// tool name never has two implementations. While an interface does declare
	// a name, that declaration still wins.
	const declared = new Set(capabilityTools.map((tool) => tool.name));
	const memoryCapabilities = memoryIsolation ? [] : (memory?.capabilities() ?? []);
	capabilities.push(...memoryCapabilities.filter((capability) => !declared.has(capability.name)));
	for (const tool of capabilityTools) capabilities.push(hostToolCapability(tool));
	for (const definition of mcp.tools) {
		if (definition.exposure === "hidden") continue;
		capabilities.push(mcp.capability(definition));
	}
	// Lazy discovery: the one-line describe tool is always available.
	capabilities.push(toolInfoCapability);
	return capabilities;
}

/** The `codemode` capability, which calls the other capabilities. */
const codemodeCapability = createCodemodeCapability({
	declarations: () => {
		const active = new Set(activeCapabilities().map((capability) => capability.name));
		return knownCapabilities()
			.filter((capability) => active.has(capability.name))
			.map((capability) => ({
				name: capability.name,
				description: capability.description,
				parameters: capability.parameters,
			}));
	},
	invoke: async (name, args, signal): Promise<CapabilityResult> => {
		if (!host) throw new Error("No session is open");
		return host.invokeCapability(name, args, signal);
	},
});

/** The capabilities the model may call right now. */
function activeCapabilities(): Capability[] {
	const all = [...knownCapabilities(), codemodeCapability];
	if (activeToolNames) return all.filter((capability) => activeToolNames?.includes(capability.name));
	// The unified surface offers the whole set in every mode. The interface
	// can still narrow it with `settings`, and an isolated conversation still
	// loses the memory capabilities, but the files, the search and the shell
	// are there whether the conversation is a chat or a project task.
	return all;
}

/** Hand the active capability set to the kernel. */
function publishCapabilities(): void {
	host?.setCapabilities(activeCapabilities());
}

/** The tools the interface lists. */
function declaredTools(): { name: string; label: string; description: string; parameters: JsonObject }[] {
	return [...knownCapabilities(), codemodeCapability].map((capability) => ({
		name: capability.name,
		label: capability.label,
		description: capability.description,
		parameters: capability.parameters,
	}));
}

/** Read the skills and prompt templates the session may use. */
function loadSessionResources(): void {
	if (capabilityMode === "assistant") {
		skills = [];
		prompts = [];
		resourceDiagnostics = [];
		host?.setSkills([]);
		return;
	}
	const foundSkills = loadSkills({ cwd, agentDir: agentDir(), trusted });
	const foundPrompts = loadPromptTemplates({ cwd, agentDir: agentDir(), trusted });
	skills = foundSkills.skills;
	prompts = foundPrompts.templates;
	resourceDiagnostics = [...foundSkills.diagnostics, ...foundPrompts.diagnostics].map(describeDiagnostic);
	host?.setSkills(skills);
}

function describeDiagnostic(diagnostic: ResourceDiagnostic): string {
	return `${diagnostic.path ? `${diagnostic.path}: ` : ""}${diagnostic.message}`;
}

/** What the interface reads about the session's resources. */
function resources(): Record<string, unknown> {
	return {
		skills: skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			path: skill.filePath,
			source: skill.source,
			disableModelInvocation: skill.disableModelInvocation,
		})),
		prompts: prompts.map((prompt) => ({
			name: prompt.name,
			description: prompt.description,
			argumentHint: prompt.argumentHint,
			path: prompt.filePath,
			source: prompt.source,
			content: prompt.content,
		})),
		extensions: [],
		diagnostics: [...mcp.diagnostics, ...resourceDiagnostics],
		tools: declaredTools(),
		activeTools: activeCapabilities().map((capability) => capability.name),
		// Memory is a resource of the session, so the interface reads it through
		// the existing method rather than a new protocol call.
		memory: memory
			? {
					...memory.status(),
					capabilities: (memory.capabilities() ?? []).map((capability) => capability.name),
					dreams: memory.dreams().length,
				}
			: null,
	};
}

/** The state the interface reads. */
function snapshot(): Snapshot {
	if (!host) {
		return {
			cwd,
			mode: capabilityMode,
			permission,
			trusted,
			busy: false,
			model: selectedProfile?.id,
			thinking: "off",
			messages: [],
			contextMessageCount: 0,
			generation: {
				mode: "off",
				outputTokens: generation.OUTPUT_TOKENS,
				contextWindow: selectedProfile?.context ?? 16384,
			},
			context: { tokens: null, contextWindow: selectedProfile?.context ?? 16384, percent: null },
			compaction: null,
			stats: { userMessages: 0, assistantMessages: 0, toolResults: 0, totalMessages: 0, toolCalls: 0 },
			changes: [],
		};
	}
	const state = host.snapshot();
	const mode = generation.thinkingMode(state.thinking);
	return {
		...state,
		trusted,
		generation: {
			mode,
			outputTokens: mode === "max" ? null : state.generation.outputTokens,
			contextWindow: state.generation.contextWindow,
		},
	};
}

function requireSession(): KernelHost {
	if (!host) throw new Error("Open a project first");
	return host;
}

/** Stop the session and every server it started. */
async function disposeSession(): Promise<void> {
	const old = host;
	host = null;
	skills = [];
	prompts = [];
	resourceDiagnostics = [];
	if (old) await old.abort();
	await mcp.closeAll();
}

/** Select the model of the session. */
async function setProfile(profile: ModelProfile | undefined, thinking?: unknown): Promise<ModelProfile> {
	if (!profile) throw new Error("Choose an Ramo model");
	const selected = normaliseProfile(profile);
	// The local service port travels with the profile the desktop sent. It is not
	// part of the kernel's profile type, but the embedding arm needs it, so it is
	// captured here rather than guessed.
	const port = Number((profile as unknown as { port?: number }).port);
	if (Number.isFinite(port) && port > 0) selectedPort = port;
	selectedProfile = selected;
	config.profiles = (config.profiles ?? []).some((entry) => entry.id === selected.id)
		? config.profiles.map((entry) => (entry.id === selected.id ? selected : entry))
		: [...(config.profiles ?? []), selected];
	if (host) {
		host.setModel({ profile: selected, respond }, toKernelThinking(thinking, host.thinking));
	}
	send({
		kind: "modelOwner",
		model: selected.id,
		context: selected.context,
		outputTokens: selected.outputTokens,
	});
	return selected;
}

/** Normalise the optional run/edit repair loop configuration. */
function parseRepair(raw: unknown): RepairConfig | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const config = raw as Record<string, unknown>;
	const command = String(config.command ?? config.checkCommand ?? "");
	if (!command.trim()) return undefined;
	const maxRounds = Number(config.maxRounds ?? 2);
	return {
		command,
		maxRounds: Number.isFinite(maxRounds) ? Math.max(0, Math.min(3, maxRounds)) : 2,
		escalationModel: typeof config.escalationModel === "string" ? config.escalationModel : undefined,
		escalationThinking: typeof config.escalationThinking === "string" ? config.escalationThinking : undefined,
	};
}

/** The session file a request refers to. */
function resolveStore(params: Record<string, unknown>): SessionStore {
	if (params.sessionId) {
		const id = String(params.sessionId);
		const file = SessionStore.findById(sessionDir(), id);
		if (file) return SessionStore.open(file);
		if (params.allowNewSession) return SessionStore.create(sessionDir(), cwd, { id });
		if (Array.isArray(params.history)) return SessionStore.create(sessionDir(), cwd);
		throw new Error("Session was not found for this project");
	}
	return SessionStore.create(sessionDir(), cwd);
}

/** Write the history the interface carried over into a new session. */
function restoreHistory(store: SessionStore, history: unknown, profile: ModelProfile): void {
	if (!Array.isArray(history) || store.branchMessages().length > 0) return;
	for (const entry of history as { role?: string; content?: string; images?: unknown }[]) {
		if (!entry || !["user", "assistant"].includes(String(entry.role))) throw new Error("Invalid historical message role");
		const text = String(entry.content ?? "");
		if (entry.role === "user") {
			const content: UserBlock[] = [{ type: "text", text }];
			for (const image of vision.validateImages(entry.images as never) ?? []) {
				content.push({ type: "image", data: image.data, mimeType: image.mimeType });
			}
			store.appendMessage({ role: "user", content, timestamp: Date.now() });
			continue;
		}
		store.appendMessage({
			role: "assistant",
			content: [{ type: "text", text }],
			provider: "ramo",
			model: profile.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: Date.now(),
		});
	}
}

/** Open a session. */
async function open(raw: Record<string, unknown>): Promise<Snapshot> {
	let params = raw;
	if (params.cwd === cwd) params = { ...capabilityConfig, ...params };
	if (opening) throw new Error("Project is opening");
	if (host && host.isBusy) throw new Error("Stop the active task before switching project");
	const target = fs.realpathSync(String(params.cwd ?? ""));
	if (!fs.statSync(target).isDirectory()) throw new Error("Project directory does not exist");
	if (!params.trusted) throw new Error("Project trust is required before loading project instructions or executing tools");
	opening = true;
	try {
		await disposeSession();
		capabilityTools = Array.isArray(params.hostTools) ? (params.hostTools as HostToolDeclaration[]) : [];
		capabilityMode = params.mode === "assistant" ? "assistant" : "project";
		capabilityContext = String(params.context ?? "");
		generationOptions = (params.generation ?? {}) as GenerationOptions;
		cwd = target;
		trusted = true;
		permission = (["read", "ask", "full"] as string[]).includes(String(params.permission))
			? (params.permission as PermissionMode)
			: "ask";
		activeToolNames = null;
		// A separate conversation in Chat is isolated from the user's personal
		// memory. An explicit decision wins; without one, the key is the chat
		// the interface opened, the main conversation is called "main", and a
		// project-bound conversation shares the global store.
		memoryIsolation =
			typeof params.memoryIsolation === "boolean"
				? params.memoryIsolation
				: capabilityMode === "assistant" && params.key !== undefined && String(params.key) !== "main";
		fs.mkdirSync(agentDir(), { recursive: true });
		fs.mkdirSync(sessionDir(), { recursive: true });
		loadSessionResources();

		const profile = await setProfile(params.profile as ModelProfile, params.thinking ?? "off");
		// Memory is loaded before the host so the first system prompt already
		// carries it. The legacy fact-store migration is a one-time tool
		// (tools/memory-migrate.mjs) run against the real directory, not a
		// startup step.
		const system = ensureMemory();
		try {
			await system.initialize();
		} catch {
			// A memory problem must never prevent a session from opening.
		}
		const store = resolveStore(params);
		host = new KernelHost({
			cwd,
			mode: capabilityMode,
			permission,
			model: { profile, respond },
			thinkingLevel: toKernelThinking(params.thinking, "off"),
			capabilities: activeCapabilities(),
			context: capabilityContext,
			// An isolated conversation carries no memory at all: neither the
			// capabilities nor the section of the prompt that carries the hot
			// file.
			memory: () => (memoryIsolation ? "" : system.promptSection()),
			skills,
			store,
			bridge: agentBridge(),
			policy: generation.compactionPolicy(profile.context),
			onEvent: (event: HostEvent) => {
				if (event.type === "tool_execution_end" && ["write", "edit"].includes(event.toolName)) {
					emit({ type: "changes", changes: host?.changesSnapshot() ?? [] });
				}
				emit(event as unknown as Record<string, unknown>);
			},
			ask: (method, params, options) => question(method, params, options),
			repair: parseRepair(params.repair),
			onEscalate: async (modelId, thinking) => {
				const target = (config.profiles ?? []).find((entry) => entry.id === modelId || entry.model === modelId);
				if (!target) return false;
				await setProfile(target, thinking);
				return true;
			},
		});
		host.load();
		restoreHistory(store, params.history, profile);
		host.load();
		await mcp.load(cwd, agentDir());
		publishCapabilities();
		capabilityConfig = {
			mode: capabilityMode,
			hostTools: capabilityTools,
			context: capabilityContext,
			generation: generationOptions,
		};
		emit({ type: "opened", state: snapshot() });
		return snapshot();
	} finally {
		opening = false;
	}
}

/** The request methods the service may call. */
async function handle(method: string, params: Record<string, unknown>): Promise<unknown> {
	switch (method) {
		case "init":
			config = params as unknown as WorkerConfig;
			// Memory is loaded before the first session, so the store and its
			// projection exist as soon as the worker does.
			await startMemory();
			return { version: "3.0.0", node: process.version };
		case "open":
			return open(params);
		case "state":
			return snapshot();
		case "sessions":
			return SessionStore.list(sessionDir(), params.cwd ? String(params.cwd) : cwd);
		case "prompt": {
			const session = requireSession();
			const images = vision.validateImages(params.images as never);
			const text = expandPromptTemplate(String(params.text ?? ""), prompts);
			if (session.isBusy) {
				if (images?.length) throw new Error("Stop the active task before sending images.");
				if (params.queue === "steer") session.steer(text);
				else session.followUp(text);
				return snapshot();
			}
			if (params.profile) await setProfile(params.profile as ModelProfile, params.thinking ?? session.thinking);
			if (images?.length && !selectedProfile?.vision) throw new Error("This model is not configured for vision.");
			await session.prompt(text || (images?.length ? "Describe the attached image." : ""), images?.map((image) => ({ data: image.data, mimeType: image.mimeType })));
			// Retention runs after the answer, in the background. The user already
			// has the reply, so a slow extractor must not delay anything. The
			// isolation and the session are captured now, while this turn is the
			// one being retained.
			scheduleRetention(text, { isolated: memoryIsolation, sessionId: host?.store.id ?? null });
			return snapshot();
		}
		case "abort":
			for (const resolve of pendingUI.values()) resolve(undefined);
			await host?.abort();
			return snapshot();
		case "uiResponse":
			pendingUI.get(String(params.id))?.(params.value);
			return true;
		case "resources":
			requireSession();
			return resources();
		case "reload": {
			requireSession();
			loadSessionResources();
			await mcp.load(cwd, agentDir());
			publishCapabilities();
			return resources();
		}
		case "rename": {
			const session = requireSession();
			session.store.setName(String(params.name ?? ""));
			return snapshot();
		}
		case "compact": {
			const session = requireSession();
			await session.compact(params.instructions ? String(params.instructions) : undefined);
			return snapshot();
		}
		case "settings": {
			const session = requireSession();
			if (session.isBusy) throw new Error("Stop the active task before changing sessions or settings");
			if (["read", "ask", "full"].includes(String(params.permission))) {
				permission = params.permission as PermissionMode;
				session.setPermission(permission);
			}
			if (params.thinking) session.setThinkingLevel(toKernelThinking(params.thinking, session.thinking));
			if (params.repair !== undefined) session.setRepair(parseRepair(params.repair));
			if (Array.isArray(params.tools)) {
				activeToolNames = [...new Set((params.tools as unknown[]).map((name) => String(name)))];
				publishCapabilities();
			}
			return snapshot();
		}
		case "tree":
			return requireSession().store.tree();
		case "changes":
			return host?.changesSnapshot() ?? [];
		case "fork": {
			const session = requireSession();
			if (session.isBusy) throw new Error("Stop the active task before changing sessions or settings");
			const branched = session.store.createBranch(params.entryId ? String(params.entryId) : undefined);
			return open({
				cwd,
				trusted,
				permission,
				profile: selectedProfile,
				sessionId: branched.id,
				thinking: session.thinking,
				memoryIsolation,
			});
		}
		case "navigateTree": {
			const session = requireSession();
			session.navigateTo(String(params.entryId ?? ""));
			return snapshot();
		}
		case "background_jobs":
			return backgroundJobsSnapshot();
		case "palette": {
			// User-level commands and skills are available in both Chat and
			// project sessions. Project resources stay project-only.
			const foundSkills = loadSkills({ cwd, agentDir: agentDir(), trusted: false });
			const foundPrompts = loadPromptTemplates({ cwd, agentDir: agentDir(), trusted: false });
			return {
				skills: foundSkills.skills.map((skill) => ({ name: skill.name, description: skill.description, source: skill.source })),
				prompts: foundPrompts.templates.map((prompt) => ({
					name: prompt.name,
					description: prompt.description,
					argumentHint: prompt.argumentHint,
					source: prompt.source,
				})),
			};
		}
		case "undo_status":
			return requireSession().undoStatus();
		case "undo": {
			const session = requireSession();
			const result = session.undo(params.entryId ? String(params.entryId) : undefined);
			emit({ type: "changes", changes: session.changesSnapshot() });
			return { ...result, ...snapshot() };
		}
		case "export": {
			const session = requireSession();
			if (session.isBusy) throw new Error("Stop the active task before changing sessions or settings");
			return { text: session.store.export(), name: path.basename(session.store.path) };
		}
		case "import": {
			requireSession();
			const text = String(params.text ?? "");
			if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error("Session exceeds 32 MiB");
			return { sessionId: importSession(sessionDir(), text, cwd) };
		}
		case "terminalStart":
		case "terminalInput":
		case "terminalResize":
		case "terminalStop":
			throw new Error("The terminal view was removed. Use the Ramo conversation.");
		case "installPackage":
		case "removePackage":
			throw new Error("Package installation was removed with the Pi harness.");
		case "shutdown":
			await disposeSession();
			setTimeout(() => process.exit(0), 20);
			return true;
		default:
			throw new Error("Unknown worker request: " + method);
	}
}

/** One mutation at a time; the read-only methods may run beside them. */
let mutation: string | null = null;
const concurrent = new Set([
	"state",
	"sessions",
	"resources",
	"tree",
	"changes",
	"abort",
	"uiResponse",
	"terminalInput",
	"terminalResize",
	"shutdown",
]);

async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
	if (concurrent.has(method)) return handle(method, params);
	if (mutation) {
		if (method === "prompt" && mutation === "prompt" && host?.isBusy) {
			if (params.queue === "steer") host.steer(String(params.text ?? ""));
			else host.followUp(String(params.text ?? ""));
			return snapshot();
		}
		throw new Error("Stop the active task before changing sessions or settings");
	}
	mutation = method;
	try {
		return await handle(method, params);
	} finally {
		mutation = null;
	}
}

process.on("message", (packet: Record<string, unknown>) => {
	if (packet.kind === "hostToolResponse") {
		const pending = pendingHost.get(String(packet.id));
		if (pending) {
			pendingHost.delete(String(packet.id));
			if (packet.error) pending.reject(new Error(String(packet.error)));
			else pending.resolve(packet.result);
		}
		return;
	}
	if (packet.kind === "searchResponse") return;
	if (packet.kind !== "request") return;
	const id = packet.id as string;
	Promise.resolve()
		.then(() => dispatch(String(packet.method), (packet.params ?? {}) as Record<string, unknown>))
		.then(
			(result) => send({ kind: "response", id, result }),
			(error: unknown) => send({ kind: "response", id, error: error instanceof Error ? error.message : String(error) }),
		);
});

process.on("disconnect", () => {
	disposeSession().finally(() => process.exit(0));
});
