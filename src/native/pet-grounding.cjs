'use strict';
// Ramo Pet — grounded drawing.
//
// The model never gets to invent a coordinate frame. Between "the user named a
// thing" and "the overlay shows a shape on it" there are three model calls on
// the happy path:
//
//   1. cell   — which numbered cell of the screen holds it? One short call on
//               the screen view with a numbered grid drawn over it.
//   2. refine — where exactly is it inside that cell? One call on a crop of
//               the FULL-resolution capture, taken from the chosen cell.
//   3. draw   — draw with that centre LOCKED into the user message.
//   4. check  — is the shape on the target? One cheap call (8 tokens) on a
//               crop of the locked box with the shape drawn on it.
//
// WHY A GRID. The first version asked for the box on the whole screen in one
// call. Measured against the frozen fixture set with the real 4B model, that
// put the mark on the target in 1 of 10 cases, and the 9B in 3 of 10: a small
// vision model cannot place a pixel on a 1920 wide screen. The same model,
// shown a numbered grid, names the right cell in 8 of 10 cases, and every one
// of its other answers was the cell next to the right one. The grid is what
// turned localisation from the worst part of the loop into the best part.
//
// There is no veto. The check cannot throw the drawing away: it decides
// whether the pet tries again, not whether the user sees anything. An earlier
// version dropped the drawing when the check said no, and on a 4B model that
// check said "no" most of the time, including on drawings that were in the
// right place - so the pet refused to draw at all. Now a failed check buys a
// RETRY: the grid is shown again with the rejected cell crossed out, the
// target is looked at again, the drawing is made again, and that drawing is
// shown. The user always gets marks; a mark in the wrong place is visible
// and fixable in one more turn, silence is not.
//
// Two rules shape this file.
//
// The model is never offered a refusal. There is no "is it there?" question
// and no "it is not there" answer, because a small model that is given that
// choice uses it far too often and loses real targets. The model always
// commits to its best guess.
//
// Model calls are the cost that matters here, on a 4B model on an 8 GB card.
// So the pipeline is as short as it can be: four calls on the happy path. A
// fifth is made only when the located target is too small to trust (a crop of
// the full-resolution capture is taken and the box is asked again inside it),
// a repair is made only when an answer cannot be used at all, and the retry
// (three more calls) is made only when the check says the shape is in the
// wrong place. One model only: there is no second model to swap in.
//
// Everything deterministic lives here: the geometry, the crop maths, the JSON
// schemas, the prompts and the loop. The model calls arrive through injected
// dependencies, so this file can be exercised without a model and without a
// screen.
//
// The contract in `pet-sketch.cjs` owns the drawing grammar. This file owns
// where the drawing goes.

const {parseSketch, sketchPrompt, boxToSketchCommands} = require('./pet-sketch.cjs');
const thinking = require('./pet-thinking.cjs');

const CANVAS = 1000;

// The grid the locate stage asks about.
//
// Five columns and four rows: twenty cells. That shape was measured against
// the frozen fixture set with the real 4B model, and it is the point where
// the model stops improving - 4x3 was 5 of 10 cells right, 5x4 was 8 of 10,
// 6x5 and 8x5 were worse (6 and 3 of 10) because the cells get too small to
// hold a readable number. A finer grid is not automatically a better grid.
const GRID_COLS = 5;
const GRID_ROWS = 4;
const GRID_CELL_COUNT = GRID_COLS * GRID_ROWS;

// The crop for the refine stage is the chosen cell plus a margin, so the
// target is still in the picture when the cell was off by a little. The
// margin is a fraction of the cell. A bigger margin was measured and was
// worse: the target got smaller in the picture and the mark landed further
// away (3 of 10 instead of 5 of 10).
const GRID_EXPAND = 0.25;

// The height of a cell number, in pixels of the screen view.
const GRID_NUM_SIZE = 44;

// The nine regions of the screen. They are geometry, not a model stage: the
// locate answer may name one, and that name is what chooses the crop for the
// refine stage. "Which third is it in?" is a question a small model answers
// far more reliably than "which pixel?", and it survives a downscale.
const ROUTING_CELLS = Object.freeze([
  'top-left', 'top', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom', 'bottom-right'
]);

// The stages and their budgets. Every grounding call is deterministic:
// temperature 0, no hidden thinking, the model stays resident.
//
// A "think hard" request gets the same stages with reasoning switched on and
// a budget that leaves room for the reasoning as well as the answer.
const GROUNDING_STAGES = Object.freeze({
  pick: Object.freeze({numPredict: 32, temperature: 0}),
  cell: Object.freeze({numPredict: 16, temperature: 0}),
  locate: Object.freeze({numPredict: 64, temperature: 0}),
  refine: Object.freeze({numPredict: 64, temperature: 0}),
  draw: Object.freeze({numPredict: 320, temperature: 0}),
  check: Object.freeze({numPredict: 8, temperature: 0})
});

const GROUNDING_STAGES_THINKING = Object.freeze({
  pick: Object.freeze({numPredict: 128, temperature: 0}),
  cell: Object.freeze({numPredict: 128, temperature: 0}),
  locate: Object.freeze({numPredict: 384, temperature: 0}),
  refine: Object.freeze({numPredict: 384, temperature: 0}),
  draw: Object.freeze({numPredict: 768, temperature: 0}),
  check: Object.freeze({numPredict: 96, temperature: 0})
});

// The budgets for this turn.
function stagesFor(wantsReasoning) {
  return wantsReasoning ? GROUNDING_STAGES_THINKING : GROUNDING_STAGES;
}

// A target smaller than this, in screen pixels, cannot be placed from the
// downscaled screen view alone. It gets one extra look inside a crop of the
// full-resolution capture.
const SMALL_TARGET_PIXELS = 40;

// The zoom stage.
//
// The answer that comes back from the cell crop is often a small thing inside
// a big picture, and a small thing is hard to place exactly. Measured against
// the fixture set with the real 4B model, one more look in a tight crop around
// that answer moved the mark from a median of 64 units away to 43 units away.
// It costs one call, and it is spent on the things that need it: a box bigger
// than a quarter of the screen is already placed well enough, and a big window
// does not need a closer look.
const ZOOM_MAX_BOX = 250;

// The crop for that extra look is never smaller than this, in 0..1000 units
// (about 115 px on a 1920 wide screen), so a tiny target still arrives at the
// model at a readable size.
const REFINE_MIN_REGION = 60;

// The drawing is made on a crop around the target rather than on the whole
// screen. A smaller picture is a faster call, and the model sees the thing at
// a size it can actually draw. These are the bounds of that crop, in 0..1000
// units, and the width the picture is sent at.
const DRAW_MIN_REGION = 220;
const DRAW_MAX_REGION = 520;
const DRAW_MAX_WIDTH = 768;

// The smallest mark the pet will draw, as a half-size in 0..1000 screen units
// (12 units is 23 pixels on a 1920 wide screen).
//
// The model sizes its circle by the SMALLER of the two locked numbers, and
// the located box can be absurdly thin: the taskbar clock was measured as
// 18 x 1 units, and the pet answered the user's "circle the clock" with a
// circle of radius 0.6 units - one pixel. The user asked for a ring around a
// thing and got a speck, so the mark has a floor. It is still the model's
// drawing: the floor only says how big the ring is asked to be.
const MIN_MARK_HALF = 12;

