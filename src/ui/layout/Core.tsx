import { useEffect, useState, type CSSProperties, useRef } from 'react';
import { useShell } from '../lib/hooks';
import { AsterSvg, computeCoreState, useCoreMotion } from '../lib/core';

function dimsBox(dims: { w: number; h: number }) {
  const docked = dims.w > 900 ? 216 : 0;
  const avail = Math.max(280, dims.w - docked);
  const width = Math.min(916, avail);
  const left = Math.max(0, docked + Math.floor((avail - width) / 2));
  return { left, width, center: left + width / 2 };
}

/** Read the legacy variables the core historically cared about. */
function readCoreState(): ReturnType<typeof computeCoreState> {
  const getVar = (name: string, fallback: unknown = 0) => {
    try { return window.RamoState?.get?.(name) ?? fallback; } catch { return fallback; }
  };
  return computeCoreState(getVar as never, getVar as never, 'home');
}

export function Core() {
  const { page, messages, busy } = useShell();
  const [dims, setDims] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    const mq = window.matchMedia('(max-width: 900px)');
    mq.addEventListener('change', onResize);
    window.addEventListener('resize', onResize);
    return () => { mq.removeEventListener('change', onResize); window.removeEventListener('resize', onResize); };
  }, []);

  // Poll the state machine -- the core reflects work happening anywhere in the app.
  const [state, setState] = useState(() => readCoreState());
  useEffect(() => {
    const timer = window.setInterval(() => setState(readCoreState()), 400);
    return () => window.clearInterval(timer);
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  useCoreMotion(ref, state);

  const occupied = messages.some((m) => String(m.user || m.assistant || '').trim());
  const pageHidden = page !== 'home';

  const { center } = dimsBox(dims);
  // Larger and a little higher than the original placement, while keeping
  // clear of the welcome line above and the composer below.
  const d = Math.min(380, Math.max(200, dims.h * 0.36));
  const cy = Math.min(dims.h * 0.50, dims.h - 184);
  // Keep the layer mounted off-home so the ASTER physics loop is continuous.
  // Unmounting here restarted seconds/outerAngle/velocities at zero and visibly
  // snapped the core; hiding instead makes page round trips pixel-stable.
  // The core is an empty-home welcome element only. Once the conversation has
  // a message it must be hidden on the home page too — returning an empty style
  // left it sitting in the middle of the chat with no explicit coordinates.
  const style: CSSProperties = occupied || pageHidden
    ? { visibility: 'hidden', pointerEvents: 'none' }
    : { position: 'absolute', left: Math.round(center - d / 2), top: Math.round(cy - d / 2), width: Math.round(d), height: Math.round(d) };

  // The caption reads Ready / Thinking / Searching / Responding / Recalling / Listening / Attention needed.
  const captions: Record<string, string> = {
    idle: 'Ready', search: 'Searching', memory: 'Recalling',
    think: 'Thinking', generate: 'Responding', speak: 'Listening', error: 'Attention needed',
  };
  const caption = captions[state.phase] || 'Working';
  const wire = String(window.RamoState?.get?.('Assistant Model') ?? '');
  const effort = ['idle', 'light', 'medium', 'high', 'extreme'][state.effort] || 'medium';
  const note = `${wire ? wire.split('/').pop() : 'assistant'} · ${effort}`;

  return (
    <div id="ramo-core-layer" role="img" aria-label="Ramo activity core" aria-hidden={pageHidden || occupied || undefined} style={style} ref={ref}>
      <AsterSvg />
      <div className="oc-core-caption" aria-hidden="true">{caption}</div>
      <div className="oc-core-note" aria-hidden="true">{note}</div>
    </div>
  );
}
