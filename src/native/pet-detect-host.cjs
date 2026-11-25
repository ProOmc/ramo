'use strict';
// Ramo Pet — the detector host.
//
// This file does not run in the Electron process. It runs in the 64-bit Node
// that ships with the application (`work/node/node.exe`), forked by
// `pet-detect.cjs`, because the Electron process is 32-bit and ONNX Runtime
// publishes no 32-bit Windows build.
//
// The contract with the main process is one JSON object per line:
//
//   in   {"id":1,"type":"detect","path":"...frame.bin","meta":{...}}
//   out  {"id":1,"type":"result","ok":true,"boxes":[...],"ms":42}
//
// Nothing but protocol goes to stdout; anything else would corrupt the
// stream, so notes and errors go to stderr.
//
// The model is YOLOE-26s-seg, exported to ONNX at 640x640 with a 158 name
// vocabulary baked in. It is loaded once and kept: a session that is opened
// per frame would cost more than the inference itself.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const codec = require('./pet-detect-codec.cjs');

// The DirectML provider loads its own DLLs, and Windows finds a DLL by the
// path of the process that loads it. The libraries sit next to the binding,
// so that directory goes on PATH before ONNX Runtime is loaded.
const ortPath = path.join(__dirname, 'work', 'node_modules', 'onnxruntime-node');
const binPath = path.join(ortPath, 'bin', 'napi-v6', process.platform, process.arch);
if (fs.existsSync(binPath)) {
  process.env.PATH = binPath + path.delimiter + (process.env.PATH || '');
}

const ort = require(ortPath);

const modelPath = process.argv[2];
const EXECUTION_PROVIDERS = ['dml', 'cpu'];
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

let session = null;
let sessionError = null;
let loading = null;

function loadSession() {
  if (session) return Promise.resolve(session);
  if (sessionError) return Promise.reject(Error(sessionError));
  if (loading) return loading;
  loading = ort.InferenceSession.create(modelPath, {
    executionProviders: EXECUTION_PROVIDERS,
    graphOptimizationLevel: 'all'
  }).then((created) => {
    session = created;
    return session;
  }).catch((error) => {
    sessionError = 'the detector model could not be opened: ' + (error && error.message ? error.message : String(error));
    loading = null;
    throw error;
  });
  return loading;
}

function outputsOf(results, names) {
  const outputs = [];
  for (const name of names) {
    const value = results[name];
    if (!value) continue;
    outputs.push({name, dims: value.dims, data: value.data});
  }
  return outputs;
}

async function detect(payload) {
  const meta = payload.meta || {};
  const size = meta.size || codec.INPUT_SIZE;
  const file = String(payload.path || '');
  if (!file || !fs.existsSync(file)) throw Error('the frame was not on disk');
  const pixels = fs.readFileSync(file);
  if (pixels.length > MAX_FRAME_BYTES) throw Error('the frame was too large');
  const width = Math.max(1, Math.round(Number(meta.w) || 0));
  const height = Math.max(1, Math.round(Number(meta.h) || 0));
  if (!width || !height || pixels.length !== width * height * 4) {
    throw Error('the frame did not match its size');
  }
  const created = await loadSession();
  const tensor = codec.toTensor(pixels, width, height, {size, padX: meta.padX, padY: meta.padY});
  const input = new ort.Tensor('float32', tensor, [1, 3, size, size]);
  const started = Date.now();
  const results = await created.run({[created.inputNames[0]]: input});
  const boxes = codec.postprocess(outputsOf(results, created.outputNames), meta, {
    conf: payload.conf,
    iou: payload.iou,
    limit: payload.limit
  });
  return {boxes, ms: Date.now() - started};
}

function reply(message) {
  try {
    process.stdout.write(JSON.stringify(message) + '\n');
  } catch (_) {}
}

const lines = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
lines.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let request = null;
  try {
    request = JSON.parse(text);
  } catch (_) {
    return;
  }
  if (!request || request.type !== 'detect') return;
  detect(request)
    .then((result) => reply({id: request.id, type: 'result', ok: true, boxes: result.boxes, ms: result.ms}))
    .catch((error) => reply({
      id: request.id,
      type: 'result',
      ok: false,
      error: error && error.message ? error.message : String(error)
    }));
});
lines.on('close', () => {
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  process.stderr.write('detector host: ' + (error && error.stack ? error.stack : String(error)) + '\n');
});