// The detector.
//
// One detector proposes a shortlist of places where the target might be, the
// model is shown the screen with a numbered disc on each, and it answers with
// one number. The mark is then made from the detector's own box, so the model
// never has to invent a coordinate.
//
// The score a detection needs is low on purpose. The model is shown the
// candidates and picks one, so a detection that never made the list is a lost
// answer, while a wrong one costs a disc and a look. The list is short (a
// dozen), because a long list is a list the model cannot read.
const DETECT_CONF = 0.05;
const DETECT_LIMIT = 12;

// The diameter of a numbered disc, in pixels of the picture the model sees.
// It is never smaller than 24, because a number the model cannot read is a
// number it cannot answer with.
const SOM_DISC = 28;

// Flat JSON schemas. Ollama takes a schema directly, so the model cannot
// answer in prose on these stages.
//
// The cell answer is one number: which cell of the numbered grid holds the
// target. There is nothing else to ask for, so the answer is one number too.
const CELL_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    cell: Object.freeze({type: 'integer'})
  }),
  required: Object.freeze(['cell'])
});

// The locate answer may carry a region name as well as the box. The region is
// advisory: it picks the crop for the refine stage, and it is ignored if it
// is not one of the nine.
const LOCATE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    cell: Object.freeze({type: 'string', enum: ROUTING_CELLS}),
    cx: Object.freeze({type: 'number'}),
    cy: Object.freeze({type: 'number'}),
    w: Object.freeze({type: 'number'}),
    h: Object.freeze({type: 'number'})
  }),
  required: Object.freeze(['cx', 'cy', 'w', 'h'])
});

const REFINE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    cx: Object.freeze({type: 'number'}),
    cy: Object.freeze({type: 'number'}),
    w: Object.freeze({type: 'number'}),
    h: Object.freeze({type: 'number'})
  }),
  required: Object.freeze(['cx', 'cy', 'w', 'h'])
});

// The check is one boolean. It buys a retry, never a veto, so it is asked in
// the most forgiving way that still means something: "are the marks on it?"
const CHECK_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    verified: Object.freeze({type: 'boolean'})
  }),
  required: Object.freeze(['verified'])
});

// The pick answer is one number: which numbered candidate is the target.
//
// The number is the WHOLE point of this branch. The detector knows where the
// things are and the model knows which one the user meant; neither of them has
// to produce a coordinate, so neither of them can invent one. The number 0
// means "none of them", and that answer sends the turn back to the grid.
const SOM_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    id: Object.freeze({type: 'integer'})
  }),
  required: Object.freeze(['id'])
});

const LOCATE_SYSTEM = 'You find one named thing in a picture of the user\'s screen. Answer with JSON only.';
const CELL_SYSTEM = 'You find one named thing in a picture of the user\'s screen. Answer with JSON only.';
const REFINE_SYSTEM = 'You locate one named object inside a crop of the user\'s screen. Answer with JSON only.';
const CHECK_SYSTEM = 'You check whether drawn marks sit on a named object. Answer with JSON only.';
const SOM_SYSTEM = 'You choose one numbered candidate on a picture of the user\'s screen. Answer with JSON only.';

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function cellRect(name) {
  const index = ROUTING_CELLS.indexOf(name);
  if (index < 0) return null;
  const col = index % 3;
  const row = Math.floor(index / 3);
  const third = CANVAS / 3;
  return {x: col * third, y: row * third, w: third, h: third};
}

// One cell of the numbered grid, in the 0..1000 canvas frame. The cells are
// numbered 1 to GRID_CELL_COUNT, left to right and then top to bottom, which
// is the order the numbers are drawn in.
function gridCellRect(cell) {
  const index = Math.round(Number(cell));
  if (!Number.isFinite(index) || index < 1 || index > GRID_CELL_COUNT) return null;
  const col = (index - 1) % GRID_COLS;
  const row = Math.floor((index - 1) / GRID_COLS);
  const w = CANVAS / GRID_COLS;
  const h = CANVAS / GRID_ROWS;
  return {x: col * w, y: row * h, w, h};
}

// The crop the refine stage looks at: the chosen cell with a margin around
// it, clamped to the canvas. The margin is a fraction of the cell, so the
// target is still in the picture when the cell was off by one.
function gridCropRect(cell, margin) {
  const base = gridCellRect(cell);
  if (!base) return null;
  const mx = base.w * clamp(Number(margin) || 0, 0, 1);
  const my = base.h * clamp(Number(margin) || 0, 0, 1);
  const x = clamp(base.x - mx, 0, CANVAS);
  const y = clamp(base.y - my, 0, CANVAS);
  const w = clamp(base.x + base.w + mx, 0, CANVAS) - x;
  const h = clamp(base.y + base.h + my, 0, CANVAS) - y;
  return {x, y, w, h};
}

// A region plus a margin, clamped to the canvas. The margin is a fraction of
// the region, so a small region still gets a usable ring around it.
function cropRectForCell(name, margin) {
  const base = cellRect(name);
  if (!base) return null;
  const mx = base.w * clamp(Number(margin) || 0, 0, 1);
  const my = base.h * clamp(Number(margin) || 0, 0, 1);
  const x = clamp(base.x - mx, 0, CANVAS);
  const y = clamp(base.y - my, 0, CANVAS);
  const w = clamp(base.x + base.w + mx, 0, CANVAS) - x;
  const h = clamp(base.y + base.h + my, 0, CANVAS) - y;
  return {x, y, w, h};
}

// The one forward mapper. `crop` is a rectangle in global 0..1000 canvas
// units; `local` is a rectangle in the crop's own 0..1000 units. Everything
// that came out of a crop goes back to the screen through this function.
function projectCropToGlobal(crop, local) {
  const sx = (crop && crop.w ? crop.w : 0) / CANVAS;
  const sy = (crop && crop.h ? crop.h : 0) / CANVAS;
  return {
    x: (crop ? crop.x : 0) + (local.x || 0) * sx,
    y: (crop ? crop.y : 0) + (local.y || 0) * sy,
    w: (local.w || 0) * sx,
    h: (local.h || 0) * sy
  };
}

// The exact inverse, used to draw the shape back onto the verification crop.
// A round trip through both is unit tested.
function projectGlobalToCrop(crop, global) {
  const sx = crop && crop.w ? CANVAS / crop.w : 0;
  const sy = crop && crop.h ? CANVAS / crop.h : 0;
  return {
    x: ((global.x || 0) - (crop ? crop.x : 0)) * sx,
    y: ((global.y || 0) - (crop ? crop.y : 0)) * sy,
    w: (global.w || 0) * sx,
    h: (global.h || 0) * sy
  };
}

function projectPointToGlobal(crop, x, y) {
  return projectCropToGlobal(crop, {x, y, w: 0, h: 0});
}

// A box given as a centre and a size becomes a top-left box.
function boxFromCentre(value) {
  const cx = Number(value && value.cx);
  const cy = Number(value && value.cy);
  const w = Math.max(0, Number(value && value.w) || 0);
  const h = Math.max(0, Number(value && value.h) || 0);
  return {x: cx - w / 2, y: cy - h / 2, w, h};
}

