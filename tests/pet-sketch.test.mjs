import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_STROKES,
  MAX_TEXT,
  SKETCH_CONTRACT,
  DEFAULT_DURATION_MS,
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  parseSketch,
  projectSketch,
  sketchPrompt,
  sketchSystemPrompt,
  sketchConfirmation,
  isDrawRequest,
  wantsScreenContext,
  NO_SCREEN_REPLY,
  cleanText
} = require('../src/native/pet-sketch.cjs');

/**
 * The pet's drawing hand is deliberately dumb: a local Bonsai model answers
 * with a few short commands, this module bounds every number and label, and
 * the overlay renders the result for a few seconds.
 *
 * These checks decide what can be decided without a model or a screen:
 * the grammar, the clamps, one tolerant rescale, projection to pixels, the
 * prompt shape and the intent gate. They do not judge whether a drawing
 * "looks right"; that needs a live local model run.
 */

test('a small house becomes circles, lines and a rectangle', () => {
  const sketch = parseSketch([
    'COLOR yellow',
    'WIDTH 6',
    'R 280 470 720 820',
    'P 250 470 500 260 750 470',
    'R 460 650 540 820',
    'C 380 560 36'
  ].join('\n'));
  assert.equal(sketch.ok, true);
  assert.equal(sketch.strokes.length, 4);
  assert.equal(sketch.color, '#ffd54a');
  assert.equal(sketch.width, 6);
  assert.deepEqual(sketch.strokes[0], {type: 'rect', x1: 280, y1: 470, x2: 720, y2: 820});
  assert.deepEqual(sketch.strokes[1], {type: 'polyline', points: [{x: 250, y: 470}, {x: 500, y: 260}, {x: 750, y: 470}]});
});

test('every command type is read', () => {
  const sketch = parseSketch([
    'C 500 500 40',
    'L 10 20 30 40',
    'R 100 100 200 200',
    'P 10 10 20 20 30 10',
    'A 500 500 100 0 180',
    'T 500 500 24 hello',
    'ARROW 10 10 200 200'
  ].join('\n'));
  assert.equal(sketch.ok, true);
  assert.deepEqual(sketch.strokes.map((s) => s.type), ['circle', 'line', 'rect', 'polyline', 'arc', 'text', 'arrow']);
  assert.equal(sketch.strokes[5].text, 'hello');
});

test('markdown, bullets, numbered lists and fenced blocks are tolerated', () => {
  const sketch = parseSketch([
    '```',
    '1. C: 500 500 40',
    '- L 10 10 20 20',
    '`R 100 100 200 200`',
    '```',
    'C: 300 300 20'
  ].join('\n'));
  assert.equal(sketch.ok, true);
  assert.deepEqual(sketch.strokes.map((s) => s.type), ['circle', 'line', 'rect', 'circle']);
});

test('coordinates outside the canvas are clamped, not dropped', () => {
  const sketch = parseSketch('C -500 1000 900\nL -20 -20 500 500');
  assert.equal(sketch.ok, true);
  assert.deepEqual(sketch.strokes[0], {type: 'circle', cx: 0, cy: 1000, r: 600});
  assert.deepEqual(sketch.strokes[1], {type: 'line', x1: 0, y1: 0, x2: 500, y2: 500});
});

test('coordinates are never rescaled', () => {
  // The old "0..100 means percent" correction is gone: a model that answers
  // in percent is out of contract, and quietly multiplying it by ten is how
  // a top-left target ends up in the middle of the screen.
  const sketch = parseSketch('C 50 50 10\nL 0 0 100 100');
  assert.equal(sketch.ok, true);
  assert.deepEqual(sketch.strokes[0], {type: 'circle', cx: 50, cy: 50, r: 10});
  assert.deepEqual(sketch.strokes[1], {type: 'line', x1: 0, y1: 0, x2: 100, y2: 100});
});

test('device-pixel coordinates are clamped, not rescaled', () => {
  const sketch = parseSketch('C 960 540 100\nL 0 0 1920 1080');
  assert.equal(sketch.ok, true);
  assert.deepEqual(sketch.strokes[0], {type: 'circle', cx: 960, cy: 540, r: 100});
  assert.deepEqual(sketch.strokes[1], {type: 'line', x1: 0, y1: 0, x2: 1000, y2: 1000});
});

