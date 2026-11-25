/**
 * Add/Edit an API model saved on this machine.
 *
 * One unified OpenAI-compatible flow — Gemini included (Google serves an
 * OpenAI-compatible chat endpoint at the preset below), so there is no
 * separate provider mode to learn. Base-URL presets fill the common ones,
 * and "Fetch models from provider" lists the live catalogue for the key you
 * gave it; pick one to fill the Model ID. Keys are never shown back — only
 * saved/removed/labelled — and RAMO never displays a raw key.
 */
import { useEffect, useMemo, useState } from 'react';
import { refreshApiRegistry } from '../lib/models';
import { useDialogFocus } from '../lib/useDialogFocus';

interface ApiProfile {
  id: string;
  name: string;
  provider: string;
  model: string;
  providerModel?: string;
  endpoint: string;
  auth: string;
  kind: string;
  ready: boolean;
}

interface ModelOption {
  id: string;
  label?: string;
  description?: string;
}

const GEMINI_CHAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

/** Quick-fill presets — all plain OpenAI-compatible base URLs with Bearer keys. */
const PRESETS: ReadonlyArray<{ label: string; endpoint: string }> = [
  { label: 'Gemini', endpoint: GEMINI_CHAT_URL },
  { label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions' },
  { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions' },
  { label: 'NVIDIA', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions' },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ApiModelDialog({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<ApiProfile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [auth, setAuth] = useState<'bearer' | 'x-api-key'>('bearer');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelFilter, setModelFilter] = useState('');
  const [modelIndex, setModelIndex] = useState(0);
  const dialogRef = useDialogFocus<HTMLElement>(onClose);

  const reload = async () => {
    setLoading(true);
    try {
      const rows = await (window as unknown as { ramoDesktop?: { apiProviders: { list: () => Promise<ApiProfile[]> } } })
        .ramoDesktop?.apiProviders?.list?.();
      setProfiles(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetFetch = () => {
    setFetchError('');
    setModelOptions([]);
    setModelFilter('');
    setModelIndex(0);
  };

  const startEdit = (profile: ApiProfile) => {
    resetFetch();
    setEditingId(profile.id);
    setName(profile.name);
    setModel(profile.providerModel || profile.model);
    // Legacy Gemini profiles are edited through the same unified flow: the
    // Gemini OpenAI-compatible endpoint they already use underneath.
    setEndpoint(profile.provider === 'gemini' ? GEMINI_CHAT_URL : profile.endpoint);
    setAuth(profile.auth === 'x-api-key' ? 'x-api-key' : 'bearer');
    setApiKey('');
    setMessage('');
  };

  const useProfile = async (profile: ApiProfile) => {
    try {
      (window as unknown as { RamoState?: { set?: (name: string, value: string) => void } })
        .RamoState?.set?.('Assistant Model', profile.model);
    } catch (error) {
      setMessage(errorMessage(error));
      return;
    }
    await refreshApiRegistry(true);
    onClose();
  };

  const startNew = () => {
    resetFetch();
    setEditingId(null);
    setName('');
    setModel('');
    setEndpoint('');
    setAuth('bearer');
    setApiKey('');
    setMessage('');
  };

  const save = async () => {
    const cleanName = name.trim();
    const cleanModel = model.trim();
    if (!cleanName || !cleanModel) { setMessage('Give this API model a name and a model ID.'); return; }
    if (!endpoint.trim()) { setMessage('Paste the API base URL (or use a preset).'); return; }
    setBusy(true);
    setMessage('');
    try {
      await (window as unknown as { ramoDesktop?: { apiProviders: { save: (p: Record<string, unknown>) => Promise<unknown> } } })
        .ramoDesktop?.apiProviders?.save?.({
          ...(editingId ? { id: editingId } : {}),
          name: cleanName,
          provider: 'openai-compatible',
          model: cleanModel,
          endpoint: endpoint.trim(),
          auth,
          apiKey: apiKey.trim(),
        });
      setMessage('Saved.');
      startNew();
      await reload();
      await refreshApiRegistry(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    if (!window.confirm('Delete this API model profile? The saved key is also removed from this computer.')) return;
    setBusy(true);
    try {
      await (window as unknown as { ramoDesktop?: { apiProviders: { remove: (id: string) => Promise<unknown> } } })
        .ramoDesktop?.apiProviders?.remove?.(editingId);
      startNew();
      await reload();
      await refreshApiRegistry(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    setFetchError('');
    setFetching(true);
    setModelOptions([]);
    setModelFilter('');
    setModelIndex(0);
    try {
      const result = await (window as unknown as {
        ramoDesktop?: { apiProviders: { models: (spec: Record<string, unknown>) => Promise<{ models?: ModelOption[]; count?: number }> } };
      }).ramoDesktop?.apiProviders?.models?.({
        ...(editingId ? { id: editingId } : {}),
        endpoint: endpoint.trim(),
        auth,
        apiKey: apiKey.trim(),
      });
      const list = Array.isArray(result?.models) ? result!.models! : [];
      setModelOptions(list);
      setMessage(list.length ? `Found ${list.length} models. Type to filter, then click one.` : 'The provider returned no models.');
    } catch (error) {
      setFetchError(errorMessage(error));
    } finally {
      setFetching(false);
    }
  };

  const pickModel = (id: string) => {
    setModel(id);
    setModelOptions([]);
    setModelFilter('');
    setModelIndex(0);
    setMessage(`Model ID set to ${id}.`);
  };

  const filter = modelFilter.trim().toLowerCase();
  const filtered = useMemo(
    () => modelOptions.filter((option) => !filter || option.id.toLowerCase().includes(filter) || (option.label ?? '').toLowerCase().includes(filter)),
    [modelOptions, filter],
  );
  const shown = filtered.slice(0, 200);
  useEffect(() => { if (modelIndex >= shown.length) setModelIndex(0); }, [shown.length, modelIndex]);

  const onFilterKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setModelIndex((i) => Math.min(i + 1, shown.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setModelIndex((i) => Math.max(i - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); const target = shown[modelIndex]; if (target) pickModel(target.id); }
    else if (event.key === 'Escape') { event.preventDefault(); resetFetch(); }
  };

  const canFetch = !fetching && Boolean(endpoint.trim()) && (Boolean(apiKey.trim()) || Boolean(editingId));
  const canSave = Boolean(name.trim() && model.trim() && endpoint.trim());

  return (
    <div className="oc-overlay-layer is-modal" role="presentation" data-shell="react" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="oc-overlay-panel oc-api-model-editor" role="dialog" aria-modal="true" aria-label={editingId ? 'Edit API model' : 'Add an API model'} style={{ width: 470, maxWidth: 'calc(100vw - 48px)', inset: '50% auto auto 50%', transform: 'translate(-50%, -50%)', position: 'fixed' }}>
        <div className="oc-dialog-head">
          <h2>{editingId ? 'Edit API model' : 'Add an API model'}</h2>
          <button type="button" className="oc-shell-button" aria-label="Close panel" onClick={onClose}>Close</button>
        </div>
        <p className="oc-dialog-help">API keys stay on this computer, encrypted by your OS. They are never written into chats, exports or screenshots.</p>

        <div style={{ overflowY: 'auto', maxHeight: '55vh', paddingRight: 2 }}>
        {loading ? <p className="oc-dialog-help" role="status">Loading saved API models…</p> : null}
        {!loading && profiles.length === 0 ? <p className="oc-dialog-help">No saved API models yet. Fill in the form below to add one.</p> : null}
        {profiles.length > 0 ? (
          <div className="oc-model-list" aria-label="Saved API models">
            {profiles.map((row) => (
              <div key={row.id} role="group" aria-label={row.name || row.model} className="oc-model-option" style={{ padding: '10px 12px', border: '1px solid var(--oc-rule)' }}>
                <button type="button" className="oc-model-option" aria-pressed={editingId === row.id} onClick={() => startEdit(row)} style={{ flex: 1, minWidth: 0 }}>
                  <span>
                    <b>{row.name || row.model}</b>
                    <small>{row.provider === 'gemini' ? 'Google Gemini' : 'OpenAI-compatible'} · {row.model}</small>
                  </span>
                  <span className="oc-model-status">{editingId === row.id ? 'Editing' : 'Edit'}</span>
                </button>
                <button type="button" className="oc-shell-button primary" style={{ minHeight: 30, padding: '5px 10px', fontSize: 12, flex: 'none' }} onClick={() => void useProfile(row)}>Use</button>
              </div>
            ))}
          </div>
        ) : null}

        <label className="oc-form-field">Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My coding assistant" aria-label="Profile name" />
        </label>

        <label className="oc-form-field">Model ID
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Exact model ID from your provider" aria-label="Model ID" spellCheck={false} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '-6px 0 10px' }}>
          <button type="button" className="oc-shell-button" style={{ minHeight: 28, padding: '4px 12px', fontSize: 12 }} disabled={!canFetch} onClick={() => void fetchModels()}>{fetching ? 'Fetching…' : 'Fetch models from provider'}</button>
          {modelOptions.length > 0 ? <span className="oc-dialog-help" style={{ margin: 0 }}>{filtered.length} shown</span> : null}
        </div>
        {fetchError ? <p className="oc-dialog-help" role="alert" style={{ color: 'var(--oc-danger, #ff9a9a)' }}>{fetchError}</p> : null}
        {modelOptions.length > 0 ? (
          <div role="presentation" style={{ border: '1px solid var(--oc-rule)', borderRadius: 10, margin: '0 0 12px', overflow: 'hidden' }}>
            <input value={modelFilter} onChange={(event) => { setModelFilter(event.target.value); setModelIndex(0); }} onKeyDown={onFilterKey} autoFocus placeholder="Search models…" aria-label="Filter models" spellCheck={false} style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', background: 'var(--oc-surface)', border: 'none', borderBottom: '1px solid var(--oc-rule)', borderRadius: 0, color: 'inherit', outline: 'none', font: 'inherit' }} />
            <div role="listbox" aria-label="Available models" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {shown.map((option, index) => (
                <button key={option.id} type="button" role="option" aria-selected={index === modelIndex} className="oc-model-option" style={{ padding: '6px 10px', background: index === modelIndex ? 'var(--oc-surface)' : 'transparent', border: 'none', borderRadius: 0 }} onMouseEnter={() => setModelIndex(index)} onClick={() => pickModel(option.id)}>
                  <span>
                    <b style={{ fontSize: 12 }}>{option.label || option.id}</b>
                    {option.label ? <small>{option.id}</small> : null}
                  </span>
                  {option.description ? <span className="oc-model-status" title={option.description} style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{option.description}</span> : null}
                </button>
              ))}
              {shown.length === 0 ? <p className="oc-dialog-help" style={{ padding: '10px', margin: 0 }}>No models match “{modelFilter}”.</p> : null}
            </div>
          </div>
        ) : null}

        <label className="oc-form-field">API base URL
          <input value={endpoint} onChange={(event) => { setEndpoint(event.target.value); resetFetch(); }} placeholder="https://api.openai.com/v1/chat/completions" aria-label="API base URL" spellCheck={false} />
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '-6px 0 12px' }} aria-label="Provider presets">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" className="oc-shell-button" style={{ minHeight: 24, padding: '2px 10px', fontSize: 11 }} onClick={() => { setEndpoint(preset.endpoint); setAuth('bearer'); resetFetch(); }}>{preset.label}</button>
          ))}
        </div>
        <label className="oc-form-field">Key format
          <select value={auth} onChange={(event) => setAuth(event.target.value as 'bearer' | 'x-api-key')} aria-label="Authorization scheme">
            <option value="bearer">Bearer token</option>
            <option value="x-api-key">x-api-key header</option>
          </select>
        </label>
        <label className="oc-form-field">API key{editingId ? ' — leave empty to keep the saved key' : ''}
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} aria-label="API key" placeholder={editingId ? 'Leave empty to keep the stored key' : 'sk-…'} />
        </label>
        {message ? <p className="oc-dialog-help" role="status">{message}</p> : null}
        </div>

        <div className="oc-model-actions" style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap', borderTop: '1px solid var(--oc-rule)', paddingTop: 16 }}>
          <button type="button" className="oc-shell-button primary" disabled={!canSave || busy || loading} onClick={() => void save()}>{busy ? 'Saving…' : 'Save API model'}</button>
          {editingId ? <button type="button" className="oc-shell-button" onClick={() => void remove()} disabled={busy || loading}>Remove</button> : null}
          <button type="button" className="oc-shell-button" onClick={startNew} disabled={busy || loading}>{editingId ? 'Cancel edit' : 'Clear form'}</button>
        </div>
      </section>
    </div>
  );
}
