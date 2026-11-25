import { useCallback, useEffect, useMemo, useState } from 'react';
import { refreshApiRegistry } from '../lib/models';
import appMode from '../../config/app-mode.json';

interface OllamaModel { name: string; parameters?: string; size?: number }
interface OllamaInventory { online: boolean; installed?: boolean; port: number; models: OllamaModel[]; error?: string }
interface SetupState { complete: boolean; ollamaPort: number; tiers: { fast?: string; smart?: string; superSmart?: string } }
interface KeyStatus { provider: string; name: string; saved: boolean; masked: string | null }
interface ApiProfile { id: string; name: string; label?: string; provider: string; providerModel: string; endpoint: string }
interface SetupBridge {
  get: () => Promise<SetupState>;
  save: (value: SetupState) => Promise<SetupState>;
  downloadOllama: () => Promise<void>;
  browseOllamaModels: () => Promise<void>;
  startOllama: () => Promise<OllamaInventory>;
}

const SEARCH_KEYS = [
  { id: 'anysearch', name: 'AnySearch', variable: 'AnySearch API Key', storage: 'AI_SEARCH_API_KEY_V1', hint: 'Primary search. Leave blank to try direct anonymous access.' },
  { id: 'tavily', name: 'Tavily', variable: 'Tavily API Key', storage: 'RAMO_TAVILY_API_KEY_V1', hint: 'Optional reserve, used only after AnySearch fails.' },
];
const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', hint: 'OpenAI chat models' },
  { id: 'openrouter', name: 'OpenRouter', hint: 'Models routed by OpenRouter' },
  { id: 'anthropic', name: 'Anthropic', hint: 'Anthropic chat models' },
  { id: 'gemini', name: 'Google Gemini', hint: 'Gemini chat models' },
  { id: 'nvidia', name: 'NVIDIA', hint: 'NVIDIA NIM chat models' },
];
const setupBridge = () => (window.ramoDesktop as unknown as { setup: SetupBridge }).setup;

function sizeBillions(model: OllamaModel): number {
  const match = /(?:^|[^0-9])([0-9]+(?:\.[0-9]+)?)\s*b(?:[^a-z]|$)/i.exec(model.parameters || model.name);
  return match ? Number(match[1]) : 1e6;
}
function defaults(models: OllamaModel[]): SetupState['tiers'] {
  const ranked = [...models].sort((a, b) => sizeBillions(a) - sizeBillions(b) || (a.size || 0) - (b.size || 0) || a.name.localeCompare(b.name));
  const preferredFast = models.some((m) => m.name === 'heretic-4b-vision');
  const preferredSmart = models.some((m) => m.name === 'heretic-9b-vision');
  const fast = preferredFast ? 'heretic-4b-vision' : ranked[0]?.name || '';
  const smart = preferredSmart ? 'heretic-9b-vision' : ranked.find((m) => m.name !== fast)?.name || fast;
  const superSmart = [...ranked].reverse().find((m) => ![fast, smart].includes(m.name))?.name || smart;
  return { fast, smart, superSmart };
}

