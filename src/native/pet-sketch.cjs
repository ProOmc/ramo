'use strict';
// Ramo Pet — a small, local-only sketch layer.
//
// This is the simple part of a SketchVLM-style loop: the local Bonsai model
// answers with a short list of drawing commands, this module validates every
// number and text string deterministically, and the native overlay renders the
// result for a few seconds. The model owns the semantic choice of what to draw;
// this file owns bounds, limits, colour parsing and the command grammar.
//
// There is exactly ONE contract. `SKETCH_CONTRACT` below is the single source
// of truth: the prompt is generated from it and the parser is validated
// against it, so the two can never drift apart again.
//
// The grammar is deliberately line based, because small local models follow
// short examples far more reliably than nested SVG or free-form JSON:
//
//   COLOR red                 optional, once
//   WIDTH 5                   optional, once
//   C cx cy r                 circle
//   L x1 y1 x2 y2             line
//   R x1 y1 x2 y2             rectangle
//   P x1 y1 x2 y2 ...         polyline (2-30 points)
//   A cx cy r a1 a2           arc, degrees
//   T x y size text           short label
//   ARROW x1 y1 x2 y2         arrow
//
// Coordinates are 0..1000 with (0,0) at the top-left. There is NO tolerant
// rescaling any more: a model that answers in percent or in device pixels is
// out of contract, and the grounding stages in `pet-grounding.cjs` are what
// put the model in the right frame in the first place.

const DEFAULT_DURATION_MS = 8000;
const MIN_DURATION_MS = 2000;
const MAX_DURATION_MS = 20000;
const DEFAULT_COLOR = '#ffd54a';
const DEFAULT_WIDTH = 5;

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

// Nine colours, chosen for contrast against both light and dark screens. The
// prompt used to advertise nine names while the parser quietly accepted
// seventeen; the contract now names exactly nine and the parser accepts
// exactly those nine.
const CONTRACT_COLORS = Object.freeze({
  red: '#ff4d4d',
  green: '#4dff88',
  blue: '#4da6ff',
  yellow: '#ffd54a',
  orange: '#ff9f43',
  pink: '#ff7ad9',
  white: '#ffffff',
  cyan: '#5ef2ff',
  magenta: '#ff5ef2'
});

const SKETCH_CONTRACT = Object.freeze({
  version: 2,
  canvas: Object.freeze({
    min: 0,
    max: 1000,
    origin: 'top-left',
    xAxis: 'right',
    yAxis: 'down',
    description: 'Canvas: x and y are numbers from 0 to 1000. (0,0) is the top-left, (1000,1000) is the bottom-right.'
  }),
  commands: Object.freeze([
    Object.freeze({code: 'C', syntax: 'C cx cy r', shape: 'circle', arity: 3, numbers: 'cx cy r'}),
    Object.freeze({code: 'L', syntax: 'L x1 y1 x2 y2', shape: 'line', arity: 4, numbers: 'x1 y1 x2 y2'}),
    Object.freeze({code: 'R', syntax: 'R x1 y1 x2 y2', shape: 'rectangle', arity: 4, numbers: 'x1 y1 x2 y2'}),
    Object.freeze({code: 'P', syntax: 'P x1 y1 x2 y2 ...', shape: 'polyline', arity: 4, numbers: 'x1 y1 x2 y2 ...'}),
    Object.freeze({code: 'A', syntax: 'A cx cy r a1 a2', shape: 'arc', arity: 5, numbers: 'cx cy r a1 a2'}),
    Object.freeze({code: 'T', syntax: 'T x y size text', shape: 'label', arity: 3, numbers: 'x y size'}),
    Object.freeze({code: 'ARROW', syntax: 'ARROW x1 y1 x2 y2', shape: 'arrow', arity: 4, numbers: 'x1 y1 x2 y2'})
  ]),
  // A rectangle written as "R x y size" is a square from its top-left corner.
  aliases: Object.freeze({
    R: Object.freeze({arity: 3, form: 'R x y size', note: 'a square from its top-left corner'}),
    P: Object.freeze({minArity: 4, even: true, note: '2 numbers per point, at least 2 points'})
  }),
  colors: Object.freeze(Object.keys(CONTRACT_COLORS)),
  colorValues: Object.freeze(CONTRACT_COLORS),
  minCommands: 1,
  maxCommands: 24,
  maxPolyPoints: 30,
  maxTextLength: 80,
  widthRange: Object.freeze([1, 12]),
  textSizeRange: Object.freeze([10, 80]),
  radiusRange: Object.freeze([2, 600]),
  rules: Object.freeze([
    'Answer with drawing commands only, one per line. No prose, no markdown, no explanation.',
    'Use 1 to 24 commands.',
    'Build a simple recognizable outline. Circles, rectangles, lines and arrows are enough.',
    'Do not draw a full-screen frame or a grid unless the user asks for one.',
    'Never invent an object that is not in the image. If you cannot see it, do not draw it.',
    'Never output SVG, JSON, HTML or a sentence.'
  ])
});

