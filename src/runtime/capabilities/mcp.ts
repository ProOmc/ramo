/**
 * Ramo's MCP client.
 *
 * The Model Context Protocol lets a project provide extra capabilities from a
 * local program. Ramo speaks the protocol itself: it starts the configured
 * server, performs the JSON-RPC handshake, lists the server's tools and calls
 * them. Nothing about the protocol lives in an extension system, because
 * Ramo has no extension system.
 *
 * The wire details follow the protocol as implemented by Pi 1.4.0
 * (`third_party/pi/packages/coding-agent/src/core/mcp/`, MIT licensed,
 * Copyright (c) 2025 Mario Zechner): newline-delimited JSON-RPC over stdio, the
 * `initialize` handshake with the `notifications/initialized` notification
 * afterwards, cursor-paged `tools/list`, `tools/call` for execution, and the
 * `mcp__<server>__<tool>` naming with a 64 character cap and a hash suffix.
 *
 * Changes from the upstream client: the client is Ramo's own, the tool
 * catalogue is handed to the kernel directly, and a server is torn down with its
 * whole process tree when the project changes.
 */

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Capability, CapabilityResult, JsonObject } from "../kernel/types.js";

/** The protocol version Ramo offers. */
const PROTOCOL_VERSION = "2025-11-25";

/** The protocol versions Ramo accepts from a server. */
const ACCEPTED_PROTOCOL_VERSIONS = new Set([
	"2025-11-25",
	"2025-06-18",
	"2025-03-26",
	"2024-11-05",
]);

/** How long a single request may take. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** The longest tool name the model sees. */
const MAX_TOOL_NAME_LENGTH = 64;

/** How long a server may take to start and list its tools. */
const CONNECT_TIMEOUT_MS = 8_000;

/** Stop waiting for a server that does not answer. */
function withTimeout<T>(running: Promise<T>, timeout: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`the server did not answer within ${timeout} ms`)), timeout);
		running.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/** How a server's tools reach the model. */
export type McpExposure = "direct" | "codemode" | "deferred" | "hidden";

/** The configuration of one MCP server. */
export interface McpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	exposure?: McpExposure;
}

/** The configuration file format. */
export interface McpConfigFile {
	mcpServers?: Record<string, McpServerConfig>;
}

/** One tool an MCP server offers. */
export interface McpToolDefinition {
	/** The name the model sees. */
	name: string;
	label: string;
	description: string;
	/** The JSON Schema of the accepted arguments. */
	parameters: JsonObject;
	/** The server the tool belongs to. */
	server: string;
	/** The name the server knows the tool by. */
	originalName: string;
	/** How the tool reaches the model. */
	exposure: McpExposure;
}

/**
 * The name a server's tool gets in the model catalogue.
 *
 * Names outside the character set a provider accepts are replaced, and a name
 * that is too long keeps a hash of the original so two long names never
 * collide.
 */
export function mcpToolName(server: string, tool: string): string {
	const raw = `mcp__${server}__${tool}`;
	const sanitized = raw.replace(/[^A-Za-z0-9_]/g, "_");
	if (sanitized.length <= MAX_TOOL_NAME_LENGTH) return sanitized;
	const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 8);
	return `${sanitized.slice(0, MAX_TOOL_NAME_LENGTH - 9)}_${digest}`;
}

/** Read a configuration file. A missing or broken file is not an error. */
function readConfigFile(file: string): McpConfigFile {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as McpConfigFile;
		if (!parsed || typeof parsed !== "object" || typeof parsed.mcpServers !== "object" || !parsed.mcpServers) {
			return {};
		}
		return parsed;
	} catch {
		return {};
	}
}

/** Find the configuration files that apply to a project. */
export function mcpConfigFiles(cwd: string, agentDir: string): string[] {
	const files: string[] = [];
	if (agentDir) files.push(path.join(agentDir, "mcp.json"));
	files.push(path.join(cwd, ".pi", "mcp.json"));
	return files;
}

