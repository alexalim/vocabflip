"""계층: Unit — ARPAbet→IPA 순수 변환 로직 (외부 의존성 없음)."""
import pytest

from ipa import arpabet_to_ipa, phoneme_tokens

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("arpa,ipa", [
    ("AH0 B AO1 R T", "əˈbɔrt"),            # abort: 강세는 b 앞(두음)
    ("AE0 B S T R AE1 K T", "æbˈstrækt"),   # abstract(v): str 은 합법 두음
    ("AE1 B S T R AE0 K T", "ˈæbstrækt"),   # abstract(adj): 첫 음절 강세
    ("CH ER1 CH", "tʃɝtʃ"),                 # 단음절은 강세 기호 생략
    ("DH AH0", "ðə"),
    ("P R EH1 Z AH0 N T", "ˈprɛzənt"),
    ("R EH2 K AH0 M EH1 N D", "ˌrɛkəˈmɛnd"),  # 2차 강세
    ("AH0 F AO1 R D", "əˈfɔrd"),
    ("B AH1 T ER0", "ˈbʌtɚ"),
])
def test_arpabet_to_ipa(arpa, ipa):
    assert arpabet_to_ipa(arpa) == ipa


def test_phoneme_tokens_keep_affricates_whole():
    # 'tʃ' 가 't' 로 쪼개지면 음소 색인이 오염된다
    assert phoneme_tokens("CH ER1 CH") == ["tʃ", "ɝ", "tʃ"]
