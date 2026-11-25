import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const grounding = require('../src/native/pet-grounding.cjs');
const {SKETCH_CONTRACT} = require('../src/native/pet-sketch.cjs');

/**
 * The grounding loop is the part of the pet that decides WHERE a mark goes.
 * It is driven entirely by injected dependencies, so every branch can be
 * exercised here without a model and without a screen: what the loop asks,
 * what it does with the answer, how many model calls it spends, and what it
 * refuses to do.
 */

const {
  ROUTING_CELLS,
  GRID_COLS,
  GRID_ROWS,
  GRID_CELL_COUNT,
  GROUNDING_STAGES,
  SMALL_TARGET_PIXELS,
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
  validateCell,
  validateLocate,
  validateRefine,
  runGroundedDraw
} = grounding;

// --- geometry ---------------------------------------------------------------

test('the nine routing cells tile the canvas', () => {
  assert.equal(ROUTING_CELLS.length, 9);
  const topLeft = cellRect('top-left');
  const topRight = cellRect('top-right');
  const bottomLeft = cellRect('bottom-left');
  const bottomRight = cellRect('bottom-right');
  assert.deepEqual([topLeft.x, topLeft.y], [0, 0]);
  assert.deepEqual([topRight.x + topRight.w, topRight.y], [1000, 0]);
  assert.deepEqual([bottomLeft.x, bottomLeft.y + bottomLeft.h], [0, 1000]);
  assert.deepEqual([bottomRight.x + bottomRight.w, bottomRight.y + bottomRight.h], [1000, 1000]);
  assert.equal(cellRect('nowhere'), null);
});

test('the numbered grid tiles the canvas and numbers its cells in reading order', () => {
  assert.equal(GRID_COLS * GRID_ROWS, GRID_CELL_COUNT);
  const first = gridCellRect(1);
  const last = gridCellRect(GRID_CELL_COUNT);
  const second = gridCellRect(2);
  assert.deepEqual([first.x, first.y], [0, 0]);
  assert.deepEqual([last.x + last.w, last.y + last.h], [1000, 1000]);
  // Cell 2 is the one to the right of cell 1, not the one below it.
  assert.equal(second.x, first.w);
  assert.equal(second.y, first.y);
  assert.equal(gridCellRect(0), null);
  assert.equal(gridCellRect(GRID_CELL_COUNT + 1), null);
  assert.equal(gridCellRect('seven'), null);
});

test('the grid crop is the cell with a margin, and stays on the canvas', () => {
  const crop = gridCropRect(1, 0.25);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 0);
  assert.ok(crop.w > 200 && crop.h > 250, 'the crop is bigger than the cell');
  const middle = gridCropRect(12, 0.25);
  assert.ok(middle.x > 0 && middle.y > 0);
  assert.ok(middle.x + middle.w < 1000);
  assert.ok(middle.y + middle.h < 1000);
});

test('a cell crop adds a margin and stays on the canvas', () => {
  const crop = cropRectForCell('top-left', 0.18);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 0);
  const middle = cropRectForCell('center', 0.18);
  assert.ok(middle.x > 0 && middle.y > 0);
  assert.ok(middle.x + middle.w < 1000);
});

test('a crop maps back to the screen through one function', () => {
  const crop = {x: 300, y: 100, w: 400, h: 200};
  const centre = projectCropToGlobal(crop, {x: 500, y: 500, w: 0, h: 0});
  assert.equal(Math.round(centre.x), 500);
  assert.equal(Math.round(centre.y), 200);
  const edge = projectCropToGlobal(crop, {x: 0, y: 0, w: 1000, h: 1000});
  assert.deepEqual([Math.round(edge.x), Math.round(edge.y), Math.round(edge.w), Math.round(edge.h)], [300, 100, 400, 200]);
  const point = projectPointToGlobal(crop, 250, 250);
  assert.equal(Math.round(point.x), 400);
  assert.equal(Math.round(point.y), 150);
});

test('the crop mapping round trips', () => {
  const crop = cropRectForCell('middle-right', 0.2);
  const global = {x: 700, y: 400, w: 120, h: 90};
  const local = projectGlobalToCrop(crop, global);
  const back = projectCropToGlobal(crop, local);
  for (const key of ['x', 'y', 'w', 'h']) {
    assert.ok(Math.abs(back[key] - global[key]) < 0.001, key + ': ' + back[key] + ' vs ' + global[key]);
  }
});

