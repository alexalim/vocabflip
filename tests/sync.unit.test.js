// Layer: Unit — study-state merge (pure function, no storage or network)
const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeStates } = require("../js/sync.js");

const card = (reps, due) => ({ type: "review", step: 0, due, ivl: 3, ease: 2.5, reps, lapses: 0 });

test("the card with more reviews wins, from either side", () => {
  const local = { cards: { abort: card(5, 100), afford: card(1, 900) }, days: {}, settings: {} };
  const remote = { cards: { abort: card(2, 999), afford: card(4, 50) }, days: {}, settings: {} };
  const m = mergeStates(local, remote);
  assert.equal(m.cards.abort.reps, 5);
  assert.equal(m.cards.afford.reps, 4);
});

test("on equal reviews the later due date wins", () => {
  const m = mergeStates({ cards: { a: card(3, 10) } }, { cards: { a: card(3, 20) } });
  assert.equal(m.cards.a.due, 20);
});

test("cards studied on only one device are kept", () => {
  const m = mergeStates({ cards: { pc: card(1, 1) } }, { cards: { phone: card(1, 1) } });
  assert.deepEqual(Object.keys(m.cards).sort(), ["pc", "phone"]);
});

test("daily counts take the larger value", () => {
  const m = mergeStates(
    { cards: {}, days: { "2026-10-16": { newDone: 5, revDone: 1, again: 0 } } },
    { cards: {}, days: { "2026-10-16": { newDone: 3, revDone: 7, again: 2 } } },
  );
  assert.deepEqual(m.days["2026-10-16"], { newDone: 5, revDone: 7, again: 2 });
});

test("this device's settings win", () => {
  const m = mergeStates({ cards: {}, settings: { deck: "2k" } }, { cards: {}, settings: { deck: "1k", voice: "x" } });
  assert.deepEqual(m.settings, { deck: "2k", voice: "x" });
});

test("missing side returns the other unchanged", () => {
  const s = { cards: { a: card(1, 1) } };
  assert.equal(mergeStates(s, null), s);
  assert.equal(mergeStates(null, s), s);
});
