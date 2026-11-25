'use strict';
// Ramo Pet — the screen side of grounded drawing.
//
// Three jobs, all local:
//   1. capture the display the pointer is on, at full resolution, so a crop
//      can be taken from the real pixels rather than from a downscaled copy;
//   2. cut a crop out of that capture and hand it to the model as JPEG;
//   3. draw the model's own strokes back onto a crop, so the verification
//      stage can ask the model whether the shape really surrounds the target.
//
// It also draws the numbered grid the locate stage asks about: the screen
// view covered with numbered cells, so the model can answer "which cell" and
// the pet can crop that cell at full resolution.
//
// The shape overlay uses a hidden canvas page. That is the same mechanism the
// numbered grid uses, so there is one way to put pixels on an image in this
// app and no new native dependency.

const {BrowserWindow, desktopCapturer, screen} = require('electron');
const codec = require('./pet-detect-codec.cjs');

const CANVAS_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>ramo screen</title></head>' +
  '<body style="margin:0;background:#000"><canvas id="c"></canvas></body></html>';

let canvasWindow = null;
let canvasReady = null;

async function ensureCanvas() {
  if (canvasWindow && !canvasWindow.isDestroyed()) return canvasWindow;
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#000000',
    webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}
  });
  canvasWindow = win;
  canvasReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('the canvas page did not load')), 10000);
    win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(true); });
    win.webContents.once('did-fail-load', (_event, _code, description) => { clearTimeout(timer); reject(Error('the canvas page failed: ' + description)); });
    win.loadURL('data:text/html,' + encodeURIComponent(CANVAS_HTML));
  });
  win.on('closed', () => { canvasWindow = null; canvasReady = null; });
  await canvasReady;
  return win;
}

// The display at a third of its size, as the tracker works.
//
// The tracking loop runs every 150 ms, so the capture has to be cheap. Asking
// desktopCapturer for a small thumbnail gets the scaler to do the work in
// native code instead of reading back two million pixels just to throw four
// out of five away.
async function captureSmall(maxWidth = 640) {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = display.bounds;
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const scale = Math.min(1, Math.max(1, Math.round(maxWidth)) / width);
    const thumbW = Math.max(1, Math.round(width * scale));
    const thumbH = Math.max(1, Math.round(height * scale));
    const sources = await desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width: thumbW, height: thumbH}});
    if (!sources || !sources.length) return {ok: false};
    const source = sources.find((entry) => String(entry.display_id) === String(display.id)) || sources[0];
    const image = source.thumbnail;
    if (!image || image.isEmpty()) return {ok: false};
    const size = image.getSize();
    return {ok: true, image, width: size.width, height: size.height, captureWidth: width, captureHeight: height, bounds: {...bounds}, scale: thumbW / width};
  } catch (_) {
    return {ok: false};
  }
}

// The display the pointer is on, captured at its own resolution.
async function captureFull() {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = display.bounds;
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const sources = await desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width, height}});
    if (!sources || !sources.length) return {ok: false};
    const source = sources.find((entry) => String(entry.display_id) === String(display.id)) || sources[0];
    const image = source.thumbnail;
    if (!image || !image.isEmpty()) return {ok: true, image, width, height, bounds: {...bounds}};
    return {ok: false};
  } catch (_) {
    return {ok: false};
  }
}

// The size of the model-sized view of a capture.
//
// The screen view and the numbered-discs picture have to agree on it, because
// the discs are sized in the pixels of the picture the model is shown. It is
// computed once here so the two cannot drift apart.
function viewSize(capture, options = {}) {
  const maxWidth = options.maxWidth || 1280;
  if (!capture || !capture.ok || !capture.image) return {width: 0, height: 0};
  const size = capture.image.getSize();
  const width = Math.min(maxWidth, Math.max(320, size.width));
  const height = Math.max(1, Math.round(size.height * (width / size.width)));
  return {width, height};
}

