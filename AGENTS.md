# AGENTS.md — 쓰레드 레퍼런스 수집기 인수인계 (코덱스용)

이 저장소는 **구매문의 댓글이 달린 판매자 글을 찾아주는 크롬 확장(MV3)** 이다.
너(코덱스)는 사장님(제이슨) 대신 이 repo에서 혼자 작업할 수 있어야 한다.

전체 설명 [README.md](README.md) · 분산 수집 [collector-node/SETUP.md](collector-node/SETUP.md) ·
키워드 [docs/KEYWORDS.md](docs/KEYWORDS.md) · 화면 [docs/USAGE.md](docs/USAGE.md). **작업 전 README를 먼저 읽어라.**

---

## 0. 환경 — 네가 할 수 없는 것부터

- 너는 **집 아이맥(맥)** 에서 돈다. **사장님 폰·매장 윈도우 PC의 파일은 못 건드린다.**
- **스레드(Threads)에 로그인하거나 인증정보를 입력하지 마라.** 금지다. 수집은 사장님이 각 컴퓨터 크롬에 로그인해 둔 세션에서 확장이 직접 한다. 너는 코드·문서·동기화만.
- **비밀값을 커밋하지 마라.** 런타임 디렉터리에 `slack_webhook.txt`, `ghauth.out`, 로그가 있다 — 이 repo가 아니라 `~/threads-collector/`(비-git 런타임)에 있으니 혼동 말 것. 공용 수집 저장소는 **private 유지**.

## 1. repo 두 개 + 런타임 하나

| 경로 | git | 용도 |
|---|---|---|
| `~/projects/threads-collector` | ✅ `sskk22000-dotcom/threads-collector` | **코드(확장)·문서.** 여기서 개발·커밋 |
| `~/threads-collector/shared` | ✅ `sskk22000-dotcom/threads-collected` (private) | 컴퓨터 간 수집분 합류 지점 |
| `~/threads-collector/` | ❌ 비-git | 런타임: `phone_sync.py`, `reference_server.py`, incoming/, 리뷰·키워드 상태 |

## 2. 코드 고칠 때 — 반드시 통과시킬 것

```bash
./tools/check.sh          # manifest 유효성 + 전체 문법 + 회귀테스트 69개 + 키워드문서 최신여부. 하나라도 실패 시 exit 1
python3 tools/gen_keyword_doc.py   # ★ keywords.js를 고쳤으면 반드시 docs/KEYWORDS.md 재생성 (안 하면 check.sh 실패)
./tools/harness/serve.sh  # UI 고칠 때: 크롬 재로드 말고 하네스로. 콘솔에서 await __seed()로 가짜 글 5건 통과
./tools/package.sh        # 배포 zip. check.sh 통과해야만 dist/ 에 생성. 버전은 manifest.json을 따름
```

- 의존성 없음(node 있으면 node, 없으면 JavaScriptCore).
- 소스 구조는 README "구조" 참고. 상태 소유자는 `src/background.js`, DOM 추출·스크롤은 `src/content.js`.

## 3. 사장님이 정한 경계 — 깨지 마라

- **새 키워드는 사용자가 승인(컨펌)하기 전엔 절대 수집에 반영되지 않는다.** 자동 추천은 `pending`에서 멈춘다. 이 흐름(승인 전 멈춤)을 우회하는 코드를 넣지 마라.
- **수집 조건은 원글 기준, 셋 다(댓글≥20·판매자글·좋아요≥100) 봐야** 담는다. 등급(A/B/C)은 저장 안 하고 볼 때마다 재계산 — 이 설계 유지.
- **페이싱(봇 감지 회피)을 함부로 빠르게 하지 마라.** 자동 스크롤 기준 2.5초↑, 조회수 확인은 하나씩 8초↑ 랜덤. 메모리 [[banchanddel-distributed-collect]]의 TUNING 범위 안에서만.

## 4. 분산 수집 (여러 컴퓨터) — [collector-node/SETUP.md](collector-node/SETUP.md) 정본

- **중복 방지(샤딩):** 각 컴퓨터에 `shardId`(집=0, 매장=1, 세번째=2) + 공통 `shardCount`를 크롬 확장 서비스워커 콘솔에서 설정. `hash(이름)%shardCount==shardId`로 계정·검색어를 정적 분할 → 같은 계정 두 번 안 긁음. ⚠️ **shardCount=N이면 N대 다 켜져야 전부 수집.** 일부만 켜면 shardCount를 켜는 대수로 낮춰라.
- **합류:** 각 컴퓨터는 자기 `localhost:8790`에만 수집 → `collector-node/collect_daemon.py`가 10분마다 공용 repo `incoming/<host>/`로 push + `nodes/<host>.json` heartbeat. 집 아이맥이 `collect_pull.sh`로 받는다.
- **early-stop(본글 재스크롤 방지):** 프로필에서 '새글0·기존글만' 스캔이 연속 `staleRotateScans`회면 다음 소스로. 첫 방문만 끝까지, 재방문은 맨 위 새글만.

## 5. 폰 검토앱 동기화 (매일 / 수동)

- 바탕화면 **`반찬뜰 동기화.command`** 더블클릭 → `collect_pull.sh`로 공유분 받고 → Claude가 artifact **글 검토앱**(`ACW9z3o3t22z9GQ6KLsfDM`)의 posts를 덤프 → `python3 ~/threads-collector/phone_sync.py` 가 리뷰 반영·주제필터·중복차단(`synced_keys.json`) 후 신규분만 업로드.
- 사장님이 앱에서 `채택(pick)`한 글의 본문은 `picked_store.json` + `prefs.json`의 `pickedKeywords`로 모여, GitHub에 올라가 확장이 10분마다 pull → **수집 학습에 반영**된다. 이 경로가 "채택 → 수집에 영향" 고리다.
- 자동: launchd `com.banchanddel.refsync`(매일 7:30 `sync_reference.py`), `com.banchanddel.threadscollector`(`reference_server.py` 상주). Claude 예약작업 `banchanddel-phone-sync`, `banchanddel-threads-daily`.
- 검토 기준(어떤 글을 채택/거부)은 [reference_playbook.md](https://github.com/sskk22000-dotcom/threads-collector)가 아니라 런타임 `~/threads-collector/reference_playbook.md` + 메모리 [[banchanddel-thread-playbook]]에 있다.

## 6. 커밋 전

- `./tools/check.sh` 통과 확인. 키워드 고쳤으면 `gen_keyword_doc.py` 돌렸는지 확인.
- 비밀값·수집 데이터·로그는 커밋 금지(`.gitignore` 확인). 공용 저장소 private 유지.
