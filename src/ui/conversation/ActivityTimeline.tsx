/**
 * Cherry-style process group for the inline work log.
 *
 * Adapted from Cherry Studio's ThinkingBlock / MessageProcessGroup /
 * AgentToolCallCard pattern, ported onto Ramo's ActivityRun model. Renders
 * RAMO's stored run — never invents progress. Missing pieces stay hidden.
 */
import { useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import type { ActivityCall, ActivityRun, ActivityStep } from '../lib/activity';

const ICON_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_DOT = '<span class="oc-process-live-dot" aria-hidden="true"></span>';
const ICON_STOP = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>';
const ICON_DOC = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></svg>';
const ICON_TOOL = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.3-2.3z"/></svg>';
const ICON_BOOK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 5h7a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3zM20 5h-6a3 3 0 0 0-3 3v13h7a3 3 0 0 1 3 3z"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

function elapsedLabel(run: ActivityRun): string {
  const ms = run.elapsed_ms ?? 0;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${mins}m ${rest}s`;
}

function stepIcon(kind: string): string {
  switch (kind) {
    case 'search': return ICON_SEARCH;
    case 'search_result': return ICON_SEARCH;
    case 'read': return ICON_DOC;
    case 'tool': return ICON_TOOL;
    case 'recall': return ICON_BOOK;
    default: return ICON_TOOL;
  }
}
function stepLabel(step: ActivityStep): string {
  const base = String(step.message ?? '').trim();
  const trimmed = base.length > 90 ? base.slice(0, 89) + '…' : base;
  switch (step.kind) {
    case 'search': return 'Searched — ' + (trimmed || 'the web');
    case 'read': return 'Read — ' + trimmed;
    case 'recall': return 'Recall — ' + trimmed;
    default: return trimmed || step.kind;
  }
}
function tpsLabel(call: ActivityCall): string | null {
  const tps = Number((call.metrics as Record<string, unknown> | undefined)?.output_tps);
  return Number.isFinite(tps) && tps > 0 ? `${tps.toFixed(1)} tok/s` : null;
}

export function ActivityTimeline({ run, busy }: { run: ActivityRun | undefined; busy?: boolean }) {
  if (!run) return null;
  return <Timeline key={String(run.id ?? '') + String(run.index)} run={run} busy={busy} />;
}

function Timeline({ run, busy }: { run: ActivityRun; busy?: boolean }) {
  const live = busy ?? !run.done;
  const failed = run.failed || run.status === 'failed';
  const interrupted = run.interrupted || run.status === 'interrupted';
  const [expanded, setExpanded] = useState<boolean>(!!live);
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({});
  const calls = Array.isArray(run.calls) ? run.calls : [];
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const hasContent = calls.length > 0 || steps.length > 0;
  if (!hasContent && !live) return null;

  const groups = [
    ...calls.map((call, i) => ({ at: call.at ?? run.at, index: i, reason: true as const, call })),
    ...steps.map((step, i) => ({ at: step.at ?? run.at, index: 1000 + i, reason: false as const, step })),
  ].sort((a, b) => a.at - b.at || a.index - b.index);

  const statusLabel = failed ? 'Failed after' : interrupted ? 'Stopped after' : live ? 'Working · live' : 'Processed ·';
  const statusIcon = failed ? ICON_STOP : interrupted ? ICON_STOP : live ? ICON_DOT : ICON_CHECK;
  const searchCount = steps.filter((s) => s.kind === 'search').length;

  return (
    <div className={'oc-process' + (live ? ' live' : failed || interrupted ? ' stopped' : ' done')}>
      <button type="button" className="oc-process-head" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className="oc-process-status" dangerouslySetInnerHTML={{ __html: statusIcon }} />
        <span className="oc-process-title">{statusLabel}{live ? '' : ` ${elapsedLabel(run)}`}</span>
        {searchCount > 0 ? <span className="oc-process-meta">{searchCount} search{searchCount === 1 ? '' : 'es'}</span> : null}
        <span className="oc-process-chevron" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} dangerouslySetInnerHTML={{ __html: ICON_CHEVRON }} />
      </button>
      {expanded ? (
        <div className="oc-process-body">
          {groups.length === 0 ? <p className="oc-process-empty">No steps recorded yet.</p> : null}
          {groups.map((group) => (group.reason ? (
            <ReasoningBlock key={'c' + group.call.id} call={group.call} open={openReasoning[group.call.id] ?? !!live} onToggle={() => setOpenReasoning((cur) => ({ ...cur, [group.call.id]: !(cur[group.call.id] ?? !!live) }))} />
          ) : (
            <StepRow key={'s' + group.index} step={group.step} />
          )))}
        </div>
      ) : null}
    </div>
  );
}

function ReasoningBlock({ call, open, onToggle }: { call: ActivityCall; open: boolean; onToggle: () => void }) {
  const thinking = String(call.thinking ?? '').trim();
  const tps = tpsLabel(call);
  const model = String(call.model ?? (call.metrics as Record<string, unknown> | undefined)?.model ?? '').trim();
  if (!thinking) return (
    <div className="oc-call-line">
      <span className="oc-call-model">{model || 'Model call'}</span>
      <span className="oc-call-meta">{tps ? ` · ${tps}` : ''}{call.status === 'done' ? ' · done' : call.status === 'error' ? ' · failed' : ''}</span>
    </div>
  );
  return (
    <div className="oc-think">
      <button type="button" className="oc-think-head" aria-expanded={open} onClick={onToggle}>
        <span className="oc-think-dot" aria-hidden="true" />
        <span className="oc-think-label">Deep reasoning</span>
        {tps ? <span className="oc-think-rate">{tps}</span> : null}
        <span className="oc-think-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }} dangerouslySetInnerHTML={{ __html: ICON_CHEVRON }} />
      </button>
      {open ? <div className="oc-think-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(thinking) }} /> : null}
    </div>
  );
}

function StepRow({ step }: { step: ActivityStep }) {
  const sources = Array.isArray(step.sources) ? step.sources.filter((s) => s && s.url) : [];
  return (
    <div className="oc-step">
      <span className="oc-step-icon" dangerouslySetInnerHTML={{ __html: stepIcon(step.kind) }} />
      <div className="oc-step-body">
        <div className="oc-step-label">{stepLabel(step)}</div>
        {step.why && step.why !== step.message ? <div className="oc-step-why">{step.why}</div> : null}
        {sources.length > 0 ? (
          <ul className="oc-step-sources">
            {sources.slice(0, 6).map((source, index) => (
              <li key={index}><a href={String(source.url)} target="_blank" rel="noreferrer noopener">{String(source.title || source.url)}</a></li>
            ))}
          </ul>
        ) : null}
        {step.kind === 'read' && typeof step.characters === 'number' && step.characters > 0 ? <div className="oc-step-why">{step.characters.toLocaleString()} characters</div> : null}
      </div>
    </div>
  );
}
