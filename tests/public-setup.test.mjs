import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { RamoApiProviders } = require('../src/native/ramo-api-providers.js');

test('public setup persists only tier names and completion, never credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-public-setup-'));
  const store = new RamoApiProviders({ filePath: path.join(dir, 'providers.json'), fetchImpl: async () => { throw Error('offline'); } });
  assert.deepEqual(store.setup(), { tiers: {}, complete: false, ollamaPort: 11434 });
  store.saveSetup({ complete: true, tiers: { fast: 'small:1b', smart: 'mid:7b', superSmart: 'large:35b' }, apiKey: 'must-not-be-written' });
  assert.equal(store.setup().tiers.superSmart, 'large:35b');
  assert.equal(store.setup().complete, true);
  store.saveSetup({ complete: true, ollamaPort: 11440, tiers: { fast: 'api:cloud-fast' } });
  assert.equal(store.setup().ollamaPort, 11440);
  assert.ok(!fs.readFileSync(path.join(dir, 'providers.json'), 'utf8').includes('must-not-be-written'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a cloud model profile can reuse its provider key slot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-cloud-tier-'));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: async (value) => Buffer.from(value), decryptString: async (value) => Buffer.from(value).toString() };
  const store = new RamoApiProviders({ filePath: path.join(dir, 'providers.json'), safeStorage, fetchImpl: async () => { throw Error('offline'); } });
  await store.setKnown('openai', 'test-provider-key-12345');
  const profile = await store.save({ provider: 'openai', name: 'Cloud fast', model: 'model-id' });
  assert.equal(profile.provider, 'openai');
  assert.equal(profile.providerModel, 'model-id');
  assert.equal(profile.endpoint, RamoApiProviders.KNOWN.openai.endpoint);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('public provider slots include the major OpenAI-compatible services', () => {
  assert.deepEqual(Object.keys(RamoApiProviders.KNOWN).sort(), ['anthropic', 'gemini', 'nvidia', 'openai', 'openrouter']);
  assert.equal(RamoApiProviders.KNOWN.anthropic.auth, 'x-api-key');
});