const MAX_STROKES = SKETCH_CONTRACT.maxCommands;
const MAX_POLY_POINTS = SKETCH_CONTRACT.maxPolyPoints;
const MAX_TEXT = SKETCH_CONTRACT.maxTextLength;
const COLORS = SKETCH_CONTRACT.colorValues;

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const isHex = (value) => /^#?[0-9a-f]{6}$/i.test(String(value || '').trim());

// Command code -> contract entry. The parser looks up arity here instead of
// carrying its own numbers, so the contract really is the only source.
const CONTRACT_BY_CODE = (() => {
  const table = Object.create(null);
  for (const command of SKETCH_CONTRACT.commands) table[command.code] = command;
  return Object.freeze(table);
})();

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

function cleanLine(line) {
  let text = String(line == null ? '' : line).trim();
  // Markdown bullets, numbered lists, quoted commands and fenced blocks are
  // common small-model habits and carry no meaning here.
  text = text.replace(/^```[a-z0-9_-]*\s*/i, '').replace(/```\s*$/, '').trim();
  text = text.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
  text = text.replace(/^`+|`+$/g, '').trim();
  text = text.replace(/^([A-Za-z]+)\s*:\s*/, '$1 ').trim();
  return text;
}

function makeTextStroke(line) {
  // Text keeps its own punctuation and spaces, so it is parsed before the
  // comma/parenthesis cleanup used for numeric commands.
  const m = line.match(/^(?:T|TEXT|LABEL)\s*[:(]?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*[,:]?\s*([^]*)$/i);
  if (!m) return null;
  const text = cleanText(m[4].replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim());
  if (!text) return null;
  return {
    type: 'text',
    x: Number(m[1]),
    y: Number(m[2]),
    size: Number(m[3]),
    text
  };
}

function parseColor(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (COLORS[raw]) return COLORS[raw];
  if (isHex(raw)) return '#' + raw.replace(/^#/, '').toLowerCase();
  return '';
}

function parseDuration(value, fallback) {
  const n = finite(value);
  if (n == null || n <= 0) return fallback;
  // The prompt asks for seconds. Accept milliseconds too, because a model may
  // copy a number it has seen in the app rather than the prompt.
  const ms = n >= 1000 ? n : n * 1000;
  return clamp(Math.round(ms), MIN_DURATION_MS, MAX_DURATION_MS);
}

// A command the contract knows but the model wrote wrongly is a hard error:
// the grounding loop repairs it once with the exact message. A line that is
// not a command at all (prose, a stray word) is ignored and counted.
function arityError(code, spec, got, nums) {
  const wanted = spec.numbers || String(spec.arity);
  if (code === 'P' && nums.length % 2 !== 0) {
    return 'P needs an even number of numbers (2 per point), got ' + nums.length;
  }
  return code + ' needs ' + spec.arity + ' numbers (' + wanted + '), got ' + got;
}

function parseSketch(raw, options = {}) {
  const contract = SKETCH_CONTRACT;
  const fallbackDuration = clamp(
    Math.round(finite(options.durationMs) || DEFAULT_DURATION_MS),
    MIN_DURATION_MS,
    MAX_DURATION_MS
  );
  const result = {
    ok: false,
    // The exact reason the parse failed. The grounding loop puts this string
    // in front of the model when it asks for a repair.
    error: null,
    warnings: [],
    color: parseColor(options.color) || DEFAULT_COLOR,
    width: clamp(Math.round(finite(options.width) || DEFAULT_WIDTH), contract.widthRange[0], contract.widthRange[1]),
    durationMs: fallbackDuration,
    strokes: [],
    ignored: 0,
    commandCount: 0
  };
  // The model may switch colour between marks ("COLOR red ... COLOR blue ...").
  // Each stroke captures the colour that was active when it was written, so a
  // drawing with two colours does not collapse to the last one.
  let currentColor = result.color;
  let explicitColor = false;
  const addStroke = (stroke) => {
    if (!stroke) return;
    if (explicitColor) stroke.color = currentColor;
    result.strokes.push(stroke);
    result.commandCount++;
    if (result.commandCount > contract.maxCommands) {
      // Reject, never truncate: a drawing with more commands than the contract
      // allows is not a drawing the renderer should half-draw.
      result.error = 'too many commands: ' + result.commandCount + ' (the contract allows at most ' + contract.maxCommands + ')';
      result.strokes = [];
      result.commandCount = result.commandCount;
    }
  };
  const lines = String(raw == null ? '' : raw).split(/\r?\n/);
  for (const line of lines) {
    if (result.error) break;
    const clean = cleanLine(line);
    if (!clean) continue;
    const textStroke = makeTextStroke(clean);
    if (textStroke) {
      addStroke(textStroke);
      continue;
    }
    // Commas, parentheses and equals signs are noise around the numbers.
    const tokens = clean.replace(/[(),=]/g, ' ').split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const command = tokens.shift().toUpperCase();
    const nums = tokens.filter((t) => finite(t) != null).map(Number);
    let stroke = null;
    if (command === 'COLOR' || command === 'COLOUR') {
      const value = tokens.join(' ').trim();
      const color = parseColor(value);
      if (color) {
        result.color = color;
        currentColor = color;
        explicitColor = true;
      } else {
        result.ignored++;
        result.warnings.push('unknown colour "' + value + '" (use one of: ' + contract.colors.join(', ') + ')');
      }
      continue;
    }
    if (command === 'WIDTH' || command === 'W') {
      const width = finite(tokens[0]);
      if (width != null) result.width = clamp(Math.round(width), contract.widthRange[0], contract.widthRange[1]);
      else {
        result.ignored++;
        result.warnings.push('WIDTH needs a number');
      }
      continue;
    }
    if (command === 'DURATION' || command === 'TIME') {
      if (options.allowDuration !== false) result.durationMs = parseDuration(tokens[0], fallbackDuration);
      continue;
    }
    const spec = CONTRACT_BY_CODE[command];
    if (!spec) {
      result.ignored++;
      continue;
    }
    if (command === 'C' || command === 'CIRCLE' || command === 'DOT') {
      if (nums.length >= 3) stroke = {type: 'circle', cx: nums[0], cy: nums[1], r: nums[2]};
      else result.error = arityError('C', spec, nums.length, nums);
    } else if (command === 'L' || command === 'LINE') {
      if (nums.length >= 4) stroke = {type: 'line', x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3]};
      else result.error = arityError('L', spec, nums.length, nums);
    } else if (command === 'R' || command === 'RECT' || command === 'RECTANGLE' || command === 'BOX') {
      if (nums.length >= 4) stroke = {type: 'rect', x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3]};
      else if (nums.length === 3) {
        // A small model often writes a square as "R x y size". The contract
        // lists that form as an accepted alias, not as an error.
        const size = Math.abs(nums[2]);
        stroke = {type: 'rect', x1: nums[0], y1: nums[1], x2: nums[0] + size, y2: nums[1] + size};
      } else result.error = arityError('R', spec, nums.length, nums);
    } else if (command === 'P' || command === 'POLY' || command === 'POLYLINE' || command === 'PATH') {
      if (nums.length >= 4 && nums.length % 2 === 0) {
        const points = [];
        for (let i = 0; i < nums.length && points.length < MAX_POLY_POINTS; i += 2) {
          points.push({x: nums[i], y: nums[i + 1]});
        }
        stroke = {type: 'polyline', points};
      } else result.error = arityError('P', spec, nums.length, nums);
    } else if (command === 'A' || command === 'ARC') {
      if (nums.length >= 5) stroke = {type: 'arc', cx: nums[0], cy: nums[1], r: nums[2], a1: nums[3], a2: nums[4]};
      else result.error = arityError('A', spec, nums.length, nums);
    } else if (command === 'ARROW' || command === 'ARR') {
      if (nums.length >= 4) stroke = {type: 'arrow', x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3]};
      else result.error = arityError('ARROW', spec, nums.length, nums);
    }
    if (stroke) addStroke(stroke);
    else if (!result.error) result.ignored++;
  }

  if (result.error) {
    result.ok = false;
    return result;
  }

  // No tolerant rescale any more. Coordinates are the canvas coordinates the
  // contract asks for, clamped to the canvas. A model that answers in percent
  // or in device pixels is out of contract, and quietly multiplying it by ten
  // is how a top-left target ends up in the middle of the screen.
  const x = (value) => clamp(Math.round(value), contract.canvas.min, contract.canvas.max);
  const y = (value) => clamp(Math.round(value), contract.canvas.min, contract.canvas.max);
  const radius = (value) => clamp(Math.round(value), contract.radiusRange[0], contract.radiusRange[1]);
  const size = (value) => clamp(Math.round(value), contract.textSizeRange[0], contract.textSizeRange[1]);

  const strokes = [];
  for (const stroke of result.strokes) {
    const add = (next) => {
      // A stroke only carries its own colour when the model switched colour
      // part way through. The drawing's colour is the colour for everything
      // else.
      if (stroke.color && stroke.color !== result.color) next.color = stroke.color;
      strokes.push(next);
    };
    if (stroke.type === 'circle') {
      add({type: 'circle', cx: x(stroke.cx), cy: y(stroke.cy), r: radius(stroke.r)});
    } else if (stroke.type === 'arc') {
      add({type: 'arc', cx: x(stroke.cx), cy: y(stroke.cy), r: radius(stroke.r), a1: stroke.a1, a2: stroke.a2});
    } else if (stroke.type === 'text') {
      add({type: 'text', x: x(stroke.x), y: y(stroke.y), size: size(stroke.size), text: stroke.text});
    } else if (stroke.type === 'polyline') {
      const points = stroke.points.map((point) => ({x: x(point.x), y: y(point.y)}));
      if (points.length >= 2) add({type: 'polyline', points});
    } else if (stroke.type === 'rect') {
      const x1 = x(Math.min(stroke.x1, stroke.x2));
      const y1 = y(Math.min(stroke.y1, stroke.y2));
      const x2 = x(Math.max(stroke.x1, stroke.x2));
      const y2 = y(Math.max(stroke.y1, stroke.y2));
      add({type: 'rect', x1, y1, x2, y2});
    } else if (stroke.type === 'arrow') {
      add({type: 'arrow', x1: x(stroke.x1), y1: y(stroke.y1), x2: x(stroke.x2), y2: y(stroke.y2)});
    } else {
      add({
        type: 'line',
        x1: x(stroke.x1),
        y1: y(stroke.y1),
        x2: x(stroke.x2),
        y2: y(stroke.y2)
      });
    }
  }
  result.strokes = strokes;
  result.ok = strokes.length > 0;
  if (!result.ok && !result.error) result.error = 'no drawing command was found';
  return result;
}

