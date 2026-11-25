import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installWork } = require('../app/work/main.cjs');

function fixture(models, tiers = {}, api = []) {
  const manager = {
    probe: async () => ({ ready: false }),
    profileSummary: () => [{ id: 'qwen36', kind: 'llama', model: 'configured-moe', port: 8091, context: 24576 }, { id: 'custom', kind: 'llama', model: 'local-extra', port: 8092, context: 16384 }],
    get: () => ({ port: 11434 }),
    listOllamaModels: async () => ({ online: true, models }),
  };
  const app = { getPath: () => path.resolve('evidence/model-profile'), on() {} };
  return installWork({ app, ipcMain: { handle() {} }, manager, apiProviders: { list: () => api, setup: () => ({ tiers, complete: true, ollamaPort: 11434 }) } });
}

test('detected Ollama models fill all tiers by parameter size and keep custom profiles', async () => {
  const work = fixture([{ name: 'mid:7b', parameters: '7B' }, { name: 'large:35b', parameters: '35B' }, { name: 'tiny:1b', parameters: '1B' }]);
  const models = await work.models();
  assert.equal(models.find((m) => m.tier === 'fast').model, 'tiny:1b');
  assert.equal(models.find((m) => m.tier === 'smart').model, 'mid:7b');
  assert.equal(models.find((m) => m.tier === 'superSmart').model, 'large:35b');
  assert.ok(models.some((m) => m.id === 'custom'));
  assert.ok(models.some((m) => m.id === 'qwen36'));
});

test('known models remain preferred and explicit tier assignments win when installed', async () => {
  const installed = [{ name: 'heretic-4b-vision', parameters: '4B' }, { name: 'heretic-9b-vision', parameters: '9B' }, { name: 'other:32b', parameters: '32B' }];
  const preferred = await fixture(installed).models();
  assert.equal(preferred.find((m) => m.tier === 'fast').model, 'heretic-4b-vision');
  assert.equal(preferred.find((m) => m.tier === 'smart').model, 'heretic-9b-vision');
  const assigned = await fixture(installed, { fast: 'other:32b', smart: 'heretic-4b-vision', superSmart: 'heretic-9b-vision' }).models();
  assert.equal(assigned.find((m) => m.tier === 'fast').model, 'other:32b');
  assert.equal(assigned.find((m) => m.tier === 'smart').model, 'heretic-4b-vision');
  assert.equal(assigned.find((m) => m.tier === 'superSmart').model, 'heretic-9b-vision');
});

test('cloud API profiles can own every tier without Ollama', async () => {
  const api = [{ id: 'api-fast', name: 'Cloud fast' }, { id: 'api-smart', name: 'Cloud smart' }, { id: 'api-super', name: 'Cloud super' }];
  const models = await fixture([], { fast: 'api:api-fast', smart: 'api:api-smart', superSmart: 'api:api-super' }, api).models();
  for (const tier of ['fast', 'smart', 'superSmart']) {
    assert.equal(models.find((m) => m.tier === tier).kind, 'api');
  }
  assert.equal(models.find((m) => m.tier === 'fast').label, 'Fast');
  assert.equal(models.find((m) => m.tier === 'superSmart').profileId, 'api-super');
});

test('missing installations and stale assignments do not break registry creation', async () => {
  const models = await fixture([], { fast: 'not-installed', smart: 'also-missing' }).models();
  assert.equal(models.find((m) => m.tier === 'fast'), undefined);
  assert.equal(models.find((m) => m.tier === 'smart'), undefined);
  assert.equal(models.find((m) => m.tier === 'superSmart'), undefined);
  assert.ok(models.some((m) => m.id === 'qwen36'));
});
