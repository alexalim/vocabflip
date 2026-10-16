// Anki 방식 SM-2 스케줄러 (순수 함수 — DOM·저장소 의존 없음)
(function (root) {
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const ROLLOVER_HOUR = 4; // Anki처럼 새벽 4시에 하루가 바뀐다

  const DEFAULTS = {
    learnSteps: [1, 10],      // 분
    relearnSteps: [10],       // 분
    graduatingIvl: 1,         // 일
    easyIvl: 4,               // 일
    startEase: 2.5,
    minEase: 1.3,
    hardMult: 1.2,
    easyBonus: 1.3,
    maxIvl: 36500,
  };

  const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;

  function newCard() {
    return { type: "new", step: 0, due: 0, ivl: 0, ease: 0, reps: 0, lapses: 0 };
  }

  // now 가 속한 "학습일"이 끝나는 시각(다음 날 새벽 4시)
  function dayEnd(now) {
    const d = new Date(now);
    d.setHours(ROLLOVER_HOUR, 0, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  function dayKey(now) {
    const d = new Date(dayEnd(now) - DAY);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // 복습 카드는 '며칠 뒤 학습일의 시작'에 due
  function dueInDays(now, days) {
    return dayEnd(now) + (days - 1) * DAY;
  }

  function stepDelayMin(steps, step, rating) {
    if (rating === HARD) {
      if (step === 0 && steps.length > 1) return (steps[0] + steps[1]) / 2;
      return steps[step];
    }
    return steps[step];
  }

  function graduate(c, now, ivl) {
    c.type = "review";
    c.step = 0;
    c.ivl = ivl;
    if (!c.ease) c.ease = c._opt.startEase;
    c.due = dueInDays(now, ivl);
  }

  // card 를 바꾸지 않고 새 상태를 돌려준다
  function answer(card, rating, now, opt) {
    const o = Object.assign({}, DEFAULTS, opt || {});
    const c = Object.assign({}, card, { _opt: o });
    c.reps = (c.reps || 0) + 1;

    if (c.type === "new") { c.type = "learning"; c.step = 0; }

    if (c.type === "learning" || c.type === "relearning") {
      const steps = c.type === "learning" ? o.learnSteps : o.relearnSteps;
      if (rating === AGAIN) {
        c.step = 0;
        c.due = now + steps[0] * MIN;
      } else if (rating === HARD) {
        c.due = now + stepDelayMin(steps, c.step, HARD) * MIN;
      } else if (rating === GOOD) {
        if (c.step + 1 < steps.length) {
          c.step += 1;
          c.due = now + steps[c.step] * MIN;
        } else {
          graduate(c, now, c.type === "relearning" ? Math.max(1, c.ivl) : o.graduatingIvl);
        }
      } else {
        graduate(c, now, c.type === "relearning" ? Math.max(1, c.ivl) + 1 : o.easyIvl);
      }
    } else {
      // review
      const ivl = c.ivl, ease = c.ease;
      if (rating === AGAIN) {
        c.lapses = (c.lapses || 0) + 1;
        c.ease = Math.max(o.minEase, ease - 0.2);
        c.ivl = 1;
        c.type = "relearning";
        c.step = 0;
        c.due = now + o.relearnSteps[0] * MIN;
      } else {
        const hard = Math.max(ivl + 1, Math.round(ivl * o.hardMult));
        const good = Math.max(hard + 1, Math.round(ivl * ease));
        const easy = Math.max(good + 1, Math.round(ivl * ease * o.easyBonus));
        if (rating === HARD) { c.ease = Math.max(o.minEase, ease - 0.15); c.ivl = hard; }
        else if (rating === GOOD) { c.ivl = good; }
        else { c.ease = ease + 0.15; c.ivl = easy; }
        c.ivl = Math.min(c.ivl, o.maxIvl);
        c.due = dueInDays(now, c.ivl);
      }
    }
    delete c._opt;
    return c;
  }

  function fmtDelay(ms) {
    const m = ms / MIN;
    if (m < 60) return "<" + Math.max(1, Math.round(m)) + "m";
    const h = m / 60;
    if (h < 24) return Math.round(h) + "h";
    const d = h / 24;
    if (d < 30) return Math.round(d) + "d";
    if (d < 365) return (d / 30).toFixed(1).replace(/\.0$/, "") + "mo";
    return (d / 365).toFixed(1).replace(/\.0$/, "") + "y";
  }

  // 버튼 위 간격 미리보기 [again, hard, good, easy]
  function preview(card, now, opt) {
    return [AGAIN, HARD, GOOD, EASY].map(function (r) {
      const n = answer(card, r, now, opt);
      if (n.type === "review") return n.ivl < 30 ? n.ivl + "d" : fmtDelay(n.ivl * DAY);
      return fmtDelay(n.due - now);
    });
  }

  const api = { DEFAULTS, AGAIN, HARD, GOOD, EASY, MIN, DAY, newCard, answer, preview, dayEnd, dayKey, fmtDelay };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SRS = api;
})(this);
