# VocabFlip

Anki 방식(active recall + 망각 곡선 기반 간격 반복)으로 BNC/COCA 고빈도 3,000단어를 익히는 로컬 웹앱.

## 실행
`index.html`을 브라우저(Chrome/Edge 권장)로 열면 된다. 데이터가 `.js` 파일이라 `file://`로도 동작한다.
로컬 서버가 편하면: `python3 -m http.server 8000` → http://127.0.0.1:8000

## 배포 (모바일·외부 접속)
claude.ai Artifact(비공개): https://claude.ai/artifact/P3mSq6xsAjR4svxpn8BaVi — 남에게 보이려면 페이지 Share 메뉴에서 공유.
갱신: `python3 -I tools/build_artifact.py` → `dist/index.html`을 같은 링크로 재게시(`data/*.js`, `js/*.js`는 files로 함께).
학습 기록은 기기별 저장이라 기기 간 이동은 설정 탭 "백업 복사" → 다른 기기에 붙여넣기.

## 사내망 PoC 서버 (계정 공유)
GitHub Pages 버전의 계정은 그 브라우저에만 저장된다. 같은 사내망의 여러 기기에서 같은 계정을 쓰려면
이 PC에서 앱과 계정 API를 함께 띄운다(Python 표준 라이브러리만 사용, 포트 하나).

```bash
nohup python3 -u tools/serve_lan.py --host 0.0.0.0 --port 8000 > lan-data/server.log 2>&1 &
# 접속: http://<이 PC의 사내 IP>:8000/   (PC를 재부팅하면 다시 실행)
```

- 계정·학습 기록은 `lan-data/vocabflip.sqlite3`(git 제외)에 저장, 비밀번호는 PBKDF2 해시
- 앱에 필요한 파일만 제공하고 `.git`·설정·DB 파일은 404
- http 연결이라 암호화되지 않는다. 다른 곳에서 쓰는 비밀번호는 쓰지 말 것

## 폰트
국방과학연구소체(ADD Font, add.re.kr) Regular/ExtraBold → `fonts/*.woff2`. 지식재산권은 국방과학연구소, 글꼴 판매 금지,
장평·기울기·두께 변형 금지(그래서 이탤릭 없음·`font-synthesis: none`). 임베딩 문의: (주)투게더그룹. IPA 기호는 폰트에 없어 별도 글꼴로 표시.

## 기능
| 탭 | 내용 |
|---|---|
| 학습 | 앞면은 단어만 보여준다 → 정답 보기 → 뜻 · 문장(예문 듣기) · 뉘앙스 · 이렇게도 쓰인다. 다시/어려움/알맞음/쉬움으로 평가하면 SM-2로 다음 복습일을 잡는다 |
| 탐색 | 단어·뜻 검색, 카드 상태와 다음 복습일 |
| 통계 | 오늘 학습량, 정답률, 장기 기억 카드 수, 14일 복습 예정 |
| 텅 트위스터 | 588개, 듣기·천천히 듣기·속도 조절, 미국식 발음 기호 보기 |
| 발음 기호 | 단어를 입력하면 미국식 IPA, 발음 듣기, 복사용 코드 블록을 보여준다. 기호를 누르면 그 소리가 들어간 고빈도 단어 15개를 보여준다 |

단축키(학습): `Space`/`Enter` 정답 보기 → 알맞음, `1`~`4` 평가, `r` 다시 듣기.

## 데이터 출처
- 단어 목록: BNC/COCA word family lists v2.0.0 (Paul Nation, eapfoundation.com). 1k~3k 사용
- 발음: CMU Pronouncing Dictionary(미국 영어) → `tools/ipa.py`로 IPA 변환
- 텅 트위스터: tongue-twister.net/en.htm © Mr.Twister
- 한국어 뜻·예문·뉘앙스: `gen/PROMPT.md` 규격으로 Claude가 생성(`gen/out/`), `tools/merge_content.py`로 검증·병합
- 음성: 브라우저 내장 Web Speech API(en-US)

## 재빌드
```bash
uv run --with openpyxl python -I tools/build_data.py   # raw/ → data/*.js, gen/in/
python3 -I tools/merge_content.py                       # gen/out/ → data/content.js
```

## 테스트
```bash
cd tools && python3 -m pytest -q                      # Unit(IPA) + Schema(콘텐츠)
node --test tests/*.test.js                     # Unit(SRS 스케줄러)
```

## 기여하기
뜻·예문이 어색하면 **콘텐츠 오류 제보** 이슈를 열거나 `gen/out/*.json`을 고쳐 PR을 보내 주세요.
자세한 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다.

## 라이선스
- 코드: [MIT](LICENSE)
- 한국어 카드 콘텐츠(`gen/out/`, `data/content.js`): [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- 발음(CMUdict), 단어 목록(BNC/COCA), 텅 트위스터, 국방과학연구소체 폰트는 각 원저작자의 조건을 따릅니다. 자세한 내용은 [LICENSE](LICENSE) 하단에 있습니다.
