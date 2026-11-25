/**
 * Lazy tool discovery for the unified surface (docs/tiered-shell-spec.md §2).
 *
 * Layer 1 is a tiny always-on index: tool name plus one-line purpose, with the
 * `tool_info <name>` instruction beside it (host.ts puts it in the system
 * prompt). Layer 2 is the full JSON schema, returned on demand by `tool_info`
 * or just-in-time when the model calls an unloaded tool by name.
 *
 * The harness-side policy is never in the model's context: the index lists
 * names and one-line purposes only, and this module is never injected into the
 * tool declarations wholesale.
 *
 * Ramo-owned code. Hook points: host.ts loopConfig/buildSystemPrompt and
 * loop.ts prepareCall's not-found path.
 */

import type { Capability, CapabilityResult, JsonObject, ToolDeclaration } from "../kernel/types.js";

/** The seven work tools kept fully loaded every turn (spec §2.2, DECIDED). */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
	"read",
	"write",
	"edit",
	"ls",
	"find",
	"grep",
	"powershell",
]);

export const TOOL_INFO_NAME = "tool_info";
export const TOOL_INFO_DESCRIPTION = "Describe a tool's schema and show an example.";

const DISCOVERY_INSTRUCTION = "Call tool_info <name> once for a schema, then call the tool directly. Do not call tool_info twice for the same name.";

/** First sentence of a description, capped to one short line. */
export function oneLine(description: string): string {
	const text = String(description || "").replace(/\s+/g, " ").trim();
	const first = text.split(/(?<=[.!?])\s|;\s|\s-\s/)[0] || text;
	return first.length > 110 ? `${first.slice(0, 107)}...` : first;
}

/**
 * Build the always-on index. One line per tool, plus the discovery instruction.
 * No schemas, no arguments, no allowlists — only names and one-line purposes.
 */
export function buildToolIndex(declarations: ToolDeclaration[]): string {
	const lines = declarations
		.filter((declaration) => declaration.name !== TOOL_INFO_NAME)
		.map((declaration) => `- ${declaration.name}: ${oneLine(declaration.description)}`);
	if (lines.length === 0) return "";
	return [`## Available tools`, DISCOVERY_INSTRUCTION, ...lines].join("\n");
}

function exampleValue(key: string, schema: JsonObject | undefined): unknown {
	const name = key.toLowerCase();
	if (name === "url" || name.endsWith("url")) return "https://example.com";
	if (name === "path" || name === "file") return "notes.txt";
	if (name === "query" || name === "pattern") return "notes";
	if (name === "command") return "Get-ChildItem .";
	if (name === "name" || name === "word") return "example";
	if (!schema) return "value";
	const values = schema.enum;
	if (Array.isArray(values) && values.length) return values[0];
	const type = schema.type;
	if (type === "number" || type === "integer") return 1;
	if (type === "boolean") return true;
	if (type === "array") return [];
	if (type === "object") return {};
	return "value";
}

/**
 * The declaration sent for a tool whose full schema is loaded on demand. A
 * real function-calling model can only emit calls to declared functions, so
 * indexed tools must still appear in `tools` — just with a tiny schema.
 */
export function minimalDeclaration(declaration: ToolDeclaration): ToolDeclaration {
	const raw = declaration.parameters?.properties;
	const source: JsonObject | undefined = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as JsonObject : undefined;
	const properties: JsonObject = {};
	if (source) {
		for (const key of Object.keys(source)) {
			const value = source[key];
			const type = value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject).type : undefined;
			properties[key] = { type: type || "string" } as JsonObject;
		}
	}
	return {
		name: declaration.name,
		description: oneLine(declaration.description),
		// Keep the argument NAMES so the model can call the tool correctly the
		// first time. Only constraints/descriptions wait for the full schema.
		parameters: { type: "object", properties, additionalProperties: true },
	};
}

/** One short, valid-shaped example call for a declaration. */
export function exampleCall(declaration: ToolDeclaration): string {
	const parameters = declaration.parameters || ({} as JsonObject);
	const properties = (parameters.properties && typeof parameters.properties === "object"
		? parameters.properties
		: {}) as Record<string, JsonObject>;
	const required = Array.isArray(parameters.required)
		? parameters.required.map((name: unknown) => String(name))
		: Object.keys(properties);
	const args: Record<string, unknown> = {};
	for (const key of required.slice(0, 6)) args[key] = exampleValue(key, properties[key]);
	return `${declaration.name} ${JSON.stringify(args)}`;
}

/** The text returned for an exact-name lookup. */
export function describeTool(declaration: ToolDeclaration): string {
	return [
		`Tool: ${declaration.name}`,
		`Purpose: ${oneLine(declaration.description)}`,
		`Full description: ${declaration.description}`,
		`Schema: ${JSON.stringify(declaration.parameters)}`,
		`Example: ${exampleCall(declaration)}`,
		`Now call ${declaration.name} directly with your real arguments. Do not call tool_info again for ${declaration.name}.`,
	].join("\n");
}

/**
 * The `tool_info` capability. Exact-name lookup first, substring `query` as
 * fallback; a successful lookup returns the full schema plus one example.
 */
export function createToolInfoCapability(options: { declarations: () => ToolDeclaration[] }): Capability {
	return {
		name: TOOL_INFO_NAME,
		label: "tool_info",
		description: TOOL_INFO_DESCRIPTION,
		readOnly: true,
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", description: "Exact tool name." },
				query: { type: "string", description: "Substring of a tool name, when the exact name is unknown." },
			},
			additionalProperties: false,
		},
		async execute(_id, params): Promise<CapabilityResult> {
			const all = options.declarations().filter((declaration) => declaration.name !== TOOL_INFO_NAME);
			const name = String(params.name ?? "").trim();
			const query = String(params.query ?? "").trim();
			if (name) {
				const exact = all.find((declaration) => declaration.name === name);
				if (exact) return { content: [{ type: "text", text: describeTool(exact) }], details: {} };
			}
			const needle = (query || name).toLowerCase();
			if (needle) {
				const matches = all.filter((declaration) => declaration.name.toLowerCase().includes(needle));
				if (matches.length === 1) return { content: [{ type: "text", text: describeTool(matches[0]) }], details: {} };
				if (matches.length > 1) {
					return {
						content: [{
							type: "text",
							text: `Tools matching "${needle}": ${matches.map((entry) => entry.name).join(", ")}. Call tool_info with the exact name.`,
						}],
						details: {},
					};
				}
			}
			return {
				content: [{ type: "text", text: `No tool named ${name || query || "(none)"}. Available: ${all.map((entry) => entry.name).join(", ")}` }],
				details: {},
				isError: true,
			};
		},
	};
}
