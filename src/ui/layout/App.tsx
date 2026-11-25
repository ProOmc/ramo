import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ShellProvider, useShell } from '../lib/hooks';
import '../ui.css';
import { Sidebar } from './Sidebar';
import { Composer } from '../conversation/Composer';
import { Core } from './Core';
import { HomePage } from '../conversation/Home';
import { ResearchPage, SystemPage, SessionTreePage } from '../pages/index';
import { BrowserPage } from '../browser/BrowserPage';
import { SetupGate } from '../setup/SetupScreen';

/** The one horizontal measurement: the column the pane and its contents centre on. */
function contentBox(stageW: number): { left: number; width: number } {
  const docked = stageW > 900 ? 216 : 0;
  const avail = Math.max(0, stageW - docked);
  const width = Math.min(916, avail);
  const left = Math.max(0, docked + Math.floor((avail - width) / 2));
  return { left: Math.round(left), width: Math.round(width) };
}

function ToastHost() {
  const { toast, clearToast } = useShell();
  const toastRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.getElementById('ramo-stage-overlay-v180');
    const node = toastRef.current;
    if (!root) return undefined;
    const measure = () => root.style.setProperty('--oc-toast-space', node ? `${Math.ceil(node.getBoundingClientRect().height + 8)}px` : '0px');
    const observer = node ? new ResizeObserver(measure) : null;
    if (node) observer?.observe(node);
    measure();
    return () => { observer?.disconnect(); root.style.setProperty('--oc-toast-space', '0px'); };
  }, [toast]);
  if (!toast) return null;
  return (
    <div ref={toastRef} key={toast.key} className="oc-toast" role="status" aria-live="polite">
      <span className="oc-toast-mark" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg></span>
      <span className="oc-toast-text">{toast.text}</span>
      {toast.action ? <button type="button" className="oc-toast-action" onClick={() => { toast.action?.run(); clearToast(); }}>{toast.action.label}</button> : null}
      <button type="button" className="oc-toast-dismiss" aria-label="Dismiss notification" onClick={clearToast}>×</button>
    </div>
  );
}

function Shell() {
  const { page, messages } = useShell();
  const [dims, setDims] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const compact = dims.w <= 900;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const box = useMemo(() => contentBox(dims.w), [dims.w]);

  // Publish the geometry pins the pane/composer/core read, exactly once per change.
  useLayoutEffect(() => {
    const root = document.getElementById('ramo-stage-overlay-v180');
    if (!root) return undefined;
    root.style.setProperty('--oc-content-x', box.left + 'px');
    root.style.setProperty('--oc-content-w', box.width + 'px');
    root.style.setProperty('--oc-pane-left', box.left + 'px');
    root.style.setProperty('--stage-w', dims.w + 'px');
    root.style.setProperty('--stage-h', dims.h + 'px');
  }, [box.left, box.width, dims.w, dims.h]);

  // The legacy used a window resize listener; matchMedia also fires for
  // device-metrics overrides (and never misses the user's actual drag).
  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    const mq = window.matchMedia('(max-width: 900px)');
    mq.addEventListener('change', onResize);
    window.addEventListener('resize', onResize);
    const poll = window.setInterval(onResize, 400);
    return () => { mq.removeEventListener('change', onResize); window.removeEventListener('resize', onResize); window.clearInterval(poll); };
  }, []);

  useEffect(() => { if (!compact) setSidebarOpen(false); }, [compact]);
  useEffect(() => { setSidebarOpen(false); }, [page]);
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); document.getElementById('oc-mobile-nav')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const occupied = messages.some((m) => String(m.user || m.assistant || '').trim());
  useLayoutEffect(() => {
    const root = document.getElementById('ramo-stage-overlay-v180');
    root?.classList.toggle('oc-occupied-home', occupied);
    root?.classList.toggle('oc-compact', compact);
    root?.classList.toggle('sidebar-open', sidebarOpen && compact);
    // The drawer transform rules key off the root element (html), matching ramo-studio.css.
    document.documentElement.classList.toggle('sidebar-open', sidebarOpen && compact);
  }, [occupied, compact, sidebarOpen]);

  const pageContent = page === 'home' ? <HomePage />
    : page === 'research' ? <ResearchPage />
    : page === 'browser' ? <BrowserPage />
    : page === 'sessions' ? <SessionTreePage />
    : page === 'system' ? <SystemPage />
    : <HomePage />;

  return (
    <div id="ramo-stage-overlay-v180" className={`${compact ? ' oc-compact' : ''}${sidebarOpen && compact ? ' sidebar-open' : ''}`} data-shell="react">
      {compact && (
        <button id="oc-mobile-nav" type="button" aria-label="Toggle navigation" aria-controls="oc-studio-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((v) => !v)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      )}
      {compact && sidebarOpen && <div id="oc-mobile-backdrop" aria-hidden="true" onClick={() => setSidebarOpen(false)} />}
      <Sidebar hidden={compact && !sidebarOpen} />
      <section id="ramo-workspace-pane-v180" className={page === 'home' ? '' : 'page-mode'} role="main" aria-label="Ramo page">
        <div id="ramo-workspace-content-v180" className="ramo-w-content">
          {pageContent}
        </div>
      </section>
      <Core />
      <Composer />
      <ToastHost />
      <SetupGate />
    </div>
  );
}

export function App() {
  return (
    <ShellProvider>
      <Shell />
    </ShellProvider>
  );
}
