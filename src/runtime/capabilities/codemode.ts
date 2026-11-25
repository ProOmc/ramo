/**
 * Ramo's `codemode` capability.
 *
 * The model may write a small JavaScript program that calls several
 * capabilities in one step: read three files, run one command, keep only the
 * lines it needs. The program runs in a fresh context that has no file system,
 * no network and no timers of its own; the only way out is the `tools` object,
 * and every call through it goes through the same permission check as a direct
 * call.
 *
 * Pi 1.4.0 offered the same capability (`third_party/pi/packages/coding-agent/
 * src/extensions/codemode/tool.ts`, MIT licensed, Copyright (c) 2025 Mario
 * Zechner), but ran the program in a QuickJS sandbox. Ramo has no QuickJS
 * dependency and may not add one, so the program runs in a Node context built
 * with `node:vm`. A Node context is not a security boundary: the sandbox keeps
 * the program away from the file system and the network by withholding
 * `require`, `process` and `fetch`, but a determined program can still reach
 * the host through the prototype chain. The capability therefore requires the
 * same approval as any other command, in a chat as much as in a project.
 */

import vm from "node:vm";
import type { Capability, CapabilityResult, JsonObject, ToolDeclaration } from "../kernel/types.js";

/** The name the model calls this capability by. */
export const CODEMODE_CAPABILITY_NAME = "codemode";

/** How long a script may run. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** The most output a script may produce. */
const DEFAULT_MAX_OUTPUT_CHARS = 40_000;

/** What a script may call. */
export interface CodemodeInvoker {
	/** The declarations of the capabilities a script may call. */
	declarations: () => ToolDeclaration[];
	/** Calls one capability. The call goes through the kernel's permission check. */
	invoke: (name: string, args: JsonObject, signal?: AbortSignal) => Promise<CapabilityResult>;
}

/** The options a script may set on its first line. */
interface CodemodeOptions {
	max_output_tokens?: number;
	timeout_ms?: number;
}

/** The globals a script sees. */
const DESCRIPTION = `Run JavaScript that calls other capabilities. The input is raw JavaScript, not JSON and not a code fence. It runs as the body of an async function, so top-level \`await\` and \`return\` work.
- \`await tools.<name>({ ...args })\` resolves to the text output of the capability and rejects with an Error when it fails.
- \`text(value)\`, \`console.log(...)\` and a top-level \`return\` add output. \`exit()\` ends the script early.
- \`store(key, value)\` and \`load(key)\` keep JSON values between calls.
- \`ALL_TOOLS\` lists the capabilities a script may call.
- Optional first line: \`// @options: {"timeout_ms": 60000}\``;

/**
 * The capability that runs a script.
 *
 * The invoker is supplied by the kernel host, so a nested call is validated and
 * approved exactly like a call the model made directly.
 */