// Convert the normalised commands to pixels for the monitor the overlay is on.
// Radius and text use the smaller dimension so a non-square screen does not
// stretch circles into ellipses.
function projectSketch(sketch, width, height) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const sx = w / 1000;
  const sy = h / 1000;
  const s = Math.min(sx, sy);
  const x = (value) => Number((value * sx).toFixed(2));
  const y = (value) => Number((value * sy).toFixed(2));
  const r = (value) => Number((value * s).toFixed(2));
  const strokes = (sketch && sketch.strokes ? sketch.strokes : []).map((stroke) => {
    if (stroke.type === 'circle') return {type: 'circle', cx: x(stroke.cx), cy: y(stroke.cy), r: r(stroke.r)};
    if (stroke.type === 'arc') return {type: 'arc', cx: x(stroke.cx), cy: y(stroke.cy), r: r(stroke.r), a1: stroke.a1, a2: stroke.a2};
    if (stroke.type === 'text') return {type: 'text', x: x(stroke.x), y: y(stroke.y), size: Math.max(10, r(stroke.size)), text: stroke.text};
    if (stroke.type === 'polyline') return {type: 'polyline', points: stroke.points.map((point) => ({x: x(point.x), y: y(point.y)}))};
    if (stroke.type === 'rect') return {type: 'rect', x: x(stroke.x1), y: y(stroke.y1), w: Math.max(1, x(stroke.x2) - x(stroke.x1)), h: Math.max(1, y(stroke.y2) - y(stroke.y1))};
    if (stroke.type === 'arrow') return {type: 'arrow', x1: x(stroke.x1), y1: y(stroke.y1), x2: x(stroke.x2), y2: y(stroke.y2)};
    return {type: 'line', x1: x(stroke.x1), y1: y(stroke.y1), x2: x(stroke.x2), y2: y(stroke.y2)};
  });
  return {width: w, height: h, strokes, color: sketch && sketch.color, widthPx: clamp(Math.round((sketch && sketch.width) || DEFAULT_WIDTH), 1, 12)};
}