test('already-normalised coordinates are not rescaled', () => {
  const sketch = parseSketch('C 500 500 50\nL 100 200 800 900');
  assert.equal(sketch.ok, true);
  assert.deepEqual(sketch.strokes[0], {type: 'circle', cx: 500, cy: 500, r: 50});
  assert.deepEqual(sketch.strokes[1], {type: 'line', x1: 100, y1: 200, x2: 800, y2: 900});
});

test('rectangles are normalised so x1/y1 is the top-left', () => {
  const sketch = parseSketch('R 800 900 200 100');
  assert.equal(sketch.ok, true);
  assert.deepEqual(sketch.strokes[0], {type: 'rect', x1: 200, y1: 100, x2: 800, y2: 900});
});

test('a polyline needs an even number of coordinates and at least two points', () => {
  assert.equal(parseSketch('P 10 10 20').ok, false);
  assert.equal(parseSketch('P 10 10').ok, false);
  const sketch = parseSketch('P 10 10 20 20');
  assert.equal(sketch.ok, true);
  assert.equal(sketch.strokes[0].points.length, 2);
});

test('a malformed numeric command is an error the model can be told about', () => {
  // A known command written with the wrong number of values is out of
  // contract, so the parse fails with the exact reason. The grounding loop
  // hands that reason back to the model for one repair.
  const sketch = parseSketch('C 500 500\nL 10 10 20 20\nHELLO world');
  assert.equal(sketch.ok, false);
  assert.equal(sketch.strokes.length, 0);
  assert.match(sketch.error, /C needs 3 numbers/);
});

test('a line that is not a command at all is ignored and counted', () => {
  const sketch = parseSketch('I will draw a cat sitting on a mat.\nC 500 500 20');
  assert.equal(sketch.ok, true);
  assert.equal(sketch.strokes.length, 1);
  assert.equal(sketch.ignored, 1);
});

test('prose alone is not a drawing', () => {
  const sketch = parseSketch('I would draw a cat sitting on a mat. It would have whiskers.');
  assert.equal(sketch.ok, false);
  assert.equal(sketch.strokes.length, 0);
  assert.ok(sketch.ignored >= 1);
});

test('empty and whitespace input is not a drawing', () => {
  for (const value of ['', '   ', '\n\n', null, undefined]) {
    const sketch = parseSketch(value);
    assert.equal(sketch.ok, false);
    assert.equal(sketch.strokes.length, 0);
  }
});

test('more commands than the contract allows is rejected, never truncated', () => {
  const lines = [];
  for (let i = 0; i < MAX_STROKES + 1; i++) lines.push('C ' + (100 + i) + ' 500 10');
  const tooMany = parseSketch(lines.join('\n'));
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.strokes.length, 0);
  assert.match(tooMany.error, /too many commands: 25/);
  // Exactly the contract limit is still fine.
  const exact = parseSketch(lines.slice(0, MAX_STROKES).join('\n'));
  assert.equal(exact.ok, true);
  assert.equal(exact.strokes.length, MAX_STROKES);
});

test('polyline points are bounded', () => {
  const nums = [];
  for (let i = 0; i < 200; i++) nums.push(i * 4, i * 3);
  const sketch = parseSketch('P ' + nums.join(' '));
  assert.equal(sketch.ok, true);
  assert.equal(sketch.strokes[0].points.length, 30);
});

test('text is stripped of control characters and cut to the limit', () => {
  const sketch = parseSketch('T 500 500 24 ' + 'a'.repeat(200) + '\u0000\u001f');
  assert.equal(sketch.ok, true);
  assert.equal(sketch.strokes[0].text.length, MAX_TEXT);
  assert.equal(cleanText('  a\n\nb\tc  '), 'a b c');
});

test('text keeps quotes, punctuation and spaces inside the label', () => {
  const sketch = parseSketch('T 400 400 30 "Hello, world!"');
  assert.equal(sketch.ok, true);
  assert.equal(sketch.strokes[0].text, 'Hello, world!');
});

test('colour accepts names and hex, and rejects nonsense', () => {
  assert.equal(parseSketch('COLOR red\nC 500 500 20').color, '#ff4d4d');
  assert.equal(parseSketch('COLOR #00FF88\nC 500 500 20').color, '#00ff88');
  assert.equal(parseSketch('COLOR 0099ff\nC 500 500 20').color, '#0099ff');
  assert.equal(parseSketch('COLOR blurple\nC 500 500 20').color, DEFAULT_COLOR);
});