// The whole screen, resized for the model. This is the image the routing and
// drawing stages look at.
//
// The resize is done with the best filter Electron has. The cheaper filter
// softens small things: measured against the fixture set, the game character
// was a smear of cyan in the soft picture and the model named the wrong grid
// cell for it. A sharper view is worth the few milliseconds.
function screenView(capture, options = {}) {
  try {
    if (!capture || !capture.ok || !capture.image) return null;
    const quality = options.quality || 90;
    const size = capture.image.getSize();
    const {width, height} = viewSize(capture, options);
    const view = (width === size.width && height === size.height)
      ? capture.image
      : capture.image.resize({width, height, quality: 'best'});
    return view.toJPEG(quality).toString('base64');
  } catch (_) {
    return null;
  }
}

// Cut a rectangle out of the full-resolution capture. `rect` is in the
// 0..1000 canvas space, so it is the same rectangle the model reasoned about.
function crop(capture, rect, options = {}) {
  try {
    if (!capture || !capture.ok || !capture.image || !rect) return {ok: false, error: 'there was no capture to crop'};
    const size = capture.image.getSize();
    const sx = size.width / 1000;
    const sy = size.height / 1000;
    const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x * sx)));
    const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y * sy)));
    const width = Math.max(1, Math.min(size.width - x, Math.round(rect.w * sx)));
    const height = Math.max(1, Math.min(size.height - y, Math.round(rect.h * sy)));
    const piece = capture.image.crop({x, y, width, height});
    const maxWidth = options.maxWidth || 1280;
    const quality = options.quality || 90;
    // The contract asks for a 2x upscale capped at 1280 wide. A very small
    // crop is enlarged further, because a 30 pixel crop is unreadable to the
    // model even when it is technically correct.
    let scale = Number(options.upscale) || 1;
    const pieceWidth = piece.getSize().width;
    if (pieceWidth * scale < 160) scale = Math.min(8, 160 / Math.max(1, pieceWidth));
    let targetWidth = Math.min(maxWidth, Math.max(1, Math.round(pieceWidth * scale)));
    let targetHeight = Math.max(1, Math.round(piece.getSize().height * (targetWidth / Math.max(1, pieceWidth))));
    // The crop is resized with the best filter too. The crop is where the
    // refine and zoom stages look, so a soft filter blurs the very thing
    // they are being asked to place. Measured against the fixture set, the
    // sharp crop put the mark a median of 54 units away from the target
    // against 66 for the soft one.
    const resized = (targetWidth === pieceWidth && targetHeight === piece.getSize().height)
      ? piece
      : piece.resize({width: targetWidth, height: targetHeight, quality: 'best'});
    return {ok: true, base64: resized.toJPEG(quality).toString('base64'), width: targetWidth, height: targetHeight};
  } catch (error) {
    return {ok: false, error: 'the crop failed: ' + (error && error.message ? error.message : String(error))};
  }
}

