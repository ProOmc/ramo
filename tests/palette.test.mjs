/** Command/skill palette lists user-level prompt templates in Chat and project sessions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkService } = require('../app/work/service.cjs');

test('palette exposes prompts and skills without enabling project resources in Chat', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-palette-'));
  const cwd = path.join(tmp, 'project');
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(path.join(dataDir, 'agent', 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'agent', 'skills', 'review', ), { recursive: true });
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(dataDir, 'agent', 'prompts', 'ship.md'), '---\ndescription: Ship the change\nargument-hint: <target>\n---\nShip $ARGUMENTS\n');
  fs.writeFileSync(path.join(dataDir, 'agent', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review a diff\n---\nReview carefully.\n');
  fs.mkdirSync(path.join(cwd, '.pi', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.pi', 'prompts', 'secret-project.md'), 'project only\n');
  const service = new WorkService({ appDir: path.resolve('app'), dataDir, models: async () => [{ id: 'f', model: 'f', context: 16384 }], chat: async () => {} });
  t.after(async () => { await service.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await service.request('open', { cwd, trusted: true, mode: 'assistant', permission: 'ask', model: 'f' });
  const palette = await service.request('palette');
  assert.ok(palette.prompts.some((p) => p.name === 'ship' && /Ship the change/.test(p.description)), 'user prompt listed with description');
  assert.ok(palette.skills.some((s) => s.name === 'review' && /Review a diff/.test(s.description)), 'user skill listed with description');
  assert.ok(!palette.prompts.some((p) => p.name === 'secret-project'), 'project prompt not exposed in Chat');
});
