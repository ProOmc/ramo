import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BROWSER_PANE_ID, BROWSER_VIEWPORT_ID, PREVIEW_REFRESH_MS,
  controlLabel, normalizeState, type PaneState,
} from './pane-wire';
import { bridge } from './bridge';
import './browser-pane.css';


/** The in-chat browser card: live status, live preview, one open control. */
function BrowserCard({ state, preview, onOpen }: { state: PaneState; preview: string; onOpen: () => void }) {
  return (
    <aside className="ramo-browser-card" aria-label="Browser card">
      <div className="ramo-browser-card-head">
        <span className="ramo-browser-icon" aria-hidden="true">◉</span>
        <span className="ramo-browser-title">Browser</span>
        <span className={`ramo-browser-dot${state.url ? ' live' : ''}`} aria-hidden="true" />
      </div>
      <p className="ramo-browser-status">{state.url ? state.status : 'Waiting for a page'}</p>
      <div className="ramo-browser-preview">
        {preview ? <img src={preview} alt="Live preview of the agent browser page" /> : <span>No live page yet</span>}
      </div>
      <button type="button" className="ramo-browser-open" onClick={onOpen}>Open browser</button>
    </aside>
  );
}

/** The viewing window: live page on top, then Take control and Stop task. */
function BrowserWindowView({ state, onClose, onTake, onResume, onStop }: {
  state: PaneState;
  onClose: () => void;
  onTake: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);

  const syncBounds = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    void bridge()?.pane.bounds({
      // The pane is a child of the app window, so bounds are parent-relative.
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    if (viewport.current) observer.observe(viewport.current);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('move', syncBounds);
    return () => { observer.disconnect(); window.removeEventListener('resize', syncBounds); window.removeEventListener('move', syncBounds); };
  }, [syncBounds]);

  return (
    <section className="ramo-browser-window" aria-label="Ramo browser viewing window">
      <header className="ramo-browser-window-head">
        <span className="ramo-browser-avatar" aria-hidden="true">R</span>
        <div>
          <strong>Ramo</strong>
          <span className="ramo-browser-window-status">{state.status}</span>
        </div>
        <button type="button" className="ramo-browser-close" onClick={onClose} aria-label="Close browser window">×</button>
      </header>
      <div className="ramo-browser-url" title={state.url}>{state.url || 'No page open'}</div>
      <div id={BROWSER_VIEWPORT_ID} ref={viewport} className="ramo-browser-viewport" aria-label="Live browser page">
        <span className="ramo-browser-viewport-note">Live browser view</span>
      </div>
      <div className="ramo-browser-actions">
        {state.controlMode === 'agent' ? (
          <button type="button" className="ramo-browser-take" onClick={onTake}>Take control of the browser</button>
        ) : (
          <button type="button" className="ramo-browser-take" onClick={onResume}>{controlLabel(state.controlMode)} — resume Ramo</button>
        )}
        <button type="button" className="ramo-browser-stop" onClick={onStop}>Stop the task</button>
      </div>
    </section>
  );
}

export function BrowserPane() {
  const [state, setState] = useState<PaneState>(() => normalizeState(null));
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const api = bridge();
    if (!api) return undefined;
    void api.pane.state().then(value => setState(normalizeState(value))).catch(() => {});
    return api.pane.onState(event => setState(normalizeState(event)));
  }, []);

  useEffect(() => {
    if (!state.url) { setPreview(''); return undefined; }
    let active = true;
    const refresh = () => {
      void bridge()?.tool('screenshot', {}).then(result => {
        if (active && result?.ok && result.data) setPreview(`data:image/png;base64,${result.data}`);
      }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, PREVIEW_REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [state.url]);

  const onOpen = () => {
    const node = document.getElementById(BROWSER_VIEWPORT_ID);
    const rect = node?.getBoundingClientRect();
    const bounds = rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : { x: 80, y: 80, width: 900, height: 600 };
    void bridge()?.pane.open(bounds).then(value => { setState(normalizeState(value)); setOpen(true); }).catch(e => setError(String(e?.message || e)));
  };
  const onClose = () => { void bridge()?.pane.close().then(value => { setState(normalizeState(value)); setOpen(false); }).catch(() => {}); };
  const onTake = () => { void bridge()?.pane.takeControl().then(value => setState(normalizeState(value))).catch(() => {}); };
  const onResume = () => { void bridge()?.pane.resume().then(value => setState(normalizeState(value))).catch(() => {}); };
  const onStop = () => {
    void (window as unknown as { ramoDesktop?: { work?: { request(method: string): Promise<unknown> } } }).ramoDesktop?.work?.request('abort')
      .then(() => { setOpen(false); void bridge()?.pane.close().catch(() => {}); })
      .catch(e => setError(String(e?.message || e)));
  };

  return (
    <div id={BROWSER_PANE_ID} className="ramo-browser-root">
      <BrowserCard state={state} preview={preview} onOpen={onOpen} />
      {open && <BrowserWindowView state={state} onClose={onClose} onTake={onTake} onResume={onResume} onStop={onStop} />}
      {error && <div className="ramo-browser-error" role="alert">{error}</div>}
    </div>
  );
}
