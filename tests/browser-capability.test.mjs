import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createBrowserCapabilities, browserOperationNames } from '../build/browser-capabilities.js';
const require = createRequire(import.meta.url);
const browserHost = require('../src/runtime/browser-host.cjs');

/** A gateway stand-in that records the typed operation and returns a result. */
function startGateway() {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: 'https://example.test/', text: 'page text' }));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

test('the host refuses non-http navigation and exposes no eval operation', () => {
  assert.deepEqual(browserHost.TOOLS, ['navigate', 'snapshot', 'click', 'type', 'read', 'screenshot', 'wait']);
  assert.equal(browserHost.TOOLS.includes('eval'), false);
  assert.equal(browserHost.safeUrl('https://example.test/a'), 'https://example.test/a');
  for (const value of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,x', 'about:blank', 'not a url']) {
    assert.throws(() => browserHost.safeUrl(value), /http\(s\)|http and https/, value);
  }
});

test('the host denies popups, external opens, notifications, display capture and media', () => {
  assert.deepEqual([...browserHost.DENIED_PERMISSIONS].sort(),
    ['display-capture', 'media', 'notifications', 'openExternal'].sort());
});

test('the browser exposes exactly seven typed operations and no eval', () => {
  assert.deepEqual(browserOperationNames(), [
    'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type',
    'browser_read', 'browser_screenshot', 'browser_wait',
  ]);
  const caps = createBrowserCapabilities({ baseUrl: 'http://127.0.0.1:1/v1', token: 't' });
  assert.equal(caps.length, 7);
  assert.equal(caps.some(c => /eval|javascript|execute_script/.test(c.name)), false);
  for (const cap of caps) {
    assert.equal(cap.parameters.type, 'object');
    assert.equal(cap.parameters.additionalProperties, false);
  }
});

test('the host sanitizer strips hidden, script, comments and markup locally', () => {
  const units = [
    { kind: 'text', text: '  Hello   <b>world</b> <!-- hidden --> ', domPath: 'body > p' },
    { kind: 'text', text: 'secret', hidden: true, domPath: 'body > div' },
    { kind: 'text', text: 'script alert(1)', domPath: 'body > script' },
    { kind: 'control', text: 'Search', domPath: 'body > button', selector: '#search' },
    { kind: 'bad', text: 'nope', domPath: 'body' },
  ];
  const clean = browserHost.sanitizeUnits(units);
  assert.deepEqual(clean.map(u => u.text), ['Hello world', 'Search']);
  assert.equal(clean[0].domPath, 'body > p');
});

test('reader schemas declare task and expose no arbitrary code', () => {
  const caps = createBrowserCapabilities({ baseUrl: 'http://127.0.0.1:1/v1', token: 't' });
  for (const name of ['browser_read', 'browser_snapshot']) {
    const params = caps.find(c => c.name === name).parameters;
    assert.equal(params.properties.task.type, 'string');
    assert.equal(params.properties.maxUnits.type, 'integer');
    assert.equal(params.additionalProperties, false);
    assert.equal(JSON.stringify(params).includes('eval'), false);
  }
});

test('read operations are read-only, writes are not, and each declares strict arguments', () => {
  const caps = createBrowserCapabilities({ baseUrl: 'http://127.0.0.1:1/v1', token: 't' });
  const byName = new Map(caps.map(c => [c.name, c]));
  for (const name of ['browser_snapshot', 'browser_read', 'browser_screenshot', 'browser_wait']) {
    assert.equal(byName.get(name).readOnly, true, name);
  }
  for (const name of ['browser_navigate', 'browser_click', 'browser_type']) {
    assert.notEqual(byName.get(name).readOnly, true, name);
  }
  assert.deepEqual(byName.get('browser_navigate').parameters.required, ['url']);
  assert.deepEqual(byName.get('browser_type').parameters.required, ['ref', 'text']);
});

test('the reader capabilities use the /reader route and never expose raw DOM', async () => {
  const { server, seen, port } = await startGateway();
  try {
    const caps = createBrowserCapabilities({ baseUrl: `http://127.0.0.1:${port}/v1`, token: 'secret' });
    const snap = caps.find(c => c.name === 'browser_snapshot');
    const result = await snap.execute('call-1', { task: 'find weather', maxUnits: 5 });
    assert.equal(result.isError, undefined);
    assert.equal(result.details.kind, 'untrusted-reader-result');
    assert.equal(result.details.untrusted === undefined, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/reader');
    assert.equal(seen[0].auth, 'Bearer secret');
    assert.deepEqual(seen[0].body, { mode: 'controls', args: { mode: 'controls', task: 'find weather', maxUnits: 5 } });
    assert.equal(JSON.stringify(result).includes('page text'), false);
    assert.equal(JSON.stringify(result).includes('<script'), false);
  } finally {
    server.close();
  }
});

test('a failed gateway call is reported as an error the model can see', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(502); res.end('bad gateway'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const cap = createBrowserCapabilities({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, token: 't' })
      .find(c => c.name === 'browser_read');
    const result = await cap.execute('call-2', {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /browser_read failed/);
  } finally {
    server.close();
  }
});
