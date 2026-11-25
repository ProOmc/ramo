/** Background shell: a long command returns immediately and notifies on completion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorkService } = require('../app/work/service.cjs');

const chunk = (onChunk, text) => onChunk({ choices: [{ delta: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } });
const call = (onChunk, name, args) => onChunk({ choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'bg1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });

async function waitFor(check, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('condition not met');
}

test('background PowerShell returns a job id and emits a completion event', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-bg-'));
  const cwd = path.join(tmp, 'project');
  fs.mkdirSync(cwd);
  let requests = 0;
  const service = new WorkService({
    // Tiered shell: a long non-read command belongs to the broad (MoE) tier —
    // unknown fixture ids default to R and would be refused at attempt time.
    appDir: path.resolve('app'), dataDir: path.join(tmp, 'data'), models: async () => [{ id: 'qwen36', model: 'qwen36-tune', context: 16384 }], hostTool: async () => ({ ok: true }),
    chat: async (_m, _body, { onChunk }) => {
      requests += 1;
      if (requests === 1) call(onChunk, 'powershell', { command: "Start-Sleep -Milliseconds 600; 'BG_DONE'", background: true });
      else chunk(onChunk, 'Started.');
    },
  });
  const events = [];
  service.on('event', (event) => events.push(event));
  t.after(async () => { await service.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  await service.request('open', { cwd, trusted: true, permission: 'full', mode: 'project', model: 'qwen36' });
  const started = Date.now();
  const state = await service.request('prompt', { text: 'Run a long command', model: 'qwen36' });
  assert.ok(Date.now() - started < 5000, 'the turn did not wait for the command');
  const result = state.messages.filter((m) => m.role === 'toolResult').find((m) => m.toolName === 'powershell');
  assert.match(JSON.stringify(result), /BG-|jobId/);
  await waitFor(() => events.some((e) => e.type === 'background_job_done'));
  const done = events.find((e) => e.type === 'background_job_done');
  assert.equal(done.exitCode, 0);
  assert.match(done.output, /BG_DONE/);
  const jobs = await service.request('background_jobs');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].done, true);
  assert.equal(jobs[0].exitCode, 0);
});
