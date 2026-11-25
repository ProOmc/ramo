/**
 * The visible in-app browser pane's deterministic wiring. No React here so the
 * model-free suite can check bounds, state normalisation and the control gate.
 * The pane is a viewing/control surface only; it grants no new permissions.
 */

export const BROWSER_PANE_ID = "ramo-browser-pane-v1";
export const BROWSER_VIEWPORT_ID = "ramo-browser-viewport-v1";
/** The page the Browser tab opens on first use. Only changed deliberately. */
export const DEFAULT_BROWSER_URL = "https://www.google.com";

export type ControlMode = "agent" | "user";

export interface PaneBounds { x: number; y: number; width: number; height: number }

export interface PaneState {
  url: string;
  title: string;
  loading: boolean;
  visible: boolean;
  controlMode: ControlMode;
  lastTool: string;
  status: string;
}

/** Keep the native child window inside the display and at a usable size. */
export function clampBounds(bounds: PaneBounds, screen: { width: number; height: number }): PaneBounds {
  const width = Math.max(320, Math.min(Math.round(Number(bounds.width) || 0), screen.width));
  const height = Math.max(240, Math.min(Math.round(Number(bounds.height) || 0), screen.height));
  return {
    x: Math.max(0, Math.min(Math.round(Number(bounds.x) || 0), Math.max(0, screen.width - width))),
    y: Math.max(0, Math.min(Math.round(Number(bounds.y) || 0), Math.max(0, screen.height - height))),
    width,
    height,
  };
}

/** Agent control paused means only read-only tools may run. */
export function canAgentTool(tool: string, mode: ControlMode): boolean {
  if (mode === "agent") return true;
  return ["snapshot", "read", "screenshot", "wait"].includes(String(tool));
}

/** A short, honest status line from observable host state — not model prose. */
export function statusFrom(tool: string, loading: boolean): string {
  if (loading || tool === "navigate") return "Opening page...";
  if (tool === "read" || tool === "snapshot") return "Reading page...";
  if (tool === "screenshot") return "Looking at the page...";
  if (tool === "click" || tool === "type") return "Working on the page...";
  if (tool === "wait") return "Waiting for the page...";
  return "Watching the page";
}

export function normalizeState(raw: unknown): PaneState {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lastTool = typeof input.lastTool === "string" ? input.lastTool : "";
  const loading = input.loading === true;
  return {
    url: typeof input.url === "string" ? input.url : "",
    title: typeof input.title === "string" ? input.title : "Ramo browser",
    loading,
    visible: input.visible === true,
    controlMode: input.controlMode === "user" ? "user" : "agent",
    lastTool,
    status: typeof input.status === "string" && input.status ? input.status : statusFrom(lastTool, loading),
  };
}

export function controlLabel(mode: ControlMode): string {
  return mode === "user" ? "You control the browser" : "Ramo controls the browser";
}

/** The address bar accepts a hostname or a full http(s) URL, nothing else. */
export function normalizeBrowserAddress(input: string): string {
  const value = String(input || "").trim();
  if (!value || /\s/.test(value)) throw new Error("Enter a web address such as example.com");
  // An explicit non-http scheme must not become a hostname by prepending https.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) throw new Error("Use an http:// or https:// address");
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new Error("Enter a valid web address"); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error("Use an http:// or https:// address");
  return parsed.href;
}

/** How long a preview refresh may wait before the card goes stale. */
export const PREVIEW_REFRESH_MS = 2000;
