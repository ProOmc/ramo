/**
 * Ramo Agent Hub — standalone agent message router.
 *
 * Zero dependencies. Storage under the data root (%APPDATA%\Ramo\agent-hub
 * on Windows, $HOME/.ramo-agent-hub otherwise).
 *
 * Usage:
 *   node src/hub/hub.mjs serve            start the HTTP server (default 4317)
 *   node src/hub/hub.mjs status           report whether a master token exists
 *   node src/hub/hub.mjs list             list thread ids
 *   node src/hub/hub.mjs show <thread>    print a thread
 *   node src/hub/hub.mjs send <to> <kind> <text>
 *     (kind: message | question | job)
 *
 * The master token is minted on first serve, stored 0600, never printed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';

let DATA_ROOT = process.env.RAMO_AGENT_HUB_DIR
  || (process.env.APPDATA ? path.join(process.env.APPDATA, 'Ramo', 'agent-hub') : path.join(os.homedir(), '.ramo-agent-hub'));
let TOKEN_FILE = path.join(DATA_ROOT, 'token');
let PEERS_FILE = path.join(DATA_ROOT, 'peers.json');
let THREADS_DIR = path.join(DATA_ROOT, 'threads');
let OUTBOX_FILE = path.join(DATA_ROOT, 'outbox.jsonl');
const KINDS = new Set(['message', 'question', 'job']);
const NAME_RE = /^[a-z0-9_-]{1,32}$/i;
const ID_RE = /^[a-f0-9]{1,64}$/i;
const MAX_TEXT = 32 * 1024;
const DEFAULT_THREAD = 'default';

function ensureRoot() {
  fs.mkdirSync(DATA_ROOT, { recursive: true, mode: 0o700 });
  fs.mkdirSync(THREADS_DIR, { recursive: true, mode: 0o700 });
}

function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readToken() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return null; }
}

function mintToken() {
  const token = crypto.randomBytes(48).toString('base64url');
  atomicWrite(TOKEN_FILE, token);
  return token;
}

function loadToken() {
  let token = readToken();
  if (!token) {
    ensureRoot();
    token = mintToken();
  }
  return token;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function loadPeers() {
  try {
    const raw = fs.readFileSync(PEERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePeers(peers) {
  atomicWrite(PEERS_FILE, `${JSON.stringify(peers, null, 2)}\n`);
}

function findPeer(peers, name) {
  const wanted = String(name || '').toLowerCase();
  return peers.find((peer) => String(peer.name || '').toLowerCase() === wanted);
}

function upsertPeer(peers, next) {
  const idx = peers.findIndex((peer) => String(peer.name || '').toLowerCase() === String(next.name || '').toLowerCase());
  if (idx >= 0) peers[idx] = next; else peers.push(next);
  return peers;
}

function validateName(name) {
  return typeof name === 'string' && NAME_RE.test(name.trim());
}

function validateMessage(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!validateName(from)) return { ok: false, error: 'from must match ^[a-z0-9_-]{1,32}$' };
  if (to !== '*' && !validateName(to)) return { ok: false, error: 'to must match ^[a-z0-9_-]{1,32}$ or be *' };
  const kind = typeof body.kind === 'string' ? body.kind.trim().toLowerCase() : '';
  if (!KINDS.has(kind)) return { ok: false, error: 'kind must be one of message | question | job' };
  const text = typeof body.text === 'string' ? body.text : '';
  if (text.trim().length === 0) return { ok: false, error: 'text must be non-empty' };
  if (text.length > 32768) return { ok: false, error: 'text must be at most 32768 characters' };
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomBytes(16).toString('hex');
  if (!ID_RE.test(id) || id.length > 64) return { ok: false, error: 'id must be 1-64 hex characters' };
  const timestamp = Number.isFinite(body.timestamp) ? Math.floor(body.timestamp) : Date.now();
  const thread = typeof body.thread === 'string' && body.thread.trim() ? body.thread.trim() : DEFAULT_THREAD;
  if (!/^[a-z0-9_-]{1,64}$/i.test(thread)) return { ok: false, error: 'thread must match ^[a-z0-9_-]{1,64}$' };
  return { ok: true, value: { from, to, kind, id, text, timestamp, thread } };
}

function appendOutbox(entry) {
  fs.appendFileSync(OUTBOX_FILE, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

function readOutbox() {
  try {
    return fs.readFileSync(OUTBOX_FILE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function clearOutboxFor(id) {
  const remaining = readOutbox().filter((entry) => entry.id !== id);
  if (remaining.length === readOutbox().length) return false;
  atomicWrite(OUTBOX_FILE, remaining.length ? `${remaining.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '');
  return true;
}

function threadFile(thread) {
  return path.join(THREADS_DIR, `${thread}.jsonl`);
}

function readThread(thread) {
  try {
    return fs.readFileSync(threadFile(thread), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function listThreads() {
  try {
    return fs.readdirSync(THREADS_DIR).filter((name) => name.endsWith('.jsonl')).map((name) => name.slice(0, -6)).sort();
  } catch {
    return [];
  }
}

function appendThread(thread, message) {
  fs.appendFileSync(threadFile(thread), `${JSON.stringify(message)}\n`, { mode: 0o600 });
}

function readJsonBody(req, limit = 32768) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let chunks = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(new Error('body too large')); return; }
      chunks += chunk;
    });
    req.on('end', () => {
      if (!chunks.trim()) return resolve({});
      try { resolve(JSON.parse(chunks)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function auth(req, token, peers) {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) {
    const supplied = match[1].trim();
    if (safeEqual(supplied, token)) return { ok: true, as: 'master' };
    for (const peer of peers) {
      if (peer.token && safeEqual(supplied, peer.token)) return { ok: true, as: `peer:${peer.name}` };
    }
  }
  return { ok: false };
}

function sendJson(res, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function peerDeliver(peer, message, thread) {
  return new Promise((resolve) => {
    try {
      const url = new URL(peer.address);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return resolve({ ok: false, error: 'address must be http(s) URL' });
      const body = Buffer.from(JSON.stringify({ thread, ...message }), 'utf8');
      const req = http.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname === '/' ? '/messages' : url.pathname,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': body.length,
          authorization: `Bearer ${peer.token}`,
        },
        timeout: 8000,
      }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (error) => resolve({ ok: false, error: error.message }));
      req.write(body);
      req.end();
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

export function createHub({ root = DATA_ROOT } = {}) {
  ensureRoot();
  return {
    root,
    tokenFile: path.join(root, 'token'),
    peersFile: path.join(root, 'peers.json'),
    threadsDir: path.join(root, 'threads'),
    outboxFile: path.join(root, 'outbox.jsonl'),
  };
}

function rebind(paths) {
  DATA_ROOT = paths.root;
  TOKEN_FILE = paths.tokenFile;
  PEERS_FILE = paths.peersFile;
  THREADS_DIR = paths.threadsDir;
  OUTBOX_FILE = paths.outboxFile;
}

export function status({ root } = {}) {
  if (root) rebind(createHub({ root }));
  ensureRoot();
  const token = readToken();
  return {
    root: DATA_ROOT,
    tokenPresent: Boolean(token),
    peers: loadPeers().map((peer) => ({ name: peer.name, address: peer.address, kinds: peer.kinds || ['message', 'question', 'job'] })),
    threads: listThreads(),
    outbox: readOutbox(),
  };
}

export async function serve({ port = 4317, host = '127.0.0.1', root } = {}) {
  if (root) rebind(createHub({ root }));
  ensureRoot();
  const token = loadToken();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const peers = loadPeers();
    const authResult = auth(req, token, peers);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true, name: 'agent-hub', version: 1, threads: listThreads().length });
      return;
    }

    if (!authResult.ok) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      const body = await readJsonBody(req).catch((error) => ({ error: error.message }));
      if (body.error) { sendJson(res, 400, { ok: false, error: body.error }); return; }
      const name = String(body.name || '').trim();
      if (!validateName(name)) { sendJson(res, 400, { ok: false, error: 'name must match ^[a-z0-9_-]{1,32}$' }); return; }
      const address = String(body.address || '').trim();
      let parsed;
      try { parsed = new URL(address); } catch { sendJson(res, 400, { ok: false, error: 'address must be an absolute http(s) URL' }); return; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { sendJson(res, 400, { ok: false, error: 'address must be http(s)' }); return; }
      const peerToken = typeof body.token === 'string' ? body.token.trim() : '';
      if (peerToken.length < 16) { sendJson(res, 400, { ok: false, error: 'peer token must be at least 16 characters' }); return; }
      const kinds = Array.isArray(body.kinds) && body.kinds.every((k) => KINDS.has(String(k).toLowerCase()))
        ? body.kinds.map((k) => String(k).toLowerCase())
        : ['message', 'question', 'job'];
      const next = { name: name.toLowerCase(), address, token: peerToken, kinds, registeredAt: Date.now() };
      savePeers(upsertPeer(peers, next));
      sendJson(res, 200, { ok: true, name: next.name, address: next.address, kinds: next.kinds });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/peers') {
      sendJson(res, 200, { ok: true, peers: peers.map((peer) => ({ name: peer.name, address: peer.address, kinds: peer.kinds, registeredAt: peer.registeredAt, last: peer.last || null })) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/outbox') {
      sendJson(res, 200, { ok: true, outbox: readOutbox() });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/threads/')) {
      const thread = decodeURIComponent(url.pathname.slice('/threads/'.length));
      if (!/^[a-z0-9_-]{1,64}$/i.test(thread)) { sendJson(res, 400, { ok: false, error: 'invalid thread id' }); return; }
      sendJson(res, 200, { ok: true, thread, messages: readThread(thread) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const body = await readJsonBody(req).catch((error) => ({ error: error.message }));
      if (body.error) { sendJson(res, 400, { ok: false, error: body.error }); return; }
      const check = validateMessage(body);
      if (!check.ok) { sendJson(res, 400, { ok: false, error: check.error }); return; }
      const message = check.value;
      appendThread(message.thread, message);
      const targets = message.to === '*'
        ? peers.filter((peer) => peer.name !== message.from)
        : peers.filter((peer) => peer.name === message.to);
      const results = await Promise.all(targets.map((peer) => peerDeliver(peer, message, message.thread)));
      const delivered = results.filter((r) => r.ok).length;
      const queuedFor = targets.filter((_, i) => !results[i].ok);
      for (const [peer, result] of targets.map((peer, i) => [peer, results[i]])) {
        if (!result.ok) appendOutbox({ id: message.id, thread: message.thread, to: peer.name, message });
      }
      sendJson(res, 200, { ok: true, id: message.id, delivered, queued: queuedFor.length, thread: message.thread });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => resolve({ server, port, host }));
  });
}

function cmdStatus() {
  const s = status();
  console.log('agent-hub');
  console.log(`root: ${s.root}`);
  console.log(s.tokenPresent ? 'token: present (value not printed)' : 'token: MISSING');
  console.log(`peers: ${s.peers.length}`);
  for (const p of s.peers) console.log(`  - ${p.name} @ ${p.address} kinds=${(p.kinds || []).join(',')}`);
  console.log(`threads: ${s.threads.length} (${s.threads.join(', ')})`);
  console.log(`outbox: ${s.outbox.length} pending`);
}

function cmdShow(thread) {
  const messages = readThread(thread);
  for (const message of messages) {
    const stamp = new Date(message.timestamp).toISOString();
    console.log(`[${message.kind}] ${stamp} ${message.from} → ${message.to}`);
    console.log(message.text);
    console.log('---');
  }
  if (messages.length === 0) console.log('(thread empty or missing)');
}

function cmdList() {
  for (const name of listThreads()) console.log(name);
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'help';
  if (cmd === 'serve') {
    const portFlag = args.indexOf('--port');
    const hostFlag = args.indexOf('--host');
    const port = portFlag >= 0 ? Number(args[portFlag + 1]) : Number(process.env.RAMO_AGENT_HUB_PORT || 4317);
    const host = hostFlag >= 0 ? args[hostFlag + 1] : (process.env.RAMO_AGENT_HUB_HOST || '127.0.0.1');
    console.log(`agent-hub listening on ${host}:${port}`);
    serve({ port, host }).catch((error) => { console.error(`hub failed to start: ${error.message}`); process.exit(1); });
    return;
  }
  if (cmd === 'status') return cmdStatus();
  if (cmd === 'list') return cmdList();
  if (cmd === 'show') return cmdShow(args[1] || DEFAULT_THREAD);
  if (cmd === 'send') {
    const [, to, kind, ...rest] = args;
    const text = rest.join(' ');
    if (!to || !kind) { console.error('usage: send <to> <kind> <text>'); process.exit(1); }
    ensureRoot();
    const message = { from: process.env.RAMO_AGENT_NAME || 'ramo', to, kind, text, id: crypto.randomBytes(16).toString('hex'), timestamp: Date.now(), thread: DEFAULT_THREAD };
    appendThread(DEFAULT_THREAD, message);
    console.log(JSON.stringify({ ok: true, id: message.id }));
    return;
  }
  console.log('agent hub: serve | status | list | show [thread] | send <to> <kind> <text>');
}

const isDirectRun = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isDirectRun || process.argv[1].endsWith('hub.mjs')) main();
