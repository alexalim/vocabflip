// PoC accounts kept in this browser only — used when js/config.js has no Supabase project.
// Username + password (PBKDF2 hash), per-user study progress, logout, password change, delete.
(function () {
  "use strict";
  const cfg = window.VOCABFLIP_CONFIG || {};
  if ((cfg.supabaseUrl && cfg.supabaseKey) || !window.VF || !(window.crypto && crypto.subtle)) return;

  const ACCOUNTS = "vocabflip.accounts";
  const SESSION = "vocabflip.session";
  const userKey = (u) => "vocabflip.user." + u;
  const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
  const ITER = 210000;

  const $ = (s) => document.querySelector(s);
  const esc = window.VF.esc;
  const toast = window.VF.toast;
  const root = $("#account-body");
  document.querySelector('.tabs button[data-tab="account"]').hidden = false;

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const remove = (k) => { try { localStorage.removeItem(k); } catch (e) { /* 저장소 차단 */ } };
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

  async function hash(password, saltB64) {
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256));
  }
  async function makeRecord(password) {
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    return { salt, hash: await hash(password, salt), iter: ITER, created: Date.now() };
  }
  async function verify(username, password) {
    const rec = read(ACCOUNTS, {})[username];
    return !!rec && (await hash(password, rec.salt)) === rec.hash;
  }

  let user = read(SESSION, null);

  // 로그인 중에는 학습할 때마다 그 사람의 기록으로 저장
  window.VF.onSave(() => { if (user) write(userKey(user), window.VF.getState()); });

  function signIn(u) {
    user = u;
    write(SESSION, u);
    // 이 기기에서 로그인 전에 공부한 기록은 계정 기록과 합친다
    const merged = window.SYNC.mergeStates(window.VF.getState(), read(userKey(u), null));
    window.VF.replaceState(merged);
    write(userKey(u), merged);
  }
  function signOut() {
    if (user) write(userKey(user), window.VF.getState());
    user = null;
    remove(SESSION);
    window.VF.replaceState(null);
  }

  // ---------- views ----------
  const field = (id, label, type, extra) =>
    `<label class="field"><span>${label}</span><input id="${id}" type="${type}" ${extra || ""}></label>`;
  const note = `<p class="hint poc">PoC 버전: 계정과 학습 기록은 <b>이 브라우저에만</b> 저장돼요. 다른 기기 로그인, 아이디·비밀번호 찾기, 구글·카카오 로그인은 정식 버전에서 지원해요.</p>`;

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
        <p class="hint">계정과 이 계정의 학습 기록이 이 브라우저에서 모두 지워지고 되돌릴 수 없어요.</p>
        <button type="button" id="delete-account" class="danger">회원 탈퇴</button>
        <p id="auth-msg" class="auth-msg" role="status"></p>${note}</div>`;
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
    root.innerHTML = `<div class="account-card">${nav}${body}<p id="auth-msg" class="auth-msg" role="status"></p>${note}</div>`;
  }

  const msg = (text, bad) => { const m = $("#auth-msg"); if (m) { m.textContent = text; m.classList.toggle("bad", !!bad); } };
  const val = (id) => ($("#" + id).value || "").trim();

  root.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.pane) return render(t.dataset.pane);
    if (t.id === "logout") {
      signOut();
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
      const accounts = read(ACCOUNTS, {});
      delete accounts[user];
      write(ACCOUNTS, accounts);
      remove(userKey(user));
      user = null;
      remove(SESSION);
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
        const accounts = read(ACCOUNTS, {});
        if (accounts[u]) return msg("이미 쓰고 있는 아이디예요.", true);
        accounts[u] = await makeRecord(pw);
        if (!write(ACCOUNTS, accounts)) return msg("이 브라우저는 저장소를 쓸 수 없어서 가입할 수 없어요.", true);
        signIn(u);
        toast("가입했어요. 지금까지의 학습 기록을 계정에 저장했어요");
        render();
      } else if (f.id === "f-login") {
        const u = val("li-user").toLowerCase();
        if (!(await verify(u, $("#li-pw").value))) return msg("아이디 또는 비밀번호가 맞지 않아요.", true);
        signIn(u);
        toast("로그인했어요");
        render();
      } else if (f.id === "f-chpw") {
        if (!(await verify(user, $("#cp-old").value))) return msg("현재 비밀번호가 맞지 않아요.", true);
        const pw = $("#cp-new").value;
        if (pw.length < 8) return msg("새 비밀번호는 8자 이상이어야 해요.", true);
        if (pw !== $("#cp-new2").value) return msg("새 비밀번호 확인이 일치하지 않아요.", true);
        const accounts = read(ACCOUNTS, {});
        accounts[user] = Object.assign(await makeRecord(pw), { created: accounts[user].created });
        write(ACCOUNTS, accounts);
        f.reset();
        msg("비밀번호를 바꿨어요.");
      }
    } finally {
      btn.disabled = false;
    }
  });

  render();
})();
