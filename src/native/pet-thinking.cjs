'use strict';
// Ramo Pet — "think hard" turns.
//
// The pet normally answers fast and shallow: a small token budget, no hidden
// reasoning, a short spoken reply. When the user asks it to think hard, the
// model is allowed to reason before it answers, and the budgets grow so the
// answer still fits after the reasoning.
//
// The rule is deliberately literal - the words have to be in the request.
// The pet cannot ask "did you want a careful answer?" before answering, and a
// silent change of behaviour would make the pet slow for no reason.
//
// This applies to the turns that produce the answer: the spoken reply and the
// grounding stages of a drawing. It does not apply to the router, whose only
// job is to pick a tool in a few hundred milliseconds.

const THINK_PHRASES = /\b(?:think hard|think harder|think carefully|think deeply|think it through|think through|think about it carefully|reason carefully|reason deeply|reason step by step|step by step|take your time)\b/i;

// The budgets, per kind of call. A thinking turn needs room for the reasoning
// AND the answer, so the budget is several times the normal one.
const BUDGETS = Object.freeze({
  answer: Object.freeze({think: false, numPredict: 60}),
  answerThinking: Object.freeze({think: true, numPredict: 1024}),
  locate: Object.freeze({think: false, numPredict: 64}),
  locateThinking: Object.freeze({think: true, numPredict: 384}),
  refine: Object.freeze({think: false, numPredict: 64}),
  refineThinking: Object.freeze({think: true, numPredict: 384}),
  draw: Object.freeze({think: false, numPredict: 320}),
  drawThinking: Object.freeze({think: true, numPredict: 768}),
  check: Object.freeze({think: false, numPredict: 8}),
  checkThinking: Object.freeze({think: true, numPredict: 96})
});

// Does this request ask for reasoning?
function wantsThinking(text) {
  return THINK_PHRASES.test(String(text == null ? '' : text));
}

// The settings for one kind of call, with or without reasoning.
function budgetFor(kind, text) {
  const base = BUDGETS[kind] || BUDGETS.answer;
  if (!wantsThinking(text)) return base;
  return BUDGETS[kind + 'Thinking'] || Object.freeze({think: true, numPredict: base.numPredict * 4});
}

module.exports = {
  THINK_PHRASES,
  BUDGETS,
  wantsThinking,
  budgetFor
};
