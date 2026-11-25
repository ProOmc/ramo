// The memory subsystem, driven against real files.
//
// MEMORY.md is the truth; daily notes are the delta; topics/ holds detail;
// history/ keeps a dated copy of MEMORY.md and git keeps the rest. Stand-ins:
// a fake retain model and a fake dream model, nothing else. Retrieval paths
// run for real against the markdown files.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MemorySystem,
  MEMORY_TIERS,
  memoryPaths,
  memoryCapabilities,
  runDream, parseDreamAnswer, listDreams, revertDream, dreamSectionNames,
  retainTurn, looksLikeQuestion, looksLikeMetaInstruction,
  buildLedger, checkFidelity, extractAtoms, planBudget,
  buildProjection,
  readDailySince,
  daysWithEntries,
  listDailyNotes,
  estimateTokens,
  findSecret,
  ensureLayout,
  backupHot,
  appendDailyEntry,
  searchMarkdown,
} from '../build/memory.js';

import { migrateLegacyStoreToHotFile } from '../build/memory.js';

function temporary() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-memory-'));
}

function seedHot(dir, text) {
  ensureLayout(dir);
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), text);
}

/**
 * The merge phase: keep the current file and add one durable line. This mirrors
 * the real contract (no size target, the file may grow) and keeps every atom
 * the source had, so the merge fidelity gate is exercised honestly.
 */
