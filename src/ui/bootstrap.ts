/**
 * The engine bootstrap: reproduces what the legacy `renderer/app.ts` did to
 * stand the shared engine up (RamoState → RamoApplication → AssistantExtension),
 * without the legacy workspace/unified installs — the React shell owns those.
 *
 * Nothing outside `src/renderer`, `src/core`, `src/compat/domain.js` and
 * `src/compat/ramo-overlays.js` (dialog host) is constructed here; the React
 * UI imports bridge calls (`ramoDesktop`) and the same instances.
 */
import defaults from '../config/defaults.json';
import { ApplicationState } from '../core/state.js';
// The Harness is required by RamoApplication's constructor; it is a pure
// JS module with no DOM usage.
import '../compat/ramo-harness-core.js';
import { AssistantEngine, AssistantExtension } from '../compat/domain.js';
import { RamoApplication } from '../renderer/application.js';
import { MemorySurface } from '../renderer/memory-surface.js';
import type { LegacyObject } from '../renderer/legacy-boundary';
// Interim only (B1 → B2): the pet settings dialog in pet-bridge.js opens with
// the compat overlay host. B2 replaces both with a React modal.
import '../compat/ramo-overlays.js';
import '../compat/ramo-conversations.js';

// The legacy chrome rules key off html.oc-studio — the React shell keeps that contract.
document.documentElement.classList.add('oc-studio');
try { const savedTheme = localStorage.getItem('ramo-theme-v1'); document.documentElement.dataset.ramoTheme = savedTheme === 'paper' ? 'paper' : 'graphite'; } catch { /* the graphite default ships in index.html */ }

window.RamoState = new ApplicationState(defaults);
const configNames = new Set(['Assistant Model', 'Research Report Model', 'Ollama Chat URL', 'Remote Ollama URL', 'Research Model Backend', 'Research OpenAI Chat URL', 'Research Report Context', 'Research Budget Seconds', 'Research Maximum Rounds', 'Voice Enabled']);
window.RamoState.subscribe((name: string) => {
  if (!configNames.has(name)) return;
  const saved = Object.fromEntries([...configNames].map((key) => [key, window.RamoState.get(key)]));
  try { localStorage.setItem('RAMO_UNIFIED_SETTINGS', JSON.stringify(saved)); } catch { console.error('Ramo settings could not be saved.'); }
});

const application = new RamoApplication(window.ramoDesktop, (host, storage) => new AssistantEngine(host, storage));
window.RamoApplication = application;
window.RamoRuntime = {
  request: (method: string, params?: Record<string, unknown>) => application.request(method, params),
  onEvent: (callback: (event: LegacyObject) => void) => application.onEvent(callback),
};

const assistant: LegacyObject = new AssistantExtension();
window.__ramoAssistantInstance = assistant;
// Install the conversation lifecycle wrappers (empty-chat reuse on New chat).
// The compat wrapper touches `u._writeProjectPrompt('')` and the composer
// textarea; both are gone in React, so pass no-op stand-ins.
try { (window as unknown as { RamoConversations?: { install?: (a: unknown, u: unknown) => void } }).RamoConversations?.install?.(assistant, {
  _writeProjectPrompt: () => true,
  composer: null,
  _resizeComposer: () => {},
}); } catch { /* selection still works unpatched */ }
assistant.clearContext = () => application.clearContext();

// The memory surface is a viewer and an editor over the store the worker
// owns. It reads the projection the worker writes and sends commands back
// through the inbox, so the interface never writes a fact itself.
const memory = new MemorySurface(window.ramoDesktop);
window.RamoMemory = memory;

assistant.openMemories = async () => {
  try { await memory.open(); } catch (error) { assistant.setVariable('UI_TEXT_OUT', error instanceof Error ? error.message : String(error)); }
};

void application.initialize(assistant as LegacyObject).catch((error) => {
  document.body.textContent = 'Ramo could not open local data: ' + String((error as Error)?.message || error);
});

export { application, assistant };
