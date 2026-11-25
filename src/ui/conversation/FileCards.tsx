/**
 * File artifact cards (Cherry report-artifacts card pattern).
 *
 * Cherry renders an artifact card per file the agent completes, appended to
 * the message; Ramo does the equivalent honestly by diffing the kernel's
 * changes ledger. Only files written in the CURRENT turn render: the
 * baseline resets each time a new turn starts, so history from before the
 * build (or before this turn) is never shown.
 *
 * A card body click opens the file; the corner button opens a menu with
 * Open with default app / Reveal in folder / Copy path. Executable types
 * are refused by the main process; the card surfaces the reason as a toast.
 */
import { useEffect, useRef, useState } from 'react';
import { useShell } from '../lib/hooks';

interface RamoChange { path: string; before?: string | null }

const ICON_OPEN = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M9 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_REVEAL = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

export function extMeta(file: string): { ext: string; tone: string } {
  const base = String(file).split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1, dot + 5).toLowerCase() : 'file';
  let tone = 'doc';
  if (/^(html?|xhtml)$/.test(ext)) tone = 'web';
  else if (/^(js|jsx|ts|tsx|mjs|cjs|py|rs|go|java|c|h|cc|cpp|hpp|rb|php|sh|ps1|sql|css|scss|less)$/.test(ext)) tone = 'code';
  else if (/^(json|ya?ml|toml|xml|ini|env|conf|md|markdown|txt|log|gitignore)$/.test(ext)) tone = 'meta';
  else if (/^(png|jpe?g|gif|webp|bmp|svg|ico)$/.test(ext)) tone = 'img';
  return { ext, tone };
}

function typeLabel(name: string): string {
  const { ext } = extMeta(name);
  switch (ext) {
    case 'md': case 'markdown': return 'Markdown';
    case 'pdf': return 'PDF';
    case 'doc': case 'docx': return 'Word document';
    case 'xls': case 'xlsx': case 'csv': case 'tsv': return 'Spreadsheet';
    case 'ppt': case 'pptx': return 'Presentation';
    case 'html': case 'htm': return 'Web page';
    case 'js': case 'jsx': case 'ts': case 'tsx': case 'mjs': case 'cjs': return 'JavaScript / TypeScript';
    case 'py': return 'Python';
    case 'rs': return 'Rust';
    case 'sql': return 'SQL';
    case 'css': case 'scss': case 'less': return 'Stylesheet';
    case 'json': return 'JSON';
    case 'yaml': case 'yml': return 'YAML';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'bmp': case 'svg': return 'Image';
    case 'txt': return 'Text';
    default: return ext === 'file' ? 'File' : ext.toUpperCase();
  }
}

function FileCard({ row }: { row: RamoChange }) {
  const { showToast } = useShell();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = String(row.path).split(/[\\/]/).pop() ?? row.path;
  const { ext, tone } = extMeta(name);
  const dir = String(row.path).split(/[\\/]/).slice(0, -1).join('\\');

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node | null)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menuOpen]);

  const openDefault = () => {
    setMenuOpen(false);
    void window.ramoDesktop.files?.openPath?.(row.path).catch((error: unknown) => showToast(error instanceof Error ? error.message : String(error)));
  };
  const reveal = () => {
    setMenuOpen(false);
    void window.ramoDesktop.files?.revealPath?.(row.path).catch((error: unknown) => showToast(error instanceof Error ? error.message : String(error)));
  };
  const copyPath = () => {
    setMenuOpen(false);
    void navigator.clipboard?.writeText(row.path).then(() => showToast('Path copied.')).catch((error) => showToast(String(error)));
  };

  return (
    <div className="oc-file-card" role="group" aria-label={'File created: ' + name}>
      <button type="button" className="oc-file-card-body" title={row.path} aria-label={'Open ' + name} onClick={openDefault}>
        <span className={'oc-file-badge ' + tone} aria-hidden="true">{ext}</span>
        <span className="oc-file-meta">
          <span className="oc-file-name">{name}</span>
          <span className="oc-file-path" title={row.path}>{dir}</span>
          <span className="oc-file-type">{typeLabel(name)}</span>
        </span>
      </button>
      <div className="oc-file-open" ref={menuRef}>
        <button type="button" className="oc-file-open-btn" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={'Open with… ' + name} onClick={() => setMenuOpen((value) => !value)}>
          Open with <span dangerouslySetInnerHTML={{ __html: ICON_CHEVRON }} />
        </button>
        {menuOpen ? (
          <div className="oc-file-menu" role="menu" aria-label="Open actions">
            <button type="button" role="menuitem" onClick={openDefault}><span dangerouslySetInnerHTML={{ __html: ICON_OPEN }} />Open with default app</button>
            <button type="button" role="menuitem" onClick={reveal}><span dangerouslySetInnerHTML={{ __html: ICON_REVEAL }} />Reveal in folder</button>
            <button type="button" role="menuitem" onClick={copyPath}><span dangerouslySetInnerHTML={{ __html: ICON_COPY }} />Copy path</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function FileCards() {
  const { chatVersion, busy } = useShell();
  // The baseline resets when a new turn starts: cards show only files written
  // during the current turn. Anything written before the turn (history) is
  // never rendered.
  const baseline = useRef<Set<string> | null>(null);
  const [files, setFiles] = useState<RamoChange[]>([]);
  const turnActive = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const rows = await (window as unknown as { RamoRuntime?: { request: (method: string, params?: Record<string, unknown>) => Promise<unknown> } }).RamoRuntime?.request?.('changes') as RamoChange[] | undefined;
        const clean = (rows ?? []).map((row) => ({ path: String(row?.path || '') })).filter((row) => row.path);
        if (cancelled) return;
        const startingTurn = busy && !turnActive.current;
        turnActive.current = busy;
        if (startingTurn || !baseline.current) {
          // A new turn begins (or this is the first read): anything already
          // in the ledger is pre-turn and must never appear as a card.
          baseline.current = new Set(clean.map((row) => row.path));
          setFiles([]);
          return;
        }
        setFiles(clean);
      } catch {
        /* ledger unavailable */
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [chatVersion, busy]);

  if (!baseline.current) return null;
  const rows = files.filter((row) => !baseline.current!.has(row.path));
  if (rows.length === 0) return null;
  return (
    <div className="oc-file-cards" aria-label="Files created in this turn">
      {rows.map((row) => <FileCard key={row.path} row={row} />)}
    </div>
  );
}
