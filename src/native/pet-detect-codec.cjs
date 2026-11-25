'use strict';
// Ramo Pet — detector maths.
//
// This file is the part of on-device detection that has nothing to do with
// ONNX Runtime or Electron: the letterbox, the tensor layout, the decoding of
// the network's outputs, the suppression of duplicate boxes and the tracing of
// a segmentation mask into one outline. Keeping it here means every number can
// be checked by the model-free suite, while `pet-detect-host.cjs` only opens a
// session, feeds one frame and answers.
//
// The network is YOLOE-26s-seg, exported to ONNX at 640x640 with its class
// vocabulary baked in. Two output layouts exist in the wild and both are
// accepted here, because the export target is a pinned file but the shape of
// its head is not something this project should assume:
//
//   end-to-end  output0 [1, 300, 6 + 32]  rows of xyxy, conf, class id, 32 mask
//                                        coefficients; NMS already applied in
//                                        the graph by the YOLO26 head.
//   anchors     output0 [1, 4 + nc + 32, N]  channels of cx cy w h, one score
//                                        per class, then the same 32 mask
//                                        coefficients; NMS is done here.
//
// The mask branch is the same in both: 32 coefficients per detection, dotted
// with a [32, 160, 160] prototype stack. The prototypes cover the PADDED
// 640x640 canvas, so the padding is removed after tracing, not before; doing
// it in the other order shrinks every mask against the frame it belongs to.
//
// Nothing here decides what the pet draws. It turns pixels into boxes and one
// polygon per box; `pet-sketch.cjs` turns a polygon into drawing commands.

const INPUT_SIZE = 640;
const PAD_VALUE = 114;
const COEFFS = 32;

// The letterbox the frame is fitted into: keep the aspect ratio, centre the
// picture, fill the rest with the same grey Ultralytics uses for training.
// The main process resizes the capture to `w x h` with Electron's own scaler,
// so the expensive resample happens once, in native code, and not in JS.
function letterbox(width, height, size = INPUT_SIZE) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const scale = Math.min(size / safeWidth, size / safeHeight);
  const w = Math.max(1, Math.min(size, Math.round(safeWidth * scale)));
  const h = Math.max(1, Math.min(size, Math.round(safeHeight * scale)));
  return {size, scale, w, h, padX: Math.floor((size - w) / 2), padY: Math.floor((size - h) / 2)};
}