// Grow a box around its own centre and keep it on the canvas.
function expandBox(box, factor) {
  const f = Math.max(1, Number(factor) || 1);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const w = box.w * f;
  const h = box.h * f;
  const x = clamp(cx - w / 2, 0, CANVAS);
  const y = clamp(cy - h / 2, 0, CANVAS);
  return {x, y, w: clamp(cx + w / 2, 0, CANVAS) - x, h: clamp(cy + h / 2, 0, CANVAS) - y};
}

function boxCentre(box) {
  return {cx: box.x + box.w / 2, cy: box.y + box.h / 2};
}

// The region the refine stage looks at. A named region wins, because it is
// the more reliable of the two answers. Otherwise the located box is grown
// into a region around itself, never smaller than REFINE_MIN_REGION.
function refineRegion(box, cell) {
  const named = cell && ROUTING_CELLS.indexOf(cell) >= 0 ? cropRectForCell(cell, 0.18) : null;
  if (named) return named;
  if (!box) return {x: 0, y: 0, w: CANVAS, h: CANVAS};
  const grown = expandBox(box, 4);
  const cx = grown.x + grown.w / 2;
  const cy = grown.y + grown.h / 2;
  const w = Math.max(grown.w, REFINE_MIN_REGION);
  const h = Math.max(grown.h, REFINE_MIN_REGION);
  const x = clamp(cx - w / 2, 0, CANVAS);
  const y = clamp(cy - h / 2, 0, CANVAS);
  return {x, y, w: clamp(cx + w / 2, 0, CANVAS) - x, h: clamp(cy + h / 2, 0, CANVAS) - y};
}

// The region the drawing is made on.
//
// It is a SQUARE around the target, sized so the thing is big enough in the
// picture for the model to draw a ring around it, never smaller than
// DRAW_MIN_REGION and never larger than DRAW_MAX_REGION.
//
// The square matters. The region used to keep the shape of the located box,
// and a badly measured box made a badly shaped picture: the taskbar clock was
// measured as 18 x 1 units, so the crop was a thin strip and the clock
// arrived nine pixels tall in it. The model cannot draw around a thing it
// cannot see, so it drew a speck.
function drawRegion(box) {
  const centre = boxCentre(box);
  const half = Math.max(
    Math.max((box.w || 0) / 2, MIN_MARK_HALF),
    Math.max((box.h || 0) / 2, MIN_MARK_HALF)
  );
  const side = clamp(Math.max(3 * half, DRAW_MIN_REGION), DRAW_MIN_REGION, DRAW_MAX_REGION);
  const x = clamp(centre.cx - side / 2, 0, CANVAS);
  const y = clamp(centre.cy - side / 2, 0, CANVAS);
  return {x, y, w: clamp(centre.cx + side / 2, 0, CANVAS) - x, h: clamp(centre.cy + side / 2, 0, CANVAS) - y};
}

// One stroke from a crop frame back to the screen frame. This is geometry,
// so it lives here and not in the model: the drawing the model made inside a
// crop has to land on the same pixels the crop came from.
function projectStrokeToGlobal(crop, stroke) {
  const sx = (crop && crop.w ? crop.w : 0) / CANVAS;
  const sy = (crop && crop.h ? crop.h : 0) / CANVAS;
  const s = Math.min(sx, sy);
  const X = (value) => (crop ? crop.x : 0) + (Number(value) || 0) * sx;
  const Y = (value) => (crop ? crop.y : 0) + (Number(value) || 0) * sy;
  const out = Object.assign({}, stroke);
  if (stroke.type === 'circle' || stroke.type === 'arc') {
    out.cx = X(stroke.cx);
    out.cy = Y(stroke.cy);
    out.r = (Number(stroke.r) || 0) * s;
  } else if (stroke.type === 'line' || stroke.type === 'arrow') {
    out.x1 = X(stroke.x1);
    out.y1 = Y(stroke.y1);
    out.x2 = X(stroke.x2);
    out.y2 = Y(stroke.y2);
  } else if (stroke.type === 'rect') {
    out.x1 = X(stroke.x1);
    out.y1 = Y(stroke.y1);
    out.x2 = X(stroke.x2);
    out.y2 = Y(stroke.y2);
  } else if (stroke.type === 'polyline') {
    out.points = (stroke.points || []).map((point) => ({x: X(point.x), y: Y(point.y)}));
  } else if (stroke.type === 'text') {
    out.x = X(stroke.x);
    out.y = Y(stroke.y);
    out.size = (Number(stroke.size) || 0) * s;
  }
  return out;
}

function projectStrokesToGlobal(crop, strokes) {
  return (strokes || []).map((stroke) => projectStrokeToGlobal(crop, stroke));
}

// ---------------------------------------------------------------------------
// Requests and answers
// ---------------------------------------------------------------------------

const TARGET_PREFIX = /^(?:please\s+)?(?:can you\s+|could you\s+|i want you to\s+|i'd like you to\s+)?(?:circle|ring|encircle|surround|highlight|underline|mark|point\s+(?:to|at)|outline|annotate|label|draw|sketch|doodle)\s+/i;
// Only the bare "on my screen" is dropped. The place the user gave is kept:
// "on my taskbar", "in the photo", "on the left side". Those words are what
// tells a small model where to look, and an earlier version threw them away.
// Measured on the fixture set with the real 4B model, keeping them put the
// mark in the right cell or the one next to it in 9 of 10 cases, against 8 of
// 10 when they were stripped.
const TARGET_TAIL = /\s+on\s+(?:my|the|your|this|that)\s+(?:screen|display|monitor)\s*$/i;

// The phrase the model is asked to find. "circle the Settings gear on my
// screen" becomes "the Settings gear".
function targetPhrase(request) {
  let text = String(request == null ? '' : request).trim();
  if (!text) return 'the thing the user named';
  text = text.replace(TARGET_PREFIX, '');
  text = text.replace(TARGET_TAIL, '');
  text = text.replace(/\s*\([^)]*\)\s*/g, ' ');
  text = text.replace(/[.?!]+$/, '').trim();
  if (!text) return String(request).trim().slice(0, 120);
  return text.slice(0, 120);
}

// Models answer JSON with all sorts of wrappers. This pulls the first JSON
// object out of the reply.
function parseJsonReply(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return {ok: false, error: 'the answer was empty'};
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start < 0) return {ok: false, error: 'the answer was not JSON'};
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  const slice = end > 0 ? body.slice(start, end) : body.slice(start);
  try {
    const value = JSON.parse(slice);
    if (!value || typeof value !== 'object') return {ok: false, error: 'the answer was not a JSON object'};
    return {ok: true, value};
  } catch (error) {
    return {ok: false, error: 'the answer was not valid JSON'};
  }
}

// The cell stage. One short answer: which numbered cell of the grid holds
// the target. There is no "it is not there" answer here. The model is told
// to commit, because a small model that is allowed to hesitate turns real
// targets into refusals.
function cellPrompt(target, extra) {
  const lines = [
    'The attached image is the user\'s screen with a numbered grid over it. ' +
      'Each cell is numbered 1 to ' + GRID_CELL_COUNT + ', left to right, top to bottom (' +
      GRID_COLS + ' columns, ' + GRID_ROWS + ' rows).',
    'Which numbered cell contains "' + target + '"?',
    'Answer with JSON only: {"cell": <number>}.',
    'It may be small, faint or low-contrast. Give your best answer even if you are not sure.'
  ];
  if (extra) lines.splice(2, 0, extra);
  return lines.join('\n');
}