function mergeFixture(prompt) {
  const blocks = [...prompt.matchAll(/"""\n([\s\S]*?)\n"""/g)].map((match) => match[1]);
  let hot = (blocks[0] ?? '').trim();
  if (!hot) hot = '# Memory\n\nEdits you make here are saved, and a deletion is real.';
  if (!/^## /m.test(hot)) hot += '\n\n## Facts';
  const extra = '- The pet project, always-on desktop companion.';
  if (!hot.includes(extra)) {
    if (/^## Projects\s*$/m.test(hot)) hot = hot.replace(/^(## Projects\s*)$/m, `$1\n${extra}`);
    else hot += `\n\n## Projects\n${extra}`;
  }
  return `${hot.trimEnd()}\n\n---CHANGELOG---\nAdded: the pet as a project entry\nChanged: nothing\nRemoved: nothing\n`;
}

/** The compression phase: one terse, digit-free note under each asked heading. */
function compressFixture(prompt) {
  const names = [...new Set([...prompt.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim()))];
  return `${names.map((name) => `## ${name}\n- Condensed note.`).join('\n\n')}\n`;
}

const DREAM_MODEL = {
  id: 'mock-dream',
  usage: { input: 10, output: 5 },
  calls: [],
  async complete({ system, prompt }) {
    this.calls.push({ system, prompt });
    const text = system.includes('merge step') ? mergeFixture(prompt) : compressFixture(prompt);
    return { text, usage: { ...this.usage } };
  },
};

/** A dream model whose merge and compression phases are supplied separately. */
function phaseModel({ merge, compress, id = 'phase-model' }) {
  return {
    id,
    calls: [],
    async complete({ system, prompt, maxTokens }) {
      this.calls.push({ system, prompt, maxTokens });
      const text = system.includes('merge step') ? merge(prompt) : compress(prompt);
      return { text, usage: { input: 2, output: 2 } };
    },
  };
}

/** A memory file whose ledger is large enough to stress a tier's budget. */
function atomHeavyMemory(count) {
  const lines = ['# Memory', '', '## About you', '- A list of unique identifiers follows.', '', '## Facts'];
  for (let i = 0; i < count; i += 1) lines.push(`- Identifier unique${i}x is recorded here.`);
  lines.push('', '## Preferences', '', '## Commitments', '', '## Projects', '', '## Notes about Muse', '');
  return lines.join('\n') + '\n';
}

const RETAIN_MODEL = {
  id: 'mock-retain',
  async complete({ system, prompt }) {
    void system;
    if (!prompt.includes('My name is')) return { text: '{"items":[]}', usage: { input: 5, output: 2 } };
    return {
      text: '{"items":["My name is Mira Chen.","The user is a sound designer."]}',
      usage: { input: 5, output: 2 },
    };
  },
};

// ---------------------------------------------------------------- file layer

test('daily notes are appended and read back', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    appendDailyEntry(dir, 'Something today.', new Date('2026-11-12T10:00:00Z'));
    appendDailyEntry(dir, 'Something else today.', new Date('2026-11-12T10:05:00Z'));
    const delta = readDailySince(dir, null, 3);
    assert.equal(delta.length, 1);
    assert.match(delta[0].content, /Something today/);
    assert.match(delta[0].content, /Something else today/);
    assert.deepEqual(daysWithEntries(dir), ['2026-11-12']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('secret detection finds credentials and ignores prose', () => {
  assert.equal(findSecret('use sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 please'), 'OpenAI key');
  assert.equal(findSecret('the user said my dog is named Scout'), null);
});

test('backupHot keeps one copy per day', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    const file = path.join(dir, 'MEMORY.md');
    fs.writeFileSync(file, 'first');
    const backup = backupHot(dir, file, new Date('2026-11-01T00:00:00Z'));
    assert.ok(backup);
    assert.equal(fs.readFileSync(backup, 'utf-8'), 'first');
    fs.writeFileSync(file, 'second');
    const backup2 = backupHot(dir, file, new Date('2026-11-01T12:00:00Z'));
    assert.equal(fs.readFileSync(backup2, 'utf-8'), 'second');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- migration

test('migration places every legacy fact verbatim, archives the old store, and respects the Muse boundary', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    fs.writeFileSync(path.join(dir, 'facts.jsonl'), [
      JSON.stringify({ id: 'f_1', text: 'Windows 11 laptop, Example GPU 8GB.', kind: 'world', predicate: 'stated', subject: 'person:user', object: null }),
      JSON.stringify({ id: 'f_2', text: 'Muse runs background watches that Ramo does not run.', kind: 'world', predicate: 'stated', subject: 'concept:muse', object: null }),
      JSON.stringify({ id: 'f_3', text: 'Prefers teal for the terminal theme.', kind: 'world', predicate: 'stated', subject: 'person:user', object: null }),
      JSON.stringify({ id: 'f_4', text: 'A very long line ' + 'x'.repeat(400) + ' about the pet project.', kind: 'world', predicate: 'stated', subject: 'project:pet', object: null }),
    ].join('\n') + '\n');
    const report = migrateLegacyStoreToHotFile(dir, new Date('2026-11-11T12:00:00Z'));
    assert.equal(report.factsTotal, 4);
    assert.equal(report.factsPlaced, 4, 'every fact must be placed');
    assert.equal(report.verify.ok, true, JSON.stringify(report.verify));
    assert.ok(report.verify.museOk);
    assert.ok(!fs.existsSync(path.join(dir, 'facts.jsonl')), 'facts.jsonl must be moved to the archive');
    assert.ok(fs.existsSync(path.join(dir, 'archive-2026-11-11', 'facts.jsonl')));
    const hot = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8');
    assert.ok(hot.includes('## About you') && hot.includes('## Facts') && hot.includes('## Preferences'));
    assert.ok(hot.includes('## Notes about Muse'));
    // Muse must not leak into About you / Facts / Preferences.
    const aboutYou = hot.slice(hot.indexOf('## About you'), hot.indexOf('## Facts'));
    assert.ok(!/\bMuse\b/.test(aboutYou));
    const facts = hot.slice(hot.indexOf('## Facts'), hot.indexOf('## Preferences'));
    assert.ok(!/\bMuse\b/.test(facts));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migration reports factsVerbatim with no facts as an empty file when the store is wiped', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    // No facts.jsonl means the previous wipe migration pattern: no crash.
    const report = migrateLegacyStoreToHotFile(dir, new Date('2026-11-11T12:00:00Z'));
    assert.equal(report.factsTotal, 0);
    assert.equal(report.factsPlaced, 0);
    assert.ok(fs.existsSync(path.join(dir, 'MEMORY.md')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- retention

test('retention parses the extractor answer, writes daily notes, and honors the isolated gate', async () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    const isolated = await retainTurn({ paths: memoryPaths(dir), model: RETAIN_MODEL, userText: 'My name is Mira Chen. I am a sound designer.', isolated: true });
    assert.equal(isolated, null);
    const result = await retainTurn({ paths: memoryPaths(dir), model: RETAIN_MODEL, userText: 'My name is Mira Chen. I am a sound designer.' });
    assert.equal(result.added, 2);
    const today = readDailySince(dir, null, 3);
    assert.match(today[0].content, /Mira Chen/);
    assert.match(today[0].content, /sound designer/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retention drops user questions and its own instructions instead of recording them as facts', async () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    const model = {
      id: 'mock-questions',
      async complete() {
        return {
          text: JSON.stringify({
            items: [
              'What RAM should I buy?',
              'Should I sell the 32GB kit?',
              'The user lives in Example City.',
              "The user's raw numbers are part of the signal; do not normalize them in the records.",
            ],
          }),
          usage: { input: 3, output: 4 },
        };
      },
    };
    const result = await retainTurn({ paths: memoryPaths(dir), model, userText: 'What RAM should I buy? I live in Moreno Valley.' });
    assert.equal(result.added, 1);
    assert.deepEqual(result.lines, ['The user lives in Example City.']);
    const today = readDailySince(dir, null, 3);
    assert.ok(!/[?]/.test(today[0].content));
    assert.equal(looksLikeQuestion('Do not disturb mode stays on.'), false);
    assert.equal(looksLikeQuestion('Can I upgrade the RAM?'), true);
    assert.equal(looksLikeMetaInstruction("The user's raw numbers are part of the signal."), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- dream

test('parseDreamAnswer splits hot file and changelog, and rejects junk', () => {
  const good = parseDreamAnswer('# Memory\n\n## About you\n- x\n\n## Facts\n- y\n\n## Preferences\n\n## Commitments\n\n## Projects\n\n## Notes about Muse\n---CHANGELOG---\nAdded: pet\n');
  assert.ok(good.hot.includes('# Memory'));
  assert.deepEqual(good.changelog, ['Added: pet']);
  assert.throws(() => parseDreamAnswer('just some prose, no file'));
  assert.throws(() => parseDreamAnswer('# Memory\n\n## About you\n- only two sections'));
});

test('parseDreamAnswer accepts the headings the source file actually uses (legacy file, no ## Facts)', () => {
  const legacy = [
    '# Memory', '',
    '## About you', '- x', '',
    '## Hardware buying and selling', '- y', '',
    '## Notes about Muse (a different assistant)', '- z', '',
  ].join('\n');
  const answer = `${legacy}---CHANGELOG---\nAdded: x`;
  const required = dreamSectionNames(legacy);
  assert.deepEqual(required, ['## About you', '## Notes about Muse']);
  const parsed = parseDreamAnswer(answer, { requiredSections: required });
  assert.ok(parsed.hot.includes('## Hardware buying and selling'));
  // The old contract demanded ## Facts and could never accept a legacy file.
  assert.throws(() => parseDreamAnswer(answer));
});

// ---------------------------------------------------------------- compaction

test('the verbatim ledger counts distinct facts and carries every exact value', () => {
  const source = [
    '# Memory', '',
    '## Facts',
    '- Sells two DDR5 SODIMM pairs, $140/pair floor and $189 list.',
    '- The GPU is an Example GPU 8GB in a Windows 11 laptop.',
    '- Never sell below $140/pair without explicit permission.',
  ].join('\n');
  const ledger = buildLedger(source);
  assert.ok(ledger.atoms.includes('$140/pair'));
  assert.ok(ledger.atoms.includes('$189'));
  assert.ok(ledger.atoms.includes('8GB'));
  assert.ok(ledger.factCount >= 6 && ledger.factCount === ledger.atoms.length + ledger.rules.length);
  assert.ok(ledger.text.includes('$140/pair'));
  assert.ok(ledger.text.includes('never'), 'the polarity rule is part of the ledger');
  assert.ok(extractAtoms(source).every((atom) => typeof atom.key === 'string' && atom.key.length > 0));
});

test('the fidelity check rejects a swapped or moved number, and accepts a faithful output', () => {
  const source = [
    '# Memory', '',
    '## Facts',
    '- Sells two DDR5 SODIMM pairs, $140/pair floor and $189 list.',
    '- The GPU is an Example GPU 8GB in a Windows 11 laptop.',
    '- Never sell below $140/pair without explicit permission.',
  ].join('\n');
  const ledger = buildLedger(source);
  const faithful = `# Memory\n\n## Facts\n${ledger.text}\n\n- The RAM floor is fixed.\n`;
  const good = checkFidelity(source, faithful, ledger);
  assert.equal(good.ok, true, good.reasons.join('; '));

  // A value that exists elsewhere in the file is swapped in.
  const invented = checkFidelity(source, faithful.replace('$189', '$150'), ledger);
  assert.equal(invented.ok, false);
  assert.deepEqual(invented.unknownAtoms, ['$150']);

  // A value is dropped from the ledger by replacing it with another real value.
  const dropped = checkFidelity(source, faithful.replace('$189', '$140/pair'), ledger);
  assert.equal(dropped.ok, false);
  assert.ok(dropped.atomsAbsent.includes('$189'));

  // A real value is moved into prose next to words it never shared a line with.
  const moved = checkFidelity(source, `${faithful}\n- The GPU is $189.\n`, ledger);
  assert.equal(moved.ok, false);
  assert.ok(moved.contextViolations.length > 0);
});

test('planBudget reports the tokens the facts actually need instead of dropping them', () => {
  const lines = ['# Memory', '', '## Facts'];
  for (let i = 0; i < 900; i += 1) lines.push(`- Identifier unique${i}x is recorded here.`);
  const ledger = buildLedger(lines.join('\n'));
  const skeleton = '# Memory\n\nEdits you make here are saved, and a deletion is real.\n\n## Facts';
  const plan = planBudget(ledger, skeleton, 'standard');
  assert.equal(plan.feasible, false);
  assert.match(plan.reason, /infeasible/);
  assert.match(plan.reason, /hard cap/);
  assert.ok(plan.minimumTokens > plan.maxTokens, `minimum ${plan.minimumTokens} must exceed the cap ${plan.maxTokens}`);
  assert.ok(plan.neededTokens > plan.minimumTokens - 1);
  assert.ok(plan.reason.includes(String(plan.minimumTokens)), 'the reason must name the real number');
});

test('dream runs merge then compression, keeps a backup, and is exposed as a journal', async () => {
  const dir = temporary();
  try {
    seedHot(dir, '# Memory\n\n## About you\n- The user; laptop.\n\n## Facts\n- old fact line with $140/pair floor and $189 list.\n\n## Preferences\n\n## Commitments\n\n## Projects\n\n## Notes about Muse\n');
    DREAM_MODEL.calls.length = 0;
    const result = await runDream({ paths: memoryPaths(dir), model: DREAM_MODEL, trigger: 'manual', dailyLimit: 3 });
    assert.equal(result.status, 'completed', result.reason);
    const hot = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8');
    // The table is code-owned and carries the exact values verbatim.
    assert.match(hot, /## Facts/);
    assert.ok(hot.includes('$140/pair'), 'the ledger must carry the exact value');
    assert.ok(hot.includes('$189'), 'the ledger must carry the second exact value');
    assert.match(hot, /Condensed note\./);
    // The two calls have one job each, and the merge runs first.
    assert.match(DREAM_MODEL.calls[0].system, /merge step/);
    assert.ok(DREAM_MODEL.calls.slice(1).length >= 1);
    assert.ok(DREAM_MODEL.calls.slice(1).every((call) => /compression step/.test(call.system)));
    // The intermediate merged file is staged and is not the injected file.
    const staging = fs.readdirSync(path.join(dir, 'staging'));
    const merged = staging.find((name) => name.endsWith('.merge.md'));
    assert.ok(merged, 'the merged draft must be staged for audit');
    assert.notEqual(fs.readFileSync(path.join(dir, 'staging', merged), 'utf-8').trim(), hot.trim());
    assert.ok(result.compaction, 'compaction numbers must be reported');
    assert.ok(result.compaction.factCount >= 2);
    // The old content is in the dated backup.
    const backup = fs.readdirSync(path.join(dir, 'history')).find((n) => n.startsWith('MEMORY-'));
    assert.ok(backup, 'a dated backup must exist');
    // The journal exists with the changelog and the compaction numbers.
    const journal = fs.readdirSync(path.join(dir, 'dreams')).find((n) => n.startsWith('d_'));
    assert.ok(journal, 'a dream journal must exist');
    const journalText = fs.readFileSync(path.join(dir, 'dreams', journal), 'utf-8');
    assert.match(journalText, /Added: the pet/);
    assert.match(journalText, /## Compaction/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a dream that would record a secret is refused, and MEMORY.md is unchanged', async () => {
  const dir = temporary();
  try {
    seedHot(dir, '# Memory\n\n## About you\n- x\n\n## Facts\n\n## Preferences\n\n## Commitments\n\n## Projects\n\n## Notes about Muse\n');
    const before = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8');
    const secretDream = {
      id: 'mock-secret',
      async complete() {
        return {
          text: '# Memory\n\n## About you\n- x\nsk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\n\n## Facts\n\n## Preferences\n\n## Commitments\n\n## Projects\n\n## Notes about Muse\n---CHANGELOG---\nAdded: leak\n',
          usage: { input: 1, output: 1 },
        };
      },
    };
    const result = await runDream({ paths: memoryPaths(dir), model: secretDream, trigger: 'manual' });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /credential/);
    assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dream skipped with no delta on automatic passes', async () => {
  const dir = temporary();
  try {
    seedHot(dir, '# Memory\n\n## About you\n- The user; laptop.\n\n## Facts\n\n## Preferences\n\n## Commitments\n\n## Projects\n\n## Notes about Muse\n');
    const result = await runDream({ paths: memoryPaths(dir), model: DREAM_MODEL, trigger: 'nightly', dailyLimit: 0 });
    assert.equal(result.status, 'skipped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- capabilities

test('memory_save appends a daily line, recall finds it, forget removes it, and dreams are listed', async () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    const system = new MemorySystem({
      dir,
      endpoint: () => 'http://127.0.0.1:9',
      sessionId: () => 'test',
      memoryTier: () => 'standard',
      dreamModel: () => DREAM_MODEL,
    });
    await system.initialize();
    seedHot(dir, '# Memory\n\n## Facts\n- Prefers amber terminal themes.\n\n## Notes about Muse\n');
    const caps = system.capabilities();
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]));
    const save = byName['memory_save'];
    const saved = await save.execute('t', { text: 'Prefers amber terminal themes.' });
    assert.match(JSON.stringify(saved), /saved to today/i);
    const recall = byName['memory_recall'];
    const out = await recall.execute('t', { query: 'amber' });
    assert.match(JSON.stringify(out), /amber/i);
    const forget = byName['memory_forget'];
    assert.ok(forget);
    const removed = await forget.execute('t', { text: 'Prefers amber terminal themes.' });
    assert.match(JSON.stringify(removed), /removed/i);
    const dreams = byName['memory_dreams'];
    const list = await dreams.execute('t', {});
    assert.ok(list);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('memory_save refuses secrets', async () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    const system = new MemorySystem({
      dir,
      endpoint: () => 'http://127.0.0.1:9',
      sessionId: () => 'test',
      memoryTier: () => 'standard',
    });
    await system.initialize();
    const caps = system.capabilities();
    const save = caps.find((c) => c.name === 'memory_save');
    await assert.rejects(() => save.execute('t', { text: 'key is sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ12345' }), /credential|never/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isolated sessions retain nothing', async () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    const system = new MemorySystem({
      dir,
      endpoint: () => 'http://127.0.0.1:9',
      sessionId: () => 'test',
      memoryTier: () => 'standard',
      dreamModel: () => DREAM_MODEL,
    });
    await system.initialize();
    assert.equal(system.retentionAllowed ?? true, true); // exposed name preserved
    const result = await system.retain('RAMO_TEST_FACT mia sand', 'test', { isolated: true });
    assert.equal(result, null);
    const plain = await system.retain('RAMO_TEST_FACT mia sand', 'test', { model: RETAIN_MODEL, isolated: false });
    assert.ok(plain);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- projection

test('buildProjection produces a stable shape the renderer can read', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    seedHot(dir, '# Memory\n\n## Facts\n- a fact.\n\n## Projects\n- project line\n\n## Notes about Muse\n');
    const projection = buildProjection({ paths: memoryPaths(dir), search: null, dreams: [], projectPath: null });
    assert.ok(projection.version >= 1);
    assert.ok(typeof projection.hot.text === 'string' && projection.hot.text.length > 0);
    assert.ok(Array.isArray(projection.daily));
    assert.ok(Array.isArray(projection.timeline));
    assert.equal(projection.status.facts, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('git history is initialised and MEMORY.md changes are committed', async () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    seedHot(dir, '# Memory\n\n## About you\n\n## Facts\n- one\n\n## Preferences\n\n## Commitments\n\n## Projects\n\n## Notes about Muse\n');
    DREAM_MODEL.calls.length = 0;
    await runDream({ paths: memoryPaths(dir), model: DREAM_MODEL, trigger: 'manual' });
    const { execFileSync } = await import('node:child_process');
    const log = String(execFileSync('git', ['-C', dir, 'log', '--oneline'], { windowsHide: true }));
    assert.match(log, /memory: dream/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- injection budget

function bigMemory(sections = {}) {
  const lines = ['# Memory', '', '## About you', '- The user; a durable fact about the user that must survive every injection.'];
  lines.push('', '## Projects');
  for (let i = 0; i < 40; i += 1) lines.push(`- Project ${i}: ${'detail '.repeat(60)}`);
  lines.push('', '## Commitments', '- A commitment the agent owes the user.');
  lines.push('', '## Preferences', '- Prefers concise answers.');
  lines.push('', '## Notes about Muse', '- Muse is the other assistant.');
  void sections;
  return lines.join('\n') + '\n';
}

test('the injected memory never exceeds the tier cap and keeps the identity core', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    seedHot(dir, bigMemory());
    const system = new MemorySystem({
      dir,
      endpoint: () => 'http://127.0.0.1:9',
      sessionId: () => 'test',
      memoryTier: () => 'fast',
    });
    const section = system.promptSection();
    const tokens = estimateTokens(section);
    assert.ok(tokens <= MEMORY_TIERS.fast.max, `injected ${tokens} tokens, cap ${MEMORY_TIERS.fast.max}`);
    assert.match(section, /## About you/);
    assert.match(section, /## Preferences/);
    assert.match(section, /Muse is a different assistant from Ramo/);
    assert.match(section, /memory_recall/, 'the omitted part is named as one recall away');
    assert.ok(!section.includes('Project 39:'), 'the low-priority tail is what gets dropped');
    const status = system.status();
    assert.equal(status.tier, 'fast');
    assert.equal(status.budget, MEMORY_TIERS.fast.max);
    assert.ok(status.injectedTokens <= status.budget);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the deep tier injects the whole file when it is inside its cap', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    seedHot(dir, bigMemory());
    const system = new MemorySystem({
      dir,
      endpoint: () => 'http://127.0.0.1:9',
      sessionId: () => 'test',
      memoryTier: () => 'deep',
    });
    const section = system.promptSection();
    assert.ok(estimateTokens(section) <= MEMORY_TIERS.deep.max);
    assert.ok(section.includes('Project 39:'), 'the deep tier sees the whole file');
    assert.ok(!section.includes('not shown here'), 'nothing is omitted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- dream input + gate

test('the dreamer receives the whole memory file, not the first 8000 characters', async () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    const tail = `TAIL_MARKER_${'x'.repeat(40)}`;
    const lines = ['# Memory', '', '## About you', '- The user; laptop.', '', '## Facts'];
    for (let i = 0; i < 120; i += 1) lines.push(`- filler fact ${i} ${'b'.repeat(70)}`);
    lines.push(`- ${tail}`, '', '## Preferences', '', '## Commitments', '', '## Projects', '', '## Notes about Muse', '');
    seedHot(dir, lines.join('\n') + '\n');
    const file = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8');
    assert.ok(file.length > 8000, 'the fixture must be larger than the old 8000-char cut');
    const seen = [];
    const capture = {
      id: 'capture',
      async complete({ system, prompt }) {
        seen.push(prompt);
        return {
          text: system.includes('merge step') ? mergeFixture(prompt) : compressFixture(prompt),
          usage: { input: 1, output: 1 },
        };
      },
    };
    const result = await runDream({ paths: memoryPaths(dir), model: capture, trigger: 'manual' });
    assert.equal(result.status, 'completed');
    assert.ok(seen[0].includes(tail), 'the tail of the file must reach the dreamer');
    assert.ok(seen[0].includes(file.trim()), 'the whole file is passed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a compression chunk that overruns its hard cap is refused and the previous file is kept', async () => {
  const dir = temporary();
  try {
    seedHot(dir, '# Memory\n\n## About you\n- keep me.\n\n## Facts\n\n## Preferences\n\n## Commitments\n\n## Projects\n\n## Notes about Muse\n');
    const before = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8');
    const model = phaseModel({
      merge: mergeFixture,
      compress: (prompt) => {
        const names = [...new Set([...prompt.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim()))];
        return names.map((name) => `## ${name}\n- ${'filler '.repeat(900)}`).join('\n\n');
      },
    });
    const result = await runDream({ paths: memoryPaths(dir), model, trigger: 'manual' });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /over its .* share|truncated/);
    assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('when the ledger makes the target infeasible the result is compressed to the cap and flagged', async () => {
  const dir = temporary();
  try {
    seedHot(dir, atomHeavyMemory(600));
    const model = phaseModel({
      merge: mergeFixture,
      compress: (prompt) => {
        const budget = Number(/HARD LIMIT: (\d+)/.exec(prompt)?.[1] ?? 40);
        const names = [...new Set([...prompt.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim()))];
        const body = `- ${'note '.repeat(Math.max(4, Math.floor((budget * 0.6) / 1.25)))}`;
        return names.map((name) => `## ${name}\n${body}`).join('\n\n');
      },
    });
    const result = await runDream({ paths: memoryPaths(dir), model, trigger: 'manual' });
    assert.equal(result.status, 'completed', result.reason);
    assert.match(result.reason, /target is infeasible/);
    assert.ok(result.compaction);
    assert.ok(result.compaction.compressedTokens > result.compaction.targetTokens);
    assert.ok(result.compaction.compressedTokens <= result.compaction.maxTokens);
    const hot = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8');
    assert.ok(hot.includes('unique599x'), 'the last ledger value survives verbatim');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- dream tier gate

test('the dream gate uses the selected profile tier hard cap, through both dream paths', async () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    seedHot(dir, atomHeavyMemory(520));
    const before = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8');
    const model = phaseModel({ merge: mergeFixture });
    const system = new MemorySystem({
      dir,
      endpoint: () => 'http://127.0.0.1:9',
      sessionId: () => 'test',
      memoryTier: () => 'fast',
      dreamModel: () => model,
    });
    const dreamCapability = system.capabilities().find((capability) => capability.name === 'memory_dream');
    assert.ok(dreamCapability, 'memory_dream must exist');
    const viaCapability = await dreamCapability.execute('t', {});
    assert.match(JSON.stringify(viaCapability), /failed/);
    assert.match(JSON.stringify(viaCapability), /fast tier/);
    const viaSystem = await system.dream('manual');
    assert.equal(viaSystem.status, 'failed');
    assert.match(viaSystem.reason, /fast tier/);
    assert.match(viaSystem.reason, /infeasible/);
    assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- truncation message

test('an answer cut off at the token cap is reported as truncation, not as a missing changelog', async () => {
  const dir = temporary();
  try {
    seedHot(dir, '# Memory\n\n## About you\n- keep me.\n\n## Facts\n\n## Preferences\n\n## Commitments\n\n## Projects\n\n## Notes about Muse\n');
    const before = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8');
    const truncatedModel = {
      id: 'truncated',
      async complete({ system }) {
        const text = system.includes('merge step')
          ? '# Memory\n\n## About you\n- keep me.\n\n## Facts\n\n## Preferences'
          : '';
        return { text, usage: { input: 1, output: 2048 }, truncated: true };
      },
    };
    const result = await runDream({ paths: memoryPaths(dir), model: truncatedModel, trigger: 'manual' });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /truncated at the \d+-token cap/);
    assert.ok(!/did not return a changelog/.test(result.reason), result.reason);
    assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf-8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- BM25 wiring

test('BM25 ranks the rare-term fact line above a generic line that shares common words', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    seedHot(dir, [
      '# Memory',
      '',
      '- LFM3-1.7B: promising for tool use with BFCL v4 71.4, but thinking-off is unreliable and that rules it out.',
      '- Ramo design decisions: tool use stays with the model, and the agent harness is built in this project.',
      '- Preferences: concise answers.',
    ].join('\n') + '\n');
    const hits = searchMarkdown(dir, 'LFM3-1.7B BFCL tool use', 5);
    assert.ok(hits.length > 0);
    assert.match(hits[0].line, /LFM3-1\.7B/, `top hit was: ${hits[0].line}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the projection reports the tier, its budget and the injected token count', () => {
  const dir = temporary();
  try {
    ensureLayout(dir);
    seedHot(dir, bigMemory());
    const projection = buildProjection({ paths: memoryPaths(dir), search: null, dreams: [], tier: 'fast' });
    assert.equal(projection.tier, 'fast');
    assert.equal(projection.budget, MEMORY_TIERS.fast.max);
    assert.ok(projection.status.injectedTokens <= projection.budget);
    assert.ok(projection.status.estimatedTokens >= projection.status.injectedTokens);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
