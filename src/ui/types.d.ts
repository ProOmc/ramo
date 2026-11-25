/**
 * Globals the React UI relies on, declared once.
 * The preload exposes `ramoDesktop`; the legacy bootstrap installs the
 * Ramo facade objects. The React shell only ever reads these — never
 * installs anything new on window except for test/probe compatibility.
 */
import type { DesktopBridge } from '../renderer/legacy-boundary';

declare global {
  interface Window {
    ramoDesktop: DesktopBridge;
    RamoState: import('../core/state').ApplicationState;
    RamoApplication: import('../renderer/application').RamoApplication;
    RamoRuntime: { request(method: string, params?: Record<string, unknown>): Promise<unknown>; onEvent(callback: (event: Record<string, unknown>) => void): () => void };
    RamoMemory: import('../renderer/memory-surface').MemorySurface;
    __ramoAssistantInstance: Record<string, unknown>;
    __ramoModelRegistry: Array<Record<string, unknown>>;
  }
}

export {};