// The locate stage. One call, one answer: the box on the whole screen, and
// (optionally) which third of the screen it is in. This is the fallback for
// when the grid could not be drawn or the cell answer could not be read: it
// is worse than the grid, but it is better than no drawing.
function locatePrompt(target) {
  return [
    'The attached image is the user\'s screen.',
    'Give the tight box around "' + target + '".',
    'Answer with JSON only: {"cx": <centre x>, "cy": <centre y>, "w": <width>, "h": <height>}',
    'cx, cy, w and h are numbers from 0 to 1000 measured on the WHOLE screen. (0,0) is the top-left.',
    'Also name the third of the screen it is in: "cell" must be one of: ' + ROUTING_CELLS.join(', ') + '.',
    'It may be small, faint or low-contrast. Give your best answer even if you are not sure.'
  ].join('\n');
}

// The refine stage asks for a box inside a crop of the screen. There is no
// "it is not here" answer either: a degenerate box is an answer that cannot
// be used, and it is repaired once.
function refinePrompt(target, extra) {
  const lines = [
    'The attached image is a crop of the user\'s screen.',
    'Give the tight box around "' + target + '" inside this crop.',
    'Answer with JSON only: {"cx": <centre x>, "cy": <centre y>, "w": <width>, "h": <height>}',
    'cx, cy, w and h are numbers from 0 to 1000 measured on THIS crop, not on the whole screen.',
    'w and h must be greater than zero. Use the closest thing you can see.'
  ];
  if (extra) lines.push(extra);
  return lines.join('\n');
}

// The pick stage. The screen is shown with a numbered disc on every place the
// detector thought the target might be, and the model names one of them.
//
// The model is asked for a NUMBER, not a place. That is the whole design of
// this branch: a small vision model cannot place a pixel on a 1920 wide
// screen, but it can say "the red one, number 7" about a picture that has
// twelve numbered things on it.
function somPrompt(target, count) {
  return [
    'The attached image is the user\'s screen. Every place that might hold the target has a numbered yellow disc on it.',
    'Which numbered disc is on "' + target + '"?',
    'Answer with JSON only: {"id": <number from 1 to ' + count + '>}.',
    'If none of the discs is on the target, answer {"id": 0}.',
    'It may be small, faint or low-contrast. Give your best answer even if you are not sure.'
  ].join('\n');
}

// The check asks one forgiving question. It is deliberately biased towards
// "yes": a false "no" costs three extra model calls and about two seconds to
// retry something that was probably right, while a false "yes" only means the
// pet does not try again.
function checkPrompt(target) {
  return [
    'The attached image is a crop of the user\'s screen with red marks drawn on it.',
    'The red marks were meant to go on "' + target + '".',
    'Answer true if the red marks are on "' + target + '" or around it, even when they are rough or cover it only partly.',
    'Answer false only if the red marks are clearly somewhere else in the picture.',
    'Answer with JSON only: {"verified": true} or {"verified": false}'
  ].join('\n');
}

// One repair per stage. The exact error goes back to the model with the same
// image; the rejected answer is never repeated, so a rejected coordinate can
// never be copied forward as an example.
function stageRepairPrompt(error) {
  return 'That answer could not be used: ' + error + '\n' +
    'Answer again with the same JSON shape only. No prose, no code fences.';
}

function drawRepairPrompt(error) {
  return 'That drawing could not be used: ' + error + '\n' +
    'Answer again with drawing commands only, one per line, following the grammar in the system message. No prose, no code fences.';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// A box has to be a box: four numbers, a positive width and a positive
// height, and a centre on the screen. A region name is optional; if it is
// not one of the nine it is ignored, never an error.
function validateBox(value) {
  if (!value || typeof value !== 'object') return 'the answer was not JSON';
  for (const key of ['cx', 'cy', 'w', 'h']) {
    if (!Number.isFinite(Number(value[key]))) return 'the answer needs the numbers "cx", "cy", "w" and "h"';
  }
  const cx = Number(value.cx);
  const cy = Number(value.cy);
  const w = Number(value.w);
  const h = Number(value.h);
  if (!(w > 0) || !(h > 0)) return 'the box needs a width and a height greater than zero';
  if (cx < 0 || cy < 0 || cx > CANVAS || cy > CANVAS) {
    return 'the centre of the box must be between 0 and 1000';
  }
  return null;
}

function validateLocate(value) {
  return validateBox(value);
}

// A cell answer is one number between 1 and the number of cells. Anything
// else cannot be used: there is no cell to crop.
function validateCell(value) {
  if (!value || typeof value !== 'object') return 'the answer was not JSON';
  const cell = Number(value.cell);
  if (!Number.isFinite(cell)) return 'the answer needs the number "cell"';
  const rounded = Math.round(cell);
  if (rounded !== cell) return 'the cell must be a whole number';
  if (rounded < 1 || rounded > GRID_CELL_COUNT) {
    return 'the cell must be between 1 and ' + GRID_CELL_COUNT;
  }
  return null;
}

function validateRefine(value) {
  return validateBox(value);
}

function validateCheck(value) {
  if (!value || typeof value !== 'object') return 'the answer was not JSON';
  if (typeof value.verified !== 'boolean') return 'the answer needs "verified" to be true or false';
  return null;
}

// A pick answer is one number: 0 for "none of them", or the number of a
// candidate. A number outside the list cannot be used, because there is no
// candidate to resolve it to.
//
// A JSON null is accepted as "none of them" too, so a model that answers
// {"id": null} is understood even when the schema asked for a number.
function validatePick(value, count) {
  if (!value || typeof value !== 'object') return 'the answer was not JSON';
  if (value.id === null || value.id === undefined) return null;
  const id = Number(value.id);
  if (!Number.isFinite(id)) return 'the answer needs the number "id"';
  const rounded = Math.round(id);
  if (rounded !== id) return 'the id must be a whole number';
  if (rounded < 0) return 'the id must not be negative';
  if (rounded > count) return 'the id must be between 0 and ' + count;
  return null;
}

// ---------------------------------------------------------------------------
// The detector branch
// ---------------------------------------------------------------------------

// Run the detector once and let the model choose from what it found.
//
// The detector proposes; the model disposes. The detector returns boxes in
// the capture's own pixels, the picture the model is shown has a numbered disc
// on each of them, and the model's answer is a number. The mark is then made
// from the detector's own box, so the coordinate is never the model's to get
// wrong.
//
// Every way this can fail ends the same way: the grid loop runs instead. A
// missing detector, an empty shortlist, a picture that could not be drawn, a
// number that could not be read and a number that says "none of them" all
// return null, and null means "carry on with the grid".
async function detectOnce(deps, ctx, note, target) {
  if (!deps.detect || !deps.renderSom) return null;
  const found = await deps.detect({
    image: ctx.fullImage,
    phrases: [target],
    request: ctx.request,
    conf: DETECT_CONF,
    limit: DETECT_LIMIT
  });
  note({
    stage: 'detect',
    ok: !!(found && found.ok),
    ms: found && found.ms,
    boxes: found && Array.isArray(found.boxes) ? found.boxes.length : 0,
    // The shortlist, as the model saw it: what the detector offered, in the
    // order it offered it. A wrong pick can only be judged against this.
    candidates: (found && Array.isArray(found.boxes) ? found.boxes : []).map((box) => ({
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.w),
      h: Math.round(box.h),
      conf: Number(Number(box.conf).toFixed(3)),
      cls: box.cls,
      name: (found.classes && found.classes[box.cls]) || null
    })),
    error: (found && found.error) || null
  });
  if (!found || !found.ok || !Array.isArray(found.boxes) || !found.boxes.length) return null;
  const boxes = found.boxes.slice(0, DETECT_LIMIT);
  const som = await deps.renderSom({
    imageBase64: ctx.screenView,
    boxes,
    captureWidth: ctx.screenWidth,
    captureHeight: ctx.screenHeight,
    viewWidth: ctx.viewWidth,
    viewHeight: ctx.viewHeight,
    discSize: SOM_DISC
  });
  if (!som || !som.ok) {
    note({stage: 'som', ok: false, error: (som && som.error) || 'the candidates could not be numbered'});
    return null;
  }
  note({stage: 'som', ok: true, count: boxes.length});
  const wantsReasoning = ctx.thinking === true;
  const stages = stagesFor(wantsReasoning);
  const chosen = await stageJson(deps, {
    model: ctx.model,
    image: som.base64,
    numPredict: stages.pick.numPredict,
    think: wantsReasoning,
    messages: [
      {role: 'system', content: SOM_SYSTEM},
      {role: 'user', content: somPrompt(target, boxes.length)}
    ],
    schema: SOM_SCHEMA,
    validate: (value) => validatePick(value, boxes.length)
  });
  note({
    stage: 'pick',
    ok: chosen.ok,
    ms: chosen.ms,
    repairs: chosen.repairs,
    id: chosen.ok ? chosen.value.id : null
  });
  if (!chosen.ok) return null;
  const id = chosen.value.id === null || chosen.value.id === undefined
    ? 0
    : Math.round(Number(chosen.value.id));
  if (!id || id < 1 || id > boxes.length) return null;
  return {box: boxes[id - 1], id, count: boxes.length};
}

