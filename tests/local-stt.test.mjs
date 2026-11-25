import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {LocalSpeech, MODEL} = require('../src/native/ramo-local-stt.js');

/**
 * Dictation runs on NVIDIA Nemotron Streaming 0.6B through the local Python
 * worker `src/native/ramo-nemotron-worker.py`. The worker itself is Python
 * and cannot be covered here, but the seam in front of it can: the warm worker
 * protocol, the events the renderer and the pet depend on, and the rule that
 * only one turn may own the capture device at a time.
 *
 * The model is faked on disk (the files only have to exist and be non-empty)
 * and the worker process is faked in memory, so these checks never load a
 * model and never touch a microphone.
 */

class FakeStream extends EventEmitter {}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.writes = [];
    this.killed = false;
    this.stdin = {
      write: (text) => { this.writes.push(String(text)); return true; },
      end: (text) => { if (text) this.writes.push(String(text)); return true; }
    };
  }
  kill() { this.killed = true; }
  say(packet) { this.stdout.emit('data', Buffer.from(JSON.stringify(packet) + '\n')); }
}

const created = [];
process.on('exit', () => {
  for (const dir of created) {
    try { fs.rmSync(dir, {recursive: true, force: true}); } catch (_) {}
  }
});

function fakeDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-stt-'));
  created.push(dir);
  const root = path.join(dir, 'speech');
  const modelDir = path.join(root, 'models', MODEL.dir);
  fs.mkdirSync(path.join(root, 'venv', 'Scripts'), {recursive: true});
  fs.mkdirSync(modelDir, {recursive: true});
  fs.writeFileSync(path.join(root, 'venv', 'Scripts', 'python.exe'), 'fake');
  fs.writeFileSync(path.join(root, 'nemotron-installed-v1'), 'sherpa-onnx\n');
  for (const name of ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']) {
    fs.writeFileSync(path.join(modelDir, name), 'fake');
  }
  return dir;
}

function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      let value;
      try { value = predicate(); } catch (error) { reject(error); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - started > timeoutMs) { reject(new Error('timed out')); return; }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function makeSpeech(spawnProcess) {
  const events = [];
  const speech = new LocalSpeech({
    dataDir: fakeDataDir(),
    spawnProcess,
    sendEvent: (event) => events.push(event)
  });
  return {speech, events};
}

// A warm worker that reports itself hot the way the Python worker does.
function hotWorker(child) {
  setTimeout(() => child.say({type: 'hot', message: 'Model loaded (kept hot)'}), 5);
  return child;
}

test('the warm worker loads the Nemotron model and says it is hot', async () => {
  const child = new FakeChild();
  const spawns = [];
  const {speech} = makeSpeech((command, args, options) => {
    spawns.push({command, args, options});
    return hotWorker(child);
  });
  try {
    await speech.hot();
    assert.equal(spawns.length, 1);
    assert.ok(spawns[0].args.includes('--persistent'), 'the warm worker is the persistent one');
    assert.ok(spawns[0].args.some(a => a.endsWith('ramo-nemotron-worker.py')), 'the worker is the Nemotron worker');
    assert.equal(speech.status().engine, 'Nemotron Streaming 0.6B (local)');
    assert.equal(speech.status().offlineAfterSetup, true);
    assert.equal(speech.status().active, false);
  } finally {
    speech.shutdown();
  }
});

test('a turn starts the warm worker, reports the partials and resolves on the final transcript', async () => {
  const child = new FakeChild();
  const {speech, events} = makeSpeech(() => hotWorker(child));
  try {
    await speech.hot();
    const capture = speech.recognize();
    await waitFor(() => child.writes.includes('start\n'));
    child.say({type: 'ready', message: 'Listening'});
    child.say({type: 'partial', text: 'hello'});
    child.say({type: 'final', text: 'hello there'});
    assert.equal(await capture, 'hello there');
    assert.equal(events.filter(e => e.type === 'ready').length, 1);
    assert.equal(events.find(e => e.type === 'partial').text, 'hello');
    assert.equal(events.find(e => e.type === 'final').text, 'hello there');
    assert.equal(speech.status().active, false, 'the turn is over');
  } finally {
    speech.shutdown();
  }
});

test('only one turn may own the capture device at a time', async () => {
  const child = new FakeChild();
  const {speech} = makeSpeech(() => hotWorker(child));
  try {
    await speech.hot();
    const first = speech.recognize();
    await waitFor(() => child.writes.includes('start\n'));
    await assert.rejects(() => speech.recognize(), /already running/i);
    child.say({type: 'final', text: 'done'});
    assert.equal(await first, 'done');
    // The device is free again once the turn ended.
    const second = speech.recognize();
    await waitFor(() => child.writes.filter(w => w === 'start\n').length === 2);
    child.say({type: 'final', text: 'again'});
    assert.equal(await second, 'again');
  } finally {
    speech.shutdown();
  }
});

test('stop asks the worker to finish the turn and the transcript still arrives', async () => {
  const child = new FakeChild();
  const {speech} = makeSpeech(() => hotWorker(child));
  try {
    await speech.hot();
    const capture = speech.recognize();
    await waitFor(() => child.writes.includes('start\n'));
    speech.stop();
    assert.ok(child.writes.includes('stop\n'), 'the worker is told to finish');
    child.say({type: 'final', text: 'stopped'});
    assert.equal(await capture, 'stopped');
  } finally {
    speech.shutdown();
  }
});

test('a failure inside the worker fails the turn and is reported', async () => {
  const child = new FakeChild();
  const {speech, events} = makeSpeech(() => hotWorker(child));
  try {
    await speech.hot();
    const capture = speech.recognize();
    await waitFor(() => child.writes.includes('start\n'));
    child.say({type: 'error', message: 'Microphone unavailable'});
    await assert.rejects(() => capture, /Microphone unavailable/);
    assert.ok(events.some(e => e.type === 'error' && /Microphone unavailable/.test(e.message)));
  } finally {
    speech.shutdown();
  }
});

test('a worker that dies fails the turn instead of hanging', async () => {
  const child = new FakeChild();
  const {speech} = makeSpeech(() => hotWorker(child));
  try {
    await speech.hot();
    const capture = speech.recognize();
    await waitFor(() => child.writes.includes('start\n'));
    child.emit('close', 1);
    await assert.rejects(() => capture, /stopped/i);
  } finally {
    speech.shutdown();
  }
});

test('when the warm worker cannot start, dictation falls back to a one-shot worker', async () => {
  const oneShot = new FakeChild();
  const spawns = [];
  const {speech} = makeSpeech((command, args) => {
    spawns.push(args);
    if (args.includes('--persistent')) {
      const dead = new FakeChild();
      setTimeout(() => dead.emit('close', 1), 5);
      return dead;
    }
    return oneShot;
  });
  try {
    const capture = speech.recognize();
    await waitFor(() => spawns.some(a => !a.includes('--persistent')));
    oneShot.say({type: 'ready', message: 'Listening'});
    oneShot.say({type: 'final', text: 'one shot'});
    oneShot.emit('close', 0);
    assert.equal(await capture, 'one shot');
  } finally {
    speech.shutdown();
  }
});

test('shutdown releases the warm worker', async () => {
  const child = new FakeChild();
  const {speech} = makeSpeech(() => hotWorker(child));
  await speech.hot();
  speech.shutdown();
  assert.ok(child.writes.some(w => w.includes('shutdown')), 'the worker is told to exit');
  assert.equal(speech.status().active, false);
});