/** Merge the configuration files. A project file overrides the agent file. */
export function loadMcpConfig(cwd: string, agentDir: string): Map<string, McpServerConfig> {
	const servers = new Map<string, McpServerConfig>();
	for (const file of mcpConfigFiles(cwd, agentDir)) {
		for (const [name, config] of Object.entries(readConfigFile(file).mcpServers ?? {})) {
			if (!config || typeof config.command !== "string" || !config.command) continue;
			servers.set(name, {
				command: config.command,
				...(Array.isArray(config.args) ? { args: config.args.map(String) } : {}),
				...(config.env && typeof config.env === "object" ? { env: config.env } : {}),
				...(typeof config.cwd === "string" ? { cwd: config.cwd } : {}),
				...(config.exposure ? { exposure: config.exposure } : {}),
			});
		}
	}
	return servers;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

/**
 * One MCP server.
 *
 * The server is a child process that speaks newline-delimited JSON-RPC on its
 * standard input and output.
 */
export class McpClient {
	/** The name of the server in the configuration. */
	readonly name: string;
	private readonly config: McpServerConfig;
	private readonly cwd: string;
	private child: ChildProcess | undefined;
	private buffer = "";
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private closed = false;

	constructor(name: string, config: McpServerConfig, cwd: string) {
		this.name = name;
		this.config = config;
		this.cwd = cwd;
	}

	/** Start the server and list its tools. */
	async connect(): Promise<McpToolDefinition[]> {
		const child = spawn(this.config.command, this.config.args ?? [], {
			cwd: this.config.cwd ?? this.cwd,
			env: { ...process.env, ...(this.config.env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child = child;
		child.stdout?.setEncoding("utf-8");
		child.stdout?.on("data", (chunk: string) => this.consume(chunk));
		child.on("error", (error) => this.failAll(error instanceof Error ? error : new Error(String(error))));
		child.on("exit", (code) => {
			if (this.closed) return;
			this.failAll(new Error(`MCP server ${this.name} exited with code ${code ?? "unknown"}`));
		});

		const initialize = (await this.request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "ramo", version: "3.0.0" },
		})) as { protocolVersion?: string };
		const negotiated = initialize?.protocolVersion;
		if (negotiated && !ACCEPTED_PROTOCOL_VERSIONS.has(negotiated)) {
			throw new Error(`MCP server ${this.name} speaks protocol ${negotiated}, which Ramo does not accept`);
		}
		this.notify("notifications/initialized", {});

		const tools: McpToolDefinition[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 1000; page++) {
			const listed = (await this.request("tools/list", cursor ? { cursor } : {})) as {
				tools?: { name?: string; description?: string; inputSchema?: JsonObject }[];
				nextCursor?: string;
			};
			for (const tool of listed?.tools ?? []) {
				if (typeof tool?.name !== "string" || !tool.name) continue;
				tools.push({
					name: mcpToolName(this.name, tool.name),
					label: `${this.name}: ${tool.name}`,
					description: String(tool.description ?? `${tool.name} (MCP server ${this.name})`),
					parameters: normalizeSchema(tool.inputSchema),
					server: this.name,
					originalName: tool.name,
					exposure: this.config.exposure ?? "codemode",
				});
			}
			if (!listed?.nextCursor) break;
			cursor = listed.nextCursor;
		}
		return tools;
	}

	/** Call one tool of this server. */
	async callTool(originalName: string, args: JsonObject, signal?: AbortSignal): Promise<CapabilityResult> {
		const response = (await this.request(
			"tools/call",
			{ name: originalName, arguments: args },
			signal,
		)) as {
			content?: { type?: string; text?: string; data?: string; mimeType?: string }[];
			isError?: boolean;
			structuredContent?: unknown;
		};
		const content: CapabilityResult["content"] = [];
		for (const block of response?.content ?? []) {
			if (block?.type === "text" && typeof block.text === "string") {
				content.push({ type: "text", text: block.text });
			} else if (block?.type === "image" && typeof block.data === "string") {
				content.push({
					type: "image",
					data: block.data,
					mimeType: String(block.mimeType ?? "image/png"),
				});
			}
		}
		if (content.length === 0) content.push({ type: "text", text: "" });
		const details: JsonObject = { server: this.name, tool: originalName };
		if (response?.structuredContent !== undefined) details.structuredContent = response.structuredContent as never;
		return {
			content,
			details,
			...(response?.structuredContent !== undefined
				? { structuredContent: response.structuredContent as never }
				: {}),
			...(response?.isError ? { isError: true } : {}),
		};
	}

	/** Stop the server and every process it started. */
	async close(): Promise<void> {
		this.closed = true;
		this.failAll(new Error(`MCP server ${this.name} was closed`));
		const child = this.child;
		this.child = undefined;
		if (!child || child.pid === undefined) return;
		await killProcessTree(child);
	}

	/** Send one request and wait for its answer. */
	private request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		if (!this.child) return Promise.reject(new Error(`MCP server ${this.name} is not running`));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP request ${method} timed out`));
			}, DEFAULT_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			const onAbort = () => {
				const entry = this.pending.get(id);
				if (!entry) return;
				this.pending.delete(id);
				clearTimeout(entry.timer);
				entry.reject(new Error("MCP request was aborted"));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
			this.child?.stdin?.write(payload, (error) => {
				if (!error) return;
				const entry = this.pending.get(id);
				if (!entry) return;
				this.pending.delete(id);
				clearTimeout(entry.timer);
				entry.reject(error);
			});
		});
	}

	/** Send one notification. */
	private notify(method: string, params: unknown): void {
		this.child?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
	}

	/** Read the framed answers of the server. */
	private consume(chunk: string): void {
		this.buffer += chunk;
		if (this.buffer.length > 32 * 1024 * 1024) {
			this.failAll(new Error(`MCP server ${this.name} sent an oversized frame`));
			return;
		}
		let newline = this.buffer.indexOf("\n");
		while (newline !== -1) {
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			newline = this.buffer.indexOf("\n");
			if (!line) continue;
			let message: { id?: number; result?: unknown; error?: { message?: string } };
			try {
				message = JSON.parse(line) as typeof message;
			} catch {
				continue;
			}
			if (typeof message.id !== "number") continue;
			const entry = this.pending.get(message.id);
			if (!entry) continue;
			this.pending.delete(message.id);
			clearTimeout(entry.timer);
			if (message.error) entry.reject(new Error(message.error.message ?? "MCP request failed"));
			else entry.resolve(message.result);
		}
	}

	/** Reject every waiting request. */
	private failAll(error: Error): void {
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
		this.pending.clear();
	}
}

/** Normalise the schema of a tool so the kernel can validate against it. */
export function normalizeSchema(schema: JsonObject | undefined): JsonObject {
	const source = schema && typeof schema === "object" ? schema : {};
	const type = typeof source.type === "string" ? source.type : "object";
	const properties =
		source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)
			? (source.properties as JsonObject)
			: {};
	return {
		type,
		properties: properties as never,
		...(Array.isArray(source.required) ? { required: (source.required as unknown[]).map(String) } : {}),
	};
}

/**
 * Kill a process and everything it started.
 *
 * A server that started helpers must not leave them behind, so the whole tree
 * goes down with it.
 */
export async function killProcessTree(child: ChildProcess): Promise<void> {
	const pid = child.pid;
	if (pid === undefined) return;
	try {
		child.kill();
	} catch {
		// The process may already be gone.
	}
	if (process.platform === "win32") {
		await new Promise<void>((resolve) => {
			const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
				windowsHide: true,
				stdio: "ignore",
			});
			killer.on("error", () => resolve());
			killer.on("exit", () => resolve());
		});
		return;
	}
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		// The process was not a group leader.
	}
}

/** The servers of one project, with their tools. */
export interface McpRegistryState {
	tools: McpToolDefinition[];
	diagnostics: string[];
}

/**
 * The MCP servers of the running project.
 *
 * The registry is replaced whenever the project changes: the old servers are
 * stopped before the new ones start, so a project switch never leaves a server
 * running in the background.
 */
export class McpRegistry {
	private clients: McpClient[] = [];
	private state: McpRegistryState = { tools: [], diagnostics: [] };

	/** The tools the running project offers. */
	get tools(): McpToolDefinition[] {
		return this.state.tools;
	}

	/** The problems found while connecting. */
	get diagnostics(): string[] {
		return this.state.diagnostics;
	}

	/** Connect to every configured server of a project. */
	async load(cwd: string, agentDir: string): Promise<McpRegistryState> {
		await this.closeAll();
		const tools: McpToolDefinition[] = [];
		const diagnostics: string[] = [];
		const servers = loadMcpConfig(cwd, agentDir);
		for (const [name, config] of servers) {
			const client = new McpClient(name, config, cwd);
			try {
				const discovered = await withTimeout(client.connect(), CONNECT_TIMEOUT_MS);
				tools.push(...discovered);
				this.clients.push(client);
			} catch (error) {
				diagnostics.push(
					`MCP server ${name} could not start: ${error instanceof Error ? error.message : String(error)}`,
				);
				await client.close();
			}
		}
		this.state = { tools, diagnostics };
		return this.state;
	}

	/** Stop every server. */
	async closeAll(): Promise<void> {
		const clients = this.clients;
		this.clients = [];
		this.state = { tools: [], diagnostics: [] };
		for (const client of clients) await client.close();
	}

	/** The capability that calls one server's tool. */
	capability(definition: McpToolDefinition): Capability {
		const client = this.clients.find((entry) => entry.name === definition.server);
		return {
			name: definition.name,
			label: definition.label,
			description: definition.description,
			parameters: definition.parameters,
			readOnly: false,
			async execute(_id, args, signal) {
				if (!client) throw new Error(`MCP server ${definition.server} is not running`);
				return client.callTool(definition.originalName, args, signal);
			},
		};
	}
}