// The drawing code that runs inside the hidden canvas page. It maps the
// global 0..1000 canvas onto the crop it is given and draws the model's
// strokes, then any marks (the rejected centre is marked with a red X).
//
// A stroke may carry its own colour, and a text stroke may say how it wants
// to be set. That is what lets the numbered grid be drawn with cyan borders
// and yellow numbers through this same page: one way to put pixels on an
// image, not two.
const CANVAS_SCRIPT = `(async (payload) => {
  const image = new Image();
  image.src = 'data:image/jpeg;base64,' + payload.image;
  try { await image.decode(); } catch (error) { return null; }
  const canvas = document.getElementById('c');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const rect = payload.rect;
  const sx = canvas.width / rect.w;
  const sy = canvas.height / rect.h;
  const unit = Math.min(sx, sy);
  const px = (gx) => (gx - rect.x) * sx;
  const py = (gy) => (gy - rect.y) * sy;
  ctx.strokeStyle = payload.color || '#ff4d4d';
  ctx.fillStyle = payload.color || '#ff4d4d';
  ctx.lineWidth = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) / 90));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of payload.strokes || []) {
    if (stroke.color) {
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
    }
    ctx.beginPath();
    if (stroke.type === 'circle') {
      ctx.arc(px(stroke.cx), py(stroke.cy), Math.max(1, stroke.r * unit), 0, Math.PI * 2);
    } else if (stroke.type === 'disc') {
      // A filled circle. The set-of-marks picture numbers its candidates with
      // these, and a stroked ring cannot hold a readable number.
      ctx.arc(px(stroke.cx), py(stroke.cy), Math.max(1, stroke.r * unit), 0, Math.PI * 2);
      ctx.fillStyle = stroke.color || ctx.fillStyle;
      ctx.fill();
      continue;
    } else if (stroke.type === 'arc') {
      ctx.arc(px(stroke.cx), py(stroke.cy), Math.max(1, stroke.r * unit), (stroke.a1 || 0) * Math.PI / 180, (stroke.a2 || 180) * Math.PI / 180);
    } else if (stroke.type === 'line') {
      ctx.moveTo(px(stroke.x1), py(stroke.y1));
      ctx.lineTo(px(stroke.x2), py(stroke.y2));
    } else if (stroke.type === 'rect') {
      // The strokes arrive in the parsed 0..1000 canvas space (x1/y1/x2/y2);
      // the projected form (x/y/w/h) is accepted too.
      const hasCorners = stroke.x1 !== undefined && stroke.x2 !== undefined;
      const x1 = hasCorners ? Math.min(stroke.x1, stroke.x2) : stroke.x;
      const x2 = hasCorners ? Math.max(stroke.x1, stroke.x2) : stroke.x + stroke.w;
      const y1 = hasCorners ? Math.min(stroke.y1, stroke.y2) : stroke.y;
      const y2 = hasCorners ? Math.max(stroke.y1, stroke.y2) : stroke.y + stroke.h;
      ctx.rect(px(x1), py(y1), Math.max(1, (x2 - x1) * sx), Math.max(1, (y2 - y1) * sy));
    } else if (stroke.type === 'polyline') {
      const points = stroke.points || [];
      if (points.length < 2) continue;
      ctx.moveTo(px(points[0].x), py(points[0].y));
      for (let i = 1; i < points.length; i++) ctx.lineTo(px(points[i].x), py(points[i].y));
    } else if (stroke.type === 'arrow') {
      ctx.moveTo(px(stroke.x1), py(stroke.y1));
      ctx.lineTo(px(stroke.x2), py(stroke.y2));
      const angle = Math.atan2(py(stroke.y2) - py(stroke.y1), px(stroke.x2) - px(stroke.x1));
      const head = Math.max(8, ctx.lineWidth * 4);
      ctx.moveTo(px(stroke.x2), py(stroke.y2));
      ctx.lineTo(px(stroke.x2) - head * Math.cos(angle - 0.4), py(stroke.y2) - head * Math.sin(angle - 0.4));
      ctx.moveTo(px(stroke.x2), py(stroke.y2));
      ctx.lineTo(px(stroke.x2) - head * Math.cos(angle + 0.4), py(stroke.y2) - head * Math.sin(angle + 0.4));
    } else if (stroke.type === 'text') {
      // A text stroke may set its own font and alignment. The grid uses that
      // to centre a number in its cell; a sketch's own text keeps the old
      // plain look.
      const fontPx = stroke.fontPx || Math.max(10, Math.round(stroke.size * unit));
      ctx.font = (stroke.bold === true ? 'bold ' : '') + fontPx + 'px sans-serif';
      ctx.textAlign = stroke.align || 'left';
      if (stroke.inkCenter === true) {
        // Centre the INK of the text on the point, not the em box. Chromium's
        // "middle" baseline puts the glyph well above the point (about 20
        // pixels for a 44 pixel digit), which is enough to put a cell number
        // on top of the thing the model is being asked to find.
        ctx.textBaseline = 'alphabetic';
        const metrics = ctx.measureText(stroke.text || '');
        const ascent = metrics.actualBoundingBoxAscent || fontPx * 0.8;
        const descent = metrics.actualBoundingBoxDescent || fontPx * 0.2;
        // The ink of the glyph is centred on the point. The offset is in
        // pixels, and py() already returns pixels.
        ctx.fillText(stroke.text || '', px(stroke.x), py(stroke.y) + (ascent - descent) / 2);
      } else {
        ctx.textBaseline = stroke.baseline || 'alphabetic';
        ctx.fillText(stroke.text || '', px(stroke.x), py(stroke.y));
      }
      continue;
    }
    ctx.stroke();
  }
  for (const mark of payload.marks || []) {
    if (mark.type !== 'x') continue;
    if (mark.color) {
      ctx.strokeStyle = mark.color;
      ctx.fillStyle = mark.color;
    }
    const r = Math.max(6, (mark.radius || 20) * unit);
    const x = px(mark.cx);
    const y = py(mark.cy);
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }
  return canvas.toDataURL('image/jpeg', 0.9);
})`;

