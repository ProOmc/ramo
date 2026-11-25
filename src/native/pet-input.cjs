'use strict';
// Ramo Pet — talk trigger.
//
// The pet is talked to by *holding* a trigger: a mouse side button or a
// keyboard chord. That is what makes it usable while a game owns the
// keyboard and the mouse — the hands never leave the game, and the pet only
// holds the microphone for as long as the trigger is held.
//
// Windows offers no global hotkey for mouse buttons, and Electron's
// globalShortcut reports a key press but never the release, so hold-to-talk
// needs the physical state of the inputs. A small helper process polls that
// state with GetAsyncKeyState and reports press/release edges.
//
// The helper is plain PowerShell plus one P/Invoke. It adds no package, it
// installs no input hook (a hook would add latency to every mouse event and
// can upset game anti-cheat), and nothing leaves the machine.
const {EventEmitter} = require('events');
const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');

// Mouse buttons Windows tracks as key state. 'back' and 'forward' are the
// side buttons (thumb buttons); 'middle' is the wheel click.
const MOUSE_BUTTONS = { back: 0x05, forward: 0x06, middle: 0x04 };

const MODIFIER_CODES = {
  control: 0x11, ctrl: 0x11, cmdorctrl: 0x11, commandorcontrol: 0x11,
  alt: 0x12, altgr: 0xA3, shift: 0x10,
  super: 0x5B, win: 0x5B, meta: 0x5B, command: 0x5B, cmd: 0x5B,
};

const NAMED_KEYS = {
  space: 0x20, enter: 0x0D, return: 0x0D, tab: 0x09, escape: 0x1B, esc: 0x1B,
  backspace: 0x08, delete: 0x2E, insert: 0x2D,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  capslock: 0x14, numlock: 0x90, scrolllock: 0x91,
};

function keyCode(token) {
  const name = String(token || '').trim();
  if (!name) return 0;
  const lower = name.toLowerCase();
  if (MODIFIER_CODES[lower] !== undefined) return MODIFIER_CODES[lower];
  if (NAMED_KEYS[lower] !== undefined) return NAMED_KEYS[lower];
  if (/^[a-z]$/i.test(name)) return name.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(name)) return name.charCodeAt(0);
  const fn = name.match(/^f(\d{1,2})$/i);
  if (fn) {
    const n = Number(fn[1]);
    if (n >= 1 && n <= 24) return 0x6F + n;
  }
  const punctuation = { '-': 0xBD, '=': 0xBB, '[': 0xDB, ']': 0xDD, ';': 0xBA, "'": 0xDE, ',': 0xBC, '.': 0xBE, '/': 0xBF, '`': 0xC0, '\\': 0xDC };
  if (punctuation[name] !== undefined) return punctuation[name];
  return 0;
}

// "Ctrl+Alt+Space" -> the virtual keys that must all be held together.
// Returns null when the chord cannot be understood (the caller then keeps
// the previous trigger rather than arming something the user did not ask for).
function parseAccelerator(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const codes = [];
  for (const part of parts) {
    const code = keyCode(part);
    if (!code) return null;
    if (!codes.includes(code)) codes.push(code);
  }
  // A chord of modifier keys alone is not a trigger.
  const modifiers = codes.filter((code) => Object.values(MODIFIER_CODES).includes(code));
  if (!codes.length || (modifiers.length === codes.length)) return null;
  return { keys: codes, label: raw, code: raw.toLowerCase().replace(/\s+/g, '') };
}

// The trigger the user configured: which mouse button, which chord.
function normalizeTrigger(trigger) {
  const source = trigger && typeof trigger === 'object' ? trigger : {};
  const mouse = MOUSE_BUTTONS[source.mouse] !== undefined ? source.mouse : 'forward';
  const key = typeof source.key === 'string' ? source.key.trim() : '';
  return {
    mouse: source.mouse === 'none' ? 'none' : mouse,
    key: key && parseAccelerator(key) ? key : '',
  };
}

