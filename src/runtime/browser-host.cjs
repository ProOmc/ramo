'use strict';
/**
 * Ramo in-app browser host — step 1 of docs/agent-browser-plan.md.
 *
 * Runs in the Electron main process only. It owns one BrowserView in an
 * isolated persistent session, attached to the app window when the Browser
 * tab is visible, and exposes seven typed operations to the worker through
 * the session service's /browser route. The view has no window chrome of its
 * own: the page is part of the app, so clicks and keystrokes stay in Ramo.
 * There is no `eval` operation, no external-window escape, and no second
 * agent loop: the kernel keeps owning the turn, this module only drives a page.
 *
 * Derived from Ramo's own plan (docs/agent-browser-plan.md). No third-party
 * browser-automation dependency is used; all control goes through CDP.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TOOLS = Object.freeze(['navigate', 'snapshot', 'click', 'type', 'read', 'screenshot', 'wait']);
const DENIED_PERMISSIONS = Object.freeze(['openExternal', 'notifications', 'display-capture', 'media']);
const DEFAULT_BROWSER_URL = 'https://www.google.com';

function fail(message) {
  throw new Error(message);
}

/**
 * Local-only sanitisation of extracted units. Page text is untrusted data:
 * hidden text, scripts, styles, comments and markup are removed before it is
 * handed to the worker. This is pure so the model-free suite can check it.
 */
