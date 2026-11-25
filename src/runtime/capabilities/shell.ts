/**
 * Ramo shell capability: powershell.
 *
 * The behaviour follows Pi 1.4.0's PowerShell tool
 * (`third_party/pi/packages/coding-agent/src/core/tools/powershell.ts` and the
 * shared shell execution in `bash.ts`, MIT licensed, Copyright (c) 2025 Mario
 * Zechner): PowerShell 7 is preferred over Windows PowerShell, the command runs
 * without a profile and non-interactively, and the whole process tree is killed
 * when the run is aborted.
 *
 * Changes: this is Ramo's own implementation. Pi's shell environment helper
 * injected `PI_*` session variables; Ramo exposes its own `RAMO_*` variables
 * instead, so a command can see the model and session it belongs to.
 */

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Capability, JsonObject } from "../kernel/types.js";
import { binariesDirectory } from "../paths.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateTail } from "./truncate.js";
import { checkCommand } from "./host-guard.js";

/** A bounded record of one detached command. Output is capped, not streamed to the model. */
export interface BackgroundJob {
	id: string;
	command: string;
	startedAt: number;
	done: boolean;
	exitCode: number | null;
	output: string;
}
const backgroundJobs = new Map<string, BackgroundJob>();
let backgroundSequence = 0;

/** Snapshot of background jobs, newest last. */
export function backgroundJobsSnapshot(): BackgroundJob[] {
	return [...backgroundJobs.values()];
}


/** The arguments every PowerShell command runs with. */
const POWERSHELL_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"] as const;

/** The prefix that forces UTF-8 output, so non-ASCII text survives the pipe. */
const UTF8_OUTPUT_PREFIX = "try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n";

/** The maximum size of the command output kept in memory. */
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function fileExists(candidate: string): boolean {
	try {
		accessSync(candidate, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function findExecutableOnPath(name: string): string | undefined {
	const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const entries = (process.env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
	const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
	for (const entry of entries) {
		for (const extension of extensions) {
			const candidate = path.join(entry, name.endsWith(extension) ? name : name + extension);
			if (fileExists(candidate)) return candidate;
		}
	}
	return undefined;
}

/**
 * Resolve PowerShell on Windows, preferring PowerShell 7 when it is available.
 */
export function getPowerShellConfig(): { shell: string; args: string[] } {
	if (process.platform !== "win32") throw new Error("The powershell capability is only available on Windows.");

	let shell = findExecutableOnPath("pwsh.exe");
	const programFiles = process.env.ProgramFiles;
	if (!shell && programFiles) {
		const pwsh7 = path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe");
		if (fileExists(pwsh7)) shell = pwsh7;
	}
	shell ??= findExecutableOnPath("powershell.exe");
	const systemRoot = process.env.SystemRoot;
	if (!shell && systemRoot) {
		const windowsPowerShell = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
		if (fileExists(windowsPowerShell)) shell = windowsPowerShell;
	}
	if (!shell) throw new Error("No PowerShell executable found. Install PowerShell or add powershell.exe/pwsh.exe to PATH.");
	return { shell, args: [...POWERSHELL_ARGS] };
}

/**
 * Kill a process and everything it started.
 *
 * A command that spawned a child would otherwise keep running after the run was
 * aborted, and could still write to the project.
 */
export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {});
		} catch {
			// The process may already be gone.
		}
		return;
	}
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// The process may already be gone.
		}
	}
}

/** The environment a command runs with. */
function shellEnvironment(): NodeJS.ProcessEnv {
	const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const current = process.env[pathKey] ?? "";
	const entries = current.split(path.delimiter).filter(Boolean);
	const toolDirectory = binariesDirectory();
	return {
		...process.env,
		[pathKey]: entries.includes(toolDirectory) ? current : [toolDirectory, current].filter(Boolean).join(path.delimiter),
	};
}

interface CommandResult {
	output: string;
	truncated: boolean;
	exitCode: number;
	wallTimeSeconds: number;
}