// ---------------------------------------------------------------------------
// The prompt, generated from the contract
// ---------------------------------------------------------------------------

function sketchSystemPrompt() {
  const contract = SKETCH_CONTRACT;
  const lines = [
    "You are Ramo Pet's drawing hand. You draw on the user's screen for a few seconds.",
    contract.canvas.description,
    'Commands:'
  ];
  for (const command of contract.commands) {
    lines.push(command.syntax.padEnd(24, ' ') + command.shape);
  }
  lines.push('COLOR ' + contract.colors.join('|') + '   optional, once');
  lines.push('WIDTH ' + contract.widthRange[0] + '-' + contract.widthRange[1] + '                optional, once');
  lines.push('');
  lines.push('Rules:');
  for (const rule of contract.rules) lines.push('- ' + rule);
  return lines.join('\n');
}

const SKETCH_EXAMPLE = [
  'COLOR yellow',
  'WIDTH 6',
  'R 280 470 720 820',
  'P 250 470 500 260 750 470',
  'R 460 650 540 820',
  'C 380 560 36',
  'C 620 560 36'
].join('\n');

// The pet draws on the user's screen, so the model has to see that screen
// before it chooses where the marks go. When the capture is missing the turn
// ends with this line instead of a drawing: a model working from memory would
// put marks over whatever it imagined was there.
const NO_SCREEN_REPLY = 'I cannot see your screen right now, so I will not guess where to draw.';

