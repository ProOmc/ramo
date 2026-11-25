import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useShell } from '../lib/hooks';
import { assistantApi } from '../lib/chat';
import { useContextUsage } from '../lib/context';
import {
  MAX_FILES, prepare, source, type RamoImage,
} from '../lib/image-core';
import { availableModelChoices, refreshApiRegistry, type ModelChoice } from '../lib/models';
import { useDialogFocus } from '../lib/useDialogFocus';

const ICON_SHIELD = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3 4.5 6v6c0 4.6 3 7.8 7.5 9 4.5-1.2 7.5-4.4 7.5-9V6z"/><path d="m9.5 12 2 2 3.5-3.5"/></svg>';
const ICON_PAPERCLIP = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l7.8-7.79a4 4 0 0 1 5.65 5.66l-7.78 7.8a2 2 0 0 1-2.83-2.84l7.07-7.07"/></svg>';
const ICON_MIC = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.8 11.4v.6a6.2 6.2 0 0 0 12.4 0v-.6M12 18.4V21M9 21h6"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12L20 4l-5 16-3.1-7.9L4 12z"/><path d="m12 12 8-8"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.6" fill="#1f2123"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.3-4.3M17 10.6a6.4 6.4 0 1 1-12.8 0 6.4 6.4 0 0 1 12.8 0z"/></svg>';
const ICON_GEAR = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v3.2M12 18v3.2M2.8 12H6M18 12h3.2M5 5l2.3 2.3M16.7 16.7 19 19M5 19l2.3-2.3M16.7 7.3 19 5"/></svg>';

import { ApiModelDialog } from '../dialogs/ApiModelDialog';

const permissionLabel = (value: string) => (value === 'full' ? 'Full access' : value === 'read' ? 'Read only' : 'Ask before changes');