export function createCodemodeCapability(invoker: CodemodeInvoker): Capability {
	return {
		name: CODEMODE_CAPABILITY_NAME,
		label: CODEMODE_CAPABILITY_NAME,
		description: DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				script: { type: "string", description: "The JavaScript program to run" },
			},
			required: ["script"],
			additionalProperties: false,
		},
		readOnly: false,
		async execute(_id, params, signal): Promise<CapabilityResult> {
			const script = String(params.script ?? "");
			if (!script.trim()) throw new Error("The script was empty");
			const options = readOptions(script);
			const timeout = Math.max(1000, Math.min(DEFAULT_TIMEOUT_MS, options.timeout_ms ?? DEFAULT_TIMEOUT_MS));
			const maxOutput = Math.max(1000, Math.min(DEFAULT_MAX_OUTPUT_CHARS, (options.max_output_tokens ?? 10_000) * 4));

			const texts: string[] = [];
			const images: CapabilityResult["content"] = [];
			const consoleLines: string[] = [];
			const store = new Map<string, unknown>();
			let finished = false;

			const addText = (value: unknown): void => {
				if (value === undefined || value === null) return;
				texts.push(typeof value === "string" ? value : JSON.stringify(value));
			};

			const consoleProxy = {
				log: (...args: unknown[]) => consoleLines.push(args.map(formatValue).join(" ")),
				info: (...args: unknown[]) => consoleLines.push(args.map(formatValue).join(" ")),
				warn: (...args: unknown[]) => consoleLines.push(args.map(formatValue).join(" ")),
				error: (...args: unknown[]) => consoleLines.push(args.map(formatValue).join(" ")),
			};

			const tools: Record<string, (args: JsonObject) => Promise<string>> = {};
			for (const declaration of invoker.declarations()) {
				if (declaration.name === CODEMODE_CAPABILITY_NAME) continue;
				tools[declaration.name] = async (args: JsonObject) => {
					if (finished) throw new Error("The script has already ended");
					const result = await invoker.invoke(declaration.name, args ?? {}, signal);
					if (result.isError) throw new Error(textOfResult(result));
					return textOfResult(result);
				};
			}

			const sandbox: Record<string, unknown> = {
				tools,
				ALL_TOOLS: invoker.declarations().map((declaration) => ({
					name: declaration.name,
					description: declaration.description,
					parameters: declaration.parameters,
				})),
				text: addText,
				image: (value: unknown) => {
					if (typeof value === "string" && value.startsWith("data:")) {
						const match = /^data:([^;]+);base64,(.+)$/s.exec(value);
						if (match) images.push({ type: "image", data: match[2], mimeType: match[1] });
						return;
					}
					if (value && typeof value === "object") {
						const block = value as { data?: string; mimeType?: string };
						if (typeof block.data === "string") {
							images.push({ type: "image", data: block.data, mimeType: block.mimeType ?? "image/png" });
						}
					}
				},
				exit: () => {
					finished = true;
				},
				store: (key: string, value: unknown) => {
					store.set(String(key), value);
				},
				load: (key: string) => store.get(String(key)),
				console: consoleProxy,
			};

			const context = vm.createContext(sandbox, { name: "ramo-codemode" });
			const body = script.replace(/^\/\/\s*@options:.*$/m, "");
			const wrapped = `(async () => {\n${body}\n})()`;

			let value: unknown;
			try {
				const running = vm.runInContext(wrapped, context, { timeout, displayErrors: true }) as Promise<unknown>;
				value = await withTimeout(running, timeout, signal);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const body = [
					"Script failed",
					"",
					message,
					...(consoleLines.length > 0 ? ["", "<console_output>", ...consoleLines, "</console_output>"] : []),
				].join("\n");
				const failedDetails: JsonObject = { failed: true, error: message };
				return {
					content: [{ type: "text", text: truncate(body, maxOutput) }],
					details: failedDetails,
					isError: true,
				};
			}

			if (value !== undefined) addText(value);
			const sections: string[] = ["Script completed"];
			if (texts.length > 0) {
				sections.push("", ...texts.map((text, index) => (texts.length === 1 ? text : `==> text ${index + 1}/${texts.length} <==\n${text}`)));
			}
			if (consoleLines.length > 0) {
				sections.push("", "<console_output>", ...consoleLines, "</console_output>");
			}
			const text = sections.join("\n");
			const details: JsonObject = { failed: false, outputs: texts.length, console: consoleLines.length };
			return {
				content: [...images, { type: "text", text: truncate(text, maxOutput) }],
				details,
			};
		},
	};
}

/** The text of a capability result. */
function textOfResult(result: CapabilityResult): string {
	return result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/** Format one value for the console. */
function formatValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

/** Read the options from the first line of the script. */
function readOptions(script: string): CodemodeOptions {
	const match = /^\s*\/\/\s*@options:\s*(\{.*\})\s*$/m.exec(script);
	if (!match) return {};
	try {
		const parsed = JSON.parse(match[1]) as CodemodeOptions;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** Stop a script that runs for too long. */
function withTimeout<T>(running: Promise<T>, timeout: number, signal?: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`The script ran for more than ${timeout} ms`)), timeout);
		const onAbort = () => reject(new Error("The script was aborted"));
		signal?.addEventListener("abort", onAbort, { once: true });
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

/** Shorten output that is too long. */
function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n\n[Output shortened to ${limit} characters.]`;
}
