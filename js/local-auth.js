// PoC accounts without Supabase. Same screens, two stores:
//  - browser store: this browser's localStorage (GitHub Pages, config empty)
//  - server store:  tools/serve_lan.py on the in-house PC (config { api: "/api" })
// Username + password, per-user study progress, logout, password change, delete.
(function () {
  "use strict";
  const cfg = window.VOCABFLIP_CONFIG || {};
  if ((cfg.supabaseUrl && cfg.supabaseKey) || !window.VF) return;

  const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
  const $ = (s) => document.querySelector(s);
  const esc = window.VF.esc;
  const toast = window.VF.toast;

  // ---------- browser store ----------
  function browserStore() {
    if (!(window.crypto && crypto.subtle)) return null;
    const ACCOUNTS = "vocabflip.accounts", SESSION = "vocabflip.session", ITER = 210000;
    const userKey = (u) => "vocabflip.user." + u;
    const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
    const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const remove = (k) => { try { localStorage.removeItem(k); } catch (e) { /* 저장소 차단 */ } };
    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    async function hash(password, saltB64) {
      const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
      return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256));
    }
    async function record(password) {
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      return { salt, hash: await hash(password, salt), iter: ITER, created: Date.now() };
    }
    async function verify(u, pw) {
      const rec = read(ACCOUNTS, {})[u];
      return !!rec && (await hash(pw, rec.salt)) === rec.hash;
    }
    let me = read(SESSION, null);
    return {
      notice: "PoC 버전: 계정과 학습 기록은 <b>이 브라우저에만</b> 저장돼요. 다른 기기 로그인, 아이디·비밀번호 찾기, 구글·카카오 로그인은 정식 버전에서 지원해요.",
      async current() { return me; },
      async signup(u, pw) {
        const accounts = read(ACCOUNTS, {});
        if (accounts[u]) return "taken";
        accounts[u] = await record(pw);
        if (!write(ACCOUNTS, accounts)) return "storage";
        me = u; write(SESSION, u);
        return null;
      },
      async login(u, pw) {
        if (!(await verify(u, pw))) return "bad_credentials";
        me = u; write(SESSION, u);
        return null;
      },
      async logout() { me = null; remove(SESSION); },
      async changePassword(oldPw, newPw) {
        if (!(await verify(me, oldPw))) return "bad_credentials";
        const accounts = read(ACCOUNTS, {});
        accounts[me] = Object.assign(await record(newPw), { created: accounts[me].created });
        write(ACCOUNTS, accounts);
        return null;
      },
      async remove() {
        const accounts = read(ACCOUNTS, {});
        delete accounts[me];
        write(ACCOUNTS, accounts);
        remove(userKey(me));
        me = null; remove(SESSION);
        return null;
      },
      async load() { return read(userKey(me), null); },
      save(state) { write(userKey(me), state); },
    };
  }

  // ---------- server store ----------
  function serverStore(base) {
    let me = null, pushTimer = null, pending = null;
    async function call(method, path, body, urgent) {
      const text = body !== undefined ? JSON.stringify(body) : undefined;
      try {
        const r = await fetch(base + path, {
          method, credentials: "same-origin",
          headers: body !== undefined ? { "Content-Type": "application/json" } : {},
          body: text,
          // 페이지가 닫혀도 요청이 끝까지 가게 한다. 브라우저 한도(64KB) 안에서만 쓸 수 있다.
          keepalive: !!urgent && text !== undefined && text.length < 60000,
        });
        const data = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, data };
      } catch (e) {
        return { ok: false, status: 0, data: { error: "network" } };
      }
    }
    const err = (r) => (r.ok ? null : r.data.error || "network");
    async function flush(urgent) {
      clearTimeout(pushTimer);
      if (!pending || !me) return;
      const state = pending;
      pending = null;
      const r = await call("PUT", "/progress", { state }, urgent);
      if (!r.ok) toast("서버에 학습 기록을 저장하지 못했어요. 이 PC 서버가 켜져 있는지 확인해 주세요");
    }
    // 모바일은 앱 전환·탭 닫기로 페이지가 바로 사라지므로, 2초를 기다리지 않고 남은 기록을 보낸다
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
    window.addEventListener("pagehide", () => flush(true));
    return {
      notice: "사내 PoC 버전: 계정과 학습 기록은 <b>사내 PC 서버</b>에 저장돼서 같은 사내망의 다른 기기에서도 로그인할 수 있어요. 그 PC가 꺼져 있으면 쓸 수 없어요. 암호화되지 않은 연결이니 다른 곳에서 쓰는 비밀번호는 쓰지 마세요.",
      async current() {
        const r = await call("GET", "/me");
        me = r.ok ? r.data.username : null;
        return me;
      },
      async signup(u, pw) {
        const r = await call("POST", "/signup", { username: u, password: pw });
        if (r.ok) me = r.data.username;
        return err(r);
      },
      async login(u, pw) {
        const r = await call("POST", "/login", { username: u, password: pw });
        if (r.ok) me = r.data.username;
        return err(r);
      },
      async logout() { await flush(); await call("POST", "/logout", {}); me = null; },
      async changePassword(oldPw, newPw) { return err(await call("POST", "/password", { old: oldPw, new: newPw })); },
      async remove() { const r = await call("POST", "/delete", {}); if (r.ok) me = null; return err(r); },
      async load() { const r = await call("GET", "/progress"); return r.ok ? r.data.state : null; },
      save(state) {
        pending = state;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(flush, 2000);
      },
    };
  }

  const store = cfg.api ? serverStore(cfg.api) : browserStore();
  if (!store) return;
  const root = $("#account-body");
  document.querySelector('.tabs button[data-tab="account"]').hidden = false;

  const ERRORS = {
    taken: "이미 쓰고 있는 아이디예요.",
    bad_credentials: "아이디 또는 비밀번호가 맞지 않아요.",
    locked: "로그인에 여러 번 실패했어요. 5분 뒤에 다시 시도해 주세요.",
    invalid: "입력 형식을 확인해 주세요.",
    storage: "이 브라우저는 저장소를 쓸 수 없어서 가입할 수 없어요.",
    network: "서버에 연결하지 못했어요. 사내망에 연결돼 있는지, 서버 PC가 켜져 있는지 확인해 주세요.",
  };
  const errText = (code) => ERRORS[code] || "처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.";

  let user = null;

  // 로그인 중에는 학습할 때마다 그 사람의 기록으로 저장
  window.VF.onSave(() => { if (user) store.save(window.VF.getState()); });

  async function enter(u) {
    user = u;
    // 이 기기에서 로그인 전에 공부한 기록은 계정 기록과 합친다
    const merged = window.SYNC.mergeStates(window.VF.getState(), await store.load());
    window.VF.replaceState(merged);
    store.save(merged);
  }

  // ---------- views ----------
  const field = (id, label, type, extra) =>
    `<label class="field"><span>${label}</span><input id="${id}" type="${type}" ${extra || ""}></label>`;
  const note = () => `<p class="hint poc">${store.notice}</p>`;

  function render(pane) {
    pane = pane || "login";
    if (user) {
      root.innerHTML = `<div class="account-card">
        <p class="who"><b>${esc(user)}</b>님으로 로그인했어요. 학습 기록이 이 계정에 저장돼요.</p>
        <div class="row"><button type="button" id="logout">로그아웃</button></div>
        <h4>비밀번호 변경</h4>
        <form id="f-chpw" class="auth-form">
          ${field("cp-old", "현재 비밀번호", "password", 'autocomplete="current-password" required')}
          ${field("cp-new", "새 비밀번호 (8자 이상)", "password", 'autocomplete="new-password" minlength="8" required')}
          ${field("cp-new2", "새 비밀번호 확인", "password", 'autocomplete="new-password" required')}
          <button>비밀번호 바꾸기</button></form>
        <h4>회원 탈퇴</h4>
        <p class="hint">계정과 이 계정의 학습 기록이 모두 지워지고 되돌릴 수 없어요.</p>
        <button type="button" id="delete-account" class="danger">회원 탈퇴</button>
        <p id="auth-msg" class="auth-msg" role="status"></p>${note()}</div>`;
      return;
    }
    const nav = `<div class="seg two">${[["login", "로그인"], ["signup", "가입"]].map(([k, v]) =>
      `<button type="button" data-pane="${k}" class="${k === pane ? "active" : ""}">${v}</button>`).join("")}</div>`;
    const body = pane === "login"
      ? `<form id="f-login" class="auth-form">
          ${field("li-user", "아이디", "text", 'autocomplete="username" autocapitalize="none" required')}
          ${field("li-pw", "비밀번호", "password", 'autocomplete="current-password" required')}
          <button class="primary">로그인</button></form>`
      : `<form id="f-signup" class="auth-form">
          ${field("su-user", "아이디 (영문 소문자·숫자·_ 4~20자)", "text", 'autocomplete="username" autocapitalize="none" required')}
          ${field("su-pw", "비밀번호 (8자 이상)", "password", 'autocomplete="new-password" minlength="8" required')}
          ${field("su-pw2", "비밀번호 확인", "password", 'autocomplete="new-password" required')}
          <button class="primary">가입하기</button></form>`;
    root.innerHTML = `<div class="account-card">${nav}${body}<p id="auth-msg" class="auth-msg" role="status"></p>${note()}</div>`;
  }

  const msg = (text, bad) => { const m = $("#auth-msg"); if (m) { m.textContent = text; m.classList.toggle("bad", !!bad); } };
  const val = (id) => ($("#" + id).value || "").trim();

  root.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.pane) return render(t.dataset.pane);
    if (t.id === "logout") {
      await store.logout();
      user = null;
      window.VF.replaceState(null); // 공용 기기에서 다음 사람에게 기록이 남지 않게
      toast("로그아웃했어요");
      render();
    }
    if (t.id === "delete-account") {
      if (!t.dataset.armed) {
        t.dataset.armed = "1";
        t.textContent = "정말 탈퇴하려면 한 번 더 누르세요";
        setTimeout(() => { delete t.dataset.armed; t.textContent = "회원 탈퇴"; }, 4000);
        return;
      }
      const code = await store.remove();
      if (code) return msg(errText(code), true);
      user = null;
      window.VF.replaceState(null);
      toast("탈퇴했어요. 계정과 학습 기록을 지웠어요");
      render();
    }
  });

  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button");
    btn.disabled = true;
    try {
      if (f.id === "f-signup") {
        const u = val("su-user").toLowerCase(), pw = $("#su-pw").value;
        if (!USERNAME_RE.test(u)) return msg("아이디는 영문 소문자, 숫자, _ 로 4~20자여야 해요.", true);
        if (pw.length < 8) return msg("비밀번호는 8자 이상이어야 해요.", true);
        if (pw !== $("#su-pw2").value) return msg("비밀번호 확인이 일치하지 않아요.", true);
        const code = await store.signup(u, pw);
        if (code) return msg(errText(code), true);
        await enter(u);
        toast("가입했어요. 지금까지의 학습 기록을 계정에 저장했어요");
        render();
      } else if (f.id === "f-login") {
        const u = val("li-user").toLowerCase();
        const code = await store.login(u, $("#li-pw").value);
        if (code) return msg(errText(code), true);
        await enter(u);
        toast("로그인했어요");
        render();
      } else if (f.id === "f-chpw") {
        const pw = $("#cp-new").value;
        if (pw.length < 8) return msg("새 비밀번호는 8자 이상이어야 해요.", true);
        if (pw !== $("#cp-new2").value) return msg("새 비밀번호 확인이 일치하지 않아요.", true);
        const code = await store.changePassword($("#cp-old").value, pw);
        if (code) return msg(code === "bad_credentials" ? "현재 비밀번호가 맞지 않아요." : errText(code), true);
        f.reset();
        msg("비밀번호를 바꿨어요.");
      }
    } finally {
      btn.disabled = false;
    }
  });

  render();
  // 이미 로그인된 세션이면 이어서 (브라우저 저장소 / 서버 쿠키)
  // 다른 기기에서 공부한 기록도 합쳐서 이어간다
  store.current().then(async (u) => { if (u) { await enter(u); render(); } });
})();
