"""Layer: E2E — PoC browser-only accounts (no Supabase config), against a local static server.

Run: python3 -m http.server 8000 --bind 127.0.0.1 && uv run --with playwright python -I tests/e2e_local_accounts.py [chrome-path] [site-url]
"""
import sys

from playwright.sync_api import sync_playwright

SITE = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8000/"
CHROME = sys.argv[1] if len(sys.argv) > 1 else None
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS" if ok else "FAIL"), name, detail)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, **({"executable_path": CHROME} if CHROME else {}))
    pg = b.new_context(viewport={"width": 420, "height": 900}).new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(SITE)
    cards = lambda: pg.evaluate("Object.keys(window.VF.getState().cards)")

    def signup(u, pw):
        pg.click('button[data-tab="account"]')
        pg.click('button[data-pane="signup"]')
        pg.fill("#su-user", u); pg.fill("#su-pw", pw); pg.fill("#su-pw2", pw)
        pg.click("#f-signup button.primary")
        pg.wait_for_selector(".who")

    def login(u, pw):
        pg.click('button[data-tab="account"]')
        pg.fill("#li-user", u); pg.fill("#li-pw", pw)
        pg.click("#f-login button.primary")

    def study_one():
        pg.click('button[data-tab="study"]')
        pg.keyboard.press("Space"); pg.keyboard.press("3")

    check("account tab visible without config", pg.is_visible('button[data-tab="account"]'))
    study_one()
    first = cards()
    signup("alice_poc", "alice-pass-1")
    check("pre-signup study kept in account", cards() == first)
    stored = pg.evaluate("JSON.parse(localStorage.getItem('vocabflip.accounts')).alice_poc")
    check("password not stored in plain text", "alice-pass-1" not in str(stored) and len(stored["hash"]) > 20)

    pg.reload()
    pg.click('button[data-tab="account"]')
    check("session survives reload", "alice_poc" in pg.inner_text(".who"))

    pg.click("#logout")
    check("logout clears device study", cards() == [])

    signup("bob_poc", "bob-pass-123")
    check("second user starts empty", cards() == [])
    study_one(); study_one()
    bob_cards = cards()
    pg.click('button[data-tab="account"]'); pg.click("#logout")

    login("alice_poc", "wrong-pass")
    pg.wait_for_selector("#auth-msg.bad")
    check("wrong password rejected", "맞지 않아요" in pg.inner_text("#auth-msg"))
    pg.fill("#li-pw", "alice-pass-1"); pg.click("#f-login button.primary"); pg.wait_for_selector(".who")
    check("login restores own study only", cards() == first and set(bob_cards) - set(first) != set())

    pg.fill("#cp-old", "alice-pass-1"); pg.fill("#cp-new", "alice-pass-2"); pg.fill("#cp-new2", "alice-pass-2")
    pg.click("#f-chpw button"); pg.wait_for_selector("#auth-msg:has-text('바꿨어요')")
    pg.click("#logout")
    login("alice_poc", "alice-pass-2"); pg.wait_for_selector(".who")
    check("login with changed password", True)

    pg.click("#delete-account"); pg.click("#delete-account"); pg.wait_for_selector("#f-login")
    gone = pg.evaluate("[!JSON.parse(localStorage.getItem('vocabflip.accounts')).alice_poc, localStorage.getItem('vocabflip.user.alice_poc') === null]")
    check("delete removes account and study", gone == [True, True])
    login("bob_poc", "bob-pass-123"); pg.wait_for_selector(".who")
    check("other account untouched by delete", sorted(cards()) == sorted(bob_cards))
    check("no page errors", not errors, errors)
    pg.screenshot(path="/tmp/claude-1000/-home-islim-tmp-testrepo/cb472a4e-dc47-4e1b-95e5-5d7385adce89/scratchpad/poc.png")
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
