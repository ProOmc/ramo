import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { assistantApi, activeChat, conversationMessages } from '../lib/chat';
import { useShell } from '../lib/hooks';
import { renderMarkdown } from '../lib/markdown';
import { AsterSvg, ASTER_IDLE_VARS } from '../lib/core';
import { MemoryIsland } from '../memory/MemoryIsland';
import { useContextUsage } from '../lib/context';
import { SetupScreen } from '../setup/SetupScreen';

function Shell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="ramo-chat-scroll oc-page-scroll">
      <div className="ramo-reading oc-page">
        <h1 className="oc-page-title">{title}</h1>
        {subtitle && <p className="oc-page-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

interface KnowledgeRow {
  id?: unknown;
  title?: unknown;
  topic?: unknown;
  content?: unknown;
  summary?: unknown;
  status?: unknown;
  quality_state?: unknown;
  checked_at?: unknown;
  sources?: unknown;
}

function knowledgeDate(at: unknown): string {
  const d = new Date(String(at ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ResearchPage() {
  const { showToast, chatVersion, busy, setPage } = useShell();
  const [topic, setTopic] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const api = assistantApi();

  // Saved research lives in the engine store's knowledge collection (published
  // via research_publish / evidence). Displayed read-only, newest first.
  const knowledge = useMemo(() => {
    const rows = (api as unknown as { engine?: { store?: { data?: { knowledge?: KnowledgeRow[] } } } } | undefined)
      ?.engine?.store?.data?.knowledge;
    const list = Array.isArray(rows) ? [...rows] : [];
    return list
      .filter((row) => row && typeof row === 'object'
        && (String(row?.title ?? row?.topic ?? '').trim() !== ''))
      .sort((a, b) => Number(Date.parse(String(b?.checked_at ?? 0)) || 0) - Number(Date.parse(String(a?.checked_at ?? 0)) || 0))
      .slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatVersion]);

  const start = (event?: FormEvent) => {
    event?.preventDefault?.();
    const text = topic.trim();
    if (!text || busy) return;
    try {
      const request = window.RamoApplication.prompt(api, text, { research: true });
      setTopic('');
      setPage('home');
      showToast('Research started — watch the activity rows in this chat.');
      void Promise.resolve(request).catch((error) => showToast(error instanceof Error ? error.message : String(error)));
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <Shell title="Research">
      <form className="oc-page-row" onSubmit={start}>
        <input ref={inputRef} className="oc-page-input" placeholder="Research a topic…" aria-label="Research topic" value={topic} onChange={(event) => setTopic(event.target.value)} />
        <button type="submit" className="oc-shell-button" disabled={busy || !topic.trim()} title={busy ? 'Finish the active request first' : undefined}>Start research</button>
      </form>
      {knowledge.length === 0 ? (
        <div className="oc-research-empty">
          <div className="oc-research-core" aria-hidden="true">
            <AsterSvg vars={ASTER_IDLE_VARS} />
          </div>
          <h2>No saved research yet</h2>
          <button type="button" className="oc-shell-button" onClick={() => inputRef.current?.focus()}>New research</button>
        </div>
      ) : (
        <section className="oc-research-saved" aria-label="Saved research">
          <div className="oc-research-saved-head">
            <h2>Saved research</h2>
            <span className="oc-research-count">{knowledge.length}</span>
          </div>
          <ul className="oc-research-list">
            {knowledge.map((item, index) => {
              const title = String(item?.title ?? item?.topic ?? 'Untitled research');
              const sources = Array.isArray(item?.sources) ? item.sources : [];
              const body = String(item?.content ?? item?.summary ?? '');
              const when = knowledgeDate(item?.checked_at);
              return (
                <li key={String(item?.id ?? index)}>
                  <details className="oc-research-report">
                    <summary>
                      <span className="oc-research-title" title={title}>{title}</span>
                      <span className="oc-research-meta">
                        {when}{when ? ' · ' : ''}{sources.length} source{sources.length === 1 ? '' : 's'}
                      </span>
                    </summary>
                    <div className="oc-research-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Shell>
  );
}

function SettingsFiles() {
  const { showToast } = useShell();
  const [documents, setDocuments] = useState<Array<{ id: string; name: string; content: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('RAMO_TEXT_WORKSPACE_DOCS') || '[]'); } catch { return []; }
  });
  const [current, setCurrent] = useState({ name: '', content: '' });
  const openRef = useRef<HTMLInputElement>(null);
  const save = () => {
    const name = current.name.trim() || 'untitled.txt';
    const next = [...documents, { id: 'doc-' + Date.now(), name, content: current.content }];
    setDocuments(next);
    try { localStorage.setItem('RAMO_TEXT_WORKSPACE_DOCS', JSON.stringify(next)); } catch { /* old docs stay */ }
    setCurrent({ name: '', content: '' });
    showToast('Saved locally.');
  };
  const download = (doc: { name: string; content: string }) => {
    const blob = new Blob([doc.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const openTextFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCurrent({ name: file.name, content: String(reader.result ?? '') });
    reader.readAsText(file);
  };
  return (
    <div>
      <div className="oc-files-head">
        <input ref={openRef} type="file" accept=".txt,text/plain" hidden className="oc-image-input" aria-label="Open a text file" onChange={(event) => { openTextFile(event.target.files?.[0]); if (openRef.current) openRef.current.value = ''; }} />
        <button type="button" className="oc-shell-button" onClick={() => openRef.current?.click()}>Open a text file</button>
        <div className="oc-files-actions">
          <button type="button" className="oc-shell-button" onClick={save}>Save locally</button>
          <button type="button" className="oc-shell-button" disabled={!current.content} onClick={() => download(current)}>Download .txt</button>
        </div>
      </div>
      <label className="oc-page-field">File name
        <input value={current.name} onChange={(event) => setCurrent({ ...current, name: event.target.value })} placeholder="untitled.txt" aria-label="File name" />
      </label>
      <textarea className="oc-page-editor" aria-label="Document text" value={current.content} onChange={(event) => setCurrent({ ...current, content: event.target.value })} placeholder="Paste or write text here…" rows={14} />
      {documents.length > 0 && (
        <details className="oc-files-saved">
          <summary>Saved documents ({documents.length})</summary>
          <ul className="oc-page-list">
            {documents.map((doc) => (
              <li key={doc.id}>
                <button type="button" className="oc-shell-button-quiet" onClick={() => download(doc)}>{doc.name}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function SystemPage() {
  const { showToast, busy, messages } = useShell();
  const api = assistantApi();
  const theme = String(document.documentElement.dataset.ramoTheme || 'graphite');
  const toggleTheme = () => {
    const next = theme === 'paper' ? 'graphite' : 'paper';
    document.documentElement.dataset.ramoTheme = next;
    try { localStorage.setItem('ramo-theme-v1', next); } catch { /* ignored */ }
  };
  const [ollama, setOllama] = useState('idle');
  const checkOllama = async () => {
    setOllama('checking…');
    try {
      const rows = await window.ramoDesktop.ollamaModels();
      setOllama(Array.isArray(rows) ? `${rows.length} model(s) installed` : 'no answer');
    } catch (error) {
      setOllama('unreachable');
      showToast('Ollama check failed: ' + String(error));
    }
  };
  const modelSet = (key: string) => (event: { target: { value?: string } }) => {
    try {
      (window.RamoState as unknown as { set?: (k: string, v: string) => void } | undefined)?.set?.(key, String(event.target.value));
      showToast('Saved.');
    } catch (error) { showToast(String(error)); }
  };
  const toolAccessValue = String((window.RamoState as unknown as { get?: (k: string) => string } | undefined)?.get?.('Tool Access') ?? 'ask') || 'ask';
  const setToolAccess = (value: string) => {
    try {
      (window.RamoState as unknown as { set?: (k: string, v: string) => void } | undefined)?.set?.('Tool Access', value);
      showToast('Saved.');
    } catch (error) { showToast(String(error)); }
  };
  // Voice is opt-in. Status is probed live; enabling installs/starts the
  // local voice engine on demand. The speaker button works regardless of it.
  const [voice, setVoice] = useState<{ enabled: boolean; installed: boolean; installing: boolean; voice: string } | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const loadVoice = async () => {
    try {
      const status = await window.ramoDesktop.pocket?.status?.() as { enabled: boolean; installed: boolean; installing: boolean; voice: string } | undefined;
      setVoice(status ?? null);
    } catch { setVoice(null); }
  };
  useEffect(() => { void loadVoice(); }, []);
  const setVoiceEnabled = (enabled: boolean) => {
    setVoiceBusy(true);
    void (async () => {
      try {
        if (enabled) showToast('Starting the local voice — first-time setup can take a few minutes.');
        await window.ramoDesktop.pocket?.settings?.({ enabled });
        await loadVoice();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error));
      } finally {
        setVoiceBusy(false);
      }
    })();
  };
  const setVoiceName = (name: string) => {
    void (async () => {
      try {
        await window.ramoDesktop.pocket?.settings?.({ voice: name });
        await loadVoice();
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  // Live hardware telemetry (read-only). Polling continues while page visible.
  const [hw, setHw] = useState<SystemSnapshot | null>(null);
  const [hwBusy, setHwBusy] = useState(true);
  const loadHw = useCallback(async () => {
    try {
      const snap = await (window as unknown as { ramoDesktop?: { computer: { snapshot: () => Promise<SystemSnapshot> } } }).ramoDesktop?.computer?.snapshot?.();
      setHw(snap ?? null);
    } catch {
      setHw(null);
    } finally {
      setHwBusy(false);
    }
  }, []);
  useEffect(() => {
    void loadHw();
    const timer = window.setInterval(() => void loadHw(), 5000);
    return () => window.clearInterval(timer);
  }, [loadHw]);

  const arch = hw?.os?.arch === 'x64' ? 'x86_64' : hw?.os?.arch || '—';
  const bytesToGb = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n / 1073741824 : null);
  const orderedGpus = [...(hw?.gpus ?? [])].sort((a, b) => (a.source === 'NVIDIA driver' ? 0 : 1) - (b.source === 'NVIDIA driver' ? 0 : 1));
  const pct = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : null);
  const gb = (n: number | null) => (n === null ? '—' : n.toFixed(2) + ' GB');
  const osName = !hw?.os ? '—' : hw.os.version || (hw.os.platform === 'win32' ? 'Windows' : hw.os.platform);
  const osVersion = !hw?.os ? '—' : hw.os.release || '—';
  const electronLine = /Electron\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '45.3.3';

  const [section, setSection] = useState(() => {
    try { const saved = localStorage.getItem('ramo-settings-section-v1'); return saved || 'general'; } catch { return 'general'; }
  });
  const harnessContext = (() => {
    try {
      const value = Number((api as unknown as { harness?: { settings?: () => { context?: number } } } | undefined)?.harness?.settings?.()?.context);
      return Number.isFinite(value) ? value : undefined;
    } catch { return undefined; }
  })();
  const contextInfo = useContextUsage(messages, harnessContext);
  const currentModel = String((window as unknown as { RamoState?: { get?: (k: string) => string } }).RamoState?.get?.('Assistant Model') ?? 'assistant').split('/').pop() ?? 'assistant';
  const chatTitle = String(activeChat()?.title ?? 'Main');
  const ramRequest = (method: string, params?: Record<string, unknown>) => (window as unknown as { RamoRuntime?: { request?: (m: string, p?: Record<string, unknown>) => Promise<unknown> } }).RamoRuntime?.request?.(method, params);
  const [undoPoints, setUndoPoints] = useState<{ id: string; label: string; at: number; files: string[] }[]>([]);
  const loadUndo = useCallback(async () => {
    try {
      const list = await ramRequest('undo_status');
      setUndoPoints(Array.isArray(list) ? list as typeof undoPoints : []);
    } catch { setUndoPoints([]); }
  }, []);
  useEffect(() => { if (section === 'session') void loadUndo(); }, [section, loadUndo]);
  const rewind = async (id?: string) => {
    const point = id ? undoPoints.find((entry) => entry.id === id) : undoPoints[0];
    if (!point) { showToast('No undo points in this conversation yet.'); return; }
    if (!window.confirm(`Restore the files from "${point.label}" and rewind the conversation to before that turn? Later messages on this branch are kept only in the session tree.`)) return;
    try {
      const result = await ramRequest('undo', { entryId: point.id });
      const restored = (result as { restored?: string[] } | undefined)?.restored?.length ?? 0;
      showToast(`Restored ${restored} file${restored === 1 ? '' : 's'} and rewound the conversation.`);
      await loadUndo();
    } catch (error) { showToast('Rewind failed: ' + (error instanceof Error ? error.message : String(error))); }
  };
  const compactNow = async () => {
    try {
      showToast('Compacting…');
      await ramRequest('compact');
      showToast('Context compacted. The full saved session remains.');
    } catch (error) { showToast('Compaction failed: ' + (error instanceof Error ? error.message : String(error))); }
  };
  const branchNow = async () => {
    try {
      await ramRequest('fork');
      showToast('Conversation branched.');
    } catch (error) { showToast('Branch failed: ' + (error instanceof Error ? error.message : String(error))); }
  };
  const exportSession = async () => {
    try {
      await ramRequest('exportFile');
    } catch (error) { showToast('Export failed: ' + (error instanceof Error ? error.message : String(error))); }
  };
  const exportMarkdown = () => {
    const rows = conversationMessages();
    const body = rows.map((m) => [
      String(m.user ?? '').trim() ? '**You**\n\n' + String(m.user).trim() : '',
      String(m.assistant ?? '').trim() ? '**Ramo**\n\n' + String(m.assistant).trim() : '',
    ].filter((part) => part.trim()).join('\n\n')).filter((part) => part.trim()).join('\n\n---\n\n');
    if (!body.trim()) { showToast('Nothing to export yet.'); return; }
    const blob = new Blob([body], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ramo-conversation.md';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Saved ramo-conversation.md.');
  };
  const SECTIONS = [
    { id: 'setup', label: 'Setup' },
    { id: 'general', label: 'General' },
    { id: 'memory', label: 'Memory' },
    { id: 'models', label: 'Models' },
    { id: 'voice', label: 'Voice' },
    { id: 'tools', label: 'Tools' },
    { id: 'session', label: 'Session' },
    { id: 'files', label: 'Files' },
    { id: 'hardware', label: 'Hardware' },
    { id: 'about', label: 'About' },
  ] as const;
  const SECTION_ICONS: Record<string, string> = {
    general: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2.2" fill="var(--oc-paper,#282b2d)"/><circle cx="15" cy="12" r="2.2" fill="var(--oc-paper,#282b2d)"/><circle cx="7" cy="17" r="2.2" fill="var(--oc-paper,#282b2d)"/></svg>',
    memory: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M3 9h3M3 15h3M18 9h3M18 15h3M9 18v3M15 18v3"/></svg>',
    session: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h7v7H4z"/><path d="M13 6h7v7h-7z" stroke-dasharray="2.4 2.4"/><path d="M4 15h7v4H4z"/><path d="M13 15h7v4h-7z" stroke-dasharray="2.4 2.4"/></svg>',
    models: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="4" y="4" width="16" height="6.5" rx="2"/><rect x="4" y="13.5" width="16" height="6.5" rx="2"/></svg>',
    voice: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.8 11.4v.6a6.2 6.2 0 0 0 12.4 0v-.6M12 18.4V21M9 21h6"/></svg>',
    tools: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.3-2.3z"/></svg>',
    files: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></svg>',
    hardware: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M2 9h4M2 15h4M18 9h4M18 15h4M9 22v-4M15 22v-4"/></svg>',
    about: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8h.01"/></svg>',
  };
  const pickSection = (id: string) => {
    setSection(id);
    try { localStorage.setItem('ramo-settings-section-v1', id); } catch { /* memory-only */ }
  };
  return (
    <Shell title="Settings">
      <div className="oc-settings-layout">
        <nav className="oc-settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" className="oc-settings-tab" aria-current={section === item.id ? 'page' : undefined} onClick={() => pickSection(item.id)}>
              <span className="oc-settings-tab-icon" dangerouslySetInnerHTML={{ __html: SECTION_ICONS[item.id] }} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <section className="oc-settings-panel" aria-label="Settings panel">
          {section === 'setup' ? <SetupScreen embedded /> : null}
          {section === 'general' ? (
            <div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Theme</span>
                <span className="oc-settings-row-control">
                  <span className="oc-settings-row-value">{theme === 'paper' ? 'Paper' : 'Graphite'}</span>
                  <button type="button" role="switch" aria-checked={theme === 'paper'} aria-label="Toggle theme" className="oc-toggle" onClick={toggleTheme}>
                    <span className="oc-toggle-knob" aria-hidden="true" />
                  </button>
                </span>
              </div>
            </div>
          ) : null}
          {section === 'memory' ? (
            <div className="oc-memory-mount"><MemoryIsland /></div>
          ) : null}
          {section === 'models' ? (
            <div>
              <label className="oc-page-field">Assistant model
                <select className="oc-chat-model-select" defaultValue={String(window.RamoState?.get?.('Assistant Model') ?? '')} onChange={modelSet('Assistant Model')} aria-label="Assistant model">
                  {(((globalThis as unknown as { __ramoModelRegistry?: Array<{ tier?: string; model?: string; label?: string }> }).__ramoModelRegistry || [])).filter((profile) => profile.tier).map((profile) => <option key={profile.tier} value={profile.model}>{profile.label} · {profile.model}</option>)}
                </select>
              </label>
              <label className="oc-page-field">Research report model
                <select defaultValue={String(window.RamoState?.get?.('Research Report Model') ?? '')} onChange={modelSet('Research Report Model')} aria-label="Research report model">
                  {(((globalThis as unknown as { __ramoModelRegistry?: Array<{ tier?: string; model?: string; label?: string }> }).__ramoModelRegistry || [])).filter((profile) => profile.tier).map((profile) => <option key={profile.tier} value={profile.model}>{profile.label} · {profile.model}</option>)}
                </select>
              </label>
              <div className="oc-page-row">
                <button type="button" className="oc-shell-button" onClick={() => void checkOllama()}>Check Ollama</button>
                <span className="oc-page-note-inline" role="status">{ollama}</span>
                <button type="button" className="oc-shell-button-quiet" onClick={() => window.ramoDesktop.openModelManager()}>Manage model servers</button>
              </div>
            </div>
          ) : null}
          {section === 'voice' ? (
            <div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Voice</span>
                <span className="oc-settings-row-control">
                  <span className="oc-settings-row-value">{!voice ? '—' : voiceBusy ? 'Working…' : voice.enabled ? (voice.installing ? 'Installing…' : 'On') : 'Off'}</span>
                  <button type="button" role="switch" aria-checked={!!voice?.enabled} aria-label="Toggle voice" className="oc-toggle" disabled={voiceBusy} onClick={() => setVoiceEnabled(!voice?.enabled)}>
                    <span className="oc-toggle-knob" aria-hidden="true" />
                  </button>
                </span>
              </div>
              {voice?.enabled ? (
                <label className="oc-page-field">Speaker voice
                  <select value={voice.voice} aria-label="Speaker voice" onChange={(event) => setVoiceName(event.target.value)}>
                    <option value="michael">Michael</option>
                    <option value="george">George</option>
                    <option value="alba">Alba</option>
                    <option value="lola">Lola</option>
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          {section === 'tools' ? (
            <div>
              <label className="oc-page-field">Tool access
                <select aria-label="Tool access" value={toolAccessValue} onChange={(event) => setToolAccess(event.target.value)}>
                  <option value="ask">Ask before changes</option>
                  <option value="read">Read only</option>
                  <option value="full">Full access</option>
                </select>
              </label>
            </div>
          ) : null}
          {section === 'session' ? (
            <div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Model</span>
                <span className="oc-settings-row-control"><span className="oc-settings-row-value">{currentModel}</span></span>
              </div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Conversation</span>
                <span className="oc-settings-row-control"><span className="oc-settings-row-value">{chatTitle}</span></span>
              </div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Activity</span>
                <span className="oc-settings-row-control"><span className="oc-settings-row-value">{busy ? 'Working' : 'Idle'}</span></span>
              </div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Context</span>
                <span className="oc-settings-row-control"><span className="oc-settings-row-value">{contextInfo.percent}% · {contextInfo.used.toLocaleString()} / {contextInfo.ctxWindow.toLocaleString()} tokens</span></span>
              </div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Branch</span>
                <span className="oc-settings-row-control">
                  <button type="button" className="oc-shell-button" onClick={() => void branchNow()}>Branch this conversation</button>
                </span>
              </div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Rewind</span>
                <span className="oc-settings-row-control">
                  <button type="button" className="oc-shell-button" disabled={busy || undoPoints.length === 0} title={busy ? 'Stop the active task before rewinding' : undefined} onClick={() => void rewind()}>Undo last file changes</button>
                  {undoPoints.slice(0, 5).map((point) => (
                    <button key={point.id} type="button" className="oc-shell-button-quiet" title={`${point.files.join(', ')} — ${new Date(point.at).toLocaleString()}`} onClick={() => void rewind(point.id)}>
                      {point.label.length > 40 ? point.label.slice(0, 40) + '…' : point.label}
                    </button>
                  ))}
                </span>
              </div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Compact</span>
                <span className="oc-settings-row-control">
                  <button type="button" className="oc-shell-button" disabled={busy} title={busy ? 'Stop the active task before compacting' : undefined} onClick={() => void compactNow()}>Compact context now</button>
                </span>
              </div>
              <div className="oc-settings-row">
                <span className="oc-settings-row-label">Export</span>
                <span className="oc-settings-row-control">
                  <button type="button" className="oc-shell-button-quiet" onClick={() => void exportSession()}>Session (.json)</button>
                  <button type="button" className="oc-shell-button-quiet" onClick={exportMarkdown}>Markdown (.md)</button>
                </span>
              </div>
            </div>
          ) : null}
          {section === 'files' ? (
            <SettingsFiles />
          ) : null}
          {section === 'hardware' ? (
            <div>
              <section className="oc-hw-section" aria-label="Operating System">
                <h3 className="oc-hw-heading">Operating System</h3>
                <div className="oc-hw-card">
                  <div className="oc-hw-row"><span className="oc-hw-key">Name</span><span className="oc-hw-val">{osName}</span></div>
                  <div className="oc-hw-row"><span className="oc-hw-key">Version</span><span className="oc-hw-val">{osVersion}</span></div>
                </div>
              </section>
              <section className="oc-hw-section" aria-label="CPU">
                <h3 className="oc-hw-heading">CPU</h3>
                <div className="oc-hw-card">
                  <div className="oc-hw-row"><span className="oc-hw-key">Model</span><span className="oc-hw-val">{hw?.cpu?.name ?? '—'}</span></div>
                  <div className="oc-hw-row"><span className="oc-hw-key">Architecture</span><span className="oc-hw-val">{arch}</span></div>
                  <div className="oc-hw-row"><span className="oc-hw-key">Cores</span><span className="oc-hw-val">{hw?.cpu?.logicalCores ?? '—'}</span></div>
                  <div className="oc-hw-row"><span className="oc-hw-key">Usage</span>
                    <span className="oc-hw-usage">
                      <span className="oc-hw-bar"><span className="oc-hw-bar-fill" style={{ width: String(pct(hw?.cpu?.percent) ?? 0) + '%' }} /></span>
                      <span className="oc-hw-usage-pct">{hwBusy && !hw ? '…' : pct(hw?.cpu?.percent) === null ? '—' : pct(hw?.cpu?.percent) + '%'}</span>
                    </span>
                  </div>
                </div>
              </section>
              <section className="oc-hw-section" aria-label="Memory">
                <h3 className="oc-hw-heading">Memory</h3>
                <div className="oc-hw-card">
                  <div className="oc-hw-row"><span className="oc-hw-key">Total RAM</span><span className="oc-hw-val">{gb(bytesToGb(hw?.ram?.totalBytes))}</span></div>
                  <div className="oc-hw-row"><span className="oc-hw-key">Available RAM</span><span className="oc-hw-val">{gb(bytesToGb(hw?.ram?.availableBytes))}</span></div>
                  <div className="oc-hw-row"><span className="oc-hw-key">Usage</span>
                    <span className="oc-hw-usage">
                      <span className="oc-hw-bar"><span className="oc-hw-bar-fill" style={{ width: String(pct(hw?.ram?.percent) ?? 0) + '%' }} /></span>
                      <span className="oc-hw-usage-pct">{pct(hw?.ram?.percent) === null ? '—' : pct(hw?.ram?.percent) + '%'}</span>
                    </span>
                  </div>
                </div>
              </section>
              <section className="oc-hw-section" aria-label="GPUs">
                <h3 className="oc-hw-heading oc-hw-heading-row"><span>GPUs</span><button type="button" className="oc-hw-refresh" onClick={() => void loadHw()} disabled={hwBusy} aria-label="Refresh hardware readings">↻ Refresh</button></h3>
                {orderedGpus.length === 0 && hwBusy ? <p className="oc-page-note">Reading hardware…</p> : null}
                {orderedGpus.map((gpu) => {
                  const usedTotal = typeof gpu.vramTotalMiB === 'number' && gpu.vramTotalMiB > 0;
                  const freeGiB = usedTotal && typeof gpu.vramUsedMiB === 'number' ? (gpu.vramTotalMiB! - gpu.vramUsedMiB!) / 1024 : null;
                  const totalGiB = usedTotal ? gpu.vramTotalMiB! / 1024 : null;
                  const vramPct = typeof gpu.vramPercent === 'number' ? Math.min(100, Math.max(0, gpu.vramPercent)) : 0;
                  return (
                    <article key={gpu.id} className="oc-hw-gpu-card" aria-label={'GPU ' + gpu.name}>
                      <header className="oc-hw-gpu-head">
                        <span className="oc-hw-gpu-name">{gpu.name}</span>
                        {gpu.source === 'NVIDIA driver' ? <span className="oc-hw-badge cuda">CUDA</span> : null}
                      </header>
                      <div className="oc-hw-vram-label"><span>VRAM</span><span>{totalGiB === null ? 'Unavailable' : freeGiB!.toFixed(2) + ' GB free of ' + totalGiB!.toFixed(2) + ' GB'}</span></div>
                      <div className={'oc-hw-bar vram' + (usedTotal ? '' : ' empty')} aria-hidden="true"><span className="oc-hw-bar-fill" style={{ width: String(vramPct) + '%' }} /></div>
                      <dl className="oc-hw-gpu-meta">
                        {gpu.driverVersion ? <div><dt>Driver Version</dt><dd>{gpu.driverVersion}</dd></div> : null}
                        {gpu.computeCapability ? <div><dt>Compute Capability</dt><dd>{gpu.computeCapability}</dd></div> : null}
                        {typeof gpu.percent === 'number' ? <div><dt>Usage</dt><dd>{gpu.percent.toFixed(0)}%</dd></div> : null}
                        {typeof gpu.temperatureC === 'number' ? <div><dt>Temperature</dt><dd>{gpu.temperatureC}°C</dd></div> : null}
                      </dl>
                      {gpu.available === false ? <p className="oc-page-note-inline">No engine readings available</p> : null}
                    </article>
                  );
                })}
              </section>
            </div>
          ) : null}
          {section === 'about' ? (
            <div>
              <div className="oc-about-identity">
                <div className="oc-about-core" aria-hidden="true">
                  <AsterSvg vars={ASTER_IDLE_VARS} />
                </div>
                <span className="oc-about-name">Ramo</span>
              </div>
              <div className="oc-hw-card">
                <div className="oc-hw-row"><span className="oc-hw-key">Ramo Unified</span><span className="oc-hw-val">v3.0.0-dev</span></div>
                <div className="oc-hw-row"><span className="oc-hw-key">Electron</span><span className="oc-hw-val">{electronLine}</span></div>
                <div className="oc-hw-row"><span className="oc-hw-key">React</span><span className="oc-hw-val">19</span></div>
                <div className="oc-hw-row"><span className="oc-hw-key">Engine</span><span className="oc-hw-val">Ramo-owned kernel</span></div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}

interface SystemGpuReading {
  id: string;
  index: number;
  name: string;
  percent: number | null;
  vramUsedMiB: number | null;
  vramTotalMiB: number | null;
  vramPercent: number | null;
  temperatureC: number | null;
  source?: string;
  driverVersion?: string | null;
  computeCapability?: string | null;
  available?: boolean;
}
interface SystemSnapshot {
  timestamp: number;
  cpu: { name: string; logicalCores: number | null; percent: number | null };
  ram: { totalBytes: number; usedBytes: number; availableBytes: number; percent: number | null };
  gpus: SystemGpuReading[];
  os?: { platform: string; arch: string; release: string; version: string; node: string };
}
