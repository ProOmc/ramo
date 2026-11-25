/**
 * Draft → run → patch → re-run through the shipped worker and kernel.
 * The model is a fixture; the check command and the approval decision travel
 * the real host path. Semantic judgement is not claimed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkService } = require('../app/work/service.cjs');

const chunk = (onChunk, text) => onChunk({ choices: [{ delta: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } });
const call = (onChunk, name, args, id) => onChunk({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });

async function waitFor(check, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('condition not met');
}

test('a failed check is described to the model and a targeted patch passes the re-run', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-repair-'));
  const cwd = path.join(tmp, 'project');
  fs.mkdirSync(cwd);
  const dataDir = path.join(tmp, 'data');
  const model = { id: 'fixture', model: 'fixture', label: 'Fixture', context: 16384 };
  const checkCommand = "if ((Get-Content -Raw page.html) -match 'PASS') { 'OK' } else { throw 'The snake does not grow when it eats' }";
  const bodies = [];
  const decisions = [];
  let request = 0;
  const service = new WorkService({
    appDir: path.resolve('app'), dataDir, models: async () => [model], hostTool: async () => ({ ok: true }),
    chat: async (_model, body, { onChunk }) => {
      bodies.push(body);
      request += 1;
      if (request === 1) call(onChunk, 'write', { path: 'page.html', content: 'FAIL' }, 'c1');
      else if (request === 2) chunk(onChunk, 'Draft ready.');
      else if (request === 3) call(onChunk, 'edit', { path: 'page.html', edits: [{ oldText: 'FAIL', newText: 'PASS' }] }, 'c2');
      else chunk(onChunk, 'Fixed.');
    },
  });
  const events = [];
  service.on('event', (event) => {
    events.push(event);
    if (event.type === 'ui_request' && event.method === 'permission') {
      decisions.push(event.decision ?? null);
      void service.request('uiResponse', { id: event.id, value: { decision: 'once', approved: true } });
    }
  });
  t.after(async () => { await service.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  await service.request('open', { cwd, trusted: true, permission: 'ask', mode: 'project', model: 'fixture', repair: { command: checkCommand, maxRounds: 2 } });
  await service.request('prompt', { text: 'Build the page and fix it if the check fails.' });
  await waitFor(() => events.some((event) => event.type === 'repair_check' && event.passed));

  assert.equal(fs.readFileSync(path.join(cwd, 'page.html'), 'utf8'), 'PASS');
  const checks = events.filter((event) => event.type === 'repair_check');
  assert.ok(checks.length >= 2, 'a failed check and a passing re-run were both reported');
  assert.equal(checks[0].passed, false);
  assert.match(checks[0].summary, /does not grow when it eats/);
  assert.equal(checks.at(-1).passed, true);
  assert.equal(checks.at(-1).oneShot, 'Draft ready.');
  assert.equal(checks.at(-1).final, 'Fixed.');
  assert.ok(decisions.length >= 2, 'both mutations were approved by the interface');
  const followUp = JSON.stringify(bodies[2].messages);
  assert.match(followUp, /does not grow when it eats/);
  assert.ok(!/Get-Content/.test(followUp), 'the check source was not handed back to the model');
});
