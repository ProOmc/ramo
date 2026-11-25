/**
 * Inline activity records the live transcript consumes.
 *
 * The ports this file used to carry (HTML string renderers matching
 * `compat/workspace.js#_inlineActivityHTML`, used by the legacy DOM flow)
 * were removed — React owns the presentation now via
 * `src/ui/conversation/ActivityTimeline.tsx`.
 */

export interface ActivityStep {
  at?: number;
  kind: string;
  status?: string;
  message?: string;
  cached?: boolean;
  why?: string;
  characters?: number;
  error?: string;
  /** Set by compat when a step completes (request → resolution); used for tool-lane timing. */
  completed_at?: number;
  sources?: Array<{ url?: string; title?: string; snippet?: string; published?: string }>;
  resultsReceived?: boolean;
  searchStatus?: string;
  searchError?: string;
}
export interface ActivityCall {
  id: string;
  at?: number;
  model?: string;
  stage?: string;
  status?: string;
  output?: string;
  thinking?: string;
  thinkingOmitted?: boolean;
  thinkingEnabled?: boolean;
  thinkingTruncated?: boolean;
  elapsed_ms?: number;
  metrics?: Record<string, unknown>;
}
export interface ActivityRun {
  id?: string;
  index: number;
  at: number;
  done?: boolean;
  interrupted?: boolean;
  failed?: boolean;
  partial?: boolean;
  status?: string;
  elapsed_ms?: number;
  hiddenSteps?: number;
  hiddenCalls?: number;
  storageLimited?: boolean;
  imported?: boolean;
  revision?: number;
  calls: ActivityCall[];
  steps: ActivityStep[];
}
export interface ActivityState {
  active: string;
  inlineOpen?: Record<string, boolean>;
  inlineDetailOpen?: Record<string, boolean>;
}

/**
 * Recompute the inline-activity runs for the visible chat — a read of
 * the renderer's own message store, deduped by call/step identity.
 */
export function gatherInlineRuns(
  active: string,
  messages: Array<{ activity?: unknown }>,
  liveRun: ActivityRun | undefined,
): ActivityRun[] {
  const rows: ActivityRun[] = [];
  messages.forEach((m, index) => {
    const rec = m.activity as ActivityRun | undefined;
    if (rec) rows.push({ ...rec, index, calls: Array.isArray(rec.calls) ? rec.calls : [], steps: Array.isArray(rec.steps) ? rec.steps : [] });
  });
  if (liveRun && (liveRun.calls?.length || liveRun.steps?.length || (liveRun as { id?: string }).id)) rows.push({ ...liveRun, index: messages.length });
  return rows.sort((a, b) => a.index - b.index || (a.at ?? 0) - (b.at ?? 0));
}