test('a centre and a size become a top-left box', () => {
  assert.deepEqual(boxFromCentre({cx: 500, cy: 400, w: 100, h: 50}), {x: 450, y: 375, w: 100, h: 50});
  assert.deepEqual(boxCentre({x: 450, y: 375, w: 100, h: 50}), {cx: 500, cy: 400});
});

test('a box grows around its own centre and stays on the canvas', () => {
  const grown = expandBox({x: 10, y: 10, w: 20, h: 20}, 2);
  assert.deepEqual([grown.x, grown.y, grown.w, grown.h], [0, 0, 40, 40]);
  const inside = expandBox({x: 400, y: 400, w: 100, h: 100}, 2);
  assert.deepEqual([inside.x, inside.y, inside.w, inside.h], [350, 350, 200, 200]);
});

test('the refine region is the named cell, or a region around the box', () => {
  const named = refineRegion({x: 10, y: 10, w: 20, h: 20}, 'bottom-left');
  assert.deepEqual(named, cropRectForCell('bottom-left', 0.18));
  const around = refineRegion({x: 100, y: 100, w: 20, h: 20}, null);
  assert.ok(around.w >= 60 && around.h >= 60, 'the region is big enough to read');
  assert.ok(around.x <= 100 && around.y <= 100);
});

test('the drawing region surrounds the target and stays on the canvas', () => {
  const region = drawRegion({x: 100, y: 100, w: 100, h: 100});
  assert.ok(region.w >= 220 && region.h >= 220);
  assert.ok(region.x <= 100 && region.y <= 100);
  assert.ok(region.x + region.w >= 200 && region.y + region.h >= 200);
  const corner = drawRegion({x: 0, y: 0, w: 10, h: 10});
  assert.ok(corner.x >= 0 && corner.y >= 0);
  assert.ok(corner.x + corner.w <= 1000 && corner.y + corner.h <= 1000);
});

test('strokes drawn in a crop land back on the screen', () => {
  const crop = {x: 300, y: 100, w: 400, h: 200};
  // A circle at the middle of the crop is the middle of that region.
  const circle = projectStrokeToGlobal(crop, {type: 'circle', cx: 500, cy: 500, r: 100});
  assert.equal(Math.round(circle.cx), 500);
  assert.equal(Math.round(circle.cy), 200);
  // The radius is scaled by the smaller side of the crop.
  assert.equal(Math.round(circle.r), 20);
  // A line keeps both ends.
  const line = projectStrokeToGlobal(crop, {type: 'line', x1: 0, y1: 0, x2: 1000, y2: 1000});
  assert.deepEqual([Math.round(line.x1), Math.round(line.y1), Math.round(line.x2), Math.round(line.y2)], [300, 100, 700, 300]);
  // A polyline keeps every point.
  const poly = projectStrokeToGlobal(crop, {type: 'polyline', points: [{x: 0, y: 0}, {x: 1000, y: 1000}]});
  assert.deepEqual(poly.points.map((p) => [Math.round(p.x), Math.round(p.y)]), [[300, 100], [700, 300]]);
  // The colour of a stroke survives the trip.
  const coloured = projectStrokeToGlobal(crop, {type: 'circle', cx: 500, cy: 500, r: 10, color: '#ff0000'});
  assert.equal(coloured.color, '#ff0000');
  assert.equal(projectStrokesToGlobal(crop, [coloured]).length, 1);
});

// --- requests and answers ---------------------------------------------------

test('the target phrase is the thing the user named, with the place they gave', () => {
  assert.equal(targetPhrase('circle the Settings gear on my screen'), 'the Settings gear');
  assert.equal(targetPhrase('please highlight the red folder icon'), 'the red folder icon');
  assert.equal(targetPhrase('mark the elephant'), 'the elephant');
  assert.equal(targetPhrase('underline this line'), 'this line');
  assert.equal(targetPhrase(''), 'the thing the user named');
  // The place is kept: it is what tells the model where to look.
  assert.equal(targetPhrase('circle the search box on my taskbar'), 'the search box on my taskbar');
  assert.equal(targetPhrase('circle the cat in the photo'), "the cat in the photo");
  assert.equal(targetPhrase('circle the big window on the left side of the screen'), 'the big window on the left side of the screen');
});

