import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PetInput, parseAccelerator, normalizeTrigger, MOUSE_BUTTONS, HELPER_SCRIPT } = require('../src/native/pet-input.cjs');

/**
 * The pet is talked to by holding a trigger. Windows has no global hotkey for
 * mouse buttons and Electron reports a key press but never the release, so
 * the trigger is read from the physical state of the chosen inputs.
 *
 * These checks cover the part that can be decided without a human at the
 * keyboard: which virtual keys a chord means, what the configured trigger
 * normalises to, and that the helper polls the state instead of installing an
 * input hook (a hook would add latency to every mouse event in a game and can
 * upset anti-cheat).
 */

class FakeStream extends EventEmitter {
  setEncoding() {}
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.killed = false;
  }
  kill() { this.killed = true; }
}

test('a chord is read as the Windows virtual keys that must be held together', () => {
  const chord = parseAccelerator('Ctrl+Alt+Space');
  assert.deepEqual(chord.keys, [0x11, 0x12, 0x20]);
  assert.equal(chord.label, 'Ctrl+Alt+Space');
});

test('letters, digits and function keys in a chord are understood', () => {
  assert.deepEqual(parseAccelerator('Ctrl+Shift+K').keys, [0x11, 0x10, 0x4B]);
  assert.deepEqual(parseAccelerator('Alt+7').keys, [0x12, 0x37]);
  assert.deepEqual(parseAccelerator('Ctrl+F11').keys, [0x11, 0x7A]);
});

test('a chord that cannot be a trigger is refused rather than half-armed', () => {
  assert.equal(parseAccelerator(''), null);
  assert.equal(parseAccelerator('   '), null);
  assert.equal(parseAccelerator('Ctrl+Alt'), null, 'modifier keys alone are not a trigger');
  assert.equal(parseAccelerator('Ctrl+Nonsense'), null);
});

test('the configured trigger keeps the mouse button and only a usable chord', () => {
  assert.deepEqual(normalizeTrigger({ mouse: 'middle', key: 'Ctrl+Alt+Space' }), { mouse: 'middle', key: 'Ctrl+Alt+Space' });
  assert.deepEqual(normalizeTrigger({ mouse: 'none', key: '' }), { mouse: 'none', key: '' });
  assert.deepEqual(normalizeTrigger(undefined), { mouse: 'forward', key: '' }, 'the side button is the default');
  assert.deepEqual(normalizeTrigger({ mouse: 'back', key: 'Nonsense' }), { mouse: 'back', key: '' });
});

test('the mouse buttons are the ones Windows tracks as key state', () => {
  assert.equal(MOUSE_BUTTONS.back, 0x05);
  assert.equal(MOUSE_BUTTONS.forward, 0x06);
  assert.equal(MOUSE_BUTTONS.middle, 0x04);
});

test('the helper polls the input state instead of installing an input hook', () => {
  assert.match(HELPER_SCRIPT, /GetAsyncKeyState/);
  assert.doesNotMatch(HELPER_SCRIPT, /SetWindowsHookEx|WH_KEYBOARD_LL|WH_MOUSE_LL/,
    'a low-level hook would add latency to every mouse event and can upset game anti-cheat');
});

test('the helper reports press and release edges for the mouse and the chord', () => {
  assert.match(HELPER_SCRIPT, /\{"type":"down","source":"mouse"\}/);
  assert.match(HELPER_SCRIPT, /\{"type":"up","source":"mouse"\}/);
  assert.match(HELPER_SCRIPT, /\{"type":"down","source":"key"\}/);
  assert.match(HELPER_SCRIPT, /\{"type":"up","source":"key"\}/);
});

test('the trigger reports a press and a release to the application', async () => {
  const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-pet-input-')), 'pet-input.ps1');
  const child = new FakeChild();
  const input = new PetInput({ scriptPath, spawnProcess: () => child, platform: 'win32' });
  const events = [];
  input.on('down', (source) => events.push(['down', source]));
  input.on('up', (source) => events.push(['up', source]));
  const started = input.start({ mouse: 'middle', key: 'Ctrl+Alt+Space' });
  assert.ok(fs.existsSync(scriptPath), 'the helper script is written into the app profile');
  child.stdout.emit('data', '{"type":"ready"}\n');
  assert.equal(await started, true);
  assert.equal(input.running, true);
  child.stdout.emit('data', '{"type":"down","source":"mouse"}\n{"type":"up","source":"mouse"}\n');
  assert.deepEqual(events, [['down', 'mouse'], ['up', 'mouse']]);
  input.stop();
  assert.equal(input.running, false);
  fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
});

test('a trigger the helper cannot arm is reported instead of failing silently', async () => {
  const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-pet-input-')), 'pet-input.ps1');
  const child = new FakeChild();
  const input = new PetInput({ scriptPath, spawnProcess: () => child, platform: 'linux' });
  const errors = [];
  input.on('error', (message) => errors.push(message));
  assert.equal(await input.start({ mouse: 'middle', key: '' }), false);
  assert.match(errors.join(' '), /Windows/);
  fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
});
