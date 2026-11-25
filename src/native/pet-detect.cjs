'use strict';
// Ramo Pet — the detector's client side.
//
// The application runs in a 32-bit Electron process (Electron 22.3.27, win32
// ia32) and ONNX Runtime publishes no 32-bit Windows build at any version, so
// the detector cannot live in this process. It lives in the 64-bit Node that
// already ships with the application, forked the same way the kernel is
// forked by `src/runtime/service.cjs`, and this file is the seam:
//
//   main process            this file                 pet-detect-host.cjs
//   ------------            --------                 -------------------
//   capture bitmap  ->  letterboxed frame on disk  ->  ONNX session
//   numbered discs  <-  boxes with outlines        <-  decoded outputs
//
// The frame travels as a file rather than as bytes on the pipe because a
// 640x360 BGRA frame is 900 KB and a pipe write of that size would sit in the
// middle of the event loop; a file read in the child is a few milliseconds and
// the frame is already on disk when the child wants it.
//
// Everything numeric is in `pet-detect-codec.cjs`, which imports neither
// Electron nor ONNX Runtime, so it can be checked by the model-free suite.
//
// The vocabulary is baked into the exported model, so `phrases` cannot change
// what the network detects. What it can do is rank the answers: a phrase that
// names one of the baked classes lifts that class's boxes to the top of the
// list the model is shown. The model itself still makes the final choice from
// the numbered picture.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const codec = require('./pet-detect-codec.cjs');

const HOST_SCRIPT = 'pet-detect-host.cjs';
const MODEL_FILE = 'yoloe-26s-seg-desktop.onnx';
const CLASSES_FILE = 'yoloe-26s-seg-desktop.classes.txt';
const MODEL_DIR = path.join(__dirname, 'work', 'pet-models');
const NODE_BIN = path.join(__dirname, 'work', 'node', 'node.exe');
const REQUEST_TIMEOUT_MS = 20000;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

let child = null;
let childBroken = false;
let nextId = 1;
let pending = new Map();
let frameCounter = 0;
let classes = null;

function appDir() {
  return __dirname;
}

function modelPath() {
  return path.join(MODEL_DIR, MODEL_FILE);
}

function classNames() {
  if (classes) return classes;
  classes = [];
  try {
    const text = fs.readFileSync(path.join(MODEL_DIR, CLASSES_FILE), 'utf8');
    classes = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (_) {
    classes = [];
  }
  return classes;
}

// The words of a phrase, with the stop words that carry no meaning removed.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'on', 'in', 'at', 'to', 'for', 'my', 'your', 'that',
  'this', 'is', 'are', 'and', 'or', 'it', 'with', 'please', 'circle', 'mark',
  'highlight', 'around', 'near', 'around'
]);

function words(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

// Which baked classes a set of phrases points at.
//
// A class matches when a phrase names it outright, or when they share a word
// that is specific enough to be worth something: "taskbar clock" matches
// "clock", "yellow folder" matches "folder", and "valorant icon" matches
// "icon" but not "val" from "valve".
function matchClasses(phrases) {
  const names = classNames();
  const wanted = [];
  for (const phrase of phrases || []) {
    const phraseWords = words(phrase);
    if (!phraseWords.length) continue;
    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      const nameWords = words(name);
      if (!nameWords.length) continue;
      if (phraseWords.includes(name) || nameWords.includes(name)) {
        wanted.push(index);
        continue;
      }
      const shared = phraseWords.filter((word) => nameWords.includes(word)).length;
      if (shared > 0 && nameWords.length <= 2) wanted.push(index);
    }
  }
  return [...new Set(wanted)];
}

// Lift the boxes whose class the phrase named, without dropping the others:
// the picture shown to the model is a shortlist, not a filter.
function rankBoxes(boxes, phrases) {
  const wanted = new Set(matchClasses(phrases));
  if (!wanted.size) return boxes;
  return boxes
    .map((box, index) => ({box, index, lift: wanted.has(box.cls) ? 1 : 0}))
    .sort((a, b) => (b.lift - a.lift) || (b.box.conf - a.box.conf) || (a.index - b.index))
    .map((entry) => entry.box);
}

function hostPaths() {
  return {
    node: NODE_BIN,
    script: path.join(appDir(), HOST_SCRIPT),
    model: modelPath()
  };
}

// Is everything the host needs actually there? The answer decides whether the
// pet draws from a detector or falls back to the grid, so it is checked once
// and remembered.
let availability = null;
function detectorAvailable() {
  if (availability) return availability;
  const paths = hostPaths();
  availability = {
    ok: fs.existsSync(paths.node) && fs.existsSync(paths.script) && fs.existsSync(paths.model),
    node: paths.node,
    script: paths.script,
    model: paths.model
  };
  return availability;
}

function startHost() {
  if (child && !childBroken) return child;
  const paths = hostPaths();
  if (!detectorAvailable().ok) return null;
  childBroken = false;
  const spawned = require('node:child_process').spawn(paths.node, [paths.script, paths.model], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child = spawned;
  let stdout = '';
  spawned.stdout.setEncoding('utf8');
  spawned.stdout.on('data', (chunk) => {
    stdout += chunk;
    let newline = stdout.indexOf('\n');
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line) handleLine(line);
      newline = stdout.indexOf('\n');
    }
  });
  spawned.stderr.setEncoding('utf8');
  let stderr = '';
  spawned.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  spawned.on('exit', () => {
    child = null;
    childBroken = true;
    for (const [, entry] of pending) entry.reject(Error('the detector stopped'));
    pending = new Map();
  });
  spawned.on('error', () => {
    child = null;
    childBroken = true;
    for (const [, entry] of pending) entry.reject(Error('the detector could not be started'));
    pending = new Map();
  });
  return spawned;
}

