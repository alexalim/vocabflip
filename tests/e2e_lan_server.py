"""Layer: E2E — in-house PoC server (tools/serve_lan.py), two browser contexts as two devices.

Run: python3 tools/serve_lan.py && uv run --with playwright python -I tests/e2e_lan_server.py http://<lan-ip>:8000 [chrome-path]
Creates and deletes one test account on that server.
"""
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

SITE = sys.argv[1].rstrip("/") + "/"
CHROME = sys.argv[2] if len(sys.argv) > 2 else None
USER, PW = f"e2e_lan_{str(int(time.time()))[-6:]}", "lan-pass-123"
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS" if ok else "FAIL"), name, detail)


def status(path):
    try:
        return urllib.request.urlopen(SITE.rstrip("/") + path).status
    except urllib.error.HTTPError as e:
        return e.code


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, **({"executable_path": CHROME} if CHROME else {}))
    errors = []

    def device():
        pg = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True).new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(SITE)
        return pg

    cards = lambda pg: sorted(pg.evaluate("Object.keys(window.VF.getState().cards)"))

    pc = device()
    check("account tab visible", pc.is_visible('button[data-tab="account"]'))
    pc.keyboard.press("Space"); pc.keyboard.press("3")
    pc.click('button[data-tab="account"]'); pc.click('button[data-pane="signup"]')
    pc.fill("#su-user", USER); pc.fill("#su-pw", PW); pc.fill("#su-pw2", PW)
    pc.click("#f-signup button.primary"); pc.wait_for_selector(".who")
    check("server notice shown", "사내 PC 서버" in pc.inner_text(".poc"))
    pc.click('button[data-tab="study"]'); pc.keyboard.press("Space"); pc.keyboard.press("3")
    pc_cards = cards(pc)
    pc.wait_for_timeout(2600)  # 저장 디바운스(2초) 후 서버 반영

    phone = device()
    phone.click('button[data-tab="account"]')
    phone.fill("#li-user", USER); phone.fill("#li-pw", "wrong-pass-0")
    phone.click("#f-login button.primary"); phone.wait_for_selector("#auth-msg.bad")
    check("wrong password rejected", "맞지 않아요" in phone.inner_text("#auth-msg"))
    phone.fill("#li-pw", PW); phone.click("#f-login button.primary"); phone.wait_for_selector(".who")
    check("other device gets the same study", cards(phone) == pc_cards and len(pc_cards) == 2, cards(phone))

    phone.reload(); phone.click('button[data-tab="account"]'); phone.wait_for_selector(".who")
    check("session survives reload (cookie)", USER in phone.inner_text(".who"))
    cookie = [c for c in phone.context.cookies() if c["name"] == "vf_session"][0]
    check("session cookie HttpOnly + SameSite=Strict", cookie["httpOnly"] and cookie["sameSite"] == "Strict")

    phone.click("#delete-account"); phone.click("#delete-account"); phone.wait_for_selector("#f-login")
    pc.reload(); pc.click('button[data-tab="account"]'); pc.wait_for_selector("#f-login")
    check("deleted account logged out everywhere", True)
    pc.fill("#li-user", USER); pc.fill("#li-pw", PW); pc.click("#f-login button.primary"); pc.wait_for_selector("#auth-msg.bad")
    check("deleted account cannot log in", True)

    pc.click('button[data-tab="ipa"]'); pc.fill("#ipa-q", "abort"); pc.press("#ipa-q", "Enter")
    pc.click("#ipa-result [data-copy]")
    check("IPA copy works without clipboard API", pc.evaluate("getSelection().toString()") == "/əˈbɔrt/")
    check("no page errors", not errors, errors)
    b.close()

check("/.git/HEAD is not served", status("/.git/HEAD") == 404)
check("/api/progress needs a session", status("/api/progress") == 401)
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
