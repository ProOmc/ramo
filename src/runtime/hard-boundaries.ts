/**
 * Ramo hard boundaries — step 3.
 *
 * These are code-owned constraints, not a parallel decision-maker. They never
 * decide what a page means or whether an answer is good. They only enforce
 * non-negotiable boundaries that hold regardless of model output.
 */

import crypto from "node:crypto";

export const NEVER_AUTO_SUBMIT = Object.freeze([
  "payment", "purchase", "bid", "post", "comment", "dm",
  "credential_entry", "terms_acceptance",
] as const);

export type BoundaryCategory = (typeof NEVER_AUTO_SUBMIT)[number];

export interface ActionBoundary {
  allowed: boolean;
  requiresApproval: boolean;
  category?: BoundaryCategory;
  reason: string;
}

const SIGNALS: Record<BoundaryCategory, RegExp> = {
  payment: /pay(?:ment)?|checkout|charge\s+card|card\s+number|invoice/i,
  purchase: /buy|purchase|order\s+now|add\s+to\s+cart/i,
  bid: /\bbid\b|auction/i,
  post: /\bpost\b|tweet|submit\s+(?:the\s+)?form|publish/i,
  comment: /\bcomment\b|reply\s+publicly/i,
  dm: /direct\s+message|\bdm\b|send\s+(?:a\s+)?message/i,
  credential_entry: /password|api\s*key|secret|passphrase|login\s+credentials/i,
  terms_acceptance: /accept\s+(?:the\s+)?terms|agree\s+to\s+(?:the\s+)?terms|sign\s+up/i,
};

/** Classify an action by observable signal only. This is not semantic judgment. */
export function classifyBoundary(text: string): BoundaryCategory | null {
  const value = String(text || "");
  for (const category of NEVER_AUTO_SUBMIT) if (SIGNALS[category].test(value)) return category;
  return null;
}

export function checkActionBoundary(options: {
  action: string;
  args?: Record<string, unknown>;
  approved?: boolean;
}): ActionBoundary {
  const category = classifyBoundary(`${options.action || ""} ${JSON.stringify(options.args || {})}`);
  if (category && !options.approved) {
    return { allowed: false, requiresApproval: true, category, reason: `${category} requires explicit human approval` };
  }
  if (category && options.approved) {
    return { allowed: true, requiresApproval: true, category, reason: `${category} was explicitly approved` };
  }
  return { allowed: true, requiresApproval: false, reason: "no never-auto-submit category detected" };
}

/** Domain allowlist. An empty allowlist means no outbound domain is allowed. */
export function checkDomain(url: string, allowlist: string[]): boolean {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return (Array.isArray(allowlist) ? allowlist : []).some(entry => {
      const value = String(entry).toLowerCase().replace(/^\./, "");
      return host === value || host.endsWith("." + value);
    });
  } catch { return false; }
}

/** Social accounts are contact/research only, with per-account host limits. */
export const SOCIAL_DOMAINS: Record<string, string[]> = Object.freeze({
  x: ["x.com", "twitter.com"],
  reddit: ["reddit.com"],
  youtube: ["youtube.com"],
  fandom: ["fandom.com"],
});

export function checkSocialDomain(accountKind: string, url: string): boolean {
  const list = SOCIAL_DOMAINS[String(accountKind || "")];
  if (!list) return false;
  return checkDomain(url, list);
}

/** Step, time and token budgets are deterministic and cancellable. */
export function checkBudget(state: {
  step?: number; maxSteps?: number;
  elapsedMs?: number; maxMs?: number;
  tokens?: number; maxTokens?: number;
}): { ok: boolean; reason: string } {
  if (Number.isFinite(state.maxSteps) && Number(state.step ?? 0) >= Number(state.maxSteps)) return { ok: false, reason: "step budget exhausted" };
  if (Number.isFinite(state.maxMs) && Number(state.elapsedMs ?? 0) >= Number(state.maxMs)) return { ok: false, reason: "time budget exhausted" };
  if (Number.isFinite(state.maxTokens) && Number(state.tokens ?? 0) >= Number(state.maxTokens)) return { ok: false, reason: "token budget exhausted" };
  return { ok: true, reason: "within budget" };
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Task cancelled");
}

/** Append-only integrity: a checksum over the exact action record. */
export function actionHash(record: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

export function verifyAction(record: unknown, hash: string): boolean {
  return actionHash(record) === String(hash || "");
}