function sanitizeUnits(units) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(units) ? units : []) {
    if (!raw || typeof raw !== 'object') continue;
    const kind = ['heading', 'text', 'control'].includes(String(raw.kind)) ? String(raw.kind) : '';
    if (!kind) continue;
    if (raw.hidden || raw.ariaHidden) continue;
    let text = String(raw.text ?? '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /^(script|style)\b/i.test(text)) continue;
    const domPath = String(raw.domPath ?? '').slice(0, 500);
    const selector = String(raw.selector ?? '').slice(0, 300);
    const key = `${kind}|${text}|${domPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, text: text.slice(0, 4000), domPath, selector, role: String(raw.role ?? '').slice(0, 40) });
  }
  return out;
}

/** Escape an id for a CSS selector without relying on a DOM global in main. */
function cssId(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, ch => '\\' + ch);
}

/** Restrict every navigation to http(s). Everything else is refused in code. */
function safeUrl(raw) {
  const value = String(raw || '').trim();
  let url;
  try { url = new URL(value); } catch { fail('A full http(s) URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol)) fail('Only http and https URLs are allowed');
  return url.toString();
}

function createBrowserHost({ app, userDataDir }) {
  const { BrowserView, session } = require('electron');
  const root = String(userDataDir || (app && app.getPath ? app.getPath('userData') : ''));
  if (!root) fail('A user data directory is required for the isolated browser profile');
  const profileDir = path.join(root, 'ramo-agent');
  const isolated = session.fromPath(profileDir);

  // An embedded view, not a second BrowserWindow: no title bar, no taskbar
  // entry, no focus fight with the user's own browser.
  const view = new BrowserView({
    webPreferences: {
      session: isolated,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });
  const contents = view.webContents;
  // This view owns its navigation policy. The shell installs link handling on
  // app windows only; nothing global can redirect these navigations outward.
  let defaultLoaded = false;
  let parent = null;
  let viewMounted = false;
  let lastRequestedBounds = null;
  const boundsLog = [];

  // Hard safety boundaries. A page cannot open a new window, launch an
  // external app, ask for notifications, capture the screen or use devices.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  isolated.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(!DENIED_PERMISSIONS.includes(permission));
  });
  isolated.setPermissionCheckHandler((_wc, permission) => !DENIED_PERMISSIONS.includes(permission));
  // Explicit http(s) allowlist for this webContents only.
  contents.on('will-navigate', (event, url) => {
    try { safeUrl(url); } catch { event.preventDefault(); }
  });
  contents.on('will-frame-navigate', (event, url) => {
    try { safeUrl(url); } catch { event.preventDefault(); }
  });
  contents.on('will-redirect', (event, url) => {
    try { safeUrl(url); } catch { event.preventDefault(); }
  });

  // One CDP session for the whole job; the actor never sees the protocol.
  let attached = false;
  let refs = new Map();
  let seq = 0;
  // The pane is a viewing/control surface. It never adds a model permission.
  let controlMode = 'agent';
  let paneVisible = false;
  let lastTool = '';
  const stateListeners = new Set();
  function cdp(method, params = {}) {
    if (!attached) fail('Browser debugger is not attached');
    return contents.debugger.sendCommand(method, params);
  }
  async function ensureAttached() {
    if (!attached) {
      await contents.debugger.attach('1.3');
      // Mark attached before the enable calls: cdp() itself guards on this.
      attached = true;
      await cdp('Page.enable');
      await cdp('DOM.enable');
      await cdp('Accessibility.enable');
    }
  }
  async function documentNode() {
    const { root: node } = await cdp('DOM.getDocument', { depth: -1 });
    return node;
  }
  async function nodeForRef(ref) {
    const selector = refs.get(String(ref));
    if (!selector) fail('Unknown ref: ' + String(ref));
    const { nodeId } = await cdp('DOM.querySelector', { nodeId: (await documentNode()).nodeId, selector });
    if (!nodeId) fail('Element no longer present: ' + String(ref));
    return nodeId;
  }
  function compactAx(tree, limit = 400) {
    const out = [];
    for (const node of tree.nodes || []) {
      if (node.ignored) continue;
      const role = node.role && node.role.value;
      const name = node.name && String(node.name.value || '').trim();
      if (!role || !name || role === 'generic' || role === 'none') continue;
      if (['StaticText', 'Text', 'InlineTextBox', 'image'].includes(role)) continue;
      out.push(`${role}: ${name.slice(0, 200)}`);
      if (out.length >= limit) break;
    }
    return out.join('\n') || '(no accessible controls found)';
  }
  function buildRefs(tree) {
    refs = new Map();
    let index = 0;
    for (const node of tree.nodes || []) {
      if (node.ignored) continue;
      const role = node.role && node.role.value;
      if (!['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'heading'].includes(role)) continue;
      const name = node.name && String(node.name.value || '').trim();
      const selector = node.properties ? node.properties.find(p => p.name === 'id') : null;
      const attr = selector && selector.value && selector.value.value ? String(selector.value.value) : '';
      const key = `e${++index}`;
      // Only elements with a stable id receive an actionable ref. A typed
      // click never guesses at an index-based selector in someone else's DOM.
      if (attr) {
        refs.set(key, `#${cssId(attr)}`);
        if (name) refs.set(name.slice(0, 80), `#${cssId(attr)}`);
      }
    }
  }
  async function bodyText() {
    const node = await documentNode();
    const { result } = await cdp('Runtime.callFunctionOn', {
      objectId: (await cdp('DOM.resolveNode', { nodeId: node.nodeId })).object.objectId,
      functionDeclaration: 'function(){return document.body ? document.body.innerText.slice(0,200000) : "";}',
      returnByValue: true,
    });
    return String(result.value || '');
  }
  async function waitFor(condition, timeoutMs) {
    const deadline = Date.now() + Math.min(Number(timeoutMs) || 10000, 60000);
    while (Date.now() < deadline) {
      const url = contents.getURL();
      const text = await bodyText().catch(() => '');
      if (String(condition.text || '') && text.includes(String(condition.text))) return { ok: true, url };
      if (condition.url && url.includes(String(condition.url))) return { ok: true, url };
      if (!Object.keys(condition).length && !contents.isLoading()) return { ok: true, url };
      await new Promise(r => setTimeout(r, 250));
    }
    return { ok: false, url: contents.getURL() };
  }

  /**
   * Internal untrusted-reader extraction. This is NOT an actor tool: the
   * service reaches it through the /reader route only. The page function runs
   * inside the isolated renderer and returns text plus DOM paths; no cloud
   * reader and no arbitrary-JS capability are involved.
   */
  async function extract(mode = 'content', options = {}) {
    await ensureAttached();
    const root = await documentNode();
    const { object } = await cdp('DOM.resolveNode', { nodeId: root.nodeId });
    const { result } = await cdp('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function () {
        const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','CANVAS','VIDEO','AUDIO','IFRAME','NAV','FOOTER','HEADER','FORM']);
        const hidden = (el) => {
          const s = getComputedStyle(el);
          return s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || el.getAttribute('aria-hidden') === 'true';
        };
        const cssPath = (el) => {
          const parts = [];
          let node = el;
          while (node && node.nodeType === 1 && parts.length < 12) {
            if (node.id) { parts.unshift('#' + node.id); break; }
            const tag = node.tagName.toLowerCase();
            const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(x => x.tagName === node.tagName) : [];
            const index = siblings.indexOf(node) + 1;
            parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + index + ')' : ''));
            node = node.parentElement;
          }
          return parts.join(' > ');
        };
        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
        const container = document.querySelector('article, main, [role="main"], .post-content, .entry-content, #content') || document.body;
        const units = [];
        if (container) {
          const tags = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dd,dt,pre';
          container.querySelectorAll(tags).forEach((el) => {
            if (hidden(el) || el.closest('script,style,noscript,template')) return;
            let parent = el.parentElement;
            while (parent && parent !== container) {
              if (SKIP.has(parent.tagName) || hidden(parent)) return;
              parent = parent.parentElement;
            }
            const text = clean(el.innerText);
            if (text.length < 12) return;
            units.push({ kind: /^H[1-6]$/.test(el.tagName) ? 'heading' : 'text', text: text.slice(0, 4000), domPath: cssPath(el), selector: el.id ? '#' + el.id : '' });
          });
        }
        const controls = [];
        document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="link"],[role="textbox"]').forEach((el) => {
          if (hidden(el)) return;
          const name = clean(el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || '');
          if (!name) return;
          controls.push({ kind: 'control', role: clean(el.getAttribute('role') || el.tagName).toLowerCase(), text: name.slice(0, 300), domPath: cssPath(el), selector: el.id ? '#' + el.id : '' });
        });
        return { units, controls };
      }`,
      returnByValue: true,
    });
    const raw = result && result.value ? result.value : {};
    const limit = Math.max(1, Math.min(Number(options.maxUnits) || 200, 500));
    const units = sanitizeUnits(raw.units).slice(0, limit);
    const controls = sanitizeUnits(raw.controls).slice(0, limit);
    refs = new Map();
    controls.forEach((item, index) => {
      if (!item.selector) return;
      const ref = 'e' + (index + 1);
      item.ref = ref;
      refs.set(ref, item.selector);
      refs.set(item.text.slice(0, 80), item.selector);
    });
    return {
      ok: true,
      mode: mode === 'controls' ? 'controls' : 'content',
      url: contents.getURL(),
      title: contents.getTitle(),
      capturedAt: new Date().toISOString(),
      units: mode === 'content' ? units : [],
      controls: mode === 'controls' ? controls : [],
    };
  }

  function paneState() {
    return {
      url: contents.getURL() || '',
      title: contents.getTitle() || '',
      loading: !!contents.isLoading(),
      visible: paneVisible,
      controlMode,
      lastTool,
      status: contents.isLoading() ? 'Opening page...' : (lastTool ? 'Last action: ' + lastTool : 'Watching the page'),
    };
  }
  function emitState() {
    const state = paneState();
    for (const listener of stateListeners) {
      try { listener(state); } catch { /* a listener must not break the host */ }
    }
  }
  for (const event of ['did-start-loading', 'did-finish-load', 'did-navigate', 'page-title-updated']) {
    contents.on(event, () => emitState());
  }
  function viewRect(bounds) {
    const value = bounds && typeof bounds === 'object' ? bounds : {};
    const rect = {
      x: Math.max(0, Math.round(Number(value.x) || 0)),
      y: Math.max(0, Math.round(Number(value.y) || 0)),
      width: Math.max(320, Math.round(Number(value.width) || 720)),
      height: Math.max(240, Math.round(Number(value.height) || 560)),
    };
    lastRequestedBounds = rect;
    boundsLog.push({ at: Date.now(), ...rect });
    if (boundsLog.length > 12) boundsLog.shift();
    return rect;
  }
  function mountView(parentWindow, rect) {
    if (!parentWindow || parentWindow.isDestroyed()) return;
    if (viewMounted && parent === parentWindow) {
      const current = view.getBounds();
      if (current.x === rect.x && current.y === rect.y && current.width === rect.width && current.height === rect.height) return;
      view.setBounds(rect);
      return;
    }
    if (viewMounted && parent && !parent.isDestroyed()) parent.removeBrowserView(view);
    parent = parentWindow;
    parent.addBrowserView(view);
    viewMounted = true;
    view.setBounds(rect);
  }
  function unmountView() {
    if (viewMounted && parent && !parent.isDestroyed()) parent.removeBrowserView(view);
    viewMounted = false;
  }
  function showPane(bounds, parentWindow) {
    // First reveal loads the default page here in the host, before any caller's
    // subsequent navigate IPC. Doing this in the renderer would race with an
    // agent or harness navigate and could overwrite it with the default.
    if (!defaultLoaded && (!contents.getURL() || contents.getURL() === 'about:blank')) {
      defaultLoaded = true;
      try { void contents.loadURL(DEFAULT_BROWSER_URL); } catch { /* next open can retry */ }
    }
    mountView(parentWindow, viewRect(bounds));
    paneVisible = true;
    emitState();
    return paneState();
  }
  function hidePane() {
    unmountView();
    paneVisible = false;
    emitState();
    return paneState();
  }
  function setPaneBounds(bounds) {
    if (!paneVisible || !bounds) return paneState();
    if (parent && viewMounted) view.setBounds(viewRect(bounds));
    return paneState();
  }
  function setControlMode(mode) {
    controlMode = mode === 'user' ? 'user' : 'agent';
    if (controlMode === 'user' && viewMounted) {
      try { contents.focus(); } catch { /* focus is best-effort */ }
    }
    emitState();
    return paneState();
  }
  function onState(listener) {
    if (typeof listener === 'function') stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }

  async function runToolInner(tool, args = {}) {
    if (!TOOLS.includes(String(tool))) fail('Unsupported browser operation: ' + String(tool));
    lastTool = String(tool);
    // Taking control pauses the agent. This is a UI control gate, not a new
    // permission: step-3 hard boundaries still apply to every action.
    if (controlMode === 'user' && ['navigate', 'click', 'type'].includes(String(tool))) {
      fail('The user has control of the browser; resume before the agent can act');
    }
    // The debugger target only exists once a document is loaded. Attaching on
    // about:blank makes CDP enable commands hang on this Electron build.
    if (tool === 'navigate') {
      const url = safeUrl(args.url);
      await contents.loadURL(url);
      return { ok: true, url };
    }
    await ensureAttached();
    if (tool === 'snapshot') {
      const response = await cdp('Accessibility.getFullAXTree');
      // Chromium variants return either {tree:{nodes}} or {nodes} directly.
      const tree = response.tree || { nodes: response.nodes || [] };
      buildRefs(tree);
      return { ok: true, url: contents.getURL(), title: contents.getTitle(), outline: compactAx(tree, Number(args.limit) || 400) };
    }
    if (tool === 'read') {
      return { ok: true, url: contents.getURL(), title: contents.getTitle(), text: await bodyText() };
    }
    if (tool === 'click') {
      const nodeId = await nodeForRef(args.ref);
      await cdp('DOM.scrollIntoViewIfNeeded', { nodeId });
      const { object } = await cdp('DOM.resolveNode', { nodeId });
      await cdp('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){this.click();}' });
      return { ok: true, ref: String(args.ref) };
    }
    if (tool === 'type') {
      const nodeId = await nodeForRef(args.ref);
      await cdp('DOM.focus', { nodeId });
      await cdp('Input.insertText', { text: String(args.text ?? '').slice(0, 100000) });
      return { ok: true, ref: String(args.ref), chars: String(args.text ?? '').length };
    }
    if (tool === 'screenshot') {
      const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!args.fullPage });
      return { ok: true, mimeType: 'image/png', data: shot.data };
    }
    if (tool === 'wait') {
      const result = await waitFor(args.condition || {}, args.timeoutMs);
      return { ok: result.ok, url: result.url };
    }
    fail('Unreachable browser operation');
  }
  async function runTool(tool, args = {}) {
    try { return await runToolInner(tool, args); }
    finally { emitState(); }
  }

  function metrics() {
    const pid = contents.getOSProcessId && contents.getOSProcessId();
    let workingSetMb = null;
    if (pid && process.platform === 'win32') {
      try {
        const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command',
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`], { encoding: 'utf8', timeout: 15000 }).trim();
        const bytes = Number(raw);
        if (Number.isFinite(bytes) && bytes > 0) workingSetMb = Math.round((bytes / 1048576) * 10) / 10;
      } catch { /* metrics are best-effort, never a failure of the turn */ }
    }
    return {
      rendererPid: pid || null,
      rendererWorkingSetMb: workingSetMb,
      sessionDir: profileDir,
      // Bounds diagnostics for the tab layout review. DIPs, not device pixels.
      requestedBounds: lastRequestedBounds,
      boundsLog: boundsLog.slice(),
      paneBounds: view.getBounds(),
      parentBounds: parent && !parent.isDestroyed() ? parent.getBounds() : null,
      parentContentBounds: parent && !parent.isDestroyed() ? parent.getContentBounds() : null,
    };
  }

  async function close() {
    try { if (attached) await contents.debugger.detach(); } catch { /* already gone */ }
    attached = false;
    unmountView();
  }

  return Object.freeze({
    tools: TOOLS,
    profileDir,
    runTool,
    paneState,
    showPane,
    hidePane,
    setPaneBounds,
    setControlMode,
    onState,
    // Internal only: the actor never receives this method.
    internal: Object.freeze({ extract }),
    metrics,
    close,
    isDestroyed: () => !contents || contents.isDestroyed(),
    view,
  });
}

module.exports = { createBrowserHost, TOOLS, DENIED_PERMISSIONS, safeUrl, sanitizeUnits };