// Run one payload through the hidden canvas page and get the picture back.
// Everything that puts pixels on an image goes through here, so there is one
// renderer and one set of rules.
async function renderPage(payload) {
  try {
    const win = await ensureCanvas();
    // The caller names the picture "cropBase64"; the page script expects
    // "image". This was the one name that made every check fail silently.
    const scriptPayload = Object.assign({}, payload, {image: payload.cropBase64 || payload.image || ''});
    const dataUrl = await win.webContents.executeJavaScript(
      CANVAS_SCRIPT + '(' + JSON.stringify(scriptPayload) + ')',
      true
    );
    if (!dataUrl || typeof dataUrl !== 'string') return {ok: false, error: 'the canvas page returned no image'};
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return {ok: false, error: 'the canvas page returned an image in an unknown form'};
    const base64 = Buffer.from(dataUrl.slice(comma + 1), 'base64').toString('base64');
    return {ok: true, base64};
  } catch (error) {
    return {ok: false, error: 'the shape could not be drawn: ' + (error && error.message ? error.message : String(error))};
  }
}

// Draw the strokes (and any marks) onto a crop and return the new image.
async function renderShape(payload) {
  return renderPage(payload);
}

// The numbered grid.
//
// The model finds a small target on a 1920 wide screen far more reliably when
// it is asked which numbered cell the thing is in than when it is asked for
// a pixel. So the screen view is covered with a grid, every cell carries its
// number, and the answer to "where is it" is a cell number.
//
// The numbers sit in the middle of their cell on purpose: the number ends up
// next to the target, and a small model matches the two far better than it
// matches a far away label. The number is drawn eight times in black and once
// in yellow, so it stays readable over any background.
//
// `rejectCell` marks the cell the pet used last time with a red X. That is
// what the retry asks about: the same grid, with the wrong answer crossed
// out.
//
// payload:
//   imageBase64  the screen view to draw on
//   cols, rows   the grid shape
//   numSize      the height of a number, in pixels of the image
//   rejectCell   the cell number to cross out (optional)
function gridStrokes(cols, rows, numSize, rejectCell) {
  const strokes = [];
  const cellW = 1000 / cols;
  const cellH = 1000 / rows;
  const border = '#00ffff';
  const number = '#ffe600';
  const outline = '#000000';
  for (let index = 0; index < cols * rows; index++) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x0 = col * cellW;
    const y0 = row * cellH;
    const x1 = x0 + cellW;
    const y1 = y0 + cellH;
    strokes.push({type: 'rect', x1: x0, y1: y0, x2: x1, y2: y1, color: border});
    // The number, centred in the cell, outlined in black so it can be read
    // over a white window or a black terminal. The ink is centred exactly:
    // a number that sits above the middle of its cell can land on top of the
    // thing the model is being asked to find.
    const cx = x0 + cellW / 2;
    const cy = y0 + cellH / 2;
    const step = Math.max(2, Math.round(numSize * 0.08));
    for (const [ox, oy] of [[-step, 0], [step, 0], [0, -step], [0, step],
      [-step, -step], [step, step], [-step, step], [step, -step]]) {
      strokes.push({
        type: 'text',
        text: String(index + 1),
        x: cx + ox,
        y: cy + oy,
        fontPx: numSize,
        bold: true,
        align: 'center',
        inkCenter: true,
        color: outline
      });
    }
    strokes.push({
      type: 'text',
      text: String(index + 1),
      x: cx,
      y: cy,
      fontPx: numSize,
      bold: true,
      align: 'center',
      inkCenter: true,
      color: number
    });
  }
  const marks = [];
  const rejected = Number(rejectCell);
  if (Number.isFinite(rejected) && rejected >= 1 && rejected <= cols * rows) {
    const col = (rejected - 1) % cols;
    const row = Math.floor((rejected - 1) / cols);
    marks.push({
      type: 'x',
      cx: col * cellW + cellW / 2,
      cy: row * cellH + cellH / 2,
      radius: cellW * 0.22,
      color: '#ff2d2d'
    });
  }
  return {strokes, marks};
}

