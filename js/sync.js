// Merge two saved study states (this device ↔ account). Pure — no DOM or storage.
(function (root) {
  // Per card: the copy with more reviews wins; on a tie, the later due date.
  function pickCard(a, b) {
    if (!a) return b;
    if (!b) return a;
    if ((a.reps || 0) !== (b.reps || 0)) return (a.reps || 0) > (b.reps || 0) ? a : b;
    return (a.due || 0) >= (b.due || 0) ? a : b;
  }

  // Per day: counts can only grow, so take the larger of each.
  function pickDay(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      newDone: Math.max(a.newDone || 0, b.newDone || 0),
      revDone: Math.max(a.revDone || 0, b.revDone || 0),
      again: Math.max(a.again || 0, b.again || 0),
    };
  }

  function mergeMap(a, b, pick) {
    const out = {};
    for (const k of new Set(Object.keys(a || {}).concat(Object.keys(b || {})))) out[k] = pick((a || {})[k], (b || {})[k]);
    return out;
  }

  // settings: this device's choices win (deck, voice and limits are per-device habits).
  function mergeStates(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    return Object.assign({}, remote, local, {
      cards: mergeMap(local.cards, remote.cards, pickCard),
      days: mergeMap(local.days, remote.days, pickDay),
      settings: Object.assign({}, remote.settings, local.settings),
    });
  }

  const api = { mergeStates, pickCard };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SYNC = api;
})(this);