// BGRA bytes (what `nativeImage.toBitmap()` returns on Windows) into the
// float32 NCHW tensor the export expects. Values are 0..1, channels are RGB in
// that order, and the padding is not resampled: it is written as flat grey.
function toTensor(bgra, width, height, meta) {
  const size = (meta && meta.size) || INPUT_SIZE;
  const padX = (meta && meta.padX) || 0;
  const padY = (meta && meta.padY) || 0;
  const plane = size * size;
  const tensor = new Float32Array(plane * 3);
  const pad = PAD_VALUE / 255;
  tensor.fill(pad);
  const w = Math.min(width, size - padX);
  const h = Math.min(height, size - padY);
  for (let y = 0; y < h; y++) {
    let source = y * width * 4;
    let target = (y + padY) * size + padX;
    for (let x = 0; x < w; x++) {
      const i = source + x * 4;
      const j = target + x;
      tensor[j] = bgra[i + 2] / 255;
      tensor[plane + j] = bgra[i + 1] / 255;
      tensor[plane * 2 + j] = bgra[i] / 255;
    }
  }
  return tensor;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (overlap <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - overlap;
  return union > 0 ? overlap / union : 0;
}

// One box per object. The end-to-end head already suppresses duplicates, but a
// cheap pass here is still worth it: one object can fire twice at two guessed
// classes, and the numbered disc the model is shown must not point at the same
// thing twice.
function dedupe(boxes, threshold = 0.5) {
  const kept = [];
  for (const box of boxes.slice().sort((a, b) => b.conf - a.conf)) {
    if (kept.some((other) => iou(other, box) > threshold)) continue;
    kept.push(box);
  }
  return kept;
}

// Which output is which. The detection tensor always carries the mask
// coefficients; the prototype stack is the four dimensional one.
function findOutputs(outputs) {
  let detections = null;
  let protos = null;
  for (const output of outputs || []) {
    const dims = output && output.dims ? output.dims : [];
    if (dims.length === 4) protos = output;
    else if (dims.length === 3) detections = output;
  }
  return {detections, protos};
}

function at(data, index) {
  const value = data[index];
  return Number.isFinite(value) ? value : 0;
}

// Turn one row or one anchor into a box in the 640x640 input frame.
function plainBox(raw, options) {
  if (!(raw.w > 0 && raw.h > 0)) return null;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  if (raw.conf < options.conf) return null;
  return {
    x: raw.x,
    y: raw.y,
    w: raw.w,
    h: raw.h,
    conf: raw.conf,
    cls: raw.cls,
    coeffs: raw.coeffs
  };
}

function decodeRows(output, options) {
  const dims = output.dims;
  const rows = dims[1];
  const attrs = dims[2];
  const data = output.data;
  const endToEnd = attrs === 6 + COEFFS;
  const classes = endToEnd ? 1 : attrs - 4 - COEFFS;
  const boxes = [];
  for (let i = 0; i < rows; i++) {
    const base = i * attrs;
    const coeffs = [];
    for (let c = 0; c < COEFFS; c++) coeffs.push(at(data, base + (endToEnd ? 6 : 4 + classes) + c));
    let conf = 0;
    let cls = -1;
    if (endToEnd) {
      conf = at(data, base + 4);
      cls = Math.round(at(data, base + 5));
    } else {
      for (let k = 0; k < classes; k++) {
        const score = at(data, base + 4 + k);
        if (score > conf) { conf = score; cls = k; }
      }
    }
    if (conf < options.conf) continue;
    const a = at(data, base);
    const b = at(data, base + 1);
    const c = at(data, base + 2);
    const d = at(data, base + 3);
    const box = endToEnd
      ? plainBox({x: a, y: b, w: c - a, h: d - b, conf, cls, coeffs}, options)
      : plainBox({x: a - c / 2, y: b - d / 2, w: c, h: d, conf, cls, coeffs}, options);
    if (box) boxes.push(box);
  }
  return boxes;
}

function decodeAnchors(output, options) {
  const dims = output.dims;
  const attrs = dims[1];
  const anchors = dims[2];
  const classes = attrs - 4 - COEFFS;
  const data = output.data;
  const boxes = [];
  for (let i = 0; i < anchors; i++) {
    let conf = 0;
    let cls = -1;
    for (let k = 0; k < classes; k++) {
      const score = at(data, (4 + k) * anchors + i);
      if (score > conf) { conf = score; cls = k; }
    }
    if (conf < options.conf) continue;
    const cx = at(data, i);
    const cy = at(data, anchors + i);
    const w = at(data, anchors * 2 + i);
    const h = at(data, anchors * 3 + i);
    const coeffs = [];
    for (let c = 0; c < COEFFS; c++) coeffs.push(at(data, (4 + classes + c) * anchors + i));
    const box = plainBox({x: cx - w / 2, y: cy - h / 2, w, h, conf, cls, coeffs}, options);
    if (box) boxes.push(box);
  }
  return boxes;
}

// Input-frame boxes -> the frame of the original capture. `meta` is the
// letterbox that produced the input, so this is the exact inverse.
function toFrame(box, meta) {
  const scale = meta && meta.scale ? meta.scale : 1;
  const padX = (meta && meta.padX) || 0;
  const padY = (meta && meta.padY) || 0;
  return {
    x: (box.x - padX) / scale,
    y: (box.y - padY) / scale,
    w: box.w / scale,
    h: box.h / scale,
    conf: box.conf,
    cls: box.cls
  };
}

function clipBox(box, width, height) {
  const x = Math.max(0, Math.min(width - 1, box.x));
  const y = Math.max(0, Math.min(height - 1, box.y));
  const right = Math.max(x + 1, Math.min(width, box.x + box.w));
  const bottom = Math.max(y + 1, Math.min(height, box.y + box.h));
  return {x, y, w: right - x, h: bottom - y, conf: box.conf, cls: box.cls};
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

// Trace one mask into a polygon, in the frame of the original capture.
//
// The coefficients are dotted with the prototypes over the padded canvas; the
// result is thresholded inside the detection's own box, and the outline is the
// per-row extent of the true pixels. That is a silhouette rather than a
// marching-squares contour, which is deliberate: it is monotone, it cannot
// produce a self-intersecting path, and at 160x160 the loss against a proper
// contour is smaller than the wobble the mask already has. The polygon is then
// reduced by RDP so it fits the sketch contract's 30 points.
function maskPolygon(coeffs, protos, box, options) {
  if (!protos || !protos.data || !box) return null;
  const dims = protos.dims;
  const channels = dims[1];
  const mh = dims[2];
  const mw = dims[3];
  const data = protos.data;
  const threshold = options && Number.isFinite(options.threshold) ? options.threshold : 0.5;
  const mx = mw / INPUT_SIZE;
  const my = mh / INPUT_SIZE;
  const left = Math.max(0, Math.floor(box.x * mx));
  const right = Math.min(mw - 1, Math.ceil((box.x + box.w) * mx));
  const top = Math.max(0, Math.floor(box.y * my));
  const bottom = Math.min(mh - 1, Math.ceil((box.y + box.h) * my));
  if (right <= left || bottom <= top) return null;
  // Left edge downwards, right edge upwards: a closed ring without crossings.
  const lefts = [];
  const rights = [];
  for (let y = top; y <= bottom; y++) {
    let first = -1;
    let last = -1;
    for (let x = left; x <= right; x++) {
      let logit = 0;
      for (let c = 0; c < channels; c++) logit += coeffs[c] * data[(c * mh + y) * mw + x];
      if (sigmoid(logit) < threshold) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    lefts.push([first, y]);
    rights.push([last, y]);
  }
  if (lefts.length < 3) return null;
  const ring = lefts.concat(rights.reverse());
  const reduced = simplify(ring, Math.max(1, ((right - left) + (bottom - top)) * 0.02));
  return reduced.map(([x, y]) => [x / mx, y / my]);
}

// Ramer-Douglas-Peucker. One number decides how many of the outline's points
// survive: the sketch contract allows 30, and a mark with too many corners is
// harder to read than a smooth silhouette.
function simplify(points, tolerance) {
  if (!points || points.length <= 3) return points || [];
  let max = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointLineDistance(points[i], first, last);
    if (d > max) { max = d; index = i; }
  }
  if (max <= tolerance) return [first, last];
  const head = simplify(points.slice(0, index + 1), tolerance);
  const tail = simplify(points.slice(index), tolerance);
  return head.slice(0, -1).concat(tail);
}

function pointLineDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  return Math.abs(dy * point[0] - dx * point[1] + b[0] * a[1] - b[1] * a[0]) / length;
}

// The whole post-processing step: outputs -> boxes in the capture's own frame,
// sorted by confidence, de-duplicated, with the first `limit` kept and an
// outline polygon where a mask was produced.
function postprocess(outputs, meta, options = {}) {
  const conf = Number.isFinite(options.conf) ? options.conf : 0.25;
  const iouThreshold = Number.isFinite(options.iou) ? options.iou : 0.5;
  const limit = Number.isFinite(options.limit) ? options.limit : 12;
  const width = Math.max(1, Math.round(meta.width));
  const height = Math.max(1, Math.round(meta.height));
  const found = findOutputs(outputs);
  if (!found.detections) return [];
  const dims = found.detections.dims;
  // A rows tensor has fewer attributes than rows ([1, 300, 38]); a channels
  // tensor has fewer channels than anchors ([1, 38, 8400]).
  const raw = dims[2] > dims[1]
    ? decodeAnchors(found.detections, {conf})
    : decodeRows(found.detections, {conf});
  const kept = dedupe(raw, iouThreshold).slice(0, limit);
  return kept.map((box) => {
    const frame = toFrame(box, meta);
    const clipped = clipBox(frame, width, height);
    const polygon = found.protos
      ? maskPolygon(box.coeffs, found.protos, box, {threshold: options.maskThreshold})
      : null;
    return {
      x: clipped.x,
      y: clipped.y,
      w: clipped.w,
      h: clipped.h,
      conf: clipped.conf,
      cls: clipped.cls,
      polygon: polygon
        ? polygon.map(([x, y]) => {
          const mapped = toFrame({x, y, w: 0, h: 0}, meta);
          return [Math.max(0, Math.min(width, mapped.x)), Math.max(0, Math.min(height, mapped.y))];
        })
        : null
    };
  });
}

// The set-of-marks picture: a numbered disc on every candidate.
//
// The disc sits on the centre of the candidate's box, in the picture the model
// is shown, and it is filled and at least 24 pixels across, because a stroked
// ring cannot hold a readable number and a smaller number is a number the
// model cannot read.
//
// The positions are in the 0..1000 space the canvas renderer draws in, and the
// radius is converted through the same `unit` the renderer uses, so the disc
// is the requested size in pixels of the picture.
function somStrokes(boxes, options = {}) {
  const strokes = [];
  const captureWidth = Math.max(1, Number(options.captureWidth) || 1);
  const captureHeight = Math.max(1, Number(options.captureHeight) || 1);
  const viewWidth = Math.max(1, Number(options.viewWidth) || captureWidth);
  const viewHeight = Math.max(1, Number(options.viewHeight) || captureHeight);
  const discSize = Math.max(24, Math.round(Number(options.discSize) || 28));
  const unit = Math.min(viewWidth, viewHeight) / 1000;
  const radius = Math.max(1, (discSize / 2) / unit);
  const scaleX = viewWidth / captureWidth;
  const scaleY = viewHeight / captureHeight;
  const list = Array.isArray(options.boxes) ? options.boxes : [];
  list.forEach((box, index) => {
    const cx = (Number(box.x) + Number(box.w) / 2) * scaleX;
    const cy = (Number(box.y) + Number(box.h) / 2) * scaleY;
    strokes.push({type: 'disc', cx: cx / unit, cy: cy / unit, r: radius, color: '#ffd54a'});
    strokes.push({
      type: 'text',
      text: String(index + 1),
      x: cx / unit,
      y: cy / unit,
      fontPx: Math.round(discSize * 0.62),
      bold: true,
      align: 'center',
      inkCenter: true,
      color: '#000000'
    });
  });
  return strokes;
}

module.exports = {
  INPUT_SIZE,
  PAD_VALUE,
  COEFFS,
  letterbox,
  toTensor,
  iou,
  dedupe,
  postprocess,
  maskPolygon,
  simplify,
  pointLineDistance,
  somStrokes
};
