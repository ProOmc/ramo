/**
 * Shared context-fill calculation used by the composer meter and the
 * Settings Session tab. Measured when model timings exist (prompt + output
 * of the last completed call against the harness window), else a chars/4
 * estimate of the real transcript. Never a static or fake number.
 */
import { useMemo } from 'react';
import type { ChatMessage } from './chat';

export interface ContextUsage {
  ctxWindow: number;
  used: number;
  percent: number;
  measured: boolean;
}

export function computeContextUsage(messages: Array<ChatMessage & { activity?: unknown }>, harnessContext?: number): ContextUsage {
  let ctxWindow = 16384;
  if (Number.isFinite(harnessContext) && (harnessContext as number) >= 4096) ctxWindow = Math.floor(harnessContext as number);
  let used = 0;
  let measured = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const calls = (messages[i]?.activity as { calls?: Array<{ metrics?: Record<string, unknown> | null }> } | undefined)?.calls;
    if (!Array.isArray(calls)) continue;
    for (let j = calls.length - 1; j >= 0; j -= 1) {
      const m = calls[j]?.metrics;
      if (!m) continue;
      const total = (Number(m.prompt_tokens ?? 0) || 0) + (Number(m.output_tokens ?? 0) || 0);
      if (total > 0) { used = total; measured = true; break; }
    }
    if (measured) break;
  }
  if (!measured) {
    const chars = messages.reduce((sum, m) => sum + String(m.user ?? '').length + String(m.assistant ?? '').length, 0);
    used = Math.floor(chars / 4);
  }
  const percent = Math.min(100, Math.max(0, Math.round((used / Math.max(1, ctxWindow)) * 100)));
  return { ctxWindow, used, percent, measured };
}

export function useContextUsage(messages: Parameters<typeof computeContextUsage>[0], harnessContext?: number): ContextUsage {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => computeContextUsage(messages, harnessContext), [messages, harnessContext]);
}
