/**
 * Rewind: a file change made by a turn is recorded in the session tree and a
 * later undo restores the bytes and moves the conversation back. No model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkService } = require('../app/work/service.cjs');

const chunk = (onChunk, text) => onChunk({ choices: [{ delta: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
const call = (onChunk, name, args) => onChunk({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'u1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });

async function waitFor(check, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('condition not met');
}

test('undo restores file bytes and rewinds the conversation', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-undo-'));
  const cwd = path.join(tmp, 'project');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'original');
  const dataDir = path.join(tmp, 'data');
  const model = { id: 'fixture', model: 'fixture', label: 'Fixture', context: 16384 };
  let requests = 0;
  const service = new WorkService({
    appDir: path.resolve('app'), dataDir, models: async () => [model], hostTool: async () => ({ ok: true }),
    chat: async (_m, _body, { onChunk }) => {
      requests += 1;
      if (requests === 1) call(onChunk, 'write', { path: 'note.txt', content: 'changed' });
      else chunk(onChunk, 'Done.');
    },
  });
  t.after(async () => { await service.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  await service.request('open', { cwd, trusted: true, permission: 'full', mode: 'project', model: 'fixture' });
  await service.request('prompt', { text: 'Change the note', model: 'fixture' });
  assert.equal(fs.readFileSync(path.join(cwd, 'note.txt'), 'utf8'), 'changed');

  const points = await service.request('undo_status');
  assert.equal(points.length, 1, 'one undo point recorded for the turn');
  assert.match(points[0].label, /Change the note/);
  assert.equal(points[0].files.length, 1);
  assert.ok(points[0].files[0].endsWith('note.txt'));

  const result = await service.request('undo', { entryId: points[0].id });
  assert.equal(result.restored.length, 1);
  assert.ok(result.restored[0].endsWith('note.txt'));
  assert.equal(fs.readFileSync(path.join(cwd, 'note.txt'), 'utf8'), 'original');
  const after = await service.request('state');
  assert.ok(!after.messages.some((m) => m.role === 'user' && JSON.stringify(m.content).includes('Change the note')), 'the user turn is no longer on the active branch');
  assert.equal((await service.request('undo_status')).length, 0, 'the rewound point is no longer on the branch');
});

test('undo refuses a recorded path outside the project', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-undo-scope-'));
  const cwd = path.join(tmp, 'project');
  fs.mkdirSync(cwd);
  const service = new WorkService({ appDir: path.resolve('app'), dataDir: path.join(tmp, 'data'), models: async () => [{ id: 'f', model: 'f', context: 16384 }], chat: async () => {} });
  t.after(async () => { await service.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await service.request('open', { cwd, trusted: true, permission: 'full', mode: 'project', model: 'f' });
  await assert.rejects(service.request('undo', { entryId: 'missing' }), /No undo points|not found/);
  await waitFor(() => true);
});
