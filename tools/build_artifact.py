"""index.html → dist/index.html (claude.ai Artifact 배포용).

Artifact는 배포 시 <!doctype>/<html>/<head>/<body> 골격을 씌우므로 그 태그를 걷어내고,
CSS는 인라인한다. 스크립트·데이터는 Artifact의 files 로 같은 경로에 함께 올린다.
"""
import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
# Artifact CSP 는 Google Fonts 외 폰트 호스트를 막으므로 폰트는 data URI 로 인라인
css = re.sub(r'url\("\.\./fonts/([^"]+\.woff2)"\)',
             lambda m: 'url("data:font/woff2;base64,' + base64.b64encode((ROOT / "fonts" / m.group(1)).read_bytes()).decode() + '")',
             css)

head = re.search(r"<head>(.*?)</head>", src, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", src, re.S).group(1)
title = re.search(r"<title>.*?</title>", head).group(0)

out = (f'{title}\n<meta name="claude:viewport-fit-sides" content="cover">\n'
       f"<style>\n{css}</style>\n{body.strip()}\n")
(ROOT / "dist").mkdir(exist_ok=True)
(ROOT / "dist" / "index.html").write_text(out, encoding="utf-8")
print("dist/index.html", len(out))
