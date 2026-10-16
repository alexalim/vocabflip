// Accounts: username/password signup and login, find ID, reset password,
// Google/Kakao login and manual linking, and study-progress sync.
(function () {
  "use strict";
  const cfg = window.VOCABFLIP_CONFIG || {};
  const tabBtn = document.querySelector('.tabs button[data-tab="account"]');
  // 계정 탭은 기본으로 숨겨 두고, Supabase 설정이 있을 때만 보인다 (claude.ai 빌드 등은 계정 없이 동작)
  if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase || !window.VF) return;
  if (tabBtn) tabBtn.hidden = false;

  const USERNAME_DOMAIN = "users.vocabflip.invalid";
  const USERNAME_RE = /^[a-z0-9_]{4,20}$/;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const PROVIDERS = { google: "구글", kakao: "카카오" };
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true },
  });

  const $ = (s) => document.querySelector(s);
  const esc = window.VF.esc;
  const toast = window.VF.toast;
  const home = () => location.origin + location.pathname;
  const root = $("#account-body");
  let user = null, recovering = false, pushTimer = null, lastSync = null;

  // ---------- sync ----------
  async function pull() {
    const { data, error } = await sb.from("progress").select("state").eq("user_id", user.id).maybeSingle();
    if (error) return toast("학습 기록을 불러오지 못했어요");
    const merged = window.SYNC.mergeStates(window.VF.getState(), data && data.state);
    window.VF.replaceState(merged);
    await push();
  }
  async function push() {
    if (!user) return;
    const { error } = await sb.from("progress").upsert({ user_id: user.id, state: window.VF.getState(), updated_at: new Date().toISOString() });
    if (error) { toast("학습 기록을 저장하지 못했어요. 잠시 뒤 다시 시도해요"); return; }
    lastSync = new Date();
    const s = $("#sync-status");
    if (s) s.textContent = "마지막 동기화: " + lastSync.toLocaleTimeString("ko-KR");
  }
  window.VF.onSave(() => {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 3000);
  });

  // ---------- views ----------
  const field = (id, label, type, extra) =>
    `<label class="field"><span>${label}</span><input id="${id}" type="${type}" ${extra || ""}></label>`;

  function socialButtons() {
    return `<div class="social">${Object.entries(PROVIDERS).map(([p, n]) =>
      `<button type="button" class="social-btn ${p}" data-oauth="${p}">${n}로 계속하기</button>`).join("")}</div>`;
  }

  function signedOutView(pane) {
    const panes = { login: "로그인", signup: "가입", "find-id": "아이디 찾기", "find-pw": "비밀번호 찾기" };
    const nav = `<div class="seg">${Object.entries(panes).map(([k, v]) =>
      `<button type="button" data-pane="${k}" class="${k === pane ? "active" : ""}">${v}</button>`).join("")}</div>`;
    let body = "";
    if (pane === "login") {
      body = `<form id="f-login" class="auth-form">
        ${field("li-user", "아이디", "text", 'autocomplete="username" autocapitalize="none" required')}
        ${field("li-pw", "비밀번호", "password", 'autocomplete="current-password" required')}
        <button class="primary">로그인</button></form>
        <p class="or">또는</p>${socialButtons()}`;
    } else if (pane === "signup") {
      body = `<form id="f-signup" class="auth-form">
        ${field("su-user", "아이디 (영문 소문자·숫자·_ 4~20자)", "text", 'autocomplete="username" autocapitalize="none" required')}
        ${field("su-pw", "비밀번호 (8자 이상)", "password", 'autocomplete="new-password" minlength="8" required')}
        ${field("su-pw2", "비밀번호 확인", "password", 'autocomplete="new-password" required')}
        ${field("su-email", "복구용 이메일 (아이디·비밀번호 찾기에만 사용)", "email", 'autocomplete="email" required')}
        <label class="consent"><input id="su-agree" type="checkbox" required>
          <span>[필수] 아이디·복구용 이메일·학습 기록을 계정 관리와 기기 간 동기화를 위해 탈퇴할 때까지 보관하는 데 동의합니다.
          <a href="privacy.html" target="_blank" rel="noopener">개인정보 처리방침</a></span></label>
        <button class="primary">가입하기</button></form>
        <p class="or">또는</p>${socialButtons()}`;
    } else if (pane === "find-id") {
      body = `<form id="f-findid" class="auth-form">
        <p class="hint">가입할 때 적은 복구용 이메일로 아이디를 보내 드려요.</p>
        ${field("fi-email", "복구용 이메일", "email", 'autocomplete="email" required')}
        <button class="primary">아이디 받기</button></form>`;
    } else {
      body = `<form id="f-findpw" class="auth-form">
        <p class="hint">아이디와 복구용 이메일이 맞으면 비밀번호 재설정 링크를 보내 드려요.</p>
        ${field("fp-user", "아이디", "text", 'autocomplete="username" autocapitalize="none" required')}
        ${field("fp-email", "복구용 이메일", "email", 'autocomplete="email" required')}
        <button class="primary">재설정 링크 받기</button></form>`;
    }
    root.innerHTML = `<div class="account-card">${nav}${body}<p id="auth-msg" class="auth-msg" role="status"></p></div>`;
  }

  function recoveryView() {
    root.innerHTML = `<div class="account-card"><h3>새 비밀번호 설정</h3>
      <form id="f-newpw" class="auth-form">
        ${field("np-pw", "새 비밀번호 (8자 이상)", "password", 'autocomplete="new-password" minlength="8" required')}
        ${field("np-pw2", "새 비밀번호 확인", "password", 'autocomplete="new-password" required')}
        <button class="primary">비밀번호 바꾸기</button></form>
      <p id="auth-msg" class="auth-msg" role="status"></p></div>`;
  }

  async function signedInView() {
    const [{ data: profile }, { data: ids }] = await Promise.all([
      sb.from("profiles").select("username, recovery_email").eq("id", user.id).maybeSingle(),
      sb.auth.getUserIdentities(),
    ]);
    const identities = (ids && ids.identities) || [];
    const linked = new Set(identities.map((i) => i.provider));
    const meta = user.user_metadata || {};
    const who = profile && profile.username ? profile.username
      : meta.name || meta.full_name || meta.preferred_username || (user.email && !user.email.endsWith(USERNAME_DOMAIN) ? user.email : "소셜 계정");
    const links = Object.entries(PROVIDERS).map(([p, n]) => linked.has(p)
      ? `<li><span>${n}</span><span class="ok">연결됨</span></li>`
      : `<li><span>${n}</span><button type="button" data-link="${p}">연결하기</button></li>`).join("");
    const recovery = profile && profile.username ? `
      <form id="f-email" class="auth-form inline">
        ${field("re-email", "복구용 이메일", "email", `value="${esc(profile.recovery_email || "")}" autocomplete="email" required`)}
        <button>변경</button></form>` : "";
    root.innerHTML = `<div class="account-card">
      <p class="who"><b>${esc(who)}</b>님, 학습 기록이 계정에 저장되고 있어요.</p>
      <p id="sync-status" class="hint">${lastSync ? "마지막 동기화: " + lastSync.toLocaleTimeString("ko-KR") : "동기화 중…"}</p>
      <div class="row"><button type="button" id="sync-now">지금 동기화</button><button type="button" id="logout">로그아웃</button></div>
      <h4>연결된 소셜 계정</h4>
      <p class="hint">연결해 두면 아이디 대신 그 계정으로도 같은 기록에 로그인할 수 있어요.</p>
      <ul class="links">${links}</ul>
      ${recovery}
      <h4>회원 탈퇴</h4>
      <p class="hint">계정과 저장된 학습 기록이 모두 지워지고 되돌릴 수 없어요.</p>
      <button type="button" id="delete-account" class="danger">회원 탈퇴</button>
      <p id="auth-msg" class="auth-msg" role="status"></p></div>`;
  }

  function render(pane) {
    if (recovering) return recoveryView();
    if (user) return signedInView();
    return signedOutView(pane || "login");
  }

  const msg = (text, bad) => { const m = $("#auth-msg"); if (m) { m.textContent = text; m.classList.toggle("bad", !!bad); } };
  const val = (id) => ($("#" + id).value || "").trim();

  // ---------- actions ----------
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.pane) return render(t.dataset.pane);
    if (t.dataset.oauth) {
      const { error } = await sb.auth.signInWithOAuth({ provider: t.dataset.oauth, options: { redirectTo: home() } });
      if (error) msg("로그인 창을 열지 못했어요: " + error.message, true);
    }
    if (t.dataset.link) {
      const { error } = await sb.auth.linkIdentity({ provider: t.dataset.link, options: { redirectTo: home() } });
      if (error) msg("연결하지 못했어요. 이미 다른 VocabFlip 계정에 연결된 소셜 계정일 수 있어요.", true);
    }
    if (t.id === "sync-now") { await pull(); toast("동기화했어요"); }
    if (t.id === "logout") {
      await push();
      await sb.auth.signOut();
      window.VF.replaceState(null); // 공용 기기에서 다음 사람에게 기록이 남지 않게
      toast("로그아웃했어요. 이 기기의 학습 기록은 지웠고 계정에는 남아 있어요");
    }
    if (t.id === "delete-account") {
      if (!t.dataset.armed) {
        t.dataset.armed = "1";
        t.textContent = "정말 탈퇴하려면 한 번 더 누르세요";
        setTimeout(() => { delete t.dataset.armed; t.textContent = "회원 탈퇴"; }, 4000);
        return;
      }
      const { error } = await sb.functions.invoke("delete-account", { body: {} });
      if (error) return msg("탈퇴하지 못했어요. 잠시 뒤 다시 시도해 주세요.", true);
      await sb.auth.signOut();
      window.VF.replaceState(null);
      toast("탈퇴했어요. 계정과 학습 기록을 지웠어요");
    }
  });

  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("button");
    btn.disabled = true;
    try {
      if (f.id === "f-login") {
        const u = val("li-user").toLowerCase();
        const { error } = await sb.auth.signInWithPassword({ email: `${u}@${USERNAME_DOMAIN}`, password: $("#li-pw").value });
        if (error) msg("아이디 또는 비밀번호가 맞지 않아요.", true);
      } else if (f.id === "f-signup") {
        const u = val("su-user").toLowerCase(), pw = $("#su-pw").value, email = val("su-email").toLowerCase();
        if (!USERNAME_RE.test(u)) return msg("아이디는 영문 소문자, 숫자, _ 로 4~20자여야 해요.", true);
        if (pw.length < 8) return msg("비밀번호는 8자 이상이어야 해요.", true);
        if (pw !== $("#su-pw2").value) return msg("비밀번호 확인이 일치하지 않아요.", true);
        if (!EMAIL_RE.test(email)) return msg("복구용 이메일 형식을 확인해 주세요.", true);
        if (!$("#su-agree").checked) return msg("개인정보 수집·이용에 동의해야 가입할 수 있어요.", true);
        const { data: free } = await sb.rpc("username_available", { name: u });
        if (free === false) return msg("이미 쓰고 있는 아이디예요.", true);
        const { error } = await sb.auth.signUp({ email: `${u}@${USERNAME_DOMAIN}`, password: pw, options: { data: { recovery_email: email } } });
        if (error) msg(/registered|exists/i.test(error.message) ? "이미 쓰고 있는 아이디예요." : "가입하지 못했어요: " + error.message, true);
        else toast("가입했어요. 지금까지의 학습 기록을 계정에 저장해요");
      } else if (f.id === "f-findid") {
        const email = val("fi-email").toLowerCase();
        if (!EMAIL_RE.test(email)) return msg("이메일 형식을 확인해 주세요.", true);
        const { error } = await sb.functions.invoke("find-id", { body: { email } });
        msg(error ? "요청하지 못했어요. 잠시 뒤 다시 시도해 주세요." : "가입된 이메일이라면 몇 분 안에 아이디가 도착해요. 스팸함도 확인해 주세요.", !!error);
      } else if (f.id === "f-findpw") {
        const username = val("fp-user").toLowerCase(), email = val("fp-email").toLowerCase();
        const { error } = await sb.functions.invoke("reset-password", { body: { username, email } });
        msg(error ? "요청하지 못했어요. 입력을 확인해 주세요." : "아이디와 이메일이 맞다면 몇 분 안에 재설정 링크가 도착해요.", !!error);
      } else if (f.id === "f-newpw") {
        const pw = $("#np-pw").value;
        if (pw.length < 8) return msg("비밀번호는 8자 이상이어야 해요.", true);
        if (pw !== $("#np-pw2").value) return msg("비밀번호 확인이 일치하지 않아요.", true);
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) return msg("바꾸지 못했어요. 링크를 다시 받아 주세요.", true);
        recovering = false;
        toast("비밀번호를 바꿨어요");
        render();
      } else if (f.id === "f-email") {
        const email = val("re-email").toLowerCase();
        if (!EMAIL_RE.test(email)) return msg("이메일 형식을 확인해 주세요.", true);
        const { error } = await sb.from("profiles").update({ recovery_email: email }).eq("id", user.id);
        msg(error ? "바꾸지 못했어요." : "복구용 이메일을 바꿨어요.", !!error);
      }
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- session ----------
  sb.auth.onAuthStateChange((event, session) => {
    const was = user && user.id;
    user = session ? session.user : null;
    if (event === "PASSWORD_RECOVERY") {
      recovering = true;
      window.VF.showTab("account");
    }
    if (user && user.id !== was && !recovering) setTimeout(pull, 0);
    if (location.hash.includes("access_token") || location.hash.includes("error")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    setTimeout(() => render(), 0);
  });
  render();
})();
