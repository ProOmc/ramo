'use strict';
/**
 * Step-3 guard: Mirror-style L1 + local ONNX CPU L2.
 *
 * Runs in the Electron main process beside the browser host. Its only effect
 * on the reader is annotation: flagged units are marked as untrusted and
 * routed for review. It never grants a capability or changes permissions.
 */

const fs = require('node:fs');
const path = require('node:path');

let l1 = null;
let l2 = null;
let weights = null;

function load() {
  if (l1 && l2 && weights) return;
  const root = path.resolve(__dirname, '..');
  const candidates = [
    path.join(root, 'build/injection-l1.cjs'),
    path.join(root, '../build/injection-l1.cjs'),
  ];
  const l1File = candidates.find(file => fs.existsSync(file));
  const weightsFile = [
    path.resolve(__dirname, 'detectors/injection-l1-weights.json'),
    path.join(root, 'vendor/detectors/injection-l1-weights.json'),
    path.join(root, '../vendor/detectors/injection-l1-weights.json'),
  ].find(file => fs.existsSync(file));
  if (!l1File || !weightsFile) throw new Error('L1 assets are missing');
  l1 = require(l1File);
  weights = JSON.parse(fs.readFileSync(weightsFile, 'utf8')).weights;
  l2 = require(path.join(__dirname, 'injection-l2.cjs'));
}

async function scanText(text) {
  load();
  const l1Result = l1.scoreL1(String(text || ''), weights);
  const l2Result = await l2.scanL2(String(text || ''));
  const flagged = l1Result.fired || l2Result.review;
  return {
    l1: { score: l1Result.score, fired: l1Result.fired, features: l1Result.features },
    l2: { available: l2Result.available, probability: l2Result.probability ?? null, review: !!l2Result.review, block: !!l2Result.block, error: l2Result.error || null },
    flagged,
    action: flagged ? 'annotate-and-review' : 'none',
  };
}

async function annotate(observation) {
  if (!observation || typeof observation !== 'object') return observation;
  const out = { ...observation };
  for (const key of ['units', 'controls']) {
    if (!Array.isArray(out[key])) continue;
    out[key] = await Promise.all(out[key].map(async unit => {
      const scan = await scanText(unit.text);
      return { ...unit, injection: scan, ...(scan.flagged ? { text: `[FLAGGED: untrusted page content] ${unit.text}` } : {}) };
    }));
  }
  const flagged = [...(out.units || []), ...(out.controls || [])].some(unit => unit.injection && unit.injection.flagged);
  out.guard = {
    kind: 'injection-guard-result',
    flagged,
    reviewRecommended: flagged,
    toolsDisabled: flagged,
    note: 'Scores only annotate untrusted content and recommend review. They never grant permission and never decide what the page means.',
    l1Weights: 'ramo-local-fixtures',
  };
  return out;
}

module.exports = { scanText, annotate };