// There is deliberately no "I cannot see <target>" reply. The pet is never
// offered a refusal: a small model given that choice uses it far too often
// and loses real targets, and a pet that refuses is a pet that does nothing.
// The model always commits to a place and the marks are always shown.

// `options.locked` carries the centre the grounding stages agreed on. The
// model is told exactly where the target is and must not move it.
//
// `options.cropFrame` says that the attached image is a CROP of the screen
// rather than the whole screen. The 0..1000 canvas then refers to that crop,
// and the locked numbers are in the crop's frame. The grounding code maps the
// resulting strokes back to the screen.
function sketchPrompt(request, options = {}) {
  const text = cleanText(request).slice(0, 500) || 'a simple drawing';
  let imageNote;
  if (!options.hasImage) {
    imageNote = 'There is no image attached. Draw from the request alone.';
  } else if (options.cropFrame) {
    imageNote = 'The attached image is a crop of the user\'s screen. Draw only what you can actually see in it.';
  } else if (options.grounded) {
    imageNote = 'The attached image is the user\'s screen. Mark only what you can actually see in it, where it actually is. Do not invent anything that is not in the image.';
  } else {
    imageNote = 'The attached image is the user\'s screen. This request is not about anything on it, so draw in the middle of the canvas.';
  }
  const user = [imageNote];
  if (options.locked && Number.isFinite(Number(options.locked.cx)) && Number.isFinite(Number(options.locked.cy))) {
    const cx = Math.round(Number(options.locked.cx));
    const cy = Math.round(Number(options.locked.cy));
    const rx = Math.max(4, Math.round(Number(options.locked.rx) || 40));
    const ry = Math.max(4, Math.round(Number(options.locked.ry) || 40));
    const frame = options.cropFrame ? 'in the 0..1000 frame of the attached crop' : 'in the 0..1000 canvas';
    // The radius of the ring. The model sizes a circle by the smaller of the
    // two numbers it is given, so the ring is asked for by its radius and not
    // left to be inferred from the size of the thing: a mark of one pixel
    // answers "circle the clock" with a speck.
    const radius = Math.max(4, Math.round(Math.min(rx, ry)));
    user.push('Target: ' + String(options.locked.target || 'the thing the user named'));
    user.push('The target is at (' + cx + ',' + cy + '), about ' + rx + ' x ' + ry + ' ' + frame + '.');
    user.push('A circle around it should have a radius of about ' + radius + ' ' + frame + '.');
    user.push('Draw primitives centred on that point. Do not move it.');
  }
  user.push('');
  user.push('Draw this: ' + text);
  return [
    {role: 'system', content: sketchSystemPrompt()},
    {role: 'system', content: 'Example for "draw a small house":\n' + SKETCH_EXAMPLE},
    {role: 'user', content: user.join('\n')}
  ];
}