test('a JSON reply is read out of whatever wrapper the model used', () => {
  assert.deepEqual(parseJsonReply('{"present":true,"cell":"center"}').value, {present: true, cell: 'center'});
  assert.deepEqual(parseJsonReply('```json\n{"present":false,"cell":"center"}\n```').value, {present: false, cell: 'center'});
  assert.deepEqual(parseJsonReply('Here you go: {"present":true,"cell":"top-left"} done').value, {present: true, cell: 'top-left'});
  assert.equal(parseJsonReply('not json at all').ok, false);
  assert.equal(parseJsonReply('').ok, false);
  assert.equal(parseJsonReply('{"a":1').ok, false);
});

test('stage answers are checked against their schema', () => {
  assert.equal(validateLocate({cx: 1, cy: 2, w: 3, h: 4}), null);
  assert.match(validateLocate({cx: 1, cy: 2, w: 3}), /cx/);
  assert.match(validateLocate({cx: 1, cy: 2, w: 0, h: 4}), /greater than zero/);
  assert.match(validateLocate({cx: -1, cy: 2, w: 3, h: 4}), /between 0 and 1000/);
  assert.equal(validateRefine({cx: 1, cy: 2, w: 3, h: 4}), null);
  assert.match(validateRefine({cx: 1, cy: 2, w: 3}), /cx/);
  // A cell answer is one number, and it has to be a cell that exists.
  assert.equal(validateCell({cell: 1}), null);
  assert.equal(validateCell({cell: GRID_CELL_COUNT}), null);
  assert.match(validateCell({cell: 0}), /between 1 and/);
  assert.match(validateCell({cell: GRID_CELL_COUNT + 1}), /between 1 and/);
  assert.match(validateCell({cell: 4.5}), /whole number/);
  assert.match(validateCell({}), /cell/);
});

test('the model is never offered a refusal', () => {
  // There is no "is it there?" question anywhere in the prompts, and no
  // "present" field in the schema. A small model that is offered the choice
  // uses it far too often and loses real targets.
  for (const prompt of [cellPrompt('the Settings gear'), locatePrompt('the Settings gear')]) {
    assert.doesNotMatch(prompt, /not visible|not there|absent|present/i);
    assert.match(prompt, /Give your best answer even if you are not sure/);
  }
  assert.match(cellPrompt('the Settings gear'), /Which numbered cell contains/);
  assert.match(locatePrompt('the Settings gear'), /Give the tight box/);
  assert.equal('present' in grounding.LOCATE_SCHEMA.properties, false);
  assert.equal('present' in grounding.LOCATE_SCHEMA.required, false);
  assert.equal('present' in grounding.CELL_SCHEMA.properties, false);
  assert.equal('present' in grounding.CELL_SCHEMA.required, false);
});

test('there is no veto stage anywhere in the grounding path', () => {
  // A check that can throw the drawing away is a refusal in everything but
  // name, and on a 4B model it said "no" almost every time, including on
  // drawings that were in the right place. So the check can only buy a retry.
  const sketch = require('../src/native/pet-sketch.cjs');
  assert.equal('unreliableReply' in sketch, false);
  // The "I cannot see <target>" helper is gone too. The pet never offers the
  // model a refusal: it commits to a place and the marks are shown.
  assert.equal('noTargetReply' in sketch, false);
  assert.match(grounding.checkPrompt('the cat'), /Answer true if the red marks are on/);
  assert.doesNotMatch(grounding.checkPrompt('the cat'), /not visible|not there|absent/i);
});

test('the drawing is always shown: nothing can veto it', async () => {
  // The model is never asked whether the target exists, so it commits to a
  // place and the pet draws there. A failed check buys a retry, never
  // silence.
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, true);
  assert.equal(result.drew, true);
  assert.equal(result.sketch.strokes.length, 1);
  assert.equal(result.reply, null, 'no refusal message');
  assert.equal(model.calls.length, 4, 'cell, refine, draw, check');
});

