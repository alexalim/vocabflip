"""CMUdict ARPAbet -> US IPA 변환.

강세 기호는 음절 시작(onset) 앞에 둔다. 최대 두음 원칙으로 음절 경계를 정한다.
"""

VOWELS = {
    "AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ",
    "EH": "ɛ", "ER": "ɝ", "EY": "eɪ", "IH": "ɪ", "IY": "i", "OW": "oʊ",
    "OY": "ɔɪ", "UH": "ʊ", "UW": "u",
}
CONSONANTS = {
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h",
    "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p",
    "R": "r", "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w",
    "Y": "j", "Z": "z", "ZH": "ʒ",
}

# 영어 단어 첫머리에 올 수 있는 자음군(ARPAbet). 음절 경계 판정용.
LEGAL_ONSETS = {(c,) for c in CONSONANTS if c != "NG"} | {
    tuple(o.split()) for o in """
    P L|P R|P Y|B L|B R|B Y|T R|T W|T Y|D R|D W|D Y|K L|K R|K W|K Y|G L|G R|G W|G Y
    F L|F R|F Y|TH R|TH W|SH R|S P|S T|S K|S M|S N|S L|S W|S F|S Y|V Y|M Y|N Y|HH Y|HH W
    S P L|S P R|S P Y|S T R|S T Y|S K L|S K R|S K W|S K Y
    """.replace("|", "\n").split("\n") if o.strip()
}


def _split(phones):
    """[(base, stress|None)]"""
    out = []
    for p in phones:
        if p[-1].isdigit():
            out.append((p[:-1], int(p[-1])))
        else:
            out.append((p, None))
    return out


def _vowel_ipa(base, stress):
    if base == "AH" and stress == 0:
        return "ə"
    if base == "ER" and stress == 0:
        return "ɚ"
    return VOWELS[base]


def arpabet_to_ipa(pron: str) -> str:
    ph = _split(pron.split())
    vowel_idx = [i for i, (_, s) in enumerate(ph) if s is not None]
    marks = {}  # 삽입 위치 -> 강세 기호
    for n, vi in enumerate(vowel_idx):
        stress = ph[vi][1]
        if stress not in (1, 2) or len(vowel_idx) == 1:
            continue
        prev_v = vowel_idx[n - 1] if n > 0 else -1
        start = vi
        # 직전 모음 뒤 자음들 중 합법 두음이 되는 가장 긴 꼬리를 이 음절에 붙인다
        for k in range(prev_v + 1, vi):
            onset = tuple(b for b, _ in ph[k:vi])
            if onset in LEGAL_ONSETS:
                start = k
                break
        if prev_v == -1:
            start = 0
        marks[start] = "ˈ" if stress == 1 else "ˌ"
    out = []
    for i, (b, s) in enumerate(ph):
        if i in marks:
            out.append(marks[i])
        out.append(_vowel_ipa(b, s) if s is not None else CONSONANTS[b])
    return "".join(out)


def phoneme_tokens(pron: str):
    """색인용 IPA 음소 토큰 목록(강세 기호 제외)."""
    return [_vowel_ipa(b, s) if s is not None else CONSONANTS[b] for b, s in _split(pron.split())]


def load_cmudict(path):
    d = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#")[0].strip()
            if not line:
                continue
            word, pron = line.split(" ", 1)
            base = word.split("(")[0].lower()
            d.setdefault(base, []).append(pron.strip())
    return d