function sketchConfirmation(sketch, options = {}) {
  if (!sketch || !Array.isArray(sketch.strokes) || !sketch.strokes.length) {
    return 'I could not turn that into a drawing.';
  }
  return options.screen ? 'There — I marked it on your screen.' : 'There — here is your sketch.';
}

function isDrawRequest(text) {
  const low = String(text == null ? '' : text).toLowerCase();
  if (!low.trim()) return false;
  if (/\bdraw (?:a|the) (?:conclusion|comparison|parallel|distinction)\b/.test(low)) return false;
  if (/\b(draw|sketch|doodle|annotate)\b/.test(low)) return true;
  return /\b(circle|underline|highlight|outline|point (?:to|at)|mark)\b/.test(low) &&
    /\b(screen|monitor|display|here|this|that|these|those|it|them|window|around|under|over|next to|on my)\b/.test(low);
}

// Whether the drawing should see a screenshot. Generic "draw a cat" does not
// need one; "circle the cat on my screen" does.
function wantsScreenContext(text) {
  const low = String(text == null ? '' : text).toLowerCase();
  return /\b(screen|monitor|display|here|this|that|these|those|it|them|window|game|page|picture|image|photo|around|under|over|next to|point to|pointed at|pointing at|circle|highlight|mark|annotate|outline|label)\b/.test(low);
}

// The mark the detector produces.
//
// A detected object becomes drawing commands in the same grammar the model
// writes in, so the overlay renders it through exactly one path and the
// contract's limits apply to it as well.
//
// The mask's outline is preferred over the box: a box is a rectangle around
// the thing, and an outline is the shape of the thing. When there is no mask,
// the box becomes a circle around its middle, which is the mark the drawing
// stage has always produced.
//
// options:
//   width, height   the capture's size in pixels, for the 0..1000 frame
//   polygon         the mask outline in capture pixels (optional)
//   color           a colour name from the contract (default red)
//   strokeWidth     the width of the line (default 4)
function boxToSketchCommands(box, options = {}) {
  const width = Math.max(1, Math.round(Number(options.width) || 1000));
  const height = Math.max(1, Math.round(Number(options.height) || 1000));
  const toCanvas = (x, y) => [
    clamp(Math.round((x / width) * 1000), 0, 1000),
    clamp(Math.round((y / height) * 1000), 0, 1000)
  ];
  const color = options.color && COLORS[options.color] ? options.color : 'red';
  const strokeWidth = clamp(Math.round(Number(options.strokeWidth) || 4), 1, 12);
  const polygon = Array.isArray(options.polygon)
    ? options.polygon
    : (box && Array.isArray(box.polygon) ? box.polygon : null);
  if (polygon && polygon.length >= 3) {
    const points = [];
    for (const point of polygon) {
      if (!point || point.length < 2) continue;
      const [x, y] = toCanvas(Number(point[0]), Number(point[1]));
      const previous = points[points.length - 1];
      if (previous && previous[0] === x && previous[1] === y) continue;
      points.push([x, y]);
      if (points.length >= MAX_POLY_POINTS) break;
    }
    if (points.length >= 3) {
      // The polyline is closed by repeating its first point.
      const closed = points.slice();
      if (closed.length < MAX_POLY_POINTS) closed.push(closed[0]);
      const flat = closed.map((point) => point.join(' ')).join(' ');
      return ['COLOR ' + color, 'WIDTH ' + strokeWidth, 'P ' + flat].join('\n');
    }
  }
  if (!box) return '';
  const cx = Number(box.x) + Number(box.w) / 2;
  const cy = Number(box.y) + Number(box.h) / 2;
  const [x, y] = toCanvas(cx, cy);
  const r = clamp(Math.round(Math.max(Number(box.w), Number(box.h)) / 2 / width * 1000), 2, 600);
  return ['COLOR ' + color, 'WIDTH ' + strokeWidth, 'C ' + x + ' ' + y + ' ' + r].join('\n');
}

module.exports = {
  SKETCH_CONTRACT,
  MAX_STROKES,
  MAX_COMMANDS: SKETCH_CONTRACT.maxCommands,
  MAX_POLY_POINTS,
  MAX_TEXT,
  DEFAULT_DURATION_MS,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  COLORS,
  NO_SCREEN_REPLY,
  parseSketch,
  projectSketch,
  sketchSystemPrompt,
  sketchPrompt,
  sketchConfirmation,
  isDrawRequest,
  wantsScreenContext,
  boxToSketchCommands,
  cleanText
};
