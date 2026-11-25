/**
 * Tiered-shell policy for the no-sandbox harness (docs/tiered-shell-spec.md §1).
 *
 * This is the "alternative to a sandbox": the model sees the normal `powershell`
 * tool with its unchanged description and no allowlist in its context. The
 * harness scans each attempted command per program AND subcommand and refuses
 * reads outside the read-only set at attempt time. The model then routes to
 * the user in chat; the harness never switches models and never offers an approval
 * card for a refused command.
 *
 * Harness-side only — nothing in this module is injected into a prompt. The
 * hard denylist (host-guard.ts, enforced again inside shell.ts) binds every
 * tier; the read-only check below only ADDS a restriction for tier R.
 *
 * Ramo-owned code. The scanner it builds on is also Ramo-owned
 * (command-scan.ts, modeled on OpenCode's shell scanner).
 */

import { scanPowerShellInvocations } from "./command-scan.js";

/** R = read-only restricted; B = broad shell (MoE profiles). */
export type ShellTier = "R" | "B";

/** The one-line refusal. Short on purpose: it must not spend context. */
export const SHELL_REFUSAL = "Blocked: read-only tier. Ask the user in chat to switch models.";

/**
 * Profile ids with broad shell access. Everything else — including unknown
 * ids, extra Ollama models and every `api:` profile — defaults to R.
 * the user promotes a MoE profile here deliberately; there is no auto-routing.
 */
const BROAD_PROFILE_IDS: ReadonlySet<string> = new Set<string>([
	"qwen36", // Super Smart — the local 35B-A3B CPU-MoE llama.cpp profile.
]);

/** Resolve the shell tier from the harness-side profile-id map. */
export function shellTierForProfile(profileId: string): ShellTier {
	return BROAD_PROFILE_IDS.has(String(profileId || "")) ? "B" : "R";
}

/**
 * The harness-side read-only allowlist (spec §1.4). `null` means every argument
 * is allowed for that program; otherwise each inner array is one allowed
 * leading-argument prefix (e.g. `["run", "check"]` for `npm.cmd run check`).
 * Adding a new read-only command is an explicit edit here with a comment naming
 * the Ramo workflow that needs it — it is never injected into the model prompt.
 */
const READ_ONLY_PROGRAMS: Readonly<Record<string, readonly (readonly string[])[] | null>> = {
	// Navigation/read (spec §1.4)
	"get-childitem": null,
	"get-content": null,
	"get-item": null,
	"test-path": null,
	"get-location": null,
	"get-command": null,
	where: null,
	ls: null,
	dir: null,
	cat: null,
	type: null,
	pwd: null,
	// Search/derive (spec §1.4)
	"select-string": null,
	findstr: null,
	"get-process": null,
	"get-ciminstance": null,
	"get-nettcpconnection": null,
	"measure-object": null,
	"sort-object": null,
	"select-object": null,
	"format-table": null,
	echo: null,
	// Version/test (spec §1.4) — read-only checks only; no build/install/publish.
	node: [["--version"], ["--test"]],
	python: [["--version"]],
	npm: [["test"], ["run", "check"]],
	"npm.cmd": [["test"], ["run", "check"]],
	// Git (spec §1.4) — only these read-only subcommands.
	git: [["status"], ["log"], ["diff"], ["branch"], ["show"]],
};

function matchesPrefix(args: string[], prefix: readonly string[]): boolean {
	return prefix.every((token, index) => String(args[index] ?? "").toLowerCase() === token.toLowerCase());
}

export interface ShellAccessDecision {
	allowed: boolean;
	reason?: string;
}

/**
 * Attempt-time read-only check for the shell tool.
 *
 * Tier B is unrestricted here (the hard denylist still binds at execution).
 * Tier R allows only the allowlisted programs/subcommands. A command that
 * cannot be scanned is refused rather than allowed by default.
 */
export function checkShellAccess(command: string, profileId: string): ShellAccessDecision {
	if (shellTierForProfile(profileId) === "B") return { allowed: true };
	const invocations = scanPowerShellInvocations(command);
	if (invocations.length === 0 && String(command || "").trim()) {
		return { allowed: false, reason: SHELL_REFUSAL };
	}
	for (const invocation of invocations) {
		const rule = READ_ONLY_PROGRAMS[invocation.program.toLowerCase()];
		if (rule === undefined) return { allowed: false, reason: SHELL_REFUSAL };
		if (rule !== null && !rule.some((prefix) => matchesPrefix(invocation.args, prefix))) {
			return { allowed: false, reason: SHELL_REFUSAL };
		}
	}
	return { allowed: true };
}