test('a failed check buys a retry, and the retry is what is shown', async () => {
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: false}},
    {value: {cell: 3}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    // The retry's own check passes, so the retry is shown.
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  // The drawing is shown, not dropped.
  assert.equal(result.ok, true);
  assert.equal(result.drew, true);
  assert.equal(result.retried, true);
  // The retry was shown the grid with the rejected cell crossed out.
  assert.equal(model.calls[4].image, 'grid-2');
  assert.equal(deps.grids[1].rejectCell, 12);
  // The retry's place is the one that was used, and it is not the first one.
  assert.equal(model.calls.length, 8, 'cell, refine, draw, check, cell, refine, draw, check');
  assert.equal(Math.round(result.box.x), 365, 'the box moved to the retry position');
  assert.ok(result.sketch.strokes.length === 1);
});

test('a retry that fails its own check leaves the first drawing on the screen', async () => {
  // The retry is not a veto and it is not a free pass: it has to earn the
  // place. An unchecked retry moved a mark that was 16 units from the target
  // to 844 units from it, so the retry is checked and the first drawing is
  // kept when neither passes.
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: false}},
    {value: {cell: 3}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: false}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, true);
  assert.equal(result.drew, true);
  assert.equal(result.retried, true);
  // The box is the FIRST one, not the retry's.
  assert.equal(Math.round(result.box.x), 165, 'the first place was kept');
});

test('a check that fails twice still shows a drawing', async () => {
  // There is no path that ends with "no drawing" because of a wrong place.
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: false}},
    {value: {cell: 3}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: false}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, true);
  assert.equal(result.drew, true);
  assert.equal(result.sketch.strokes.length, 1);
});

test('a retry that cannot be drawn falls back to the first drawing', async () => {
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: false}},
    {value: {cell: 3}},
    {value: BIG},
    {error: 'the drawing could not be read', raw: 'nonsense'},
    {raw: 'still nonsense'}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, true);
  assert.equal(result.drew, true);
  assert.equal(result.sketch.strokes.length, 1);
});

// --- the loop ---------------------------------------------------------------

// A refine answer for a big thing: it lands as a box that is too big to be
// worth the extra zoom look, so the test scripts stay short.
const BIG = {cx: 500, cy: 500, w: 900, h: 900};

// A scripted model. Every call is recorded, so the test can check what the
// loop asked, in which order, and how many calls it spent.
function fakeModel(script) {
  const calls = [];
  let index = 0;
  const step = () => {
    const next = script[index++];
    if (!next) throw Error('the model was called more times than the script allows');
    return next;
  };
  return {
    calls,
    callJson: async (args) => {
      calls.push({kind: 'json', image: args.image, messages: args.messages, numPredict: args.numPredict, think: args.think, schema: args.schema});
      const next = step();
      if (next.error) return {ok: false, error: next.error, raw: next.raw || ''};
      return {ok: true, value: next.value, raw: JSON.stringify(next.value)};
    },
    callDraw: async (args) => {
      calls.push({kind: 'draw', image: args.image, messages: args.messages, numPredict: args.numPredict, think: args.think});
      const next = step();
      if (next.error) return {ok: false, error: next.error, raw: next.raw || ''};
      return {raw: next.raw};
    }
  };
}

function fakeDeps(model, overrides = {}) {
  const crops = [];
  const shapes = [];
  const grids = [];
  return {
    crops,
    shapes,
    grids,
    callJson: (args) => model.callJson(args),
    callDraw: (args) => model.callDraw(args),
    crop: async (args) => {
      crops.push(args);
      return {ok: true, base64: 'crop-' + crops.length};
    },
    renderShape: async (args) => {
      shapes.push(args);
      return {ok: true, base64: 'shaped-' + shapes.length};
    },
    // The numbered grid. It is drawn on the screen view, so every grid is a
    // picture of the whole screen with cells on it.
    renderGrid: async (args) => {
      grids.push(args);
      return {ok: true, base64: 'grid-' + grids.length};
    },
    log: () => {},
    ...overrides
  };
}

const baseContext = {
  request: 'circle the Settings gear on my screen',
  target: 'the Settings gear',
  model: 'bonsai-2:4b',
  screenView: 'screen-view',
  fullImage: {ok: true},
  screenWidth: 1920,
  screenHeight: 1200,
  options: {durationMs: 8000, allowDuration: false}
};

