/**
 * Mirror-style L1: sparse character n-gram linear scoring.
 *
 * This is a Ramo-local implementation of the *shape* of the Mirror design
 * pattern (char n-grams + linear weights, deterministic and auditable). It is
 * NOT the paper's compiled artifact or weights, and its numbers are not the
 * paper's 95.97% recall / 92.07% F1. Weights are trained on Ramo's own small
 * fixture set by tools/train-l1.cjs. Rust/cargo are unavailable on this PC.
 */

export interface L1Example { text: string; injection: boolean }

export interface L1Weights {
  version: 1;
  buckets: number;
  minN: number;
  maxN: number;
  bias: number;
  weights: Record<string, number>;
  trainedOn: string;
}

export interface L1Result {
  score: number;
  fired: boolean;
  features: string[];
}

export function charNgrams(text: string, minN = 3, maxN = 5): Map<string, number> {
  const clean = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  const out = new Map<string, number>();
  for (let n = minN; n <= maxN; n += 1) {
    for (let i = 0; i + n <= clean.length; i += 1) {
      const gram = clean.slice(i, i + n);
      out.set(gram, (out.get(gram) ?? 0) + 1);
    }
  }
  return out;
}

function hash(gram: string, buckets: number): number {
  let value = 2166136261;
  for (let i = 0; i < gram.length; i += 1) {
    value ^= gram.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) % buckets;
}

function bucketsFor(text: string, weights: L1Weights): Map<number, number> {
  const out = new Map<number, number>();
  for (const [gram, count] of charNgrams(text, weights.minN, weights.maxN)) {
    const bucket = hash(gram, weights.buckets);
    out.set(bucket, Math.min(3, (out.get(bucket) ?? 0) + Math.min(count, 3)));
  }
  return out;
}

/** Deterministic perceptron-style training over hashed char n-grams. */
export function trainLinear(examples: L1Example[], options: { buckets?: number; minN?: number; maxN?: number; epochs?: number } = {}): L1Weights {
  const buckets = options.buckets ?? 4096;
  const minN = options.minN ?? 3;
  const maxN = options.maxN ?? 5;
  const weights: Record<string, number> = {};
  let bias = 0;
  const epochs = options.epochs ?? 12;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const example of examples) {
      const features = bucketsFor(example.text, { version: 1, buckets, minN, maxN, bias: 0, weights, trainedOn: "" });
      const sum = bias + [...features].reduce((total, [bucket, count]) => total + (weights[String(bucket)] ?? 0) * count, 0);
      const label = example.injection ? 1 : -1;
      if (label * sum > 0) continue;
      bias += label * 0.25;
      for (const [bucket, count] of features) {
        const key = String(bucket);
        weights[key] = (weights[key] ?? 0) + label * 0.25 * count;
      }
    }
  }
  return { version: 1, buckets, minN, maxN, bias, weights, trainedOn: `ramo-fixtures:${examples.length}` };
}

/** Score text. A flag only annotates content; it never decides actions. */
export function scoreL1(text: string, weights: L1Weights, threshold = 0.35): L1Result {
  const features = bucketsFor(text, weights);
  let sum = weights.bias;
  const top: string[] = [];
  for (const [bucket, count] of features) {
    const weight = weights.weights[String(bucket)] ?? 0;
    sum += weight * count;
    if (weight > 0.1 && top.length < 6) top.push(`${bucket}:${weight.toFixed(2)}`);
  }
  const length = Math.max(1, String(text || "").length);
  const score = Math.max(0, Math.min(1, sum / Math.sqrt(length)));
  return { score: Math.round(score * 10000) / 10000, fired: score >= threshold, features: top };
}
