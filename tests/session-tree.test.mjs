/** Session timeline: the worker exposes the tree and can navigate to an earlier entry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkService } = require('../app/work/service.cjs');

const chunk = (onChunk, text) => onChunk({ choices: [{ delta: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 } });

test('tree lists turns and navigateTree moves the active branch', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-tree-'));
  const cwd = path.join(tmp, 'project');
  fs.mkdirSync(cwd);
  const service = new WorkService({
    appDir: path.resolve('app'), dataDir: path.join(tmp, 'data'),
    models: async () => [{ id: 'f', model: 'f', context: 16384 }],
    chat: async (_m, _body, { onChunk }) => chunk(onChunk, 'Answer.'),
  });
  t.after(async () => { await service.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await service.request('open', { cwd, trusted: true, permission: 'full', mode: 'project', model: 'f' });
  await service.request('prompt', { text: 'First question', model: 'f' });
  await service.request('prompt', { text: 'Second question', model: 'f' });
  const tree = await service.request('tree');
  const all = [];
  const walk = (list) => { for (const node of list) { all.push(node); walk(node.children ?? []); } };
  walk(tree);
  const messages = all.filter((node) => node.entry.type === 'message');
  assert.ok(messages.length >= 4, 'user and assistant entries are in the tree');
  assert.ok(messages.some((node) => JSON.stringify(node.entry.message?.content).includes('First question')));
  const firstUser = messages.find((node) => node.entry.message?.role === 'user' && JSON.stringify(node.entry.message?.content).includes('First question'));
  assert.ok(firstUser, 'first user entry found');
  const before = await service.request('state');
  await service.request('navigateTree', { entryId: firstUser.entry.id });
  const after = await service.request('state');
  assert.ok(after.messages.length < before.messages.length, 'the active branch moved back');
});