test('a grounded turn locates, draws and checks in four model calls', async () => {
  const model = fakeModel([
    {value: {cell: 14}},
    {value: BIG},
    {raw: 'C 500 500 40'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);

  assert.equal(result.ok, true);
  assert.equal(result.drew, true);
  assert.equal(model.calls.length, 4, 'four model calls: cell, refine, draw, check');
  assert.deepEqual(model.calls.map((c) => c.kind), ['json', 'json', 'draw', 'json']);
  // The cell stage saw the screen with the numbered grid on it.
  assert.equal(model.calls[0].image, 'grid-1');
  assert.equal(deps.grids[0].cols, GRID_COLS);
  assert.equal(deps.grids[0].rows, GRID_ROWS);
  // The refine stage saw a crop of the chosen cell, taken from the
  // full-resolution capture.
  assert.equal(model.calls[1].image, 'crop-1');
  assert.deepEqual(deps.crops[0].rect, gridCropRect(14, 0.25));
  assert.equal(deps.crops[0].upscale, 2.5);
  // The drawing was made on a crop around the target, not on the whole screen.
  assert.notEqual(model.calls[2].image, 'grid-1');
  // The check was shown the crop with the shape drawn on it.
  assert.equal(model.calls[3].image, 'shaped-1');
  // The drawing crop is a square around the target, within the bounds.
  const drawCrop = deps.crops[deps.crops.length - 2].rect;
  assert.ok(drawCrop.w <= 520 && drawCrop.h <= 520, 'the draw crop is bounded');
  assert.ok(Math.abs(drawCrop.w - drawCrop.h) < 2, 'the draw crop is square');
});

test('the check looks at the same crop the drawing was made on', async () => {
  // The marks are in the draw region. If the check cropped tightly around the
  // located box instead, a small target would put the marks outside the
  // picture, and the model would be asked to verify an empty picture.
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 40'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  await runGroundedDraw(deps, baseContext);
  const drawCrop = deps.crops[1].rect;
  const checkCrop = deps.crops[deps.crops.length - 1].rect;
  assert.ok(checkCrop.w >= drawCrop.w, 'the check crop holds the whole drawing');
  assert.ok(checkCrop.h >= drawCrop.h, 'the check crop holds the whole drawing');
});

test('the drawing is made on a crop and the strokes are mapped back', async () => {
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 100'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);

  const region = deps.crops[deps.crops.length - 1].rect;
  // The model drew at the middle of the crop it was shown.
  const drawUser = model.calls[2].messages[model.calls[2].messages.length - 1].content;
  assert.match(drawUser, /The target is at \(500,500\)/);
  assert.match(drawUser, /0..1000 frame of the attached crop/);
  // And the stroke came back to the middle of the screen.
  const stroke = result.sketch.strokes[0];
  assert.ok(Math.abs(stroke.cx - 300) < 1, 'cx: ' + stroke.cx);
  assert.ok(Math.abs(stroke.cy - 625) < 1, 'cy: ' + stroke.cy);
  assert.ok(stroke.r < 100, 'the radius came back scaled');
});

test('a small target gets one look inside a crop, a large one does not', async () => {
  // The grid crop is a zoom, but the thing in it can still be small. A target
  // that is smaller than a quarter of the screen gets one tighter crop of its
  // own: one extra call.
  const small = fakeModel([
    {value: {cell: 12}},
    {value: {cx: 500, cy: 500, w: 10, h: 10}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: true}}
  ]);
  const smallDeps = fakeDeps(small);
  const smallResult = await runGroundedDraw(smallDeps, baseContext);
  assert.equal(small.calls.length, 5, 'cell, refine, zoom, draw, check');
  assert.equal(smallResult.refined, true);
  // The extra look was at a crop of the full-resolution capture.
  assert.ok(smallDeps.crops[1].rect.w >= 60);

  // A big target does not pay for the extra call.
  const large = fakeModel([
    {value: {cell: 12}},
    {value: {cx: 500, cy: 500, w: 900, h: 900}},
    {raw: 'C 500 500 20'},
    {value: {verified: true}}
  ]);
  const largeDeps = fakeDeps(large);
  const largeResult = await runGroundedDraw(largeDeps, baseContext);
  assert.equal(large.calls.length, 4, 'cell, refine, draw, check');
  assert.equal(largeResult.refined, true, 'the grid crop is already a refinement');
});

test('a stage that cannot be read is repaired once with the exact error', async () => {
  const model = fakeModel([
    {error: 'the answer was not JSON', raw: 'I think it is in the corner'},
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, true);
  // The repair used the same image and carried the exact error.
  assert.equal(model.calls[1].image, model.calls[0].image);
  const repair = model.calls[1].messages[model.calls[1].messages.length - 1].content;
  assert.match(repair, /could not be used/);
  assert.match(repair, /not JSON/);
  // The rejected answer is never repeated, so no coordinate can be copied on.
  assert.doesNotMatch(repair, /corner/);
});

test('a cell answer that names a cell which does not exist is repaired once', async () => {
  const model = fakeModel([
    {value: {cell: 99}},
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, true);
  const repair = model.calls[1].messages[model.calls[1].messages.length - 1].content;
  assert.match(repair, /between 1 and 20/);
});

test('a drawing that breaks the contract is repaired once with the parser error', async () => {
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500'},
    {raw: 'C 500 500 20'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, true);
  const repair = model.calls[3].messages[model.calls[3].messages.length - 1].content;
  assert.match(repair, /could not be used/);
  assert.match(repair, /C needs 3 numbers/);
});

test('the whole screen is the fallback when the grid cannot be used', async () => {
  // The grid is the better way to find a thing, but if the cell answer cannot
  // be read the pet asks for the box on the screen instead. It is a worse
  // answer, and it is better than no drawing at all.
  const model = fakeModel([
    {error: 'the answer was not JSON'},
    {error: 'the answer was not JSON'},
    {value: {cell: 'center', cx: 500, cy: 500, w: 900, h: 900}},
    {raw: 'C 500 500 20'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, true);
  assert.equal(result.drew, true);
  // The fallback saw the plain screen view, not the grid.
  assert.equal(model.calls[2].image, 'screen-view');
});

test('an answer that cannot be repaired is the only way to draw nothing', async () => {
  // This is an error, not a refusal: there was no place to draw at all.
  const model = fakeModel([
    {error: 'the answer was not JSON'},
    {error: 'the answer was not JSON'},
    {error: 'the answer was not JSON'},
    {error: 'the answer was not JSON'}
  ]);
  const deps = fakeDeps(model);
  const result = await runGroundedDraw(deps, baseContext);
  assert.equal(result.ok, false);
  assert.equal(result.drew, false);
  assert.equal(result.stage, 'locate');
  assert.match(result.reply, /could not work out where/);
  assert.doesNotMatch(result.reply, /cannot see/);
});

test('every grounding stage is deterministic and has a budget', () => {
  assert.equal(GROUNDING_STAGES.cell.numPredict, 16);
  assert.equal(GROUNDING_STAGES.locate.numPredict, 64);
  assert.equal(GROUNDING_STAGES.refine.numPredict, 64);
  assert.equal(GROUNDING_STAGES.draw.numPredict, 320);
  assert.equal(GROUNDING_STAGES.check.numPredict, 8);
  for (const stage of Object.values(GROUNDING_STAGES)) assert.equal(stage.temperature, 0);
});

test('a "think hard" turn gets reasoning and bigger budgets', async () => {
  const model = fakeModel([
    {value: {cell: 12}},
    {value: BIG},
    {raw: 'C 500 500 20'},
    {value: {verified: true}}
  ]);
  const deps = fakeDeps(model);
  await runGroundedDraw(deps, Object.assign({}, baseContext, {
    request: 'think hard and circle the Settings gear on my screen',
    thinking: true
  }));
  // Every stage was allowed to reason.
  assert.ok(model.calls.every((c) => c.think === true), 'every call asked for reasoning');
  // And every stage had room for the reasoning as well as the answer.
  assert.ok(model.calls[0].numPredict > GROUNDING_STAGES.cell.numPredict);
  assert.ok(model.calls[2].numPredict > GROUNDING_STAGES.draw.numPredict);
});

test('there is one model and no second opinion to swap in', () => {
  // A second model costs a load, an unload and more latency, and it has never
  // been shown to beat the 4B, so it is not part of the path any more.
  assert.equal(grounding.SECOND_OPINION_MODEL, undefined);
  assert.equal('secondModel' in grounding, false);
});

test('the drawing stage uses the contract limits', () => {
  assert.equal(SKETCH_CONTRACT.maxCommands, 24);
  assert.ok(GROUNDING_STAGES.draw.numPredict >= 24);
});