export function Composer() {
  const {
    busy, showToast, chatVersion, bumpChat, submitPendingUser,
    messages, setPage,
  } = useShell();
  const [value, setValue] = useState('');
  const [sttActive, setSttActive] = useState(false);
  const [sttNote, setSttNote] = useState<string | null>(null);
  const [sttPhase, setSttPhase] = useState<'setup' | 'listening' | 'processing' | 'error'>('setup');
  const [images, setImages] = useState<RamoImage[]>([]);
  const [processing, setProcessing] = useState(false);
  const [imageError, setImageError] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [registryVersion, setRegistryVersion] = useState(0);
  type PaletteItem = { name: string; description: string; argumentHint?: string; kind: 'prompt' | 'skill' };
  const [palette, setPalette] = useState<PaletteItem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const composerRef = useRef<HTMLDivElement>(null);
  const modelChipRef = useRef<HTMLButtonElement>(null);
  const commandChipRef = useRef<HTMLButtonElement>(null);
  const modelMenuRef = useDialogFocus<HTMLDivElement>(() => setModelMenuOpen(false), false, modelMenuOpen, modelChipRef);
  const paletteMenuRef = useDialogFocus<HTMLDivElement>(() => setPaletteOpen(false), false, paletteOpen, commandChipRef);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sttBase = useRef('');
  const sttUnsubscribe = useRef<(() => void) | null>(null);
  useEffect(() => () => { sttUnsubscribe.current?.(); sttUnsubscribe.current = null; }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const request = (window as unknown as { RamoRuntime?: { request?: (m: string) => Promise<unknown> } }).RamoRuntime?.request;
    if (!request) return;
    void request('palette').then((raw) => {
      const data = raw as { prompts?: { name: string; description: string; argumentHint?: string }[]; skills?: { name: string; description: string }[] };
      const items: PaletteItem[] = [
        ...(data?.prompts ?? []).map((item) => ({ ...item, kind: 'prompt' as const })),
        ...(data?.skills ?? []).map((item) => ({ name: item.name, description: item.description, kind: 'skill' as const })),
      ];
      setPalette(items);
    }).catch(() => setPalette([]));
  }, []);
  const api = assistantApi() as unknown as {
    session?: unknown;
    pendingDocument?: { kind?: string; images?: RamoImage[]; name?: string; content?: string; originalCharacters?: number; truncated?: boolean; attachedAt?: string } | null;
    askAI?: (args: Record<string, unknown>) => Promise<unknown>;
    cancel?: () => unknown;
    liveThinking?: boolean;
    setLiveThinking?: (value: boolean) => Promise<unknown>;
    modelName?: () => string;
  };

  // Populate the shared model registry (local runtime + saved API keys), then
  // clamp a stored choice that no longer resolves (legacy _syncModelPickers did this too).
  useEffect(() => {
    void refreshApiRegistry(true).then(() => {
      setRegistryVersion((v) => v + 1);
      try {
        const saved = window.RamoState?.get?.('Assistant Model');
        if (saved) {
          const known = availableModelChoices().some((choice) => choice.name === saved)
            || ((globalThis as unknown as { __ramoModelRegistry?: Array<{ model?: string; id?: string }> }).__ramoModelRegistry ?? [])
              .some((p) => p?.model === saved || p?.id === saved);
          if (!known) (window.RamoState as unknown as { set?: (k: string, v: string) => void } | undefined)?.set?.('Assistant Model', availableModelChoices()[0]?.name || '');
        }
      } catch { /* non-fatal: the picker still works with its defaults */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load what the engine holds for this conversation.
  useEffect(() => {
    const current = api?.pendingDocument?.kind === 'images' ? api.pendingDocument.images ?? [] : [];
    setImages(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatVersion]);

  const updateImages = (next: RamoImage[]) => {
    setImages(next);
    if (api) {
      api.pendingDocument = next.length
        ? { kind: 'images', name: next.length === 1 ? next[0].name : next.length + ' images', images: next, content: '' }
        : null;
    }
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    if (processing) { setImageError('Wait for image preparation to finish.'); return; }
    if (busy) { setImageError('Stop the active response before adding images.'); return; }
    if (api?.pendingDocument && api.pendingDocument.kind !== 'images') { setImageError('Remove the attached text document before adding images.'); return; }
    if (images.length + files.length > MAX_FILES) { setImageError('Attach up to 4 images. Remove an image or choose fewer files.'); return; }
    setProcessing(true);
    setImageError('Preparing images…');
    const prepared: RamoImage[] = [];
    try {
      for (const file of files) prepared.push(await prepare(file));
      const combined = [...images, ...prepared];
      if (combined.reduce((total, image) => total + image.data.length * 3 / 4, 0) > 8 * 1024 * 1024) {
        throw new Error('These prepared images exceed 8 MiB together. Attach fewer images or export smaller copies.');
      }
      updateImages(combined);
      setImageError('');
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    } finally {
      setProcessing(false);
      if (filePickerRef.current) filePickerRef.current.value = '';
    }
  };

  const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i.test(file.name);
  const isTextFile = (file: File) => file.type.startsWith('text/')
    || ['application/json', 'application/xml', 'application/x-yaml', 'application/yaml', 'application/javascript', 'application/ecmascript', 'application/sql', 'image/svg+xml'].includes(file.type)
    || /\.(txt|md|markdown|json|jsonl|csv|tsv|log|xml|ya?ml|toml|ini|conf|cfg|html?|xhtml|css|less|scss|js|jsx|mjs|cjs|ts|tsx|py|rs|go|java|c|h|cc|cpp|hpp|hh|rb|php|sh|bash|zsh|ps1|psm1|sql|svg|gradle|properties|env)$/i.test(file.name);

  const addAnyFiles = async (files: File[]) => {
    if (!files.length) return;
    if (busy) { setImageError('Stop the active response before adding files.'); return; }
    const images = files.filter(isImageFile);
    const texts = files.filter(isTextFile);
    const rejected = files.length - images.length - texts.length;
    if (images.length) await addFiles(images);
    if (texts.length) {
      if (api?.pendingDocument?.kind === 'images') { setImageError('Remove the attached images before attaching a text file.'); return; }
      const file = texts[0];
      try {
        if (file.size > 2 * 1024 * 1024) { setImageError(`“${file.name}” is too large to attach — keep it under 2 MB.`); return; }
        const full = await file.text();
        let content = full.slice(0, 24000);
        if (/[\uD800-\uDBFF]$/.test(content)) content = content.slice(0, -1);
        const truncated = full.length > content.length;
        const replaced = api?.pendingDocument?.kind === 'text';
        if (api) api.pendingDocument = { kind: 'text', name: file.name, content, originalCharacters: full.length, truncated, attachedAt: new Date().toISOString() };
        const extras = texts.length > 1 ? ' (only one text file can be attached)' : '';
        setImageError(`${replaced ? 'Replaced the text attachment with' : 'Attached'} ${file.name}${extras}${truncated ? ` — first 24,000 of ${full.length.toLocaleString()} characters.` : '.'}`);
        bumpChat();
      } catch {
        setImageError(`Could not read “${file.name}” as text.`);
      }
    }
    if (rejected > 0) setImageError('That file type is not supported — attach images or text/code files (.txt, .md, .json, .csv, .log, .html…).');
    if (filePickerRef.current) filePickerRef.current.value = '';
  };

  // Paste/drop images directly onto the composer.
  useEffect(() => {
    const host = inputRef.current?.closest('#ramo-composer-v180');
    if (!host) return undefined;
    const onPaste = (event: Event) => {
      const items = (event as ClipboardEvent).clipboardData?.items ?? [];
      const files = Array.from(items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((f): f is File => !!f);
      if (files.length) { event.preventDefault(); void addAnyFiles(files); }
    };
    const onDrop = (event: Event) => {
      const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
      if (files.length) { event.preventDefault(); void addAnyFiles(files); }
    };
    const onDragOver = (event: Event) => {
      if (Array.from((event as DragEvent).dataTransfer?.types ?? []).includes('Files')) {
        event.preventDefault();
        (event as DragEvent).dataTransfer!.dropEffect = 'copy';
      }
    };
    host.addEventListener('paste', onPaste);
    host.addEventListener('drop', onDrop);
    host.addEventListener('dragover', onDragOver);
    return () => {
      host.removeEventListener('paste', onPaste);
      host.removeEventListener('drop', onDrop);
      host.removeEventListener('dragover', onDragOver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, images, processing]);

  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault?.();
    const text = value.trim();
    setSttNote(null);
    if (busy) {
      if (!text) {
        void api?.cancel?.();
        bumpChat();
        return;
      }
      if (images.length || api?.pendingDocument?.kind === 'images') {
        showToast('Stop the current response before sending images.');
        return;
      }
      // Queue semantics: a typed message while busy is a queued follow-up.
      void Promise.resolve(window.RamoApplication.enqueue?.(text, undefined))
        .then(() => showToast('Message queued for after this response.'))
        .catch((error) => showToast(error instanceof Error ? error.message : String(error)));
      setValue('');
      return;
    }
    if (!text && images.length === 0) return;
    const payload = { TEXT: text };
    submitPendingUser(text);
    setValue('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    void Promise.resolve(api?.askAI?.(payload))
      .catch((error) => {
        // A rejected turn must not eat the draft or leave a phantom pending row.
        setValue(text);
        submitPendingUser('');
        showToast(error instanceof Error ? error.message : String(error));
      })
      .finally(() => bumpChat());
  };

  const toggleThinking = () => {
    const next = !api?.liveThinking;
    void Promise.resolve(api?.setLiveThinking?.(next)).then(() => bumpChat()).catch((error) => showToast(String(error)));
  };

  const stopStt = async () => {
    sttUnsubscribe.current?.();
    sttUnsubscribe.current = null;
    if (!sttActive) return;
    setSttNote('Finishing transcription…');
    setSttPhase('processing');
    try { await window.ramoDesktop?.stt?.stop?.(); } catch (error) { setSttPhase('error'); setSttNote(String(error)); }
    setSttActive(false);
  };
  // Auto-dismiss attachment notices (attached / replaced / truncated /
  // unsupported) after 8 s so they never linger either.
  useEffect(() => {
    if (!imageError) return undefined;
    const timer = window.setTimeout(() => setImageError(''), 8000);
    return () => window.clearTimeout(timer);
  }, [imageError]);

  // Auto-dismiss the STT note once the mic is disarmed (i.e. after
  // "Transcription complete" or an error). While listening it stays up;
  // it clears after 6 s so it never lingers across sends.
  useEffect(() => {
    if (sttActive || !sttNote) return undefined;
    const timer = window.setTimeout(() => setSttNote(null), 6000);
    return () => window.clearTimeout(timer);
  }, [sttNote, sttActive]);

  const toggleStt = async () => {
    if (sttActive) { await stopStt(); return; }
    const stt = window.ramoDesktop?.stt;
    if (!stt?.recognize) { setSttPhase('error'); setSttNote('Local speech recognition is unavailable.'); return; }
    sttUnsubscribe.current?.();
    sttBase.current = value;
    setSttActive(true);
    setSttPhase('setup');
    setSttNote('Preparing offline microphone…');
    const insert = (fragment: string) => {
      const clean = fragment.trim();
      if (!clean) return;
      const base = sttBase.current.trimEnd();
      const next = base + (base ? ' ' : '') + clean;
      sttBase.current = next;
      setValue(next);
    };
    const finishEvents = () => { sttUnsubscribe.current?.(); sttUnsubscribe.current = null; };
    sttUnsubscribe.current = typeof stt.onEvent === 'function'
      ? stt.onEvent((evt: { type?: string; text?: string; message?: string }) => {
          if (evt.type === 'ready') { setSttPhase('listening'); setSttNote('Listening… click Stop or the mic to finish. Text will not send automatically.'); }
          else if (evt.type === 'status') { setSttPhase('setup'); setSttNote(String(evt.message || 'Loading local speech model…')); }
          else if (evt.type === 'partial') { insert(String(evt.text ?? '')); }
          else if (evt.type === 'final') { insert(String(evt.text ?? '')); setSttPhase('processing'); setSttActive(false); setSttNote('Transcription complete — review before sending.'); finishEvents(); }
          else if (evt.type === 'error') { setSttPhase('error'); setSttNote(String(evt.message || 'Speech recognition failed')); finishEvents(); }
        })
      : null;
    try {
      await stt.recognize({});
      setSttActive(false);
    } catch (error) {
      setSttPhase('error');
      setSttNote(error instanceof Error ? error.message : String(error));
      setSttActive(false);
    }
  };

  // Close menus on outside pointer presses.
  useEffect(() => {
    if (!modelMenuOpen && !paletteOpen) return undefined;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (modelMenuOpen && !modelMenuRef.current?.contains(target ?? null) && !modelChipRef.current?.contains(target ?? null)) setModelMenuOpen(false);
      if (paletteOpen && !target?.closest?.('.oc-palette-choices,.oc-command-chip')) setPaletteOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [modelMenuOpen, paletteOpen]);

  // Measure the whole composer footprint, including its floating scope and
  // attachment rows. The transcript and notifications reserve that real space.
  useLayoutEffect(() => {
    const composer = composerRef.current;
    const root = document.getElementById('ramo-stage-overlay-v180');
    if (!composer || !root) return undefined;
    const measure = () => {
      const composerRect = composer.getBoundingClientRect();
      if (!composerRect.height || getComputedStyle(composer).display === 'none') {
        root.style.setProperty('--oc-composer-space', '140px');
        return;
      }
      const layers = [composer, ...Array.from(composer.querySelectorAll<HTMLElement>(':scope > .oc-scope-chips, :scope > .oc-image-attachments, :scope > .oc-attached-text, :scope > .oc-stt-status:not([hidden])'))];
      const top = Math.min(...layers.map((node) => node.getBoundingClientRect().top).filter(Number.isFinite));
      root.style.setProperty('--oc-composer-space', `${Math.max(140, Math.ceil(window.innerHeight - top + 12))}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    Array.from(composer.children).forEach((node) => observer.observe(node));
    const mutations = new MutationObserver(measure);
    mutations.observe(composer, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); mutations.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // Anchor either popover above the scope row, with a bounded scroll area.
  // Re-clamp on resize and as filtering changes its height.
  useLayoutEffect(() => {
    if (!modelMenuOpen && !paletteOpen) return undefined;
    const position = () => {
      const menu = modelMenuOpen ? modelMenuRef.current : paletteMenuRef.current;
      const wrap = composerRef.current;
      const chip = modelMenuOpen ? modelChipRef.current : wrap?.querySelector<HTMLElement>('.oc-command-chip');
      const scope = wrap?.querySelector<HTMLElement>('.oc-scope-chips');
      if (!menu || !chip || !wrap || !scope) return;
      const chipRect = chip.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const scopeRect = scope.getBoundingClientRect();
      const width = menu.getBoundingClientRect().width;
      const left = Math.max(8, Math.min(chipRect.right - width, window.innerWidth - width - 8));
      menu.style.left = `${Math.round(left - wrapRect.left)}px`;
      menu.style.right = 'auto';
      const available = Math.max(120, scopeRect.top - 16);
      menu.style.maxHeight = `${Math.floor(Math.min(480, available))}px`;
      menu.style.bottom = `${Math.round(wrapRect.bottom - scopeRect.top + 8)}px`;
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [modelMenuOpen, paletteOpen, modelQuery, paletteQuery, palette.length]);

  useLayoutEffect(() => { if (inputRef.current) autoGrow(inputRef.current); }, [value]);

  const autoGrow = (node: HTMLTextAreaElement) => {
    node.style.height = 'auto';
    const capped = Math.min(node.scrollHeight, 140);
    node.style.height = `${Math.max(24, capped)}px`;
    node.style.overflowY = node.scrollHeight > 140 ? 'auto' : 'hidden';
  };

  const model = api?.modelName?.() ?? '';
  const registry = (globalThis as unknown as { __ramoModelRegistry?: Array<{ model?: string; id?: string; label?: string; kind?: string; ready?: boolean }> }).__ramoModelRegistry ?? [];
  const registryMatch = registry.find((entry) => entry?.model === model || entry?.id === model);
  const choices = useMemo(() => availableModelChoices(), [registryVersion]);
  const activeChoice = choices.find((choice) => choice.name === model);
  const modelLabel = activeChoice?.label ?? registryMatch?.label ?? activeChoice?.label ?? (model ? String(model).split('/').pop() : 'Model');
  const thinking = !!api?.liveThinking;
  const toolAccess = String((window as unknown as { RamoState?: { get?: (k: string) => string } }).RamoState?.get?.('Tool Access') ?? 'ask') || 'ask';
  const ready = value.trim().length > 0 || images.length > 0 || busy;
  const queuedFollowUps = window.RamoApplication?.queuedFollowUps?.() ?? [];
  const restoreFollowUp = () => {
    if (value.trim() || images.length || api?.pendingDocument) { showToast('Send or clear the current draft and attachments before restoring a queued message.'); return; }
    const next = window.RamoApplication?.restoreFollowUp?.();
    if (next) { setValue(next); inputRef.current?.focus(); bumpChat(); }
  };

  // Context fill of the harness window, computed from the live session —
  // measured when model timings exist; otherwise chars/4 of the transcript.
  const contextInfo = useContextUsage(messages, (() => {
    try {
      const value = Number((api as unknown as { harness?: { settings?: () => { context?: number } } } | undefined)?.harness?.settings?.()?.context);
      return Number.isFinite(value) ? value : undefined;
    } catch { return undefined; }
  })());

  const toggleModelMenu = () => {
    setPaletteOpen(false);
    setModelMenuOpen((open) => {
      if (open) setModelQuery('');
      return !open;
    });
  };
  const pickModel = (choice: ModelChoice) => {
    setModelMenuOpen(false);
    setModelQuery('');
    const apiAny = assistantApi() as unknown as { setVariable?: (name: string, value: string) => void };
    apiAny.setVariable?.('Assistant Model', choice.name);
    bumpChat();
  };
  const openModelSettings = () => {
    setModelMenuOpen(false);
    setModelQuery('');
    try { localStorage.setItem('ramo-settings-section-v1', 'models'); } catch { /* memory-only */ }
    setPage('system');
  };
  const openApiStudio = () => {
    setModelMenuOpen(false);
    setModelQuery('');
    setApiDialogOpen(true);
  };
  return (
    <div ref={composerRef} id="ramo-composer-v180" className={ready ? 'oc-composer-ready' : 'oc-composer-idle'} data-stt-active={sttActive ? '1' : '0'} role="group" aria-label="Ramo command composer">
      <div className="oc-scope-chips" id="oc-scope-chips">
        <button type="button" className="oc-scope-chip oc-scope-approval" title="Change tool access in Settings · Tools" onClick={() => { try { localStorage.setItem('ramo-settings-section-v1', 'tools'); } catch { /* memory-only */ } setPage('system'); }}>
          <span dangerouslySetInnerHTML={{ __html: ICON_SHIELD }} />{permissionLabel(toolAccess)}
        </button>
        <button ref={commandChipRef} type="button" className="oc-scope-chip oc-command-chip" aria-haspopup="dialog" aria-expanded={paletteOpen} title="Saved slash commands and skills" onClick={() => { setModelMenuOpen(false); setPaletteOpen((open) => !open); setPaletteQuery(value.startsWith('/') ? value.slice(1) : ''); }}>
          ⌘ Commands{palette.length ? ` · ${palette.length}` : ''}
        </button>
        {queuedFollowUps.length > 0 ? <button type="button" className="oc-scope-chip oc-queued-chip" title={`Next queued message: ${queuedFollowUps[0]}`} onClick={restoreFollowUp}>{queuedFollowUps.length} queued · Restore next</button> : null}
        <input ref={filePickerRef} type="file" className="oc-image-input" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,text/*,application/json,application/xml,application/x-yaml,application/yaml,application/javascript,application/sql,image/svg+xml,.md,.markdown,.json,.jsonl,.csv,.tsv,.log,.xml,.yaml,.yml,.toml,.ini,.conf,.cfg,.html,.htm,.xhtml,.css,.less,.scss,.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rs,.go,.java,.c,.h,.cc,.cpp,.hpp,.rb,.php,.sh,.bash,.zsh,.ps1,.sql,.svg,.gradle,.properties,.env" aria-label="Attach images or text files" onChange={(event) => void addAnyFiles(Array.from(event.target.files ?? []))} />
      </div>
      {images.length > 0 && (
        <div className="oc-image-attachments has-images" data-processing={String(processing)}>
          <div className="oc-image-previews">
            {images.map((image, index) => (
              <span key={index} className="oc-image-preview">
                <img src={source(image)} alt={image.name} title={image.name} />
                <button type="button" aria-label={`Remove image ${index + 1}`} onClick={() => updateImages(images.filter((_, i) => i !== index))}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}
      {imageError ? <span className="oc-image-notice" role="status">{imageError}</span> : null}
      {api?.pendingDocument?.kind === 'text' ? (
        <div className="oc-attached-text">
          <span>{api.pendingDocument.name || 'Attached text'}{api.pendingDocument.truncated ? ` · first 24,000 of ${(api.pendingDocument.originalCharacters ?? 24000).toLocaleString()} chars` : ''}</span>
          <button type="button" aria-label="Remove attached text" onClick={() => { api.pendingDocument = null; bumpChat(); }}>×</button>
        </div>
      ) : null}
      <button type="button" id="ramo-composer-attach" aria-label="Attach files or images" title="Attach images or text files — photos, .txt, .md, .json, .csv, code, logs… (up to 4 images)" onClick={() => filePickerRef.current?.click()} disabled={processing || busy} dangerouslySetInnerHTML={{ __html: ICON_PAPERCLIP }} />
      <button type="button" id="ramo-composer-mic" aria-pressed={sttActive} aria-label={sttActive ? 'Stop speech recognition' : 'Start speech recognition'} onClick={() => void toggleStt()} dangerouslySetInnerHTML={{ __html: ICON_MIC }} />
      <textarea id="ramo-command-input-v180" ref={inputRef} rows={1} placeholder="Ask Ramo…" aria-label="Ask Ramo" title="Enter to send · Shift+Enter for a new line" value={value} onChange={(event) => { setValue(event.target.value); autoGrow(event.target); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit(); } }} />
      <button type="button" className="oc-thinking-quick" aria-pressed={thinking} aria-label={thinking ? 'Thinking on' : 'Thinking off'} onClick={toggleThinking}>Thinking {thinking ? 'on' : 'off'}</button>
      {/* The legacy ⋯ Session-settings menu is hidden by the studio chrome
          (ramo-studio.css display:none !important); refresh models and the
          research model live in System now. */}
      <button ref={modelChipRef} type="button" className="oc-model-chip" aria-label="Choose the model" aria-haspopup="dialog" aria-expanded={modelMenuOpen} data-value={model} onClick={toggleModelMenu}>
        <span>{modelLabel}</span>
        <span dangerouslySetInnerHTML={{ __html: ICON_CHEVRON }} />
      </button>
      {modelMenuOpen && (() => {
        const q = modelQuery.trim().toLowerCase();
        const filtered = choices.filter((choice) => !q
          || choice.label.toLowerCase().includes(q)
          || choice.name.toLowerCase().includes(q)
          || String(choice.details ?? '').toLowerCase().includes(q));
        const local = filtered.filter((choice) => choice.group !== 'api');
        const apiGroup = filtered.filter((choice) => choice.group === 'api');
        const renderRow = (choice: ModelChoice) => (
          <div key={choice.name} className={`oc-model-row${choice.name === model ? ' active' : ''}`}>
            <button type="button" className="oc-model-pick" aria-pressed={choice.name === model} onClick={() => pickModel(choice)}>
              <strong>{choice.label}</strong>
              <span>{choice.details || choice.name}</span>
            </button>
            <button type="button" className="oc-model-gear" aria-label={`Model settings — ${choice.label}`} title="Model settings" onClick={openModelSettings} dangerouslySetInnerHTML={{ __html: ICON_GEAR }} />
          </div>
        );
        return (
          <div ref={modelMenuRef} tabIndex={-1} className="oc-model-choices" role="dialog" aria-label="Choose the model">
            <div className="oc-model-searchwrap">
              <span className="oc-model-search-icon" dangerouslySetInnerHTML={{ __html: ICON_SEARCH }} />
              <input className="oc-model-search" autoFocus type="text" placeholder="Search models…" aria-label="Search models" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setModelMenuOpen(false); } }} />
            </div>
            <div className="oc-model-compact-context">
              <button type="button" onClick={toggleThinking} aria-pressed={thinking}>Thinking {thinking ? 'on' : 'off'}</button>
              <span title={`${contextInfo.used.toLocaleString()} / ${contextInfo.ctxWindow.toLocaleString()} tokens`}>Context {contextInfo.percent}%</span>
            </div>
            {local.length > 0 && <div className="oc-model-group">Local</div>}
            {local.map(renderRow)}
            {apiGroup.length > 0 && <div className="oc-model-group">API</div>}
            {apiGroup.map(renderRow)}
            {filtered.length === 0 && <p className="oc-model-empty">No matching models</p>}
            <button type="button" className="oc-model-row oc-model-add" onClick={openApiStudio}>
              <strong>Add an API model…</strong>
              <span>A model from a provider you have a key for</span>
            </button>
          </div>
        );
      })()}
      {paletteOpen && (() => {
        const q = paletteQuery.trim().toLowerCase();
        const filtered = palette.filter((item) => !q || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)).slice(0, 30);
        const pick = (item: PaletteItem) => {
          setValue(item.kind === 'prompt' ? `/${item.name} ` : `Use the ${item.name} skill. `);
          setPaletteOpen(false);
          setPaletteQuery('');
          inputRef.current?.focus();
        };
        return (
          <div ref={paletteMenuRef} tabIndex={-1} className="oc-model-choices oc-palette-choices" role="dialog" aria-label="Commands and skills">
            <div className="oc-model-searchwrap">
              <input className="oc-model-search" autoFocus type="text" placeholder="Search commands and skills…" aria-label="Search commands and skills" value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setPaletteOpen(false); } }} />
            </div>
            {filtered.map((item) => (
              <div key={`${item.kind}:${item.name}`} className="oc-model-row">
                <button type="button" className="oc-model-pick" onClick={() => pick(item)}>
                  <strong>{item.kind === 'prompt' ? '/' : 'Skill: '}{item.name}</strong>
                  <span>{item.argumentHint ? `${item.argumentHint} — ` : ''}{item.description || (item.kind === 'prompt' ? 'Saved prompt template' : 'Saved skill')}</span>
                </button>
              </div>
            ))}
            {palette.length === 0 && <p className="oc-model-empty">No saved commands or skills yet. Add prompt .md files or SKILL.md folders in your Ramo profile.</p>}
            {palette.length > 0 && filtered.length === 0 && <p className="oc-model-empty">No matching commands</p>}
          </div>
        );
      })()}
      <span className="oc-context-chip" role="status" title={`${contextInfo.used.toLocaleString()} / ${contextInfo.ctxWindow.toLocaleString()} tokens${contextInfo.measured ? ' · last model call' : ' · estimated from this conversation'}`} aria-label={`Context used: ${contextInfo.percent} percent`}>{contextInfo.percent}%</span>
      <button type="button" id="ramo-composer-send" aria-label={busy ? 'Stop' : 'Send'} title={busy ? 'Stop response (Ctrl+Shift+X)' : 'Send (Enter)'} onClick={() => onSubmit()} dangerouslySetInnerHTML={{ __html: busy ? ICON_STOP : ICON_SEND }} />
      <div className="oc-stt-status" data-phase={sttPhase} role="status" hidden={!sttNote}>
        <span className="oc-stt-dot" aria-hidden="true" />
        <span className="oc-stt-message">{sttNote}</span>
        {sttActive ? <button type="button" className="oc-stt-stop" onClick={() => void stopStt()}>Stop</button> : null}
      </div>
      {apiDialogOpen && createPortal(
        <ApiModelDialog onClose={() => { setApiDialogOpen(false); void refreshApiRegistry(true).then(() => setRegistryVersion((v) => v + 1)); }} />,
        document.body,
      )}
    </div>
  );
}
