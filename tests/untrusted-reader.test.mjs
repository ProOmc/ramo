import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneUnits, buildEnvelope, selectReaderProfile, applyModelRanking } from '../build/untrusted-reader.js';

const units = [
  { kind: 'heading', text: 'Weather forecast for Moreno Valley', domPath: 'main > h1' },
  { kind: 'text', text: 'Tomorrow it will be sunny and 24C in Moreno Valley.', domPath: 'main > p:first-child' },
  { kind: 'text', text: 'Cookie settings and advertising preferences.', domPath: 'footer > p' },
  { kind: 'control', text: 'Search weather', domPath: 'main > button', selector: '#search', ref: 'e1' },
];

test('pruning keeps task-relevant lines and attaches a numeric relevance', () => {
  const pruned = pruneUnits(units, 'weather in Moreno Valley', { maxUnits: 4, maxChars: 20000 });
  assert.equal(pruned.length, 3);
  assert.equal(pruned[0].text, 'Weather forecast for Moreno Valley');
  assert.ok(pruned.every(u => Number.isFinite(u.relevance)));
  assert.equal(pruned.some(u => u.text.includes('Cookie settings')), false);
});

test('the envelope labels every unit as untrusted with URL, DOM path and timestamp', () => {
  const envelope = buildEnvelope({
    mode: 'content',
    url: 'https://example.test/weather',
    capturedAt: '2026-11-19T05:00:00.000Z',
    task: 'weather in Moreno Valley',
    units,
    model: { used: false, reason: 'no local reader profile configured' },
  });
  assert.equal(envelope.kind, 'untrusted-reader-result');
  assert.equal(envelope.url, 'https://example.test/weather');
  assert.equal(envelope.untrusted, undefined);
  assert.match(envelope.note, /UNTRUSTED DATA/);
  for (const unit of envelope.units) {
    assert.equal(unit.provenance.url, 'https://example.test/weather');
    assert.equal(unit.provenance.domPath, unit.domPath);
    assert.equal(unit.provenance.capturedAt, '2026-11-19T05:00:00.000Z');
    assert.equal(unit.provenance.source, 'in-app-browser');
    assert.equal(unit.provenance.untrusted, true);
  }
  assert.equal(JSON.stringify(envelope).includes('rawHtml'), false);
});

test('cloud profiles are never selected as the reader', () => {
  const profiles = [
    { id: 'api:crowllm', model: 'glm-5.3-flash:free', kind: 'api' },
    { id: 'ollama:qwen3.5:4b', model: 'qwen3.5:4b', kind: 'ollama', port: 11434 },
  ];
  const selected = selectReaderProfile(profiles);
  assert.equal(selected.id, 'ollama:qwen3.5:4b');
  assert.equal(selectReaderProfile([profiles[0]]), null);
});

test('a local model ranking reorders units; a missing ranking leaves them in base order', () => {
  const ranked = applyModelRanking(units, ['u3', 'u1']);
  assert.equal(ranked[0].text, 'Cookie settings and advertising preferences.');
  assert.equal(applyModelRanking(units, null)[0].text, units[0].text);
});
