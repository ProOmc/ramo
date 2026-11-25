/** Shared, typed access to the main-process browser host. No CDP in the renderer. */
import type { PaneState } from './pane-wire';

export type BrowserBridge = {
  pane: {
    open(bounds: Record<string, number>): Promise<PaneState>;
    close(): Promise<PaneState>;
    bounds(bounds: Record<string, number>): Promise<PaneState>;
    takeControl(): Promise<PaneState>;
    resume(): Promise<PaneState>;
    state(): Promise<PaneState>;
    onState(callback: (event: unknown) => void): () => void;
  };
  tool(tool: string, args?: Record<string, unknown>): Promise<{ ok?: boolean; data?: string; error?: string }>;
};

export function bridge(): BrowserBridge | null {
  const browser = (window as unknown as { ramoDesktop?: { browser?: BrowserBridge } }).ramoDesktop?.browser;
  return browser?.pane ? browser : null;
}

/** The native child window is parent-relative, so viewport rect is enough. */
export function readBounds(node: Element | null): Record<string, number> {
  const rect = node?.getBoundingClientRect();
  if (!rect) return { x: 80, y: 80, width: 900, height: 600 };
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}