/** Run one PowerShell command and collect its output. */
export function runPowerShell(
	command: string,
	cwd: string,
	options: { signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		let shell: string;
		let args: string[];
		try {
			const config = getPowerShellConfig();
			shell = config.shell;
			args = config.args;
		} catch (error) {
			reject(error);
			return;
		}

		access(cwd, constants.F_OK).catch(() => {
			reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute PowerShell commands.`));
			return;
		});

		const child = spawn(shell, [...args, `${UTF8_OUTPUT_PREFIX}${command}`], {
			cwd,
			detached: process.platform !== "win32",
			env: options.env ?? shellEnvironment(),
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		let output = "";
		let dropped = false;
		const onData = (chunk: Buffer) => {
			if (dropped) return;
			output += chunk.toString("utf-8");
			if (Buffer.byteLength(output, "utf-8") > MAX_OUTPUT_BYTES) {
				dropped = true;
				output = output.slice(0, MAX_OUTPUT_BYTES);
			}
		};
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);

		let timedOut = false;
		let timeoutHandle: NodeJS.Timeout | undefined;
		const onAbort = () => {
			if (child.pid) killProcessTree(child.pid);
		};
		if (options.timeout !== undefined) {
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				if (child.pid) killProcessTree(child.pid);
			}, options.timeout * 1000);
		}
		if (options.signal) {
			if (options.signal.aborted) onAbort();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}

		const cleanup = () => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			options.signal?.removeEventListener("abort", onAbort);
		};

		child.on("error", (error) => {
			cleanup();
			reject(new Error(`Failed to run PowerShell: ${error.message}`));
		});
		child.on("close", (code, signalCode) => {
			cleanup();
			if (options.signal?.aborted) {
				reject(new Error("Command aborted"));
				return;
			}
			if (timedOut) {
				reject(new Error(`Command timed out after ${options.timeout} seconds`));
				return;
			}
			const exitCode = code ?? (signalCode ? 128 : 1);
			resolve({
				output,
				truncated: dropped,
				exitCode,
				wallTimeSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
			});
		});
	});
}

/** Run a PowerShell command in the project. */
export function createPowerShellCapability(
	cwd: string,
	context: { sessionId?: string; model?: string; emit?: (event: Record<string, unknown>) => void } = {},
): Capability {
	return {
		name: "powershell",
		label: "powershell",
		description:
			"Execute a PowerShell command in the project directory. Use it for builds, tests and system inspection. The command runs without a profile and cannot ask questions. Set background=true for a long command: it returns a job id immediately and you will be notified when it finishes. Do not poll for completion.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string", description: "PowerShell command to execute" },
				timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" },
				background: { type: "boolean", description: "Return immediately and notify when the command finishes" },
			},
			required: ["command"],
			additionalProperties: false,
		},
		async execute(_id, params, signal) {
			const command = String(params.command);
			// Hard denylist: no prompt and no process spawn for these commands.
			const gate = checkCommand(command);
			if (!gate.allowed) throw new Error(gate.reason ?? "Command blocked by the host guard.");
			const timeout = params.timeout === undefined ? undefined : Number(params.timeout);
			const env = shellEnvironment();
			if (context.sessionId) env.RAMO_SESSION_ID = context.sessionId;
			if (context.model) env.RAMO_MODEL = context.model;

			if (params.background === true) {
				const jobId = `bg-${Date.now()}-${++backgroundSequence}`;
				const job: BackgroundJob = { id: jobId, command, startedAt: Date.now(), done: false, exitCode: null, output: "" };
				backgroundJobs.set(jobId, job);
				if (backgroundJobs.size > 50) backgroundJobs.delete(backgroundJobs.keys().next().value as string);
				const settle = (exitCode: number, output: string) => {
					job.done = true;
					job.exitCode = exitCode;
					job.output = output.slice(0, 8000);
					context.emit?.({ type: "background_job_done", jobId, command, exitCode, output: job.output, at: Date.now() });
				};
				void runPowerShell(command, cwd, { env })
					.then((result) => settle(result.exitCode, truncateTail(result.output).content))
					.catch((error) => settle(1, String((error as { message?: string })?.message ?? error)));
				return {
					content: [{ type: "text" as const, text: `Background job ${jobId} started. You will be notified when it completes; do not poll for it.` }],
					details: { jobId, background: true } as JsonObject,
					structuredContent: { job_id: jobId, background: true } as JsonObject,
				};
			}

			const result = await runPowerShell(command, cwd, { signal, timeout, env });
			const truncation = truncateTail(result.output);
			let text = truncation.content;
			const details: JsonObject = {
				exitCode: result.exitCode,
				wallTimeSeconds: result.wallTimeSeconds,
			};
			if (truncation.truncated) {
				const startLine = truncation.totalLines - truncation.outputLines + 1;
				text += `\n\n[Showing lines ${startLine}-${truncation.totalLines} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit).]`;
				details.truncation = truncation as unknown as JsonObject;
			}
			const structured: JsonObject = {
				output: result.output,
				truncated: result.truncated || truncation.truncated,
				exit_code: result.exitCode,
				wall_time_seconds: result.wallTimeSeconds,
			};
			if (result.exitCode !== 0) {
				return {
					content: [{ type: "text" as const, text: `${text ? `${text}\n\n` : ""}Command exited with code ${result.exitCode}` }],
					details,
					structuredContent: structured,
					isError: true,
				};
			}
			return { content: [{ type: "text" as const, text }], details, structuredContent: structured };
		},
	};
}

/** The operating system constants used to report a signal exit. */
export const SIGNAL_NUMBERS = os.constants.signals;
