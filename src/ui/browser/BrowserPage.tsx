import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BROWSER_PANE_ID, BROWSER_VIEWPORT_ID, DEFAULT_BROWSER_URL, PREVIEW_REFRESH_MS,
  controlLabel, normalizeBrowserAddress, normalizeState, type PaneState,
} from './pane-wire';
import { bridge, readBounds } from './bridge';
import './browser-page.css';

/**
 * The Browser tab. Same page scaffolding as Research/Settings, with the
 * embedded browser's pixels hosted in the viewport rectangle. The native
 * child window is positioned over that rectangle; all chrome around it is
 * ordinary app DOM, so it reads as part of the shell rather than an overlay.
 */
export function BrowserPage() {
  const [state, setState] = useState<PaneState>(() => normalizeState(null));
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [address, setAddress] = useState(DEFAULT_BROWSER_URL);
  const [navBusy, setNavBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const addressDirty = useRef(false);

  useEffect(() => {
    const api = bridge();
    if (!api) return undefined;
    void api.pane.state().then(value => setState(normalizeState(value))).catch(reason => setError(String((reason as { message?: string })?.message || reason)));
    return api.pane.onState(event => setState(normalizeState(event)));
  }, []);

  const syncBounds = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    void bridge()?.pane.bounds(readBounds(node)).catch(() => {});
  }, []);

  useEffect(() => {
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    if (viewport.current) observer.observe(viewport.current);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('move', syncBounds);
    return () => { observer.disconnect(); window.removeEventListener('resize', syncBounds); window.removeEventListener('move', syncBounds); };
  }, [syncBounds]);

  // First visit: reveal the pane over the viewport. The host loads the default
  // page on first showPane, so this cannot race a later agent navigate.
  // Do NOT wait on requestAnimationFrame here: rAF can be paused when the
  // window is not foregrounded, which left the pane hidden and the placeholder
  // black. getBoundingClientRect() is already valid synchronously.
  useEffect(() => {
    if (started.current) return undefined;
    started.current = true;
    let cancelled = false;
    let timer = 0;
    const attemptOpen = async (tries: number) => {
      if (cancelled || tries > 10) return;
      const api = bridge();
      if (!api || !viewport.current) {
        timer = window.setTimeout(() => { void attemptOpen(tries + 1); }, 200);
        return;
      }
      try {
        syncBounds();
        const shown = await api.pane.open(readBounds(viewport.current));
        if (cancelled) return;
        setState(normalizeState(shown));
        syncBounds();
      } catch (reason) {
        if (cancelled) return;
        setError(String((reason as { message?: string })?.message || reason));
        timer = window.setTimeout(() => { void attemptOpen(tries + 1); }, 400);
      }
    };
    void attemptOpen(0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [syncBounds]);

  // Leaving the tab hides the child window; the page itself stays loaded.
  useEffect(() => () => { void bridge()?.pane.close().catch(() => {}); }, []);

  useEffect(() => {
    if (!addressDirty.current) setAddress(state.url || DEFAULT_BROWSER_URL);
  }, [state.url]);
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

  const runPaneAction = (label: string, operation: () => Promise<unknown>) => {
    if (actionBusy) return;
    setActionBusy(label);
    setError('');
    void Promise.resolve().then(operation)
      .then(value => { setState(normalizeState(value)); syncBounds(); })
      .catch(reason => setError(`${label} failed: ${String((reason as { message?: string })?.message || reason)}`))
      .finally(() => setActionBusy(''));
  };
  const open = () => {
    syncBounds();
    runPaneAction('Open browser', () => bridge()!.pane.open(readBounds(viewport.current)));
  };
  const close = () => runPaneAction('Close browser', () => bridge()!.pane.close());
  const take = () => runPaneAction('Take control', () => bridge()!.pane.takeControl());
  const resume = () => runPaneAction('Resume Ramo', () => bridge()!.pane.resume());
  const stop = () => {
    void (window as unknown as { ramoDesktop?: { work?: { request(method: string): Promise<unknown> } } }).ramoDesktop?.work?.request('abort')
      .then(() => close())
      .catch(reason => setError(String((reason as { message?: string })?.message || reason)));
  };
  const openAddress = (event?: { preventDefault: () => void }, requestedUrl?: string) => {
    event?.preventDefault();
    let url: string;
    try { url = normalizeBrowserAddress(requestedUrl ?? address); } catch (reason) { setError(String((reason as { message?: string })?.message || reason)); return; }
    const api = bridge();
    if (!api) { setError('The embedded browser is unavailable in this build.'); return; }
    setNavBusy(true);
    setError('');
    void api.tool('navigate', { url })
      .then(() => api.pane.state())
      .then(value => { setState(normalizeState(value)); addressDirty.current = false; setAddress(url); syncBounds(); })
      .catch(reason => setError(String((reason as { message?: string })?.message || reason)))
      .finally(() => setNavBusy(false));
  };

  return (
    <div id={BROWSER_PANE_ID} className="ramo-browser-root" data-page-view="browser">
      <div className="oc-page-scroll oc-browser-scroll">
        <div className="oc-page oc-browser-page">
          <header className="oc-browser-page-head">
            <div className="oc-browser-heading">
              <h1 className="oc-page-title">Browser</h1>
              <p className="oc-page-subtitle">A private window for research. Ramo reads and clicks; you can take control at any time.</p>
            </div>
            <div className="ramo-browser-card" aria-label="Browser status">
              <span className="ramo-browser-icon" aria-hidden="true">◉</span>
              <div className="ramo-browser-card-copy">
                <span className="ramo-browser-title">Browser</span>
                <span className="ramo-browser-status">{state.url ? state.status : 'Waiting for a page'}</span>
              </div>
              <span className={`ramo-browser-dot${state.url ? ' live' : ''}`} aria-hidden="true" />
              <div className="ramo-browser-preview">
                {preview ? <img src={preview} alt="Live preview of the agent browser page" /> : <span>No live page yet</span>}
              </div>
              <button type="button" className="ramo-browser-open oc-shell-button" disabled={!!actionBusy} onClick={open}>{actionBusy === 'Open browser' ? 'Opening…' : 'Open browser'}</button>
            </div>
          </header>

          <section className="ramo-browser-window" aria-label="Ramo browser viewing window">
            <header className="ramo-browser-window-head">
              <span className="ramo-browser-avatar" aria-hidden="true">R</span>
              <div className="ramo-browser-window-title">
                <strong>Ramo</strong>
                <span className="ramo-browser-window-status">{state.status}</span>
              </div>
              <button type="button" className="ramo-browser-close" disabled={!!actionBusy} onClick={close} aria-label="Close browser window">×</button>
            </header>
            <form className="ramo-browser-addressbar" onSubmit={openAddress}>
              <input aria-label="Page address" value={address} onChange={event => { addressDirty.current = true; setAddress(event.target.value); }} onFocus={event => event.target.select()} spellCheck={false} placeholder="example.com or https://example.com" />
              <button type="submit" className="oc-shell-button" disabled={navBusy} title="Open this address (Enter)">{navBusy ? 'Opening…' : 'Open'}</button>
              <button type="button" className="oc-shell-button-quiet" disabled={navBusy || !state.url} title="Reload this page" onClick={() => openAddress(undefined, state.url)}>Reload</button>
            </form>
            <div id={BROWSER_VIEWPORT_ID} ref={viewport} className="ramo-browser-viewport" aria-label="Live browser page">
              <span className="ramo-browser-viewport-note">{state.url ? 'Live browser view' : 'Opening the browser…'}</span>
            </div>
            <div className="ramo-browser-actions">
              {state.controlMode === 'agent' ? (
                <button type="button" className="ramo-browser-take oc-shell-button oc-shell-button--primary-action" disabled={!!actionBusy} onClick={take}>{actionBusy === 'Take control' ? 'Taking control…' : 'Take control of the browser'}</button>
              ) : (
                <button type="button" className="ramo-browser-take oc-shell-button" disabled={!!actionBusy} onClick={resume}>{actionBusy === 'Resume Ramo' ? 'Resuming…' : `${controlLabel(state.controlMode)} — resume Ramo`}</button>
              )}
              <button type="button" className="ramo-browser-stop oc-shell-button" disabled={!!actionBusy} onClick={stop}>Stop the task</button>
            </div>
          </section>
          {error && <div className="oc-browser-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}>Dismiss</button></div>}
        </div>
      </div>
    </div>
  );
}