test('width is clamped to a visible range', () => {
  assert.equal(parseSketch('WIDTH 0\nC 500 500 20').width, 1);
  assert.equal(parseSketch('WIDTH 99\nC 500 500 20').width, 12);
  assert.equal(parseSketch('C 500 500 20').width, DEFAULT_WIDTH);
});

test('the user setting wins over a model-supplied duration', () => {
  const locked = parseSketch('DURATION 60\nC 500 500 20', {durationMs: 8000, allowDuration: false});
  assert.equal(locked.durationMs, 8000);
  const allowed = parseSketch('DURATION 60\nC 500 500 20', {durationMs: 8000, allowDuration: true});
  assert.equal(allowed.durationMs, 20000);
});

test('duration is clamped and milliseconds are accepted', () => {
  assert.equal(parseSketch('C 500 500 20', {durationMs: 10}).durationMs, 2000);
  assert.equal(parseSketch('C 500 500 20', {durationMs: 999999}).durationMs, 20000);
  assert.equal(parseSketch('C 500 500 20').durationMs, DEFAULT_DURATION_MS);
});

test('projection maps to pixels and keeps circles round', () => {
  const sketch = parseSketch('C 500 500 100\nL 0 0 1000 1000\nR 0 0 1000 1000\nT 500 500 40 hi');
  const projected = projectSketch(sketch, 1920, 1080);
  assert.equal(projected.width, 1920);
  assert.equal(projected.height, 1080);
  const circle = projected.strokes[0];
  assert.equal(circle.cx, 960);
  assert.equal(circle.cy, 540);
  // Radius uses the smaller axis, so 100 * min(1.92, 1.08) = 108.
  assert.equal(circle.r, 108);
  const line = projected.strokes[1];
  assert.deepEqual([line.x1, line.y1, line.x2, line.y2], [0, 0, 1920, 1080]);
  const rect = projected.strokes[2];
  assert.deepEqual([rect.x, rect.y, rect.w, rect.h], [0, 0, 1920, 1080]);
  const label = projected.strokes[3];
  assert.deepEqual([label.x, label.y], [960, 540]);
});

test('projection of an empty sketch is safe', () => {
  const projected = projectSketch({strokes: []}, 800, 600);
  assert.equal(projected.strokes.length, 0);
  assert.equal(projected.width, 800);
  assert.equal(projected.height, 600);
  assert.deepEqual(projectSketch(null, 0, 0), {width: 1, height: 1, strokes: [], color: null, widthPx: DEFAULT_WIDTH});
});

