'use strict';
/**
 * Detector L2 — local CPU INT8 ONNX prompt-injection classifier.
 *
 * Model: marklkelly/bert-tiny-injection-detector (Apache-2.0), ~4.4M params,
 * 4.3 MB INT8 ONNX. CPUExecutionProvider only, threads capped, no GPU, no
 * cloud service, no model server. A flag annotates untrusted content; it never
 * grants a capability or changes what the model may do.
 */

const fs = require('node:fs');
const path = require('node:path');

const T_BLOCK = 0.9403;
const T_REVIEW = 0.8692;
const MAX_SEQ = 128;

let sessionPromise = null;
let tokenizerPromise = null;

function assets() {
  const candidates = [
    path.resolve(__dirname, 'detectors/bert-tiny-injection'),
    path.resolve(__dirname, '../../vendor/detectors/bert-tiny-injection'),
    path.resolve(__dirname, '../vendor/detectors/bert-tiny-injection'),
  ];
  const dir = candidates.find(candidate => fs.existsSync(path.join(candidate, 'tokenizer.json')));
  if (!dir) throw new Error('L2 detector assets are missing');
  return {
    model: path.join(dir, 'onnx/opset11/model.int8.onnx'),
    tokenizer: path.join(dir, 'tokenizer.json'),
  };
}

function loadTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      const data = JSON.parse(fs.readFileSync(assets().tokenizer, 'utf8'));
      const vocab = data.model.vocab || {};
      const unk = vocab[data.model.unk_token || '[UNK]'] ?? 100;
      const cls = vocab['[CLS]'] ?? 101;
      const sep = vocab['[SEP]'] ?? 102;
      const pad = vocab['[PAD]'] ?? 0;
      const prefix = data.model.continuing_subword_prefix || '##';
      return { vocab, unk, cls, sep, pad, prefix };
    })();
  }
  return tokenizerPromise;
}

function wordpiece(token, tokenizer) {
  const chars = [...token];
  if (chars.length === 1) return [tokenizer.vocab[token] ?? tokenizer.unk];
  const ids = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let found = null;
    while (end > start) {
      const piece = chars.slice(start, end).join('');
      const candidate = start === 0 ? piece : tokenizer.prefix + piece;
      if (Object.prototype.hasOwnProperty.call(tokenizer.vocab, candidate)) { found = tokenizer.vocab[candidate]; break; }
      end -= 1;
    }
    if (found === null) { ids.push(tokenizer.unk); start += 1; } else { ids.push(found); start = end; }
  }
  return ids;
}

async function encode(text) {
  const tokenizer = await loadTokenizer();
  const clean = String(text || '').toLowerCase().replace(/[\u0000-\u001f]/g, ' ');
  const pieces = clean.match(/[a-z0-9]+|[^a-z0-9\s]+/g) || [];
  const ids = [tokenizer.cls];
  for (const piece of pieces) {
    if (ids.length >= MAX_SEQ - 1) break;
    ids.push(...wordpiece(piece, tokenizer));
  }
  ids.length = Math.min(ids.length, MAX_SEQ - 1);
  ids.push(tokenizer.sep);
  const inputIds = new BigInt64Array(MAX_SEQ).fill(BigInt(tokenizer.pad));
  const attention = new BigInt64Array(MAX_SEQ);
  const typeIds = new BigInt64Array(MAX_SEQ);
  ids.forEach((id, index) => { inputIds[index] = BigInt(id); attention[index] = 1n; });
  return {
    input_ids: inputIds,
    attention_mask: attention,
    token_type_ids: typeIds,
  };
}

function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const candidates = [
        path.resolve(__dirname, 'node_modules/onnxruntime-node'),
        path.resolve(__dirname, '../../app/work/node_modules/onnxruntime-node'),
        path.resolve(__dirname, '../app/work/node_modules/onnxruntime-node'),
      ];
      const ortDir = candidates.find(dir => fs.existsSync(path.join(dir, 'package.json')));
      if (!ortDir) throw new Error('onnxruntime-node is not installed locally');
      const ort = require(ortDir);
      const file = assets().model;
      if (!fs.existsSync(file)) throw new Error('L2 ONNX model is not installed locally');
      const session = await ort.InferenceSession.create(file, {
        providers: ['CPUExecutionProvider'],
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
      });
      return { ort, session };
    })().catch(error => { sessionPromise = null; throw error; });
  }
  return sessionPromise;
}

async function scanL2(text) {
  try {
    const [{ ort, session }, feeds] = await Promise.all([loadSession(), encode(text)]);
    const tensor = (values) => new ort.Tensor('int64', values, [1, MAX_SEQ]);
    const results = await session.run({
      input_ids: tensor(feeds.input_ids),
      attention_mask: tensor(feeds.attention_mask),
      token_type_ids: tensor(feeds.token_type_ids),
    });
    const logits = Object.values(results)[0];
    const values = Array.from(logits.data);
    const a = values[0] ?? 0;
    const b = values[1] ?? 0;
    const max = Math.max(a, b);
    const ea = Math.exp(a - max);
    const eb = Math.exp(b - max);
    const probability = eb / (ea + eb);
    return {
      available: true,
      probability: Math.round(probability * 10000) / 10000,
      block: probability >= T_BLOCK,
      review: probability >= T_REVIEW,
      thresholds: { block: T_BLOCK, review: T_REVIEW },
      runtime: 'onnxruntime-node CPUExecutionProvider, INT8',
    };
  } catch (error) {
    return { available: false, error: error && error.message ? error.message : String(error), block: false, review: false };
  }
}

module.exports = { scanL2, encode, assets, T_BLOCK, T_REVIEW };
