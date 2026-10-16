// 계층: Unit — SM-2 스케줄러 순수 로직 (시간 고정, 외부 의존 없음)
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/srs.js");

const NOW = new Date(2026, 9, 16, 10, 0, 0).getTime(); // 10:00 로컬

test("새 카드 버튼 미리보기는 Anki 기본값과 같다", () => {
  assert.deepEqual(S.preview(S.newCard(), NOW), ["<1m", "<6m", "<10m", "4d"]);
});

test("Good 두 번이면 학습 단계를 졸업해 1일 뒤 복습", () => {
  let c = S.answer(S.newCard(), S.GOOD, NOW);
  assert.equal(c.type, "learning");
  assert.equal(c.due - NOW, 10 * S.MIN);
  c = S.answer(c, S.GOOD, NOW + 10 * S.MIN);
  assert.equal(c.type, "review");
  assert.equal(c.ivl, 1);
  assert.equal(c.ease, 2.5);
  // 내일 새벽 4시(학습일 경계)에 due
  assert.equal(c.due, new Date(2026, 9, 17, 4).getTime());
});

test("복습 Good 은 ease 를 곱해 간격을 늘린다", () => {
  const c = { type: "review", step: 0, ivl: 10, ease: 2.5, reps: 3, lapses: 0, due: NOW };
  assert.equal(S.answer(c, S.GOOD, NOW).ivl, 25);
  assert.equal(S.answer(c, S.HARD, NOW).ivl, 12);
  assert.equal(S.answer(c, S.EASY, NOW).ivl, 33);
});

test("복습 Again 은 lapse·ease 감소 후 재학습으로", () => {
  const c = { type: "review", step: 0, ivl: 10, ease: 2.5, reps: 3, lapses: 0, due: NOW };
  const n = S.answer(c, S.AGAIN, NOW);
  assert.equal(n.type, "relearning");
  assert.equal(n.lapses, 1);
  assert.equal(n.ease, 2.3);
  assert.equal(n.due - NOW, 10 * S.MIN);
  const back = S.answer(n, S.GOOD, NOW + 10 * S.MIN);
  assert.equal(back.type, "review");
  assert.equal(back.ivl, 1);
});

test("ease 는 하한 1.3 아래로 내려가지 않는다", () => {
  const c = { type: "review", step: 0, ivl: 3, ease: 1.35, reps: 9, lapses: 4, due: NOW };
  assert.equal(S.answer(c, S.AGAIN, NOW).ease, 1.3);
});

test("원본 카드는 변경되지 않는다", () => {
  const c = S.newCard();
  S.answer(c, S.GOOD, NOW);
  assert.equal(c.type, "new");
});

test("새벽 4시 이전은 전날 학습일", () => {
  assert.equal(S.dayKey(new Date(2026, 9, 16, 3, 59).getTime()), "2026-10-15");
  assert.equal(S.dayKey(new Date(2026, 9, 16, 4, 0).getTime()), "2026-10-16");
});
