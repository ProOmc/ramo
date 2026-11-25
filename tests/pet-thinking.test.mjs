import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const thinking = require('../src/native/pet-thinking.cjs');

/**
 * "think hard" is a promise the pet makes to the user: when they ask for
 * careful reasoning, the model reasons before it answers. The rule has to be
 * literal (the words are in the request) and it has to be off by default,
 * because reasoning costs seconds before the first spoken token.
 */

test('"think hard" and its neighbours ask for reasoning', () => {
  assert.equal(thinking.wantsThinking('think hard about this'), true);
  assert.equal(thinking.wantsThinking('Think carefully and tell me'), true);
  assert.equal(thinking.wantsThinking('please think it through'), true);
  assert.equal(thinking.wantsThinking('reason step by step'), true);
  assert.equal(thinking.wantsThinking('take your time and answer'), true);
});

test('an ordinary request does not ask for reasoning', () => {
  assert.equal(thinking.wantsThinking('circle the Settings gear on my screen'), false);
  assert.equal(thinking.wantsThinking('what is the weather like'), false);
  assert.equal(thinking.wantsThinking('draw a small house'), false);
  assert.equal(thinking.wantsThinking(''), false);
  assert.equal(thinking.wantsThinking(null), false);
});

test('the words have to be in the request, not implied by it', () => {
  // "I thought about it" is not a request for reasoning.
  assert.equal(thinking.wantsThinking('I thought about it and decided to ask you'), false);
  assert.equal(thinking.wantsThinking('the hard drive'), false);
  assert.equal(thinking.wantsThinking('think about the hard drive'), false);
});

test('a normal turn keeps the small budget and no reasoning', () => {
  const budget = thinking.budgetFor('answer', 'circle the cat on my screen');
  assert.equal(budget.think, false);
  assert.equal(budget.numPredict, 60);
});

test('a "think hard" turn reasons and has room for the reasoning', () => {
  const budget = thinking.budgetFor('answer', 'think hard about whether I should buy a new laptop');
  assert.equal(budget.think, true);
  assert.ok(budget.numPredict > 100, 'the budget has to fit the reasoning: ' + budget.numPredict);
});

test('every kind of call has a thinking budget', () => {
  for (const kind of ['answer', 'locate', 'refine', 'draw', 'check']) {
    const normal = thinking.budgetFor(kind, 'hello');
    const deep = thinking.budgetFor(kind, 'think hard about it');
    assert.equal(normal.think, false, kind);
    assert.equal(deep.think, true, kind);
    assert.ok(deep.numPredict > normal.numPredict, kind);
  }
});
