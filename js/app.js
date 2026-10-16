(function () {
  "use strict";
  const DECK = window.DECK || [];
  const CONTENT = window.CONTENT || {};
  const IPA = window.IPA_DICT || {};
  const PIDX = window.PHONEME_INDEX || {};
  const TW = window.TWISTERS || [];
  const STORE_KEY = "ankivocab.v1";
  const LEARN_AHEAD = 20 * SRS.MIN;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const boldMd = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const plain = (s) => String(s || "").replace(/\*\*/g, "");

  // ---------- 저장소 ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.cards) return Object.assign(defaultState(), s);
    } catch (e) { /* 손상/차단 시 새로 시작 */ }
    return defaultState();
  }
  function defaultState() {
    return { cards: {}, days: {}, settings: { deck: "1k", newPerDay: 20, revPerDay: 200, voice: "", autoplay: true } };
  }
  let state = load();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast("저장 실패: 브라우저 저장소를 쓸 수 없어요"); }
  }
  function today() {
    const k = SRS.dayKey(Date.now());
    return state.days[k] || (state.days[k] = { newDone: 0, revDone: 0, again: 0 });
  }
  const cardOf = (w) => state.cards[w] || SRS.newCard();

  // ---------- 음성 ----------
  let voices = [];
  function loadVoices() {
    voices = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => /^en/i.test(v.lang));
    const sel = $("#set-voice");
    sel.innerHTML = voices.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("");
    const us = voices.find((v) => v.name === state.settings.voice) || voices.find((v) => /en[-_]US/i.test(v.lang)) || voices[0];
    if (us) sel.value = us.name;
    const warn = $("#voice-warn");
    warn.hidden = voices.length > 0;
    warn.textContent = window.speechSynthesis ? "영어 음성을 찾지 못했어요. Chrome/Edge를 쓰거나 OS에 영어 음성을 설치해 주세요." : "이 브라우저는 음성 합성을 지원하지 않아요.";
  }
  function speak(text, rate) {
    if (!window.speechSynthesis) return toast("음성 합성을 지원하지 않는 브라우저예요");
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(plain(text));
    const v = voices.find((x) => x.name === $("#set-voice").value) || voices.find((x) => /en[-_]US/i.test(x.lang));
    if (v) u.voice = v;
    u.lang = v ? v.lang : "en-US";
    u.rate = rate || 0.95;
    speechSynthesis.speak(u);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-say]");
    if (b) { e.preventDefault(); speak(b.dataset.say, parseFloat(b.dataset.rate) || undefined); }
  });

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  // ---------- 탭 ----------
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  function showTab(name) {
    $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $$(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
    if (name === "study") renderStudy();
    if (name === "browse") renderBrowse();
    if (name === "stats") renderStats();
    if (name === "twister" && !$("#tw-list").childElementCount) renderTwisters();
  }

  // ---------- 덱 & 큐 ----------
  const DECKS = [["1k", "1k (1–1000)"], ["2k", "2k (1001–2000)"], ["3k", "3k (2001–3000)"], ["all", "전체 3000"]];
  const deckWords = () => DECK.filter((d) => state.settings.deck === "all" || d.lvl === state.settings.deck);

  function queue(now) {
    const learn = [], due = [], fresh = [];
    const dEnd = SRS.dayEnd(now);
    for (const d of deckWords()) {
      const c = state.cards[d.w];
      if (!c || c.type === "new") fresh.push(d);
      else if (c.type === "review") { if (c.due < dEnd) due.push(d); }
      else learn.push(d);
    }
    learn.sort((a, b) => state.cards[a.w].due - state.cards[b.w].due);
    due.sort((a, b) => state.cards[a.w].due - state.cards[b.w].due);
    const t = today();
    const newLeft = Math.max(0, state.settings.newPerDay - t.newDone);
    const revLeft = Math.max(0, state.settings.revPerDay - t.revDone);
    return { learn, due: due.slice(0, revLeft), fresh: fresh.slice(0, newLeft) };
  }

  function nextCard(now) {
    const q = queue(now);
    const learnNow = q.learn.find((d) => state.cards[d.w].due <= now);
    if (learnNow) return { d: learnNow, q };
    if (q.due.length) return { d: q.due[0], q };
    if (q.fresh.length) return { d: q.fresh[0], q };
    const ahead = q.learn.find((d) => state.cards[d.w].due <= now + LEARN_AHEAD);
    if (ahead) return { d: ahead, q };
    return { d: null, q };
  }

  // ---------- 학습 화면 ----------
  let current = null, revealed = false, waitTimer = null;

  function renderCounts(q) {
    const now = Date.now();
    $(".c-new").textContent = q.fresh.length;
    $(".c-learn").textContent = q.learn.filter((d) => state.cards[d.w].due <= now + LEARN_AHEAD).length;
    $(".c-due").textContent = q.due.length;
  }

  function renderStudy() {
    clearTimeout(waitTimer);
    const now = Date.now();
    const { d, q } = nextCard(now);
    renderCounts(q);
    current = d;
    revealed = false;
    const area = $("#card-area");
    if (!d) {
      const later = q.learn.length ? Math.min.apply(null, q.learn.map((x) => state.cards[x.w].due)) : 0;
      area.innerHTML = `<div class="card done"><h2>오늘 학습 완료 🎉</h2><p>${later ? "학습 중인 카드가 " + SRS.fmtDelay(later - now).replace("<", "약 ") + " 뒤에 다시 나와요." : "내일 다시 만나요. 설정에서 하루 새 카드 수를 늘릴 수도 있어요."}</p></div>`;
      if (later) waitTimer = setTimeout(renderStudy, Math.min(later - now + 500, 2147483000));
      return;
    }
    area.innerHTML = `<div class="card front" id="front-card">
        <p class="word">${esc(d.w)}</p>
        <button class="show-btn" id="show-btn">정답 보기</button>
        <p class="tap-hint">카드를 탭하면 뒤집혀요</p>
      </div><p class="kbd-hint">Space: 정답 보기</p>`;
    $("#front-card").addEventListener("click", reveal);
    if (state.settings.autoplay) speak(d.w);
  }

  function ipaHtml(list) {
    return (list || []).map((x) => `<span class="ipa">/${esc(x)}/</span>`).join(" · ");
  }

  function backHtml(d) {
    const c = CONTENT[d.w];
    const head = `<p class="word">${esc(d.w)}</p>
      <p class="ipa-line">${ipaHtml(d.ipa)} <button class="speak" data-say="${esc(d.w)}" title="발음 듣기">🔊</button></p>`;
    if (!c) {
      return head + `<div class="box nocontent">이 단어의 한국어 콘텐츠가 아직 없어요.${d.forms.length ? "<br>관련 형태: " + esc(d.forms.join(", ")) : ""}</div>`;
    }
    const also = (c.also || []).map((a) => `<div class="also-item"><span class="aw">${esc(a.w)}</span> <span class="pos">${esc(a.pos)}</span> ${esc(a.ko)}
        <button class="speak" data-say="${esc(a.w)}">🔊</button>
        <div class="aen">${boldMd(a.en)} <button class="speak" data-say="${esc(a.en)}" title="예문 듣기">▶</button></div></div>`).join("");
    return head + `
      <div class="box"><span class="tag mean">뜻</span><div class="meaning">${esc(c.meaning_ko)}<span class="pos">${esc(c.pos)}</span></div></div>
      <div class="box"><span class="tag ex">문장</span>
        <div class="ex-en">${boldMd(c.example_en)}</div>
        <div class="ex-ko">${esc(c.example_ko)}</div>
        <button class="listen" data-say="${esc(c.example_en)}" data-rate="0.9">▶ 예문 듣기</button></div>
      <div class="box"><span class="tag nu">뉘앙스</span><div class="nuance">${esc(c.nuance_ko)}</div></div>
      ${also ? `<div class="box"><span class="tag also">이렇게도 쓰인다</span>${also}</div>` : ""}`;
  }

  function reveal() {
    if (!current || revealed) return;
    revealed = true;
    const now = Date.now();
    const labels = SRS.preview(cardOf(current.w), now);
    const names = ["다시", "어려움", "알맞음", "쉬움"];
    $("#card-area").innerHTML = `<div class="card">${backHtml(current)}</div>
      <div class="answer-bar">${labels.map((l, i) => `<button class="r${i + 1}" data-rating="${i + 1}"><small>${l}</small>${names[i]}</button>`).join("")}</div>
      <p class="kbd-hint">1 다시 · 2 어려움 · 3 알맞음 · 4 쉬움</p>`;
    $$(".answer-bar button").forEach((b) => b.addEventListener("click", () => rate(+b.dataset.rating)));
  }

  function rate(r) {
    if (!current || !revealed) return;
    const now = Date.now();
    const before = cardOf(current.w);
    const t = today();
    if (before.type === "new") t.newDone++;
    else if (before.type === "review") t.revDone++;
    if (r === SRS.AGAIN) t.again++;
    state.cards[current.w] = SRS.answer(before, r, now);
    save();
    renderStudy();
  }

  document.addEventListener("keydown", (e) => {
    if (!$("#tab-study").classList.contains("active") || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); revealed ? rate(SRS.GOOD) : reveal(); }
    else if (revealed && /^[1-4]$/.test(e.key)) rate(+e.key);
    else if (e.key === "r" && current) speak(current.w);
  });

  const deckSel = $("#deck-select");
  deckSel.innerHTML = DECKS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  deckSel.value = state.settings.deck;
  deckSel.addEventListener("change", () => { state.settings.deck = deckSel.value; save(); renderStudy(); });

  // ---------- 탐색 ----------
  function stateLabel(c, now) {
    if (!c || c.type === "new") return ["새 카드", "-"];
    const name = { learning: "학습 중", relearning: "재학습", review: "복습" }[c.type];
    const when = c.due <= now ? "지금" : c.type === "review" ? new Date(c.due).toLocaleDateString("ko-KR") : SRS.fmtDelay(c.due - now) + " 뒤";
    return [name, when];
  }
  let browseLimit = 200;
  function renderBrowse() {
    const q = $("#browse-q").value.trim().toLowerCase();
    const f = $("#browse-state").value;
    const now = Date.now(), dEnd = SRS.dayEnd(now);
    const rows = DECK.filter((d) => {
      if (q && !d.w.toLowerCase().includes(q) && !((CONTENT[d.w] || {}).meaning_ko || "").includes(q)) return false;
      const c = state.cards[d.w];
      if (!f) return true;
      if (f === "new") return !c || c.type === "new";
      if (f === "learning") return c && (c.type === "learning" || c.type === "relearning");
      if (f === "review") return c && c.type === "review";
      if (f === "due") return c && c.type !== "new" && c.due < dEnd;
      return true;
    });
    $("#browse-body").innerHTML = rows.slice(0, browseLimit).map((d) => {
      const [s, w] = stateLabel(state.cards[d.w], now);
      return `<tr><td><b>${esc(d.w)}</b> <button class="speak" data-say="${esc(d.w)}">🔊</button></td><td>${esc((CONTENT[d.w] || {}).meaning_ko || "")}</td><td>${d.lvl}</td><td>${s}</td><td>${w}</td></tr>`;
    }).join("");
    $("#browse-more").innerHTML = rows.length > browseLimit ? `<p class="hint">${rows.length}개 중 ${browseLimit}개 표시 <button id="browse-more-btn">더 보기</button></p>` : `<p class="hint">${rows.length}개</p>`;
    const more = $("#browse-more-btn");
    if (more) more.addEventListener("click", () => { browseLimit += 500; renderBrowse(); });
  }
  $("#browse-q").addEventListener("input", () => { browseLimit = 200; renderBrowse(); });
  $("#browse-state").addEventListener("change", () => { browseLimit = 200; renderBrowse(); });

  // ---------- 통계 ----------
  function renderStats() {
    const now = Date.now(), dEnd = SRS.dayEnd(now);
    const cards = Object.values(state.cards);
    const t = today();
    const mature = cards.filter((c) => c.type === "review" && c.ivl >= 21).length;
    const young = cards.filter((c) => c.type === "review" && c.ivl < 21).length;
    const learning = cards.filter((c) => c.type === "learning" || c.type === "relearning").length;
    const studied = t.newDone + t.revDone;
    const days = [];
    for (let i = 0; i < 14; i++) {
      const s = dEnd + (i - 1) * SRS.DAY, e = s + SRS.DAY;
      days.push(cards.filter((c) => c.type !== "new" && (i === 0 ? c.due < e : c.due >= s && c.due < e)).length);
    }
    const max = Math.max(1, ...days);
    $("#stats-body").innerHTML = `
      <div class="stat-grid">
        <div class="stat"><b>${t.newDone}</b><span>오늘 새로 본 카드</span></div>
        <div class="stat"><b>${t.revDone}</b><span>오늘 복습한 카드</span></div>
        <div class="stat"><b>${studied ? Math.round((1 - t.again / Math.max(1, studied)) * 100) + "%" : "-"}</b><span>오늘 정답률</span></div>
        <div class="stat"><b>${learning}</b><span>학습 중</span></div>
        <div class="stat"><b>${young}</b><span>복습(간격 21일 미만)</span></div>
        <div class="stat"><b>${mature}</b><span>장기 기억(간격 21일 이상)</span></div>
        <div class="stat"><b>${DECK.length - cards.length}</b><span>아직 안 본 카드</span></div>
      </div>
      <h3 class="sub">앞으로 14일 복습 예정</h3>
      <div class="forecast">${days.map((n, i) => `<div style="height:${(n / max) * 100}%"><em>${n || ""}</em><span>${i === 0 ? "오늘" : "+" + i}</span></div>`).join("")}</div>`;
  }

  // ---------- 발음 기호 ----------
  const PHONEMES = Object.keys(PIDX).sort((a, b) => b.length - a.length);
  function tokenizeIpa(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const p = PHONEMES.find((ph) => s.startsWith(ph, i));
      if (p) { out.push(p); i += p.length; } else { out.push(s[i]); i++; }
    }
    return out;
  }
  function lookupIpa(word) {
    const w = word.trim().toLowerCase();
    return IPA[w] || null;
  }

  $("#ipa-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const w = $("#ipa-q").value.trim();
    if (!w) return;
    const list = lookupIpa(w);
    const box = $("#ipa-result");
    if (!list) { box.innerHTML = `<p class="warn">'${esc(w)}'의 발음 기호를 찾지 못했어요.</p>`; return; }
    box.innerHTML = list.map((ipa) => `<div class="ipa-variant">
        <div><span class="ipa-big">/${esc(ipa)}/</span> <button class="speak" data-say="${esc(w)}">🔊</button></div>
        <div class="codeblock"><code>/${esc(ipa)}/</code><button data-copy="/${esc(ipa)}/">복사</button></div>
        <div class="chips" style="margin-top:8px">${[...new Set(tokenizeIpa(ipa).filter((t) => PIDX[t]))].map((t) => `<button class="chip" data-ph="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      </div>`).join("");
  });
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      navigator.clipboard.writeText(c.dataset.copy).then(() => toast("복사했어요"), () => toast("복사 실패"));
    }
    const ph = e.target.closest("[data-ph]");
    if (ph) showPhoneme(ph.dataset.ph);
  });

  const GROUPS = [
    ["모음", ["i", "ɪ", "eɪ", "ɛ", "æ", "ɑ", "ɔ", "oʊ", "ʊ", "u", "ʌ", "ə", "ɝ", "ɚ"]],
    ["이중모음", ["aɪ", "aʊ", "ɔɪ"]],
    ["자음", ["p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "tʃ", "dʒ", "m", "n", "ŋ", "l", "r", "w", "j"]],
  ];
  $("#phoneme-chart").innerHTML = GROUPS.map(([g, list]) => `<h4>${g}</h4><div class="chips">${list.filter((p) => PIDX[p]).map((p) => `<button class="chip" data-ph="${esc(p)}">${esc(p)}</button>`).join("")}</div>`).join("");

  // Rachel's English 가 소리를 부르는 이름 (YouTube 검색어용 — IPA 글자는 검색이 잘 안 된다)
  const RACHEL_NAMES = {
    i: "EE vowel", "ɪ": "IH vowel", "eɪ": "AY diphthong", "ɛ": "EH vowel", "æ": "AA vowel cat", "ɑ": "AH vowel",
    "ɔ": "AW vowel", "oʊ": "OH diphthong", "ʊ": "UH vowel push", u: "OO vowel", "ʌ": "UH vowel butter", "ə": "schwa",
    "ɝ": "ER vowel", "ɚ": "ER schwa unstressed", "aɪ": "AI diphthong", "aʊ": "OW diphthong", "ɔɪ": "OY diphthong",
    p: "P consonant", b: "B consonant", t: "T pronunciation", d: "D consonant", k: "K consonant", "ɡ": "G consonant",
    f: "F consonant", v: "V consonant", "θ": "unvoiced TH", "ð": "voiced TH", s: "S consonant", z: "Z consonant",
    "ʃ": "SH consonant", "ʒ": "ZH consonant", h: "H consonant", "tʃ": "CH consonant", "dʒ": "J consonant",
    m: "M consonant", n: "N consonant", "ŋ": "NG consonant", l: "L consonant", r: "R consonant", w: "W consonant", j: "Y consonant",
  };
  function rachelLinks(ph) {
    const q = encodeURIComponent("Rachel's English " + (RACHEL_NAMES[ph] || ph + " sound"));
    return `<div class="rachel">이 소리 자세히 배우기:
      <a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Rachel's English 영상 ↗</a>
      <a href="https://rachelsenglish.com/sound-chart/" target="_blank" rel="noopener">사운드 차트 ↗</a></div>`;
  }

  function showPhoneme(ph) {
    $$(".chip").forEach((c) => c.classList.toggle("active", c.dataset.ph === ph));
    const words = (PIDX[ph] || []).slice(0, 15);
    $("#phoneme-words").innerHTML = `<h3 class="sub">/${esc(ph)}/ 소리가 들어간 단어 15개 <span class="hint">(빈도순)</span></h3>${rachelLinks(ph)}
      <div class="pw-list">${words.map((w) => {
        const ipa = (IPA[w.toLowerCase()] || [""])[0];
        const hl = tokenizeIpa(ipa).map((t) => (t === ph ? `<mark>${esc(t)}</mark>` : esc(t))).join("");
        return `<div class="pw"><div><b>${esc(w)}</b> <span class="pi">/${hl}/</span></div><button class="speak" data-say="${esc(w)}">🔊</button></div>`;
      }).join("")}</div>`;
    $("#phoneme-words").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- 텅 트위스터 ----------
  function lineIpa(text) {
    return text.split("\n").map((line) => line.split(/\s+/).map((tok) => {
      const w = tok.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, "");
      const p = w && (IPA[w] || IPA[w.replace(/'s$/, "")]);
      return p ? p[0] : tok;
    }).join(" ")).join("\n");
  }
  function twHtml(t) {
    return `<div class="tw" data-n="${t.n}"><div class="n">#${t.n}</div><div class="t">${esc(t.text)}</div>
      <div class="tipa" ${$("#tw-ipa").checked ? "" : "hidden"}>/${esc(lineIpa(t.text))}/</div>
      <div class="btns"><button data-tw="${t.n}" data-speed="1">▶ 듣기</button><button data-tw="${t.n}" data-speed="0.6">🐢 천천히</button></div></div>`;
  }
  let twLimit = 30;
  function renderTwisters() {
    const q = $("#tw-q").value.trim().toLowerCase();
    const rows = q ? TW.filter((t) => t.text.toLowerCase().includes(q)) : TW;
    $("#tw-list").innerHTML = rows.slice(0, twLimit).map(twHtml).join("") +
      (rows.length > twLimit ? `<button id="tw-more">더 보기 (${rows.length - twLimit}개 남음)</button>` : "");
    const m = $("#tw-more");
    if (m) m.addEventListener("click", () => { twLimit += 50; renderTwisters(); });
  }
  $("#tw-q").addEventListener("input", () => { twLimit = 30; renderTwisters(); });
  $("#tw-random").addEventListener("click", () => {
    const t = TW[Math.floor(Math.random() * TW.length)];
    $("#tw-q").value = "";
    $("#tw-list").innerHTML = twHtml(t) + `<button id="tw-all">전체 목록</button>`;
    $("#tw-all").addEventListener("click", renderTwisters);
  });
  $("#tw-ipa").addEventListener("change", () => $$(".tipa").forEach((el) => (el.hidden = !$("#tw-ipa").checked)));
  $("#tw-rate").addEventListener("input", () => ($("#tw-rate-v").textContent = $("#tw-rate").value + "×"));
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tw]");
    if (!b) return;
    const t = TW.find((x) => x.n === +b.dataset.tw);
    if (t) speak(t.text.replace(/\n/g, " "), parseFloat($("#tw-rate").value) * parseFloat(b.dataset.speed));
  });

  // ---------- 설정 ----------
  $("#set-new").value = state.settings.newPerDay;
  $("#set-rev").value = state.settings.revPerDay;
  $("#set-autoplay").checked = state.settings.autoplay;
  $("#set-new").addEventListener("change", (e) => { state.settings.newPerDay = Math.max(0, +e.target.value || 0); save(); });
  $("#set-rev").addEventListener("change", (e) => { state.settings.revPerDay = Math.max(0, +e.target.value || 0); save(); });
  $("#set-autoplay").addEventListener("change", (e) => { state.settings.autoplay = e.target.checked; save(); });
  $("#set-voice").addEventListener("change", (e) => { state.settings.voice = e.target.value; save(); speak("Hello, this is my voice."); });
  $("#export-btn").addEventListener("click", () => {
    const ta = $("#backup-text");
    ta.value = JSON.stringify(state);
    const fallback = () => { ta.select(); toast("자동 복사가 막혀 있어요. 선택된 글을 직접 복사하세요"); };
    try {
      navigator.clipboard.writeText(ta.value).then(() => toast("백업을 복사했어요"), fallback);
    } catch (err) { fallback(); }
  });
  function importText(txt) {
    try {
      const s = JSON.parse(txt);
      if (!s || typeof s.cards !== "object") throw new Error("형식 오류");
      state = Object.assign(defaultState(), s);
      save();
      toast("가져왔어요");
      renderStudy();
    } catch (err) { toast("가져오기 실패: 백업 형식이 아니에요"); }
  }
  $("#import-btn").addEventListener("click", () => importText($("#backup-text").value));
  $("#import-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) f.text().then(importText);
  });
  $("#reset-btn").addEventListener("click", () => {
    const b = $("#reset-btn");
    if (b.dataset.armed) { state = defaultState(); save(); delete b.dataset.armed; b.textContent = "학습 기록 초기화"; toast("초기화했어요"); renderStudy(); }
    else { b.dataset.armed = "1"; b.textContent = "한 번 더 누르면 초기화"; setTimeout(() => { delete b.dataset.armed; b.textContent = "학습 기록 초기화"; }, 3000); }
  });

  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
  renderStudy();
})();