test('the prompt carries the grammar, an example and the image note', () => {
  const plain = sketchPrompt('draw a cat', {hasImage: false});
  assert.equal(plain.length, 3);
  assert.equal(plain[0].role, 'system');
  assert.match(plain[0].content, /C cx cy r/);
  assert.match(plain[0].content, /0 to 1000/);
  assert.match(plain[1].content, /Example/);
  assert.match(plain[2].content, /There is no image attached/);
  assert.match(plain[2].content, /draw a cat/);

  const screen = sketchPrompt('circle the cat', {hasImage: true});
  assert.match(screen[2].content, /attached image is the user's screen/);
});

test('an overlong request is cut before it reaches the model', () => {
  const prompt = sketchPrompt('x'.repeat(900));
  assert.ok(prompt[2].content.length < 700);
});

test('the drawing prompt grounds the marks in the attached screen', () => {
  const prompt = sketchPrompt('circle the cat on my screen', {hasImage: true, grounded: true});
  assert.match(prompt[2].content, /attached image is the user's screen/);
  assert.match(prompt[2].content, /only what you can actually see/);
  assert.match(prompt[2].content, /Do not invent anything that is not in the image/);
  assert.match(prompt[0].content, /Never invent an object that is not in the image/);
});

test('an imaginary request keeps the screen but is told to draw in the middle', () => {
  const prompt = sketchPrompt('draw a small house', {hasImage: true, grounded: false});
  assert.match(prompt[2].content, /attached image is the user's screen/);
  assert.match(prompt[2].content, /draw in the middle of the canvas/);
});

test('a request with no screen attached says so plainly', () => {
  const prompt = sketchPrompt('circle the cat', {hasImage: false, grounded: true});
  assert.match(prompt[2].content, /There is no image attached/);
  assert.doesNotMatch(prompt[2].content, /attached image is the user's screen/);
});

test('the pet refuses to draw when it cannot see the screen', () => {
  assert.match(NO_SCREEN_REPLY, /cannot see your screen/);
  assert.match(NO_SCREEN_REPLY, /will not guess/);
});

test('the confirmation matches the mode and never invents detail', () => {
  const sketch = parseSketch('C 500 500 40');
  assert.equal(sketchConfirmation(sketch, {screen: true}), 'There — I marked it on your screen.');
  assert.equal(sketchConfirmation(sketch, {screen: false}), 'There — here is your sketch.');
  assert.equal(sketchConfirmation({strokes: []}), 'I could not turn that into a drawing.');
});

test('plain drawing requests are recognised', () => {
  for (const text of [
    'draw a cat',
    'sketch a house',
    'doodle a star',
    'draw me a tree'
  ]) assert.equal(isDrawRequest(text), true, text);
});

test('screen-marking requests are recognised', () => {
  for (const text of [
    'circle the button on my screen',
    'underline this line',
    'highlight that',
    'point at it',
    'mark the cat on my screen',
    'outline the window',
    'annotate this page'
  ]) assert.equal(isDrawRequest(text), true, text);
});

test('figurative "draw a conclusion" is not a drawing request', () => {
  for (const text of [
    'draw a conclusion from this',
    'draw the comparison',
    'draw a parallel',
    'draw the distinction'
  ]) assert.equal(isDrawRequest(text), false, text);
});

test('unrelated conversation is not a drawing request', () => {
  for (const text of ['', 'hello', 'what is on my screen', 'set a timer', 'what is the weather today']) {
    assert.equal(isDrawRequest(text), false, text);
  }
});

test('screen context is requested only when the request points at something', () => {
  assert.equal(wantsScreenContext('draw a cat'), false);
  assert.equal(wantsScreenContext('draw a star in the middle'), false);
  assert.equal(wantsScreenContext('circle the cat on my screen'), true);
  assert.equal(wantsScreenContext('highlight this'), true);
  assert.equal(wantsScreenContext('label that window'), true);
  assert.equal(wantsScreenContext('draw an arrow to the thing pointed at'), true);
});

test('the prompt is generated from the contract, so the two cannot drift', () => {
  const system = sketchSystemPrompt();
  // The colour list in the prompt is the contract's colour list, exactly.
  assert.ok(system.includes('COLOR ' + SKETCH_CONTRACT.colors.join('|')));
  assert.equal(SKETCH_CONTRACT.colors.length, 9);
  // The command count in the prompt is the contract's command count.
  assert.ok(system.includes('Use ' + SKETCH_CONTRACT.minCommands + ' to ' + SKETCH_CONTRACT.maxCommands + ' commands.'));
  assert.equal(SKETCH_CONTRACT.maxCommands, 24);
  // Every command the contract defines is in the prompt, and nothing else is.
  for (const command of SKETCH_CONTRACT.commands) assert.ok(system.includes(command.syntax), command.syntax);
  assert.ok(system.includes('0 to 1000'));
});

test('the parser accepts exactly the contract colours', () => {
  for (const name of SKETCH_CONTRACT.colors) {
    assert.equal(parseSketch('COLOR ' + name + '\nC 500 500 20').color, SKETCH_CONTRACT.colorValues[name]);
  }
  // Names the old parser accepted but the contract does not are refused.
  for (const name of ['black', 'gray', 'grey', 'brown', 'purple', 'lime', 'teal']) {
    assert.equal(parseSketch('COLOR ' + name + '\nC 500 500 20').color, DEFAULT_COLOR, name);
  }
});

test('the locked centre is handed to the model in the user message', () => {
  const prompt = sketchPrompt('circle the Settings gear', {
    hasImage: true,
    grounded: true,
    locked: {cx: 312, cy: 844, rx: 24, ry: 24, target: 'the Settings gear'}
  });
  const user = prompt[prompt.length - 1].content;
  assert.match(user, /The target is at \(312,844\)/);
  assert.match(user, /about 24 x 24/);
  assert.match(user, /centred on that point/);
  assert.match(user, /Do not move it/);
  assert.match(user, /the Settings gear/);
});
