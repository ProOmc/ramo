/**
 * Per-reply stats trigger + hover card.
 *
 * Adapted from Cherry Studio's `MessageTokens.tsx` / `MessageTokenDetailsCard.tsx`
 * (React copy, imports replaced with Ramo's ActivityRun metrics and Ramo's
 * tokens/CSS). Data comes only from what the runtime stored for this turn —
 * never fabricated; empty metrics => nothing rendered.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActivityRun } from '../lib/activity';

function whole(n: unknown): number | null {
  return n !== null && n !== undefined && Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.round(Number(n)) : null;
}
function rate(n: unknown): number | null {
  return Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : null;
}
function compact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
function withThousands(n: number): string {
  return n.toLocaleString('en-US');
}
function durationLabel(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = ms / 1000;
  if (seconds < 60) return seconds.toFixed(seconds < 10 ? 1 : 0) + 's';
  const mins = Math.floor(seconds / 60);
  const rest = Math.round(seconds - mins * 60);
  return `${mins}m ${rest}s`;
}
function shortDate(at?: number): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

interface MetricsView {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  modelTps: number | null;
  timeFirstTokenMs: number | null;
  endToEndTps: number | null;
  totalDurationMs: number | null;
  model: string | null;
  provider: string | null;
  lastModelLaneMs: number;
  turnElapsedMs: number;
}

export function ReplyStats({ run }: { run?: ActivityRun | undefined }) {
  const [open, setOpen] = useState(false);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); }, []);
  // Pin the hover card to viewport coordinates: the message list scrolls and
  // clips, so an absolutely-positioned card inside it gets cut off near the
  // top. The portal card is placed above the anchor when there is room,
  // below it otherwise, right-aligned to the trigger.
  useLayoutEffect(() => {
    if (!open) { setCardPos(null); return undefined; }
    const measure = () => {
      const anchor = hostRef.current?.getBoundingClientRect();
      const card = cardRef.current;
      if (!anchor || !card) return;
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.right - width));
      let top = anchor.top - height - 10;
      if (top < 8) top = anchor.bottom + 10;
      setCardPos({ top: Math.round(top), left: Math.round(left) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const inHost = hostRef.current?.contains(target ?? null) ?? false;
      const inCard = cardRef.current?.contains(target ?? null) ?? false;
      if (!inHost && !inCard) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPointer, true); };
  }, [open]);

  const closeSoon = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpen(false), 180);
  };
  const openNow = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpen(true), 160);
  };

  const metrics = (run?.calls ?? []).map((c) => c.metrics as Record<string, unknown> | undefined).filter(Boolean) as Array<Record<string, unknown>>;
  if (!metrics.length) return null;
  const callMetrics = [...metrics].reverse();
  const call = callMetrics.find((m) => Number(m.output_tps) > 0) ?? callMetrics[0];
  const requestSettings = call.request_settings as Record<string, unknown> | undefined;
  const model = (typeof requestSettings?.model === 'string' ? requestSettings.model : null)
    ?? (typeof (run?.calls?.find((c) => c.metrics)?.model) === 'string' ? String(run?.calls?.find((c) => c.metrics)?.model) : null);
  const provider = typeof call.provider === 'string' ? call.provider : null;
  const providerLabel = provider === 'ollama' ? 'Ollama' : (provider && provider.startsWith('api:')) ? 'API provider' : (provider ? provider : null);
  const inputTokens = whole(call.prompt_tokens);
  const outputTokens = whole(call.output_tokens);
  const cachedTokens = whole(call.prompt_cached_tokens);
  const modelTps = rate(call.output_tps);
  const timeFirstTokenMs = rate(call.time_to_first_chunk_ms);
  const wallMs = rate(call.wall_ms);
  const endToEndTps = outputTokens !== null && wallMs ? (outputTokens * 1000) / wallMs : null;
  const totalDurationMs = wallMs ?? rate(run?.elapsed_ms) ?? null;
  const modelLaneMs = metrics.reduce((total, m) => total + (Number(m.prompt_ms) || 0) + (Number(m.output_ms) || 0), 0);
  const turnElapsedMs = typeof run?.elapsed_ms === 'number' ? run.elapsed_ms : Math.max(modelLaneMs, wallMs ?? 0);

  const view: MetricsView = {
    inputTokens, outputTokens, cachedTokens, modelTps,
    timeFirstTokenMs, endToEndTps, totalDurationMs,
    model, provider, lastModelLaneMs: modelLaneMs, turnElapsedMs,
  };

  const totals = (inputTokens ?? 0) + (outputTokens ?? 0);
  if (totals <= 0 && !modelTps) return null;
  const totalCompact = compact(totals);
  const label = modelTps ? `${totalCompact} Tokens · ${modelTps.toFixed(1)} Tokens/s` : `${totalCompact} Tokens`;

  // Runtime breakdown, real measured values only:
  //   Model = sum of every model call's prompt_ms + output_ms (Ollama timings).
  //   Tool  = sum of (step completed_at − step at) for tool steps that recorded
  //           both (search steps get completed_at when results land; read
  //           steps get it when the read resolves). Steps without both are excluded.
  //   Other = whatever is left of the turn's elapsed time (includes
  //           compaction, queue wait and untracked tool dispatch).
  const toolMs = (run?.steps ?? []).reduce((sum, step) => {
    const start = Number(step.at);
    const end = Number(step.completed_at);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? sum + (end - start) : sum;
  }, 0);
  const otherMs = Math.max(0, (view.turnElapsedMs || 0) - view.lastModelLaneMs - toolMs);
  const breakdownLanes = [
    { label: 'Model', ms: Math.max(0, view.lastModelLaneMs), tone: 'model' as const },
    { label: 'Tool', ms: toolMs, tone: 'tool' as const },
    { label: 'Other', ms: otherMs, tone: 'other' as const },
  ];
  const breakdownTotal = breakdownLanes.reduce((sum, lane) => sum + lane.ms, 0);

  return (
    <div className="oc-reply-stats" ref={hostRef} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        className="oc-reply-stats-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Generation details"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
      </button>
      {open && createPortal((
        <div
          ref={cardRef}
          className="oc-reply-stats-card"
          role="dialog"
          aria-label="Generation details"
          style={{ position: 'fixed', top: cardPos?.top ?? -9999, left: cardPos?.left ?? -9999, visibility: cardPos ? 'visible' : 'hidden' }}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
        >
          <div className="oc-rs-head">
            <span className="oc-rs-badge" aria-hidden="true">{(view.provider ?? 'local') === 'ollama' ? 'O' : view.provider?.startsWith('api:') ? 'A' : 'L'}</span>
            <div className="oc-rs-head-text">
              <strong>{view.model ?? 'Local model'}</strong>
              <span>{[providerLabel, run?.at ? shortDate(run.at) : ''].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          <div className="oc-rs-primary">
            <div className="oc-rs-metric">
              <span className="oc-rs-metric-label">Input{(view.cachedTokens ?? 0) > 0 ? ' · cached' : ''}</span>
              <strong>{view.inputTokens === null ? '—' : withThousands(view.inputTokens)}<small> Tokens</small></strong>
            </div>
            <div className="oc-rs-metric">
              <span className="oc-rs-metric-label">Output</span>
              <strong>{view.outputTokens === null ? '—' : withThousands(view.outputTokens)}<small> Tokens</small></strong>
            </div>
            <div className="oc-rs-metric">
              <span className="oc-rs-metric-label">Throughput</span>
              <strong>{view.modelTps === null ? '—' : view.modelTps.toFixed(1)}<small> Tokens/s</small></strong>
            </div>
          </div>
          <dl className="oc-rs-secondary">
            <div><dt>Time to first token</dt><dd>{view.timeFirstTokenMs === null ? '—' : (view.timeFirstTokenMs / 1000).toFixed(2) + 's'}</dd></div>
            <div><dt>End-to-end throughput</dt><dd>{view.endToEndTps === null ? '—' : view.endToEndTps.toFixed(1) + ' Tokens/s'}</dd></div>
            <div><dt>End-to-end duration</dt><dd>{durationLabel(view.totalDurationMs)}</dd></div>
          </dl>
          <div className="oc-rs-breakdown">
            <h3>Runtime breakdown</h3>
            {breakdownTotal > 0 ? breakdownLanes.map((lane) => (
              <div key={lane.label} className="oc-rs-lane">
                <span className="oc-rs-lane-label">{lane.label}</span>
                <div className="oc-rs-lane-track">
                  <span className={'oc-rs-lane-fill ' + lane.tone} style={{ width: `${Math.min(100, (lane.ms / breakdownTotal) * 100)}%` }} />
                </div>
                <span className="oc-rs-lane-value">{durationLabel(lane.ms)}</span>
              </div>
            )) : <p className="oc-rs-empty">Breakdown unavailable for this turn.</p>}
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
