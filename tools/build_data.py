"""raw/ 원본 → data/*.js (브라우저가 file:// 로도 읽을 수 있게 window 전역에 싣는다).

실행: uv run --with openpyxl python -I tools/build_data.py
"""
import html
import json
import re
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).parent))
from ipa import arpabet_to_ipa, load_cmudict, phoneme_tokens  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW, DATA, GEN_IN = ROOT / "raw", ROOT / "data", ROOT / "gen" / "in"
DECK_LEVELS = ("1k", "2k", "3k")
SLICE = 100


def write_js(name, var, obj):
    (DATA / name).write_text(f"window.{var}={json.dumps(obj, ensure_ascii=False, separators=(',', ':'))};\n", encoding="utf-8")


def parse_forms(s):
    out = []
    for m in re.finditer(r"([^,(]+?)\s*\((\d+)\)", s or ""):
        out.append([m.group(1).strip(), int(m.group(2))])
    return out


def us_spelling(w):
    """BNC 표제어의 영국식 철자 → CMUdict 조회용 미국식 철자."""
    w = re.sub(r"yse$", "yze", w)
    w = re.sub(r"ise$", "ize", w)
    w = re.sub(r"our$", "or", w)
    return re.sub(r"ence$", "ense", w) if w == "offence" else w


def load_bnccoca():
    wb = openpyxl.load_workbook(RAW / "bnccoca.xlsx", read_only=True)
    rows = []
    for r in list(wb.worksheets[0].iter_rows(values_only=True))[1:]:
        if not r[1]:
            continue
        rows.append({"lvl": str(r[0]).strip(), "w": str(r[1]).strip(), "forms": parse_forms(r[2]), "freq": int(r[3] or 0)})
    return rows


def load_twisters():
    t = (RAW / "tt.html").read_text(encoding="utf-8", errors="replace")
    out = []
    for m in re.finditer(r'<P CLASS="SLC"><B>(\d+)</B></P><P CLASS="TXT">(.*?)</P>', t, re.S):
        text = re.sub(r"<BR>\s*", "\n", m.group(2), flags=re.I)
        text = html.unescape(re.sub(r"<[^>]+>", "", text))
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
        if lines:
            out.append({"n": int(m.group(1)), "text": "\n".join(lines)})
    return out


def main():
    DATA.mkdir(exist_ok=True)
    GEN_IN.mkdir(parents=True, exist_ok=True)
    cmu = load_cmudict(RAW / "cmudict.dict")
    rows = load_bnccoca()

    # 1) 미국식 IPA 사전 전체 (발음 기호 조회 탭용)
    ipa_dict = {w: [arpabet_to_ipa(p) for p in prons] for w, prons in cmu.items() if re.fullmatch(r"[a-z][a-z'\-.]*", w)}
    write_js("ipa_dict.js", "IPA_DICT", ipa_dict)

    # 2) 음소 → 빈도순 단어 (25k 표제어 중 CMUdict 에 있는 것)
    freq_sorted = sorted((r for r in rows if r["w"].isalpha()), key=lambda r: -r["freq"])
    index = {}
    for r in freq_sorted:
        prons = cmu.get(r["w"].lower())
        if not prons:
            continue
        for tok in set(phoneme_tokens(prons[0])):
            lst = index.setdefault(tok, [])
            if len(lst) < 60:
                lst.append(r["w"])
    write_js("phonemes.js", "PHONEME_INDEX", index)

    # 3) 학습 덱 1k~3k
    deck, missing = [], []
    for r in rows:
        if r["lvl"] not in DECK_LEVELS:
            continue
        w = r["w"]
        prons = cmu.get(w.lower()) or cmu.get(us_spelling(w.lower()), [])
        if not prons:
            missing.append(w)
        deck.append({"w": w, "lvl": r["lvl"], "freq": r["freq"], "ipa": [arpabet_to_ipa(p) for p in prons],
                     "forms": [f for f, _ in sorted(r["forms"], key=lambda x: -x[1]) if f != w][:8]})
    write_js("deck.js", "DECK", deck)

    # 4) 콘텐츠 생성용 입력 조각
    for old in GEN_IN.glob("*.json"):
        old.unlink()
    for i in range(0, len(deck), SLICE):
        sl = [{"w": d["w"], "lvl": d["lvl"], "forms": d["forms"]} for d in deck[i:i + SLICE]]
        (GEN_IN / f"{i // SLICE:03d}.json").write_text(json.dumps(sl, ensure_ascii=False, indent=1), encoding="utf-8")

    # 5) 텅 트위스터
    tw = load_twisters()
    write_js("twisters.js", "TWISTERS", tw)

    print(f"ipa_dict={len(ipa_dict)} phonemes={len(index)} deck={len(deck)} slices={-(-len(deck) // SLICE)} "
          f"cmu_missing={len(missing)} twisters={len(tw)}")
    print("missing sample:", missing[:40])


if __name__ == "__main__":
    main()