// The helper script. It polls the physical state of the chosen inputs and
// prints one JSON line per edge. GetAsyncKeyState is used rather than an
// input hook on purpose: no hook means no added latency on the game's mouse
// and nothing for anti-cheat to object to.
const HELPER_SCRIPT = `param([int]$mouse = 0, [string]$keys = '', [int]$poll = 15)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RamoInputState {
  [StructLayout(LayoutKind.Sequential)]
  public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max, uint remove);
}
"@
$keyList = @()
if ($keys) { $keyList = @($keys.Split(',') | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ }) }
[Console]::Out.WriteLine('{"type":"ready"}')
[Console]::Out.Flush()
$msg = New-Object RamoInputState+MSG
$mouseDown = $false
$keyDown = $false
while ($true) {
  # Draining the queue keeps injected test input visible to GetAsyncKeyState.
  [RamoInputState]::PeekMessage([ref]$msg, [IntPtr]::Zero, 0, 0, 1) | Out-Null
  $mouseNow = $false
  if ($mouse -ne 0) { $mouseNow = (([RamoInputState]::GetAsyncKeyState($mouse) -band 0x8000) -ne 0) }
  if ($mouseNow -ne $mouseDown) {
    $mouseDown = $mouseNow
    if ($mouseNow) { [Console]::Out.WriteLine('{"type":"down","source":"mouse"}') }
    else { [Console]::Out.WriteLine('{"type":"up","source":"mouse"}') }
    [Console]::Out.Flush()
  }
  $keysNow = $false
  if ($keyList.Count -gt 0) {
    $keysNow = $true
    foreach ($code in $keyList) {
      if ((([RamoInputState]::GetAsyncKeyState($code) -band 0x8000) -eq 0)) { $keysNow = $false; break }
    }
  }
  if ($keysNow -ne $keyDown) {
    $keyDown = $keysNow
    if ($keysNow) { [Console]::Out.WriteLine('{"type":"down","source":"key"}') }
    else { [Console]::Out.WriteLine('{"type":"up","source":"key"}') }
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds $poll
}
`;

class PetInput extends EventEmitter {
  constructor({ scriptPath, spawnProcess = spawn, platform = process.platform } = {}) {
    super();
    this.scriptPath = scriptPath || null;
    this.spawn = spawnProcess;
    this.platform = platform;
    this.child = null;
    this.config = { mouse: 'none', key: '' };
    this.ready = false;
    this.lastError = '';
  }

  get running() { return !!(this.child && !this.child.killed); }

  // The helper is a script in the app's own profile: nothing is written
  // outside it and nothing is downloaded.
  writeScript() {
    if (!this.scriptPath) throw Error('Pet input has no script path.');
    fs.mkdirSync(path.dirname(this.scriptPath), { recursive: true });
    const current = fs.existsSync(this.scriptPath) ? fs.readFileSync(this.scriptPath, 'utf8') : '';
    if (current !== HELPER_SCRIPT) fs.writeFileSync(this.scriptPath, HELPER_SCRIPT, 'utf8');
    return this.scriptPath;
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.ready = false;
    if (child) {
      try { child.kill(); } catch (_) {}
    }
    return true;
  }

  // Start (or reconfigure) the helper. Returns a promise that settles when
  // the helper reports ready, so the caller can tell the user if the trigger
  // could not be armed.
  start(trigger) {
    const config = normalizeTrigger(trigger);
    this.stop();
    this.config = config;
    if (this.platform !== 'win32') {
      this.lastError = 'The pet talk trigger needs Windows.';
      this.emit('error', this.lastError);
      return Promise.resolve(false);
    }
    const mouseCode = MOUSE_BUTTONS[config.mouse] || 0;
    const chord = config.key ? parseAccelerator(config.key) : null;
    if (!mouseCode && !chord) {
      this.lastError = 'No talk trigger is configured.';
      this.emit('error', this.lastError);
      return Promise.resolve(false);
    }
    let script;
    try { script = this.writeScript(); }
    catch (error) {
      this.lastError = String(error.message || error);
      this.emit('error', this.lastError);
      return Promise.resolve(false);
    }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
      '-mouse', String(mouseCode), '-keys', chord ? chord.keys.join(',') : '', '-poll', '15'];
    let child;
    try {
      child = this.spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      this.lastError = String(error.message || error);
      this.emit('error', this.lastError);
      return Promise.resolve(false);
    }
    this.child = child;
    this.ready = false;
    let settled = false;
    const settle = (value) => { if (settled) return; settled = true; resolve(value); };
    let resolve;
    const ready = new Promise((r) => { resolve = r; });
    const timer = setTimeout(() => { this.lastError = 'The pet talk trigger did not start in time.'; this.emit('error', this.lastError); settle(false); }, 20000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        let packet;
        try { packet = JSON.parse(text); } catch (_) { continue; }
        if (packet.type === 'ready') {
          this.ready = true;
          clearTimeout(timer);
          this.emit('ready', { ...this.config });
          settle(true);
        } else if (packet.type === 'down' || packet.type === 'up') {
          this.emit(packet.type, packet.source || 'key');
        } else if (packet.type === 'error') {
          this.lastError = String(packet.message || 'The pet talk trigger failed.');
          this.emit('error', this.lastError);
        }
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      this.lastError = text.slice(-300);
    });
    child.on('error', (error) => {
      this.lastError = String(error.message || error);
      this.emit('error', this.lastError);
      clearTimeout(timer);
      settle(false);
    });
    child.on('close', (code) => {
      if (this.child === child) { this.child = null; this.ready = false; }
      clearTimeout(timer);
      if (code) { this.lastError = 'The pet talk trigger stopped (code ' + code + ').'; this.emit('error', this.lastError); }
      settle(false);
    });
    return ready;
  }
}

module.exports = { PetInput, parseAccelerator, normalizeTrigger, keyCode, MOUSE_BUTTONS, MODIFIER_CODES, NAMED_KEYS, HELPER_SCRIPT };