function handleLine(line) {
  let message = null;
  try {
    message = JSON.parse(line);
  } catch (_) {
    return;
  }
  if (!message || message.type !== 'result') return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  entry.resolve(message);
}

function request(payload, timeoutMs = REQUEST_TIMEOUT_MS) {
  const host = startHost();
  if (!host) return Promise.reject(Error('the detector is not installed'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('the detector did not answer in time'));
    }, timeoutMs);
    pending.set(id, {
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    });
    try {
      host.stdin.write(JSON.stringify(Object.assign({id, type: 'detect'}, payload)) + '\n');
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

// Nearest-neighbour resize, used only when the caller hands over a frame that
// was not resized for us. Electron's own resizer is used when it is
// available; this is the fallback that keeps the API honest.
function resizeNearest(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const target = Buffer.alloc(targetWidth * targetHeight * 4);
  const ratioX = sourceWidth / targetWidth;
  const ratioY = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * ratioY));
    let sourceRow = sourceY * sourceWidth * 4;
    let targetRow = y * targetWidth * 4;
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * ratioX));
      const from = sourceRow + sourceX * 4;
      const to = targetRow + x * 4;
      target[to] = source[from];
      target[to + 1] = source[from + 1];
      target[to + 2] = source[from + 2];
      target[to + 3] = source[from + 3];
    }
  }
  return target;
}

// Find the frame on disk for the host to read. The name says which frame it
// is, so a stale file can never be read by the wrong request.
function writeFrame(pixels) {
  const dir = path.join(os.tmpdir(), 'ramo-detect');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `frame-${process.pid}-${Date.now()}-${frameCounter++}.bin`);
  fs.writeFileSync(file, pixels);
  return file;
}

// The detector's entry point.
//
// `buffer` is BGRA (what `nativeImage.toBitmap()` returns on Windows),
// `phrases` is what the user asked for, and the boxes that come back are in
// the CAPTURE's own pixels: the same frame the pet draws on, so nothing has
// to be scaled twice.
//
// The network works in a 640x640 padded canvas; the frame file is the inner
// picture of that letterbox; and the boxes are mapped straight back to the
// capture by the decode, because the letterbox's scale is the capture's scale.
//
// options:
//   width, height      the size of `buffer` in pixels
//   captureWidth       the capture's width in pixels (default: width)
//   captureHeight      the capture's height in pixels (default: height)
//   conf               the score a detection needs (default 0.25)
//   limit              how many boxes to keep (default 12)
//
// The caller normally hands over a frame that has ALREADY been resized to the
// letterbox's inner size, because Electron's own resizer does that in native
// code and a JS resample of a 1920x1200 screen costs more than the inference.
// When the frame is the wrong size it is fitted here instead.
async function detectForDraw(buffer, phrases, options = {}) {
  const available = detectorAvailable();
  if (!available.ok) {
    return {ok: false, boxes: [], error: 'the detector is not installed', missing: available};
  }
  const pixels = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const width = Math.max(1, Math.round(Number(options.width) || 0));
  const height = Math.max(1, Math.round(Number(options.height) || 0));
  if (!width || !height) return {ok: false, boxes: [], error: 'the capture has no size'};
  if (pixels.length !== width * height * 4) {
    return {ok: false, boxes: [], error: 'the capture pixels do not match the capture size'};
  }
  if (pixels.length > MAX_FRAME_BYTES) {
    return {ok: false, boxes: [], error: 'the capture is too large to detect on'};
  }
  const captureWidth = Math.max(1, Math.round(Number(options.captureWidth) || width));
  const captureHeight = Math.max(1, Math.round(Number(options.captureHeight) || height));
  // The letterbox is computed from the CAPTURE, not from the frame: the frame
  // is the inner picture of that letterbox, and the boxes have to come back
  // in the capture's pixels.
  const meta = codec.letterbox(captureWidth, captureHeight);
  let frame = pixels;
  if (width !== meta.w || height !== meta.h) {
    frame = resizeNearest(pixels, width, height, meta.w, meta.h);
  }
  const file = writeFrame(frame);
  const started = Date.now();
  try {
    const answer = await request({
      path: file,
      meta: {
        width: captureWidth,
        height: captureHeight,
        w: meta.w,
        h: meta.h,
        padX: meta.padX,
        padY: meta.padY,
        scale: meta.scale,
        size: meta.size
      },
      conf: Number.isFinite(options.conf) ? options.conf : 0.25,
      iou: Number.isFinite(options.iou) ? options.iou : 0.5,
      limit: Number.isFinite(options.limit) ? options.limit : 12
    });
    if (!answer || !answer.ok) {
      return {ok: false, boxes: [], error: (answer && answer.error) || 'the detector failed'};
    }
    const boxes = Array.isArray(answer.boxes) ? answer.boxes : [];
    const ranked = rankBoxes(boxes, phrases);
    return {
      ok: true,
      boxes: ranked,
      ms: Date.now() - started,
      inferenceMs: answer.ms || null,
      classes: classNames()
    };
  } catch (error) {
    return {ok: false, boxes: [], error: error && error.message ? error.message : String(error)};
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
}

function dispose() {
  if (!child) return;
  try { child.stdin.end(); } catch (_) {}
  try { child.kill(); } catch (_) {}
  child = null;
  childBroken = false;
}

module.exports = {
  detectForDraw,
  matchClasses,
  rankBoxes,
  words,
  detectorAvailable,
  hostPaths,
  dispose
};
