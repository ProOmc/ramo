/**
 * Ramo host-access guard for the no-sandbox run/edit loop.
 *
 * OpenCode parity: safety is a permission prompt, not a VM boundary. This
 * module is the deterministic part: it refuses a small set of clearly
 * destructive commands and keeps edits inside the session's project folder.
 * It never grants permission and never reads or records secrets.
 *
 * Derived from the public OpenCode permission model
 * (packages/core/src/permission.ts and tool/plugin/shell.ts, anomalyco/opencode)
 * and Pi 1.4.0's file path resolution in third_party/pi. Ramo-owned code,
 * modeled on both — no import, no fork.
 */
import path from "node:path";
import type { JsonObject } from "../kernel/types.js";
import { scanPowerShell } from "./command-scan.js";
export { scanPowerShell } from "./command-scan.js";

export interface GuardDecision {
  allowed: boolean;
  action: string;
  resource: string;
  reason?: string;
}

/** Commands refused even when the session has full permission. */
export const COMMAND_DENYLIST: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(?:Format-Volume|Format-Volume|diskpart|bcdedit|bootrec|cipher\s+\/w)\b/i, reason: "Disk, partition or boot configuration changes are blocked." },
  { pattern: /\bnetsh\s+advfirewall\s+set\b[\s\S]*\boff\b/i, reason: "Turning the firewall off is blocked." },
  { pattern: /\bSet-NetFirewallProfile\b[\s\S]*-Enabled\s+\$?false\b/i, reason: "Turning the firewall off is blocked." },
  { pattern: /\b(?:Start-Process|powershell(?:\.exe)?|pwsh(?:\.exe)?)[\s\S]*-Verb\s+RunAs\b/i, reason: "Silent elevation is blocked; ask the user instead." },
  { pattern: /\brunas\b|\bsudo\b/i, reason: "Elevation is blocked; ask the user instead." },
  { pattern: /\b(?:Stop-Process|taskkill)\b[\s\S]*\b(?:System|Wininit|csrss|smss|lsass)\b/i, reason: "Stopping a critical system process is blocked." },
  { pattern: /\b(?:Remove-Item|ri|del|rmdir|rd)\b[\s\S]*(?:C:\\+\s*[$]?|C:\\+Users\b|C:\\+Windows\b|C:\\+Program\s+Files\b|[~$]\\\s*$)[\s\S]*(?:-Recurse|\/s)\b/i, reason: "Recursive deletion of a drive, home or system folder is blocked." },
  { pattern: /\breg\s+delete\s+HKLM\b|\bRemove-Item\b[\s\S]*HKLM:/i, reason: "Deleting machine-wide registry keys is blocked." },
  { pattern: /(?:iwr|Invoke-WebRequest|curl|wget)[\s\S]*\|\s*(?:iex|Invoke-Expression)\b/i, reason: "Running downloaded code directly is blocked." },
];

/** Resolve a session path against the project folder. */
export function resolveProjectPath(input: string, cwd: string): string {
  const value = String(input || "").trim();
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    return path.resolve(home, value.slice(1).replace(/^[\\/]/, ""));
  }
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value);
}

/** Edits are confined to the session's project folder. */
export function checkProjectPath(input: string, cwd: string): GuardDecision {
  const resolved = resolveProjectPath(input, cwd);
  const root = path.resolve(cwd);
  const inside = resolved === root || resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  return inside
    ? { allowed: true, action: "edit", resource: resolved }
    : { allowed: false, action: "edit", resource: resolved, reason: "Edits are limited to the project folder." };
}

/** Refuse commands on the hard denylist before any prompt or process spawn. */
export function checkCommand(command: string): GuardDecision {
  const value = String(command || "");
  for (const rule of COMMAND_DENYLIST) {
    if (rule.pattern.test(value)) return { allowed: false, action: "powershell", resource: value.slice(0, 400), reason: rule.reason };
  }
  return { allowed: true, action: "powershell", resource: value.slice(0, 400) };
}

/** Stable key for "allow for this task" decisions in one session. */
export function permissionFingerprint(toolName: string, args: JsonObject): string {
  if (toolName === "powershell" && typeof args.command === "string") {
    const programs = scanPowerShell(args.command);
    if (programs.length) return `${toolName}:programs=${programs.map((name) => name.toLowerCase()).sort().join(",")}`;
    return `${toolName}:command=${JSON.stringify(String(args.command).slice(0, 400))}`;
  }
  const keys = ["path", "file", "files"].filter((key) => args[key] !== undefined).sort();
  const parts = keys.map((key) => `${key}=${JSON.stringify(args[key])}`);
  return `${toolName}:${parts.join("|") || "any"}`;
}

/** Step-4 provenance shown in the approval card. */
export function approvalDetails(toolName: string, args: JsonObject): { action: string; resource: string; provenance: string; resources?: string[] } {
  if (toolName === "powershell") {
    const command = String(args.command ?? "");
    const resources = scanPowerShell(command);
    return {
      action: "Run command",
      resource: command,
      ...(resources.length ? { resources } : {}),
      provenance: "Command proposed by the model; runs on this PC with your account permissions.",
    };
  }
  const target = typeof args.path === "string" ? args.path : Array.isArray(args.files) ? args.files.join(", ") : "";
  return { action: toolName === "edit" ? "Edit file" : toolName === "write" ? "Write file" : "Change files", resource: String(target), provenance: "File change proposed by the model inside the project folder." };
}