async function renderGrid(payload) {
  try {
    const cols = Math.max(1, Math.round(Number(payload.cols) || 5));
    const rows = Math.max(1, Math.round(Number(payload.rows) || 4));
    const image = String(payload.imageBase64 || payload.cropBase64 || '');
    if (!image) return {ok: false, error: 'there was no picture to put the grid on'};
    const numSize = Math.max(10, Math.round(Number(payload.numSize) || 44));
    const built = gridStrokes(cols, rows, numSize, payload.rejectCell);
    const result = await renderPage({
      cropBase64: image,
      rect: {x: 0, y: 0, w: 1000, h: 1000},
      strokes: built.strokes,
      marks: built.marks,
      color: '#00ffff'
    });
    if (!result.ok) return result;
    return {ok: true, base64: result.base64, cols, rows};
  } catch (error) {
    return {ok: false, error: 'the grid could not be drawn: ' + (error && error.message ? error.message : String(error))};
  }
}

// The set-of-marks picture.
//
// The detector proposes a shortlist of places where the target might be. The
// model is then shown the screen with a numbered disc on each proposal and
// answers with one number, so it never has to invent a coordinate: the
// coordinate comes from the detector and only the choice comes from the model.
//
// The geometry lives in `pet-detect-codec.cjs`, which has no Electron in it,
// so it can be checked by the model-free suite.
//
// payload:
//   imageBase64            the screen view to draw on
//   boxes                  [{x, y, w, h}] in CAPTURE pixels
//   captureWidth           the capture's own width in pixels
//   captureHeight          the capture's own height in pixels
//   viewWidth              the width of the picture being drawn on
//   viewHeight             the height of that picture
//   discSize               the diameter of a disc in pixels of that picture
async function renderSom(payload) {
  try {
    const image = String(payload.imageBase64 || payload.cropBase64 || '');
    if (!image) return {ok: false, error: 'there was no picture to put the numbers on'};
    const boxes = Array.isArray(payload.boxes) ? payload.boxes : [];
    if (!boxes.length) return {ok: false, error: 'there were no candidates to number'};
    const built = codec.somStrokes(boxes, payload);
    const result = await renderPage({
      cropBase64: image,
      rect: {x: 0, y: 0, w: 1000, h: 1000},
      strokes: built,
      marks: [],
      color: '#ffd54a'
    });
    if (!result.ok) return result;
    return {ok: true, base64: result.base64, count: boxes.length};
  } catch (error) {
    return {ok: false, error: 'the numbers could not be drawn: ' + (error && error.message ? error.message : String(error))};
  }
}

function dispose() {
  try {
    if (canvasWindow && !canvasWindow.isDestroyed()) canvasWindow.destroy();
  } catch (_) {}
  canvasWindow = null;
  canvasReady = null;
}

module.exports = {
  captureFull,
  captureSmall,
  screenView,
  viewSize,
  crop,
  renderShape,
  renderGrid,
  gridStrokes,
  renderSom,
  dispose
};
