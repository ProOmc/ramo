import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_PANE_ID, BROWSER_VIEWPORT_ID, DEFAULT_BROWSER_URL, clampBounds, canAgentTool,
  normalizeBrowserAddress, normalizeState, statusFrom, controlLabel, PREVIEW_REFRESH_MS,
} from '../build/browser-pane-wire.js';

test('the pane keeps stable ids and a bounded preview refresh', () => {
  assert.equal(BROWSER_PANE_ID, 'ramo-browser-pane-v1');
  assert.equal(BROWSER_VIEWPORT_ID, 'ramo-browser-viewport-v1');
  assert.equal(DEFAULT_BROWSER_URL, 'https://www.google.com');
  assert.ok(PREVIEW_REFRESH_MS >= 1000);
});

test('pane bounds stay inside the display and never collapse', () => {
  const clamped = clampBounds({ x: 1800, y: 900, width: 900, height: 700 }, { width: 1920, height: 1080 });
  assert.equal(clamped.x, 1020);
  assert.equal(clamped.y, 380);
  assert.equal(clamped.width, 900);
  assert.equal(clamped.height, 700);
  const tiny = clampBounds({ x: -10, y: -10, width: 0, height: 0 }, { width: 800, height: 600 });
  assert.deepEqual(tiny, { x: 0, y: 0, width: 320, height: 240 });
});

test('taking control pauses agent actions but not read-only observation', () => {
  for (const tool of ['navigate', 'click', 'type']) assert.equal(canAgentTool(tool, 'user'), false, tool);
  for (const tool of ['snapshot', 'read', 'screenshot', 'wait']) assert.equal(canAgentTool(tool, 'user'), true, tool);
  for (const tool of ['navigate', 'click', 'type', 'snapshot']) assert.equal(canAgentTool(tool, 'agent'), true, tool);
});

test('state normalisation exposes url, loading and control mode with a live status', () => {
  const state = normalizeState({ url: 'https://example.test/a', title: 'Example', loading: true, visible: true, controlMode: 'user', lastTool: 'navigate' });
  assert.equal(state.url, 'https://example.test/a');
  assert.equal(state.title, 'Example');
  assert.equal(state.loading, true);
  assert.equal(state.visible, true);
  assert.equal(state.controlMode, 'user');
  assert.equal(state.status, 'Opening page...');
  assert.equal(controlLabel('user'), 'You control the browser');
  assert.equal(controlLabel('agent'), 'Ramo controls the browser');
});

test('an unknown tool still yields a bounded status line', () => {
  assert.equal(statusFrom('', false), 'Watching the page');
  assert.equal(statusFrom('read', false), 'Reading page...');
  assert.equal(statusFrom('unknown-tool', false), 'Watching the page');
});

test('the address bar accepts hostnames and http(s), never script URLs', () => {
  assert.equal(normalizeBrowserAddress('example.com'), 'https://example.com/');
  assert.equal(normalizeBrowserAddress('http://localhost:8080/a'), 'http://localhost:8080/a');
  assert.throws(() => normalizeBrowserAddress('javascript:alert(1)'), /http:\/\/ or https:\/\//);
  assert.throws(() => normalizeBrowserAddress('not a url'), /web address/);
});
