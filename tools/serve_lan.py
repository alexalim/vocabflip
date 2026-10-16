"""VocabFlip in-house PoC server: the app + a small account/progress API on one port.

Python standard library only (3.8+). Accounts and progress live in SQLite under
lan-data/ (gitignored). Only the files the app needs are served.

Run:  python3 tools/serve_lan.py [--host 0.0.0.0] [--port 8000]
"""
import argparse
import hashlib
import hmac
import json
import mimetypes
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "lan-data" / "vocabflip.sqlite3"
STATIC_FILES = {"index.html", "privacy.html"}
STATIC_DIRS = {"css", "js", "data", "fonts"}
USERNAME_RE = re.compile(r"^[a-z0-9_]{4,20}$")
PBKDF2_ITER = 210_000
SESSION_DAYS = 30
MAX_BODY = 4 * 1024 * 1024
LOCK_AFTER, LOCK_SECONDS = 5, 300
COOKIE = "vf_session"
CONFIG_JS = b'window.VOCABFLIP_CONFIG={api:"/api"};\n'

_failures = {}  # username -> (count, locked_until)
_fail_lock = threading.Lock()


@contextmanager
def db():
    """Connection that commits on success and is always closed."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.execute("pragma foreign_keys = on")
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    with db() as c:
        c.executescript("""
        create table if not exists users (
          id integer primary key, username text unique not null,
          salt blob not null, hash blob not null, iter integer not null, created real not null);
        create table if not exists sessions (
          token_hash text primary key, user_id integer not null references users(id) on delete cascade,
          expires real not null);
        create table if not exists progress (
          user_id integer primary key references users(id) on delete cascade,
          state text not null, updated real not null);
        """)


def hash_pw(password, salt, iterations=PBKDF2_ITER):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def locked(username):
    with _fail_lock:
        count, until = _failures.get(username, (0, 0))
        return until > time.time()


def record_failure(username):
    with _fail_lock:
        count, _ = _failures.get(username, (0, 0))
        count += 1
        _failures[username] = (count, time.time() + LOCK_SECONDS if count >= LOCK_AFTER else 0)


def clear_failures(username):
    with _fail_lock:
        _failures.pop(username, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "VocabFlip"
    sys_version = ""

    # ---------- helpers ----------
    def send_json(self, status, body, headers=None):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return None
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return None

    def session_cookie(self, token, max_age):
        return f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}"

    def current_user(self):
        jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        if COOKIE not in jar:
            return None
        with db() as c:
            row = c.execute(
                "select u.id, u.username from sessions s join users u on u.id = s.user_id "
                "where s.token_hash = ? and s.expires > ?", (token_hash(jar[COOKIE].value), time.time())).fetchone()
        return row

    def new_session(self, user_id):
        token = secrets.token_urlsafe(32)
        with db() as c:
            c.execute("delete from sessions where expires <= ?", (time.time(),))
            c.execute("insert into sessions values (?, ?, ?)",
                      (token_hash(token), user_id, time.time() + SESSION_DAYS * 86400))
        return self.session_cookie(token, SESSION_DAYS * 86400)

    def log_message(self, fmt, *args):  # 요청 로그에서 쿠키·본문은 남기지 않는다
        print("%s %s" % (self.address_string(), fmt % args))

    # ---------- static ----------
    def do_GET(self):
        path = self.path.split("?")[0].split("#")[0]
        if path.startswith("/api/"):
            return self.guard(self.api_get, path)
        if path == "/js/config.js":
            return self.send_bytes(CONFIG_JS, "text/javascript")
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        parts = rel.split("/")
        allowed = (len(parts) == 1 and rel in STATIC_FILES) or (len(parts) > 1 and parts[0] in STATIC_DIRS)
        target = (ROOT / rel).resolve()
        if not allowed or ".." in parts or ROOT not in target.parents or not target.is_file():
            return self.send_json(404, {"error": "not_found"})
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".js":
            ctype = "text/javascript"
        self.send_bytes(target.read_bytes(), ctype)

    def send_bytes(self, data, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self.guard(self.api_post, self.path.split("?")[0])

    def do_PUT(self):
        self.guard(self.api_post, self.path.split("?")[0])

    def guard(self, fn, path):
        try:
            fn(path)
        except Exception as e:  # 스택 트레이스는 응답에 넣지 않는다
            print("api error", path, type(e).__name__)
            self.send_json(500, {"error": "server_error"})

    # ---------- api ----------
    def api_get(self, path):
        user = self.current_user()
        if path == "/api/me":
            return self.send_json(200, {"username": user[1]}) if user else self.send_json(401, {"error": "unauthorized"})
        if path == "/api/progress":
            if not user:
                return self.send_json(401, {"error": "unauthorized"})
            with db() as c:
                row = c.execute("select state from progress where user_id = ?", (user[0],)).fetchone()
            return self.send_json(200, {"state": json.loads(row[0]) if row else None})
        self.send_json(404, {"error": "not_found"})

    def api_post(self, path):
        body = self.read_json()
        if body is None:
            return self.send_json(400, {"error": "invalid"})

        if path == "/api/signup" and self.command == "POST":
            username = str(body.get("username", "")).strip().lower()
            password = str(body.get("password", ""))
            if not USERNAME_RE.match(username) or len(password) < 8:
                return self.send_json(400, {"error": "invalid"})
            salt = secrets.token_bytes(16)
            try:
                with db() as c:
                    cur = c.execute("insert into users (username, salt, hash, iter, created) values (?, ?, ?, ?, ?)",
                                    (username, salt, hash_pw(password, salt), PBKDF2_ITER, time.time()))
                    user_id = cur.lastrowid
            except sqlite3.IntegrityError:
                return self.send_json(409, {"error": "taken"})
            return self.send_json(201, {"username": username}, {"Set-Cookie": self.new_session(user_id)})

        if path == "/api/login" and self.command == "POST":
            username = str(body.get("username", "")).strip().lower()
            password = str(body.get("password", ""))
            if locked(username):
                return self.send_json(429, {"error": "locked"})
            with db() as c:
                row = c.execute("select id, salt, hash, iter from users where username = ?", (username,)).fetchone()
            if not row or not hmac.compare_digest(hash_pw(password, row[1], row[3]), row[2]):
                record_failure(username)
                return self.send_json(401, {"error": "bad_credentials"})
            clear_failures(username)
            return self.send_json(200, {"username": username}, {"Set-Cookie": self.new_session(row[0])})

        if path == "/api/logout" and self.command == "POST":
            jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
            if COOKIE in jar:
                with db() as c:
                    c.execute("delete from sessions where token_hash = ?", (token_hash(jar[COOKIE].value),))
            return self.send_json(200, {"ok": True}, {"Set-Cookie": self.session_cookie("", 0)})

        user = self.current_user()
        if not user:
            return self.send_json(401, {"error": "unauthorized"})

        if path == "/api/progress" and self.command == "PUT":
            state = body.get("state")
            if not isinstance(state, dict):
                return self.send_json(400, {"error": "invalid"})
            with db() as c:
                c.execute("insert into progress values (?, ?, ?) on conflict(user_id) do update set "
                          "state = excluded.state, updated = excluded.updated",
                          (user[0], json.dumps(state), time.time()))
            return self.send_json(200, {"ok": True})

        if path == "/api/password" and self.command == "POST":
            old, new = str(body.get("old", "")), str(body.get("new", ""))
            with db() as c:
                row = c.execute("select salt, hash, iter from users where id = ?", (user[0],)).fetchone()
            if not hmac.compare_digest(hash_pw(old, row[0], row[2]), row[1]):
                return self.send_json(401, {"error": "bad_credentials"})
            if len(new) < 8:
                return self.send_json(400, {"error": "invalid"})
            salt = secrets.token_bytes(16)
            with db() as c:
                c.execute("update users set salt = ?, hash = ?, iter = ? where id = ?",
                          (salt, hash_pw(new, salt), PBKDF2_ITER, user[0]))
            return self.send_json(200, {"ok": True})

        if path == "/api/delete" and self.command == "POST":
            with db() as c:
                c.execute("delete from users where id = ?", (user[0],))
            return self.send_json(200, {"ok": True}, {"Set-Cookie": self.session_cookie("", 0)})

        self.send_json(404, {"error": "not_found"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    init_db()
    print(f"VocabFlip LAN server on http://{args.host}:{args.port}/ (data: {DB_PATH})")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
