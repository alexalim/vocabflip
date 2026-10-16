"""Layer: E2E — accounts against a LOCAL Supabase stack (supabase start) only.

Never point this at the hosted project: it creates and deletes accounts.

Run:
  npx supabase start && npx supabase functions serve --env-file supabase/functions/.env
  python3 -m http.server 8000 --bind 127.0.0.1
  uv run --with playwright python -I tests/e2e_accounts.py <publishable-key>
"""
import json
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

SITE = "http://127.0.0.1:8000/"
API = "http://127.0.0.1:54321"
MAILPIT = "http://127.0.0.1:54324/api/v1"
KEY = sys.argv[1]
CHROME = sys.argv[2] if len(sys.argv) > 2 else None
assert API.startswith("http://127.0.0.1"), "local stack only"

stamp = str(int(time.time()))[-6:]
USER, PW, PW2 = f"e2e_{stamp}", "first-pass-123", "second-pass-456"
EMAIL = f"e2e_{stamp}@example.test"
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS" if ok else "FAIL"), name, detail)


def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def mails_to(addr):
    _, d = http("GET", f"{MAILPIT}/search?query=to:{addr}")
    return d.get("messages", [])


def mail_text(msg_id):
    _, d = http("GET", f"{MAILPIT}/message/{msg_id}")
    return d.get("Text", "")


def wait_mail(addr, n, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        m = mails_to(addr)
        if len(m) >= n:
            return m
        time.sleep(1)
    return mails_to(addr)


config_js = f'window.VOCABFLIP_CONFIG={{supabaseUrl:"{API}",supabaseKey:"{KEY}"}};'

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, **({"executable_path": CHROME} if CHROME else {}))
    ctx = b.new_context(viewport={"width": 420, "height": 900})
    ctx.route("**/js/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=config_js))
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(SITE)

    # 가입 전에 카드 1장 학습 (로컬 기록이 가입 후 계정으로 올라가야 함)
    pg.keyboard.press("Space")
    pg.keyboard.press("3")
    first_word = list(pg.evaluate("window.VF.getState().cards").keys())[0]

    # 가입
    pg.click('button[data-tab="account"]')
    pg.click('button[data-pane="signup"]')
    pg.fill("#su-user", USER)
    pg.fill("#su-pw", PW)
    pg.fill("#su-pw2", PW)
    pg.fill("#su-email", EMAIL)
    pg.check("#su-agree")
    pg.click("#f-signup button.primary")
    pg.wait_for_selector(".who", timeout=10000)
    check("signup shows signed-in view", USER in pg.inner_text(".who"))
    pg.wait_for_selector("#sync-status:has-text('마지막 동기화')", timeout=10000)
    token = pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes('auth-token')))).access_token")
    _, rows = http("GET", f"{API}/rest/v1/progress?select=state", headers={"apikey": KEY, "Authorization": f"Bearer {token}"})
    check("pre-signup study uploaded", bool(rows) and first_word in rows[0]["state"]["cards"])

    # 같은 아이디 재가입 거부
    s, free = http("POST", f"{API}/rest/v1/rpc/username_available", {"name": USER}, {"apikey": KEY})
    check("username_available false for taken name", free is False)

    # 로그아웃 → 이 기기 기록 비움
    pg.click("#logout")
    pg.wait_for_selector("#f-login", timeout=10000)
    check("logout clears local study", pg.evaluate("Object.keys(window.VF.getState().cards).length") == 0)

    # 틀린 비밀번호
    pg.fill("#li-user", USER)
    pg.fill("#li-pw", "wrong-password")
    pg.click("#f-login button.primary")
    pg.wait_for_selector("#auth-msg.bad", timeout=10000)
    check("wrong password rejected", "맞지 않아요" in pg.inner_text("#auth-msg"))

    # 로그인 → 계정 기록 복원
    pg.fill("#li-pw", PW)
    pg.click("#f-login button.primary")
    pg.wait_for_selector(".who", timeout=10000)
    pg.wait_for_function(f"!!window.VF.getState().cards['{first_word}']", timeout=10000)
    check("login restores study from account", True)

    # 다른 사용자는 남의 학습 기록을 못 읽음 (RLS)
    s, other = http("POST", f"{API}/auth/v1/signup", {"email": f"rls_{stamp}@users.vocabflip.invalid", "password": "rls-pass-123"}, {"apikey": KEY})
    _, peek = http("GET", f"{API}/rest/v1/progress?select=user_id", headers={"apikey": KEY, "Authorization": f"Bearer {other['access_token']}"})
    check("RLS hides other users' progress", peek == [])
    _, peek_profiles = http("GET", f"{API}/rest/v1/profiles?select=recovery_email", headers={"apikey": KEY})
    check("anon cannot read profiles", peek_profiles == [])

    pg.click("#logout")
    pg.wait_for_selector("#f-login", timeout=10000)

    # 아이디 찾기 메일
    pg.click('button[data-pane="find-id"]')
    pg.fill("#fi-email", EMAIL)
    pg.click("#f-findid button.primary")
    msgs = wait_mail(EMAIL, 1)
    check("find-id mail contains username", bool(msgs) and USER in mail_text(msgs[0]["ID"]))

    # 없는 이메일도 같은 안내 (계정 존재 여부 비노출)
    pg.fill("#fi-email", f"nobody_{stamp}@example.test")
    pg.click("#f-findid button.primary")
    pg.wait_for_timeout(1500)
    check("find-id same message for unknown email", "몇 분 안에" in pg.inner_text("#auth-msg") and not mails_to(f"nobody_{stamp}@example.test"))

    # 비밀번호 재설정: 링크 → 새 비밀번호 → 새 비밀번호로 로그인
    pg.click('button[data-pane="find-pw"]')
    pg.fill("#fp-user", USER)
    pg.fill("#fp-email", EMAIL)
    pg.click("#f-findpw button.primary")
    msgs = wait_mail(EMAIL, 2)
    link = re.search(r"https?://\S+", mail_text(msgs[0]["ID"]) if "재설정" in mail_text(msgs[0]["ID"]) else mail_text(msgs[1]["ID"]))
    check("reset mail has link", bool(link))
    pg.goto(link.group(0))
    pg.wait_for_selector("#f-newpw", timeout=15000)
    pg.fill("#np-pw", PW2)
    pg.fill("#np-pw2", PW2)
    pg.click("#f-newpw button.primary")
    pg.wait_for_selector(".who", timeout=10000)
    pg.click("#logout")
    pg.wait_for_selector("#f-login", timeout=10000)
    pg.fill("#li-user", USER)
    pg.fill("#li-pw", PW2)
    pg.click("#f-login button.primary")
    pg.wait_for_selector(".who", timeout=10000)
    check("login with reset password", True)

    # 회원 탈퇴 → 계정·기록 삭제
    uid = pg.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.includes('auth-token')))).user.id")
    pg.click("#delete-account")
    pg.click("#delete-account")
    pg.wait_for_selector("#f-login", timeout=10000)
    s, login = http("POST", f"{API}/auth/v1/token?grant_type=password", {"email": f"{USER}@users.vocabflip.invalid", "password": PW2}, {"apikey": KEY})
    check("deleted account cannot log in", s == 400)
    check("no page errors", not errors, errors)
    pg.screenshot(path="/tmp/claude-1000/-home-islim-tmp-testrepo/cb472a4e-dc47-4e1b-95e5-5d7385adce89/scratchpad/account.png")
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