function SearchKeyFields({ onNotice }: { onNotice: (text: string) => void }) {
  const [version, setVersion] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const saved = (storage: string) => { try { return localStorage.getItem(storage) || ''; } catch { return ''; } };
  const save = (id: string, variable: string, storage: string) => {
    const value = String(values[id] || '').trim();
    if (!value) { onNotice('Paste a key first, or use Remove to clear it.'); return; }
    try {
      localStorage.setItem(storage, value); window.RamoState?.set?.(variable, value);
      setValues((old) => ({ ...old, [id]: '' })); setVersion((v) => v + 1); onNotice('Search key saved locally.');
    } catch { onNotice('The key could not be saved in local storage.'); }
  };
  const remove = (variable: string, storage: string) => {
    try { localStorage.removeItem(storage); } catch { /* memory-only fallback */ }
    window.RamoState?.set?.(variable, ''); setVersion((v) => v + 1); onNotice('Search key removed.');
  };
  return <div className="oc-setup-key-list">{SEARCH_KEYS.map((provider) => {
    const current = saved(provider.storage) || String(window.RamoState?.get?.(provider.variable) || '');
    return <div className="oc-setup-key-row" key={provider.id}>
      <div><strong>{provider.name}</strong><small>{provider.hint}</small><span role="status">{current ? `Key set · ••••${current.slice(-4)}` : provider.id === 'anysearch' ? 'No key · direct anonymous mode' : 'Reserve not configured'}</span></div>
      <div className="oc-setup-key-actions"><input type="password" autoComplete="new-password" spellCheck={false} aria-label={`${provider.name} API key`} placeholder={current ? 'Paste a replacement key' : `Paste ${provider.name} key (optional)`} value={values[provider.id] || ''} onChange={(event) => setValues((old) => ({ ...old, [provider.id]: event.target.value }))} />
        <button type="button" className="oc-shell-button" onClick={() => save(provider.id, provider.variable, provider.storage)}>Save</button>
        <button type="button" className="oc-shell-button-quiet" disabled={!current} onClick={() => remove(provider.variable, provider.storage)}>Remove</button></div>
    </div>;
  })}<p className="oc-setup-provider-line" data-version={version}>Active: <strong>AnySearch {saved(SEARCH_KEYS[0].storage) ? '(your key)' : '(anonymous direct)'}</strong>. Tavily is a reserve only when its key is set.</p></div>;
}

