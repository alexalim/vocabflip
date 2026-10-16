# VocabFlip에 기여하기

VocabFlip을 함께 다듬어 주셔서 고맙습니다. 기여는 크게 두 가지입니다.

- **카드 콘텐츠**: 뜻, 예문, 뉘앙스, "이렇게도 쓰인다"를 고치는 일입니다. 가장 반가운 기여입니다.
- **코드**: 학습 화면, 스케줄러, 발음 기호, 텅 트위스터 기능을 고치는 일입니다.

## 무엇을 할지 모르겠다면

[Issues](../../issues) 탭에서 `help wanted`나 `good first issue` 라벨이 붙은 이슈를 보세요.
카드를 공부하다 어색한 뜻이나 예문을 발견했다면, 그것부터 고쳐 주셔도 좋습니다.

## 카드 콘텐츠 고치기

콘텐츠의 원본은 `gen/out/NNN.json`입니다. 단어 100개씩, 빈도 순서대로 나뉘어 있습니다.
`data/content.js`는 원본을 합쳐 만든 결과물이므로 **직접 고치지 마세요.**

1. 고칠 단어가 들어 있는 파일을 찾습니다. 예: `grep -l '"w": "afford"' gen/out/*.json`
2. 해당 항목을 수정합니다. 필드 규칙은 [`gen/PROMPT.md`](gen/PROMPT.md)를 따릅니다.
   - `example_en`에서 표제어는 `**afford**`처럼 `**`로 한 번 감쌉니다.
   - `also`에는 그 단어의 `gen/in/NNN.json` `forms`에 있는 단어만 씁니다.
   - `nuance_ko`는 해요체로, 4~6문장 정도로 씁니다.
3. 결과물을 다시 만들고 검증합니다.
   ```bash
   python3 -I tools/merge_content.py   # gen/out → data/content.js, 오류가 있으면 종료코드 1
   ```
4. `gen/out/NNN.json`과 `data/content.js`를 **함께** 커밋합니다.

뜻이 틀렸다고 확신하기 어렵다면 PR 대신 **콘텐츠 오류 제보** 이슈를 열어 주세요.

## 큰 변경은 먼저 이야기해 주세요

새 탭, 새 덱(4k 이상), 스케줄러 알고리즘 교체(예: FSRS)처럼 큰 변경은
작업을 시작하기 전에 이슈를 열어 방향을 먼저 맞춰 주세요.
오래 작업한 PR이 방향이 달라 닫히면 서로 아쉽습니다.

## Pull Request 규칙

- **이슈 연결**: 모든 PR은 열려 있는 이슈에 연결해야 합니다(`Closes #12`).
  관련 이슈가 없으면 먼저 이슈를 만들어 주세요. 오타 수정은 예외입니다.
- **템플릿 작성**: PR을 열면 나오는 템플릿(`.github/pull_request_template.md`)을 채워 주세요.
- **크기**: 한 PR에는 한 가지 목적만 담아 주세요. 콘텐츠 수정과 코드 수정은 나눠 주세요.
- **리팩터링만 하는 PR은 지양해 주세요.** 리뷰 비용과 회귀 위험에 비해 얻는 것이 적습니다.
  기능 추가나 버그 수정을 하면서 필요한 만큼 정리하는 것은 환영합니다.
- **화면 변경**: UI가 바뀌면 PC와 모바일(약 400px 폭) 스크린샷을 첨부해 주세요.

## 개발 환경

빌드 도구가 필요 없는 정적 웹앱입니다.

```bash
python3 -m http.server 8000      # http://127.0.0.1:8000
```

`index.html`을 브라우저로 바로 열어도 동작합니다(데이터가 `<script>`로 싣는 `.js` 파일입니다).

| 경로 | 내용 |
|---|---|
| `js/srs.js` | Anki식 SM-2 스케줄러. DOM에 의존하지 않는 순수 함수 |
| `js/app.js` | 화면과 상태 관리. 학습 기록은 브라우저 localStorage에 저장 |
| `tools/ipa.py` | CMUdict ARPAbet을 미국식 IPA로 변환 |
| `tools/build_data.py` | 원본 자료(`raw/`, 저장소에 없음)로 `data/*.js` 생성 |
| `tools/merge_content.py` | `gen/out` 검증 후 `data/content.js` 생성 |

`raw/`의 원본 자료(BNC/COCA 엑셀, CMUdict, 텅 트위스터 페이지)는 라이선스 때문에 저장소에 넣지 않았습니다.
`data/*.js`를 다시 만들어야 할 때만 README의 출처에서 받아 `raw/`에 넣으면 됩니다.

## 테스트는 반드시 통과해야 합니다

PR을 올리기 전에 아래 테스트를 실행해 주세요. CI에서도 같은 테스트를 돌립니다.

```bash
node --test tests/*.test.js                             # Unit: SRS 스케줄러
cd tools && python3 -m pytest -q               # Unit: IPA 변환 / Schema: 카드 콘텐츠
python3 -I tools/merge_content.py && git diff --exit-code data/content.js   # 결과물이 원본과 일치하는지
```

테스트를 새로 쓸 때는 파일 머리말에 계층을 밝혀 주세요(`Unit`, `Schema`, `E2E`).

## 라이선스

기여한 코드는 [MIT](LICENSE), 기여한 카드 콘텐츠는 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)으로 공개된다는 데 동의하는 것으로 봅니다.
