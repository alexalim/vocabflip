"""gen/out/*.json 검증 + 병합 → data/content.js

실행: python3 -I tools/merge_content.py   (누락·불량 조각 목록을 출력, 종료코드 1)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN_IN, GEN_OUT, DATA = ROOT / "gen" / "in", ROOT / "gen" / "out", ROOT / "data"
REQUIRED = ("w", "pos", "meaning_ko", "example_en", "example_ko", "nuance_ko", "also")
POS = {"n", "v", "adj", "adv", "prep", "conj", "pron", "det", "int", "num"}


def check_entry(src, e):
    """src: 입력 항목, e: 생성 항목 → 문제 목록"""
    errs = [f"missing {k}" for k in REQUIRED if k not in e or (e[k] in ("", None) and k != "also")]
    if errs:
        return errs
    if e["w"] != src["w"]:
        errs.append(f"word mismatch {e['w']!r}")
    if e["pos"] not in POS:
        errs.append(f"bad pos {e['pos']!r}")
    if not re.search(r"\*\*[^*]+\*\*", e["example_en"]):
        errs.append("example_en without **marker**")
    forms = set(src["forms"]) | {src["w"]}
    for a in e["also"]:
        if a.get("w") not in forms:
            errs.append(f"also word not in forms: {a.get('w')!r}")
        if not all(a.get(k) for k in ("w", "pos", "ko", "en")):
            errs.append("also item incomplete")
    return errs


def validate_slice(name):
    src = json.loads((GEN_IN / name).read_text(encoding="utf-8"))
    out_path = GEN_OUT / name
    if not out_path.exists():
        return None, ["missing file"]
    try:
        out = json.loads(out_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as ex:
        return None, [f"json error: {ex}"]
    if len(out) != len(src):
        return None, [f"count {len(out)} != {len(src)}"]
    errs = []
    for s, e in zip(src, out):
        errs += [f"{s['w']}: {m}" for m in check_entry(s, e)]
    return out, errs


def main():
    merged, bad = {}, {}
    for p in sorted(GEN_IN.glob("*.json")):
        out, errs = validate_slice(p.name)
        if errs:
            bad[p.name] = errs
        if out:
            for e in out:
                merged[e["w"]] = e
    (DATA / "content.js").write_text(
        "window.CONTENT=" + json.dumps(merged, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"merged={len(merged)} bad_slices={len(bad)}")
    for k, v in bad.items():
        print(k, v[:5])
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
