"""계층: Schema — 생성된 실제 콘텐츠(gen/out)가 카드 스키마를 만족하는지 검증 (Mock 없음)."""
from pathlib import Path

import pytest

from merge_content import GEN_IN, validate_slice

pytestmark = pytest.mark.schema
SLICES = sorted(p.name for p in GEN_IN.glob("*.json"))


@pytest.mark.parametrize("name", SLICES)
def test_slice_matches_schema(name):
    out, errs = validate_slice(name)
    assert errs == [], errs[:10]
    assert out is not None