// The mark a detected box becomes.
//
// The detector's mask is traced as an outline when there is one: a box is a
// rectangle around the thing, and an outline is the shape of the thing. When
// there is no mask the box becomes a circle around its middle, which is the
// mark the drawing stage has always produced.
//
// The commands go through the same parser as the model's own drawing, so the
// contract's limits apply to them too and the overlay has one path.
function detectedSketch(box, ctx, options = {}) {
  if (!box) return null;
  const width = Math.max(1, Math.round(Number(ctx.screenWidth) || 1));
  const height = Math.max(1, Math.round(Number(ctx.screenHeight) || 1));
  const commands = boxToSketchCommands(box, {
    width,
    height,
    polygon: box.polygon,
    color: 'red',
    strokeWidth: 4
  });
  if (!commands) return null;
  const sketch = parseSketch(commands, options);
  return sketch && sketch.ok ? sketch : null;
}

// The detected box in the 0..1000 screen frame, which is the frame the rest
// of the loop reports in and the frame the overlay draws in.
function detectedBoxOnCanvas(box, ctx) {
  const width = Math.max(1, Math.round(Number(ctx.screenWidth) || 1));
  const height = Math.max(1, Math.round(Number(ctx.screenHeight) || 1));
  return {
    x: (Number(box.x) / width) * CANVAS,
    y: (Number(box.y) / height) * CANVAS,
    w: (Number(box.w) / width) * CANVAS,
    h: (Number(box.h) / height) * CANVAS,
    conf: Number.isFinite(Number(box.conf)) ? Number(box.conf) : null,
    cls: Number.isFinite(Number(box.cls)) ? Math.round(Number(box.cls)) : null
  };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

// One JSON stage call plus, on failure, exactly one repair with the same
// image and the exact error.
async function stageJson(deps, spec) {
  const started = Date.now();
  const attempt = await deps.callJson({
    model: spec.model,
    messages: spec.messages,
    schema: spec.schema,
    image: spec.image,
    numPredict: spec.numPredict,
    think: spec.think === true
  });
  let error = attempt && attempt.ok ? null : (attempt && attempt.error) || 'the answer could not be read';
  if (attempt && attempt.ok) {
    const invalid = spec.validate ? spec.validate(attempt.value) : null;
    if (invalid) error = invalid;
    else return {ok: true, value: attempt.value, error: null, ms: Date.now() - started, repairs: 0};
  }
  const repairMessages = spec.messages.concat([
    {role: 'user', content: stageRepairPrompt(error)}
  ]);
  const repaired = await deps.callJson({
    model: spec.model,
    messages: repairMessages,
    schema: spec.schema,
    image: spec.image,
    numPredict: spec.numPredict,
    think: spec.think === true
  });
  if (repaired && repaired.ok) {
    const invalid = spec.validate ? spec.validate(repaired.value) : null;
    if (!invalid) return {ok: true, value: repaired.value, error: null, ms: Date.now() - started, repairs: 1};
    error = invalid;
  } else {
    error = (repaired && repaired.error) || error;
  }
  return {ok: false, value: null, error, ms: Date.now() - started, repairs: 1};
}

// One draw call plus, on a parse failure, exactly one repair with the exact
// parser error and the same image.
async function stageDraw(deps, spec) {
  const started = Date.now();
  const messages = spec.messages;
  const first = await deps.callDraw({
    model: spec.model,
    messages,
    image: spec.image,
    numPredict: spec.numPredict,
    think: spec.think === true
  });
  let sketch = parseSketch(first && first.raw, spec.options);
  if (sketch.ok) return {ok: true, sketch, raw: first.raw, ms: Date.now() - started, repairs: 0};
  let error = sketch.error || 'the drawing could not be read';
  const repairMessages = messages.slice(0, messages.length - 1).concat([
    {
      role: 'user',
      content: messages[messages.length - 1].content + '\n\n' + drawRepairPrompt(error)
    }
  ]);
  const repaired = await deps.callDraw({
    model: spec.model,
    messages: repairMessages,
    image: spec.image,
    numPredict: spec.numPredict,
    think: spec.think === true
  });
  sketch = parseSketch(repaired && repaired.raw, spec.options);
  if (sketch.ok) return {ok: true, sketch, raw: repaired.raw, ms: Date.now() - started, repairs: 1};
  error = sketch.error || error;
  return {ok: false, sketch: null, raw: repaired && repaired.raw, error, ms: Date.now() - started, repairs: 1};
}

// The full grounded draw.
//
// deps:
//   callJson   ({model, messages, schema, image, numPredict}) -> {ok, value, error, raw}
//   callDraw   ({model, messages, image}) -> {raw}
//   crop       ({fullImage, rect, upscale, maxWidth}) -> {ok, base64}
//   renderShape({cropBase64, rect, strokes, marks, color}) -> {ok, base64}
//   renderGrid ({imageBase64, cols, rows, numSize, rejectCell}) -> {ok, base64}
//   detect     ({image, phrases, request, conf, limit}) -> {ok, boxes}
//   renderSom  ({imageBase64, boxes, captureWidth, captureHeight,
//                viewWidth, viewHeight, discSize}) -> {ok, base64}
//   log        (message) -> void
//
// ctx:
//   request, target, model, screenView, fullImage, screenWidth, screenHeight,
//   viewWidth, viewHeight, options
async function runGroundedDraw(deps, ctx) {
  const calls = [];
  const note = (entry) => {
    calls.push(entry);
    if (deps.log) deps.log('grounding ' + JSON.stringify(entry));
  };
  const options = ctx.options || {};
  const target = ctx.target;
  // A "think hard" request gets reasoning and bigger budgets on every stage.
  const wantsReasoning = ctx.thinking === true;
  const stages = stagesFor(wantsReasoning);
  if (wantsReasoning) note({stage: 'thinking', ok: true, mode: 'reasoning'});

  // ---- The detector first ---------------------------------------------------
  // The detector proposes a shortlist of places, the model names one of them,
  // and the mark is made from the detector's own box. That is one model call
  // instead of the grid's four, and the coordinate is never the model's.
  //
  // Everything about it can fail, and every failure falls through to the grid
  // below: a detector that is not installed, a screen it finds nothing on, a
  // picture it could not number, and a model that says "none of them".
  const detected = await detectOnce(deps, ctx, note, target);
  if (detected) {
    const sketch = detectedSketch(detected.box, ctx, options);
    if (sketch) {
      const onCanvas = detectedBoxOnCanvas(detected.box, ctx);
      note({stage: 'detect-draw', ok: true, id: detected.id, box: onCanvas});
      return {
        ok: true, stage: 'detect', drew: true, verified: null, box: onCanvas, sketch,
        reply: null, calls, refined: false, detected: true,
        cls: onCanvas.cls, conf: onCanvas.conf,
        polygon: Array.isArray(detected.box.polygon) ? detected.box.polygon : null
      };
    }
    note({stage: 'detect-draw', ok: false, error: 'the detected shape could not be turned into a drawing'});
  }

  // ---- Stage 1: which cell of the grid holds it? ----------------------------
  // The screen view with a numbered grid drawn over it. The answer is one
  // number, and it is the question a small model is actually good at.
  let gridImage = null;
  if (deps.renderGrid) {
    const rendered = await deps.renderGrid({
      imageBase64: ctx.screenView,
      cols: GRID_COLS,
      rows: GRID_ROWS,
      numSize: GRID_NUM_SIZE
    });
    gridImage = rendered && rendered.ok ? rendered.base64 : null;
    note({stage: 'grid', ok: !!gridImage, error: (rendered && rendered.error) || null});
  }

  let box = null;
  let cell = null;
  let refined = false;

  if (gridImage) {
    const chosen = await stageJson(deps, {
      model: ctx.model,
      image: gridImage,
      numPredict: stages.cell.numPredict,
      think: wantsReasoning,
      messages: [{role: 'system', content: CELL_SYSTEM}, {role: 'user', content: cellPrompt(target)}],
      schema: CELL_SCHEMA,
      validate: validateCell
    });
    note({stage: 'cell', ok: chosen.ok, ms: chosen.ms, repairs: chosen.repairs, cell: chosen.ok ? chosen.value.cell : null});
    if (chosen.ok) {
      cell = Math.round(Number(chosen.value.cell));
      // ---- Stage 2: where exactly is it inside that cell? ------------------
      // A crop of the FULL-resolution capture, taken from the chosen cell. The
      // target is more than twice as big in this picture as it was on the
      // screen view, and the answer is a box in the crop's own frame.
      const region = gridCropRect(cell, GRID_EXPAND);
      const cropImage = await deps.crop({fullImage: ctx.fullImage, rect: region, upscale: 2.5, maxWidth: 1280, label: 'refine'});
      if (cropImage && cropImage.ok) {
        const answer = await stageJson(deps, {
          model: ctx.model,
          image: cropImage.base64,
          numPredict: stages.refine.numPredict,
          think: wantsReasoning,
          messages: [{role: 'system', content: REFINE_SYSTEM}, {role: 'user', content: refinePrompt(target)}],
          schema: REFINE_SCHEMA,
          validate: validateRefine
        });
        const refinedBox = answer.ok ? projectCropToGlobal(region, boxFromCentre(answer.value)) : null;
        note({stage: 'refine', ok: answer.ok, ms: answer.ms, repairs: answer.repairs, reason: 'grid-cell', cell, box: refinedBox});
        if (refinedBox) {
          box = refinedBox;
          refined = true;
        }
      }
    }
  }

  // ---- The fallback: the box on the whole screen ---------------------------
  // The grid is the better way to find a thing, but it is not the only one. If
  // the grid could not be drawn, or the cell answer could not be read, the pet
  // asks for the box on the screen view instead. That is a worse answer, but
  // it is better than no drawing at all.
  if (!box) {
    const located = await stageJson(deps, {
      model: ctx.model,
      image: ctx.screenView,
      numPredict: stages.locate.numPredict,
      think: wantsReasoning,
      messages: [{role: 'system', content: LOCATE_SYSTEM}, {role: 'user', content: locatePrompt(target)}],
      schema: LOCATE_SCHEMA,
      validate: validateLocate
    });
    note({
      stage: 'locate', ok: located.ok, ms: located.ms, repairs: located.repairs,
      cell: located.ok ? located.value.cell : null,
      box: located.ok ? boxFromCentre(located.value) : null
    });
    if (!located.ok) {
      return {
        ok: false, stage: 'locate', drew: false, verified: null, box: null, sketch: null,
        error: located.error || null,
        reply: 'I could not work out where that is on your screen.', calls
      };
    }
    box = boxFromCentre(located.value);
    cell = null;
  }

  // ---- Stage 2b: one more look, only for a small target --------------------
  // The cell crop is a zoom, but the thing in it can still be small. A target
  // that is smaller than a quarter of the screen gets one tighter crop of its
  // own, taken from the full-resolution capture around the place the first
  // answer pointed at. Measured on the fixture set, that moved the mark from
  // a median of 64 units away to 43 units away.
  if (box.w <= ZOOM_MAX_BOX || box.h <= ZOOM_MAX_BOX) {
    const region = refineRegion(box, null);
    const cropImage = await deps.crop({fullImage: ctx.fullImage, rect: region, upscale: 4, maxWidth: 1280, label: 'zoom'});
    if (cropImage && cropImage.ok) {
      const answer = await stageJson(deps, {
        model: ctx.model,
        image: cropImage.base64,
        numPredict: stages.refine.numPredict,
        think: wantsReasoning,
        messages: [{role: 'system', content: REFINE_SYSTEM}, {role: 'user', content: refinePrompt(target)}],
        schema: REFINE_SCHEMA,
        validate: validateRefine
      });
      const zoomedBox = answer.ok ? projectCropToGlobal(region, boxFromCentre(answer.value)) : null;
      note({stage: 'refine', ok: answer.ok, ms: answer.ms, repairs: answer.repairs, reason: 'zoom', box: zoomedBox});
      if (zoomedBox) {
        box = zoomedBox;
        refined = true;
      }
      // If the answer could not be used, the located box is kept. One more
      // model call is not spent on a guess that is already good enough to
      // draw.
    }
  }

  // ---- Stage 2: draw with the centre locked --------------------------------
  // The drawing is made on a crop around the target, not on the whole screen:
  // the picture is smaller, so the call is faster, and the thing is bigger in
  // it, so the drawing is better. The model works in the crop's 0..1000
  // frame and the strokes are mapped back to the screen afterwards.
  const drawOnce = async (lockedBox) => {
    const region = drawRegion(lockedBox);
    const image = await deps.crop({fullImage: ctx.fullImage, rect: region, upscale: 2, maxWidth: DRAW_MAX_WIDTH, label: 'draw'});
    const cropped = !!(image && image.ok);
    const centre = boxCentre(lockedBox);
    const localPoint = projectGlobalToCrop(region, {x: centre.cx, y: centre.cy, w: 0, h: 0});
    const local = cropped ? {cx: localPoint.x, cy: localPoint.y} : centre;
    // The half-size of the target, with the floor from MIN_MARK_HALF. A ring
    // the user can see, around the place the grounding stages agreed on.
    //
    // The ring is asked for by its radius, in the crop's own frame, using the
    // smaller side of the region: that way the radius is at least MIN_MARK_HALF
    // on the screen even when the region was clipped at an edge.
    const half = Math.max(
      Math.max(lockedBox.w / 2, MIN_MARK_HALF),
      Math.max(lockedBox.h / 2, MIN_MARK_HALF)
    );
    const scale = cropped ? Math.min(region.w, region.h) : CANVAS;
    const rx = cropped ? (half / scale) * CANVAS : half;
    const ry = rx;
    const locked = {
      cx: local.cx,
      cy: local.cy,
      rx: Math.max(4, rx),
      ry: Math.max(4, ry),
      target
    };
    const messages = sketchPrompt(ctx.request, {
      hasImage: true,
      grounded: true,
      cropFrame: cropped,
      locked
    });
    const drawn = await stageDraw(deps, {
      model: ctx.model,
      messages,
      image: cropped ? image.base64 : ctx.screenView,
      numPredict: stages.draw.numPredict,
      think: wantsReasoning,
      options
    });
    note({stage: 'draw', ok: drawn.ok, ms: drawn.ms, repairs: drawn.repairs, frame: cropped ? 'crop' : 'screen'});
    if (!drawn.ok || !drawn.sketch) return drawn;
    const sketch = cropped
      ? Object.assign({}, drawn.sketch, {strokes: projectStrokesToGlobal(region, drawn.sketch.strokes)})
      : drawn.sketch;
    return Object.assign({}, drawn, {sketch, region});
  };

  let drawn = await drawOnce(box);
  if (!drawn.ok) {
    return {
      ok: false, stage: 'draw', drew: false, verified: null, box, sketch: null,
      reply: 'I could not turn that into a drawing.', calls
    };
  }
  const firstSketch = drawn.sketch;
  // The place the first drawing was made at. The retry may replace it, and
  // if the retry does not earn the place, this is what is shown.
  const firstBox = box;

  // ---- Stage 3: is the shape on the target? ---------------------------------
  // The check cannot throw the drawing away. It decides whether the pet tries
  // again: a "no" buys a re-ground and a second drawing.
  const checkOnce = async (lockedBox, sketch, region) => {
    // The check looks at the same crop the drawing was made on.
    //
    // An earlier version cropped tightly around the located box. For a small
    // target that crop was a few pixels wide, the marks fell outside the
    // picture, and the model was asked to verify an empty picture. It said
    // "no" to drawings that were in the right place, and the pet retried
    // almost every time. The marks are in the draw region, so that is what
    // the check sees.
    const checkRect = region ? expandBox(region, 1.1) : expandBox(lockedBox, 2);
    const cropShot = await deps.crop({fullImage: ctx.fullImage, rect: checkRect, upscale: 2, maxWidth: 1280, label: 'check'});
    if (!cropShot || !cropShot.ok) {
      note({stage: 'check', ok: false, error: (cropShot && cropShot.error) || 'the check crop failed'});
      return {ok: false, error: (cropShot && cropShot.error) || 'the check crop failed', rect: checkRect};
    }
    const shaped = await deps.renderShape({
      cropBase64: cropShot.base64,
      rect: checkRect,
      strokes: sketch.strokes,
      marks: [],
      color: '#ff4d4d'
    });
    if (!shaped || !shaped.ok) {
      note({stage: 'check', ok: false, error: (shaped && shaped.error) || 'the check image failed'});
      return {ok: false, error: (shaped && shaped.error) || 'the check image failed', rect: checkRect};
    }
    const answer = await stageJson(deps, {
      model: ctx.model,
      image: shaped.base64,
      numPredict: stages.check.numPredict,
      think: wantsReasoning,
      messages: [{role: 'system', content: CHECK_SYSTEM}, {role: 'user', content: checkPrompt(target)}],
      schema: CHECK_SCHEMA,
      validate: validateCheck
    });
    note({stage: 'check', ok: answer.ok, ms: answer.ms, verified: answer.ok ? answer.value.verified : false});
    return {ok: answer.ok && answer.value.verified === true, error: answer.error || null, rect: checkRect, cropShot};
  };

  const checked = await checkOnce(box, firstSketch, drawn.region);
  if (checked.ok) {
    return {
      ok: true, stage: 'draw', drew: true, verified: true, box, sketch: firstSketch,
      reply: null, calls, refined
    };
  }

  // ---- Retry: ask the grid again with the wrong cell crossed out ------------
  // The retry is the answer. Whatever it produces is shown.
  //
  // The check said the marks were somewhere else. The grid is the stage that
  // is good at finding things, so the retry asks the grid again with the cell
  // the pet used last time crossed out, and then looks inside the cell the
  // model names this time.
  const reground = await relocateOnce(deps, ctx, checked, firstSketch, box, cell, target, note, gridImage)
    || await regroundOnce(deps, ctx, checked, firstSketch, box, target, note);
  if (reground && reground.box) {
    const oldCentre = boxCentre(firstBox);
    const newCentre = boxCentre(reground.box);
    const moved = Math.hypot(newCentre.cx - oldCentre.cx, newCentre.cy - oldCentre.cy) > 2;
    if (!moved) {
      // The retry found the same place. Drawing again would put the same marks
      // in the same place, so the first drawing is shown and the call is not
      // spent.
      note({stage: 'retry', ok: false, error: 'the retry found the same place'});
      return {
        ok: true, stage: 'draw', drew: true, verified: false, box: firstBox, sketch: firstSketch,
        reply: null, calls, refined, retried: true
      };
    }
    box = reground.box;
    const second = await drawOnce(box);
    if (second.ok) {
      // The retry has to earn its place.
      //
      // The check is not a veto, but it is evidence, and the retry was drawn
      // in a place the model chose after being told the first place was
      // wrong. That can be better (the model was looking in the wrong cell)
      // or much worse (the model moved to a different cell and found
      // something else). Measured on the fixture set, an unchecked retry
      // moved a mark that was 16 units from the target to 844 units from it.
      //
      // So the retry is checked too. If the retry's drawing passes, it is
      // shown. If it does not, the first drawing is shown: it is the one the
      // pet had already put on the screen, and nothing has said the retry is
      // better.
      const rechecked = await checkOnce(box, second.sketch, second.region);
      if (rechecked.ok) {
        return {
          ok: true, stage: 'draw', drew: true, verified: true, box, sketch: second.sketch,
          reply: null, calls, refined, retried: true
        };
      }
      note({stage: 'retry', ok: false, error: 'the retry was checked and did not pass either'});
      return {
        ok: true, stage: 'draw', drew: true, verified: false, box: firstBox, sketch: firstSketch,
        reply: null, calls, refined, retried: true
      };
    }
    // The retry could not be drawn. The first drawing is still better than
    // nothing, so it is shown.
    note({stage: 'retry', ok: false, error: second.error || null});
    return {
      ok: true, stage: 'draw', drew: true, verified: false, box: firstBox, sketch: firstSketch,
      reply: null, calls, refined, retried: true
    };
  }

  // The retry could not even be started. The first drawing is shown.
  return {
    ok: true, stage: 'draw', drew: true, verified: false, box: firstBox, sketch: firstSketch,
    reply: null, calls, refined
  };
}

// The retry, when the grid is what found the target.
//
// The same grid is drawn again with the rejected cell crossed out, and the
// model is asked which cell it really is. A new cell is worth a fresh look
// inside it. The same cell is not: the model has already said that, so the
// pet looks again in a wider crop around it instead, which is the only way to
// get a second answer out of it.
//
// It buys a second attempt, never a veto - whatever the retry draws is what
// the user sees.
async function relocateOnce(deps, ctx, verified, sketch, box, rejectedCell, target, note, gridImage) {
  if (!gridImage || !rejectedCell || !deps.renderGrid) return null;
  const wantsReasoning = ctx.thinking === true;
  const stages = stagesFor(wantsReasoning);
  const rendered = await deps.renderGrid({
    imageBase64: ctx.screenView,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    numSize: GRID_NUM_SIZE,
    rejectCell: rejectedCell
  });
  const retryGrid = rendered && rendered.ok ? rendered.base64 : gridImage;
  const chosen = await stageJson(deps, {
    model: ctx.model,
    image: retryGrid,
    numPredict: stages.cell.numPredict,
    think: wantsReasoning,
    messages: [
      {role: 'system', content: CELL_SYSTEM},
      {
        role: 'user',
        content: cellPrompt(target, 'The red X marks the cell you chose last time. It was the wrong cell.')
      }
    ],
    schema: CELL_SCHEMA,
    validate: validateCell
  });
  note({stage: 'reground', ok: chosen.ok, ms: chosen.ms, repairs: chosen.repairs, cell: chosen.ok ? chosen.value.cell : null});
  if (!chosen.ok) return null;
  const cell = Math.round(Number(chosen.value.cell));
  // A new cell is worth a fresh look inside it.
  //
  // The same cell is not: the model has already said that, so the pet looks
  // again in a tight crop around the place it used instead. A wider crop
  // around the whole cell was tried and was worse: the answer drifted away
  // from the target instead of settling on it.
  const sameCell = (cell === rejectedCell);
  const region = sameCell ? refineRegion(box, null) : gridCropRect(cell, GRID_EXPAND);
  const cropImage = await deps.crop({
    fullImage: ctx.fullImage,
    rect: region,
    upscale: sameCell ? 4 : 2.5,
    maxWidth: 1280,
    label: 'reground'
  });
  if (!cropImage || !cropImage.ok) return null;
  const answer = await stageJson(deps, {
    model: ctx.model,
    image: cropImage.base64,
    numPredict: stages.refine.numPredict,
    think: wantsReasoning,
    messages: [{role: 'system', content: REFINE_SYSTEM}, {role: 'user', content: refinePrompt(target)}],
    schema: REFINE_SCHEMA,
    validate: validateRefine
  });
  const retryBox = answer.ok ? projectCropToGlobal(region, boxFromCentre(answer.value)) : null;
  note({stage: 'refine', ok: answer.ok, ms: answer.ms, repairs: answer.repairs, reason: 'retry', cell, box: retryBox});
  if (!retryBox) return null;
  return {box: retryBox, cell};
}

// Ask again where the target is, with the rejected centre marked on the crop.
// This is the retry: the check said the marks were somewhere else, so the
// pet looks at the same crop again with an X on the place it used, and takes
// the new box. It buys a second attempt, never a veto - whatever the retry
// draws is what the user sees.
async function regroundOnce(deps, ctx, verified, sketch, box, target, note) {
  if (!verified || !verified.cropShot || !verified.rect) return null;
  const wantsReasoning = ctx.thinking === true;
  const stages = stagesFor(wantsReasoning);
  const centre = boxCentre(box);
  const marked = await deps.renderShape({
    cropBase64: verified.cropShot.base64,
    rect: verified.rect,
    strokes: sketch.strokes,
    marks: [{type: 'x', cx: centre.cx, cy: centre.cy, radius: Math.max(box.w, box.h) * 0.6}],
    color: '#ff4d4d'
  });
  if (!marked || !marked.ok) return null;
  const answer = await stageJson(deps, {
    model: ctx.model,
    image: marked.base64,
    numPredict: stages.refine.numPredict,
    think: wantsReasoning,
    messages: [
      {role: 'system', content: REFINE_SYSTEM},
      {
        role: 'user',
        content: refinePrompt(target, 'The red X marks where the last attempt was wrong. Look again and give the correct place of the target inside this crop.')
      }
    ],
    schema: REFINE_SCHEMA,
    validate: validateRefine
  });
  note({stage: 'reground', ok: answer.ok, ms: answer.ms});
  if (!answer.ok) return null;
  return {box: projectCropToGlobal(verified.rect, boxFromCentre(answer.value))};
}

module.exports = {
  CANVAS,
  ROUTING_CELLS,
  GRID_COLS,
  GRID_ROWS,
  GRID_CELL_COUNT,
  GRID_EXPAND,
  GRID_NUM_SIZE,
  CELL_SCHEMA,
  LOCATE_SCHEMA,
  REFINE_SCHEMA,
  CHECK_SCHEMA,
  SOM_SCHEMA,
  DETECT_CONF,
  DETECT_LIMIT,
  SOM_DISC,
  GROUNDING_STAGES,
  GROUNDING_STAGES_THINKING,
  stagesFor,
  SMALL_TARGET_PIXELS,
  ZOOM_MAX_BOX,
  REFINE_MIN_REGION,
  DRAW_MIN_REGION,
  DRAW_MAX_REGION,
  DRAW_MAX_WIDTH,
  cellRect,
  cropRectForCell,
  gridCellRect,
  gridCropRect,
  projectCropToGlobal,
  projectGlobalToCrop,
  projectPointToGlobal,
  boxFromCentre,
  expandBox,
  boxCentre,
  refineRegion,
  drawRegion,
  projectStrokeToGlobal,
  projectStrokesToGlobal,
  targetPhrase,
  parseJsonReply,
  cellPrompt,
  locatePrompt,
  refinePrompt,
  checkPrompt,
  somPrompt,
  stageRepairPrompt,
  drawRepairPrompt,
  validateCell,
  validateLocate,
  validateRefine,
  validateCheck,
  validatePick,
  detectOnce,
  detectedSketch,
  detectedBoxOnCanvas,
  stageJson,
  stageDraw,
  runGroundedDraw
};