function ProviderKeyFields({ onNotice, onChanged }: { onNotice: (text: string) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<KeyStatus[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => { try { setRows(await window.ramoDesktop.apiProviders.knownStatus()); } catch { setRows([]); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const status = (id: string) => rows.find((row) => row.provider === id);
  const save = async (id: string, name: string) => {
    const value = String(values[id] || '').trim(); if (!value) { onNotice(`Paste your ${name} key first.`); return; }
    try { await window.ramoDesktop.apiProviders.knownSave(id, value); setValues((old) => ({ ...old, [id]: '' })); await refresh(); onChanged(); onNotice(`${name} key saved with encrypted local storage.`); }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };
  const clear = async (id: string, name: string) => { try { await window.ramoDesktop.apiProviders.knownClear(id); await refresh(); onChanged(); onNotice(`${name} key removed.`); } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } };
  return <div className="oc-setup-key-list">{PROVIDERS.map((provider) => <div className="oc-setup-key-row" key={provider.id}>
    <div><strong>{provider.name}</strong><small>{provider.hint}</small><span role="status">{status(provider.id)?.saved ? `Key set · ${status(provider.id)?.masked}` : 'Not set'}</span></div>
    <div className="oc-setup-key-actions"><input type="password" autoComplete="new-password" spellCheck={false} aria-label={`${provider.name} API key`} placeholder={status(provider.id)?.saved ? 'Paste a replacement key' : 'Paste API key (optional)'} value={values[provider.id] || ''} onChange={(event) => setValues((old) => ({ ...old, [provider.id]: event.target.value }))} />
      <button type="button" className="oc-shell-button" onClick={() => void save(provider.id, provider.name)}>Save</button>
      <button type="button" className="oc-shell-button-quiet" disabled={!status(provider.id)?.saved} onClick={() => void clear(provider.id, provider.name)}>Remove</button></div>
  </div>)}</div>;
}

function ApiModelForm({ onSaved, onNotice }: { onSaved: () => void; onNotice: (text: string) => void }) {
  const [form, setForm] = useState({ provider: 'openai', name: '', model: '', endpoint: '', apiKey: '' });
  const set = (key: string, value: string) => setForm((old) => ({ ...old, [key]: value }));
  const save = async () => {
    if (!form.name.trim() || !form.model.trim()) { onNotice('Give the cloud model a display name and exact provider model ID.'); return; }
    try {
      await window.ramoDesktop.apiProviders.save({ ...form, auth: 'bearer' });
      setForm({ provider: form.provider, name: '', model: '', endpoint: '', apiKey: '' });
      onSaved(); onNotice('Cloud model added. You can now assign it to any tier.');
    } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="oc-setup-api-form">
    <div className="oc-setup-api-grid">
      <label className="oc-page-field">Provider<select aria-label="Cloud model provider" value={form.provider} onChange={(e) => set('provider', e.target.value)}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="openai-compatible">Other OpenAI-compatible</option></select></label>
      <label className="oc-page-field">Display name<input aria-label="Cloud model display name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My cloud model" /></label>
      <label className="oc-page-field">Exact provider model ID<input aria-label="Cloud provider model ID" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="Model ID from the provider’s catalogue" /></label>
      {form.provider === 'openai-compatible' && <label className="oc-page-field">Base URL<input aria-label="Custom API base URL" value={form.endpoint} onChange={(e) => set('endpoint', e.target.value)} placeholder="https://provider.example/v1" /></label>}
      <label className="oc-page-field">Key for this profile<input type="password" autoComplete="new-password" aria-label="Cloud profile API key" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder="Blank uses the saved provider key slot" /></label>
    </div>
    <button type="button" className="oc-shell-button" onClick={() => void save()}>Add cloud model</button>
  </div>;
}

export function SetupScreen({ onComplete, embedded = false }: { onComplete?: () => void; embedded?: boolean }) {
  const [inventory, setInventory] = useState<OllamaInventory>({ online: false, port: 11434, models: [] });
  const [setup, setSetup] = useState<SetupState>({ complete: false, ollamaPort: 11434, tiers: {} });
  const [apiProfiles, setApiProfiles] = useState<ApiProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const loadApiProfiles = useCallback(async () => { try { setApiProfiles(await window.ramoDesktop.apiProviders.list() as ApiProfile[]); } catch { setApiProfiles([]); } }, []);
  const refresh = useCallback(async (requestedPort?: number) => {
    setLoading(true);
    try {
      const saved = await setupBridge().get(), selectedPort = Number.isInteger(requestedPort) ? Number(requestedPort) : saved.ollamaPort;
      const [found, profiles] = await Promise.all([window.ramoDesktop.ollamaModels(selectedPort) as Promise<OllamaInventory>, window.ramoDesktop.apiProviders.list() as Promise<ApiProfile[]>]);
      setSetup({ ...saved, ollamaPort: selectedPort }); setInventory(found); setApiProfiles(profiles);
      if (!Object.keys(saved.tiers || {}).length && found.models?.length) setSetup((old) => ({ ...old, tiers: defaults(found.models) }));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const modelNames = useMemo(() => inventory.models?.map((model) => model.name) || [], [inventory]);
  const candidates = useMemo(() => [...modelNames.map((name) => ({ value: name, label: name, cloud: false })), ...apiProfiles.map((profile) => ({ value: 'api:' + profile.id, label: `${profile.name || profile.label} · ${profile.providerModel}`, cloud: true }))], [modelNames, apiProfiles]);
  const canFinish = candidates.length > 0 && (!modelNames.length || inventory.online);
  const startOllama = async () => { setNotice('Starting Ollama without loading a model…'); try { await setupBridge().startOllama(); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } };
  const finish = async () => {
    if (!canFinish) { setNotice('Connect Ollama with at least one installed model, or add a cloud model above.'); return; }
    const valid = new Set(candidates.map((choice) => choice.value)), tiers = { ...defaults(inventory.models), ...setup.tiers };
    for (const tier of ['fast', 'smart', 'superSmart'] as const) if (!valid.has(tiers[tier] || '')) tiers[tier] = candidates[0]?.value || '';
    try {
      await setupBridge().save({ complete: true, ollamaPort: setup.ollamaPort, tiers });
      window.RamoState?.set?.('Assistant Model', tiers.fast?.startsWith('api:') ? tiers.fast.slice(4) : tiers.fast || '');
      const research = tiers.smart || tiers.fast || ''; window.RamoState?.set?.('Research Report Model', research.startsWith('api:') ? research.slice(4) : research);
      await refreshApiRegistry(true); onComplete?.(); setNotice('Setup complete.');
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };
  return <section className={embedded ? 'oc-setup-screen embedded' : 'oc-setup-screen'} aria-label="Ramo setup">
    <div className="oc-setup-heading"><div><h1>{embedded ? 'Setup' : 'Welcome to Ramo'}</h1><p>Local and cloud models, capability tiers and optional keys.</p></div><span className={canFinish ? 'oc-setup-state ready' : 'oc-setup-state'}>{canFinish ? 'Ready to finish' : 'Setup incomplete'}</span></div>
    <section className="oc-setup-section"><h2>1. Ollama connection (optional with cloud models)</h2><p>{inventory.online ? `${modelNames.length} installed model${modelNames.length === 1 ? '' : 's'} detected on 127.0.0.1:${inventory.port}.` : inventory.error || 'Ollama is not responding yet.'}</p>
      <label className="oc-page-field">Ollama loopback port<input type="number" min={1} max={65535} aria-label="Ollama port" value={setup.ollamaPort} onChange={(event) => setSetup((old) => ({ ...old, ollamaPort: Number(event.target.value) }))} /></label>
      <div className="oc-page-row"><button type="button" className="oc-shell-button" onClick={() => void refresh(setup.ollamaPort)}>Refresh detection</button>{!inventory.online && <button type="button" className="oc-shell-button primary" onClick={() => void startOllama()}>Start Ollama</button>}{!inventory.online && <button type="button" className="oc-shell-button" onClick={() => void setupBridge().downloadOllama()}>Download Ollama</button>}<button type="button" className="oc-shell-button-quiet" onClick={() => void setupBridge().browseOllamaModels()}>Browse Ollama model library</button></div>
      {!inventory.online && <p className="oc-setup-guide">If Ollama is already running, check that its API uses this loopback port, then Refresh. Install models from the Ollama library when you are ready.</p>}
      {inventory.online && !modelNames.length && <p className="oc-setup-guide">Ollama is reachable but has no installed models. Choose a model from the library based on your own RAM/VRAM and its license, install it with <code>ollama pull &lt;model-id&gt;</code>, then Refresh. You can use cloud models instead.</p>}
    </section>
    <section className="oc-setup-section"><h2>2. Add and assign models</h2><p>Ollama and cloud API profiles are valid in every tier. Unassigned local tiers default smallest → mid → largest. Adjust them to match how you work.</p>
      {(['fast', 'smart', 'superSmart'] as const).map((tier) => <label className="oc-page-field" key={tier}>{tier === 'superSmart' ? 'Super Smart' : tier[0].toUpperCase() + tier.slice(1)}<select aria-label={`${tier} model`} value={setup.tiers[tier] || ''} disabled={!candidates.length} onChange={(event) => setSetup((old) => ({ ...old, tiers: { ...old.tiers, [tier]: event.target.value } }))}>{!candidates.length && <option value="">No local or cloud models configured</option>}{candidates.length > 0 && <option value="">Automatic / first available</option>}{modelNames.length > 0 && <optgroup label="Ollama">{modelNames.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup>}{apiProfiles.length > 0 && <optgroup label="Cloud API models">{apiProfiles.map((profile) => <option key={profile.id} value={'api:' + profile.id}>{profile.name || profile.label} · {profile.providerModel}</option>)}</optgroup>}</select></label>)}
      <h3>Cloud model keys and profiles</h3><ProviderKeyFields onNotice={setNotice} onChanged={() => void loadApiProfiles()} /><ApiModelForm onSaved={() => void loadApiProfiles()} onNotice={setNotice} />
      {apiProfiles.length > 0 && <p className="oc-page-subtitle">{apiProfiles.length} cloud model profile{apiProfiles.length === 1 ? '' : 's'} available for tier assignment.</p>}
    </section>
    <section className="oc-setup-section"><h2>3. Search keys (optional)</h2><SearchKeyFields onNotice={setNotice} /></section>
    <div className="oc-setup-footer"><p role="status">{notice || (loading ? 'Checking setup…' : 'Keys remain local and masked. They are never added to chats or exports.')}</p><button type="button" className="oc-shell-button primary" disabled={loading || !canFinish} onClick={() => void finish()}>Finish setup</button></div>
  </section>;
}

export function SetupGate() {
  const [state, setState] = useState<'loading' | 'required' | 'done'>('loading');
  useEffect(() => { if (appMode.mode !== 'personal') void setupBridge().get().then((setup) => setState(setup.complete ? 'done' : 'required')).catch(() => setState('required')); }, []);
  if (appMode.mode === 'personal' || state === 'done') return null;
  return <div className="oc-setup-backdrop">{state === 'required' ? <SetupScreen onComplete={() => setState('done')} /> : <div className="oc-setup-loading" role="status">Checking Ramo setup…</div>}</div>;
}
