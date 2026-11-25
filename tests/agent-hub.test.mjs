/**
 * Agent Hub model-free tests.
 *
 * Starts a real hub on a random port and exercises the protocol end-to-end.
 * Also checks that the kernel adds the bridge participants section to the
 * system prompt when the session opts in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function fetchJson(url, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function startHub(t, root) {
  const { serve } = await import('../src/hub/hub.mjs');
  const hub = await serve({ port: 0, host: '127.0.0.1', root });
  const addr = hub.server.address();
  t.after(() => new Promise((resolve) => hub.server.close(() => resolve())));
  const port = addr.port;
  const base = `http://127.0.0.1:${port}`;
  const token = fs.readFileSync(path.join(root, 'token'), 'utf8').trim();
  return { base, token, port };
}

const freshRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-agent-hub-'));
  return root;
};
const rm = (root) => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} };

test('register, peers, and message without token are rejected', async (t) => {
  const root = freshRoot();
  t.after(() => rm(root));
  const { base, token } = await startHub(t, root);

  // Register a peer.
  const reg = await fetchJson(`${base}/register`, {
    method: 'POST', token,
    body: { name: 'muse', address: 'http://127.0.0.1:9/messages', token: 'peer-token-with-16-plus-chars' },
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.ok, true);
  assert.equal(reg.body.name, 'muse');

  // Registered peer is visible.
  const list = await fetchJson(`${base}/peers`, { token });
  assert.equal(list.status, 200);
  assert.equal(list.body.peers.map((p) => p.name).includes('muse'), true);

  // Message without token is rejected.
  const bad = await fetchJson(`${base}/messages`, {
    method: 'POST',
    body: { from: 'oseanic', to: 'muse', kind: 'message', text: 'hi' },
  });
  assert.equal(bad.status, 401);

  // Wrong token is rejected.
  const wrong = await fetchJson(`${base}/messages`, {
    method: 'POST', token: 'wrong-token-of-32-bytes-or-more!!',
    body: { from: 'oseanic', to: 'muse', kind: 'message', text: 'hi' },
  });
  assert.equal(wrong.status, 401);

  // Proper message is accepted and queued (Muse is not reachable on :9).
  const good = await fetchJson(`${base}/messages`, {
    method: 'POST', token,
    body: { from: 'ramo', to: 'muse', kind: 'job', text: '[Ramo] ping' },
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.ok, true);
  assert.equal(good.body.delivered, 0);
  assert.equal(good.body.queued, 1);

  // Thread recorded.
  const thread = await fetchJson(`${base}/threads/default`, { token });
  assert.equal(thread.body.messages.length, 1);
  assert.equal(thread.body.messages[0].from, 'ramo');
  assert.equal(thread.body.messages[0].kind, 'job');
  assert.equal(thread.body.messages[0].text, '[Ramo] ping');
});

test('messages from registered peer are accepted with peer token', async (t) => {
  const root = freshRoot();
  t.after(() => rm(root));
  const { base } = await startHub(t, root);
  const reg = await fetchJson(`${base}/register`, {
    method: 'POST',
    token: fs.readFileSync(path.join(root, 'token'), 'utf8').trim(),
    body: { name: 'muse', address: 'http://127.0.0.1:9/messages', token: 'muse-peer-token-with-32-chars-ok!' },
  });
  assert.equal(reg.status, 200);

  const fromMuse = await fetchJson(`${base}/messages`, {
    method: 'POST', token: 'muse-peer-token-with-32-chars-ok!',
    body: { from: 'muse', to: 'ramo', kind: 'message', text: '[Guest] status request' },
  });
  assert.equal(fromMuse.status, 200);
  assert.equal(fromMuse.body.ok, true);

  const thread = await fetchJson(`${base}/threads/default`, { token: fs.readFileSync(path.join(root, 'token'), 'utf8').trim() });
  assert.equal(thread.body.messages.at(-1).from, 'muse');
});

test('message kinds and name validation are enforced', async (t) => {
  const root = freshRoot();
  t.after(() => rm(root));
  const { base, token } = await startHub(t, root);

  const badKind = await fetchJson(`${base}/messages`, {
    method: 'POST', token,
    body: { from: 'oseanic', to: 'muse', kind: 'yo', text: 'hello' },
  });
  assert.equal(badKind.status, 400);

  const badFrom = await fetchJson(`${base}/messages`, {
    method: 'POST', token,
    body: { from: 'bad name!', to: 'muse', kind: 'message', text: 'hello' },
  });
  assert.equal(badFrom.status, 400);
});

test('kernel adds Participants section to the system prompt when bridge marker exists', async (t) => {
  const { WorkService } = require('../app/work/service.cjs');
  const app = path.resolve('app');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-agent-bridge-'));
  const cwd = path.join(tmp, 'project');
  fs.mkdirSync(cwd);
  // Bridge marker: the session is the shared Agent Hub thread.
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'agent-bridge.on'), '1\n');
  const messages = [];
  const service = new WorkService({
    appDir: app,
    dataDir: path.join(tmp, 'data'),
    models: async () => [{ id: 'fixture', model: 'fixture', label: 'Protocol fixture', context: 16384, vision: true }],
    chat: async (_model, body, { onChunk }) => {
      messages.push(body.messages[0].content);
      onChunk({ choices: [{ delta: { role: 'assistant', content: 'Confirmed.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
    },
    hostTool: async () => ({ ok: true }),
  });
  t.after(async () => { await service.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const state = await service.request('open', { cwd, trusted: true, permission: 'read', mode: 'assistant', model: 'fixture', history: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi.' }] });
  await service.request('prompt', { text: 'bridge check', model: 'fixture' });
  const system = String(messages[0]?.content ?? messages[0] ?? '');
  assert.ok(system.includes('## Shared thread'), 'the system prompt must carry the Participants section');
  assert.ok(system.includes('[User] — the owner'));
  assert.ok(system.includes('[Guest] — an outside agent'));
  assert.ok(system.includes('[Ramo] — you'));
}, { concurrency: false });
