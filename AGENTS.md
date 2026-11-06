# AGENTS.md — 쓰레드 레퍼런스 수집기 인수인계 (코덱스용)

이 저장소는 **구매문의 댓글이 달린 판매자 글을 찾아주는 크롬 확장(MV3)** 이다.
너(코덱스)는 사장님(제이슨) 대신 이 repo에서 혼자 작업할 수 있어야 한다.

**▶ 이어서 할 작업은 [docs/코덱스-이어하기.md](docs/코덱스-이어하기.md)를 먼저 봐라 (작업명·현재상태·다음 할 일).**

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
./tools/check.sh          # manifest 유효성 + 전체 소스 문법 + 회귀 테스트. 하나라도 실패 시 exit 1
python3 tools/gen_keyword_doc.py   # keywords.js를 고쳤으면 docs/KEYWORDS.md 재생성 (check.sh가 직접 재생성하니 커밋 전 돌려 diff 확인)
./tools/harness/serve.sh  # UI 고칠 때: 크롬 재로드 말고 하네스로. ⚠️ await __seed()는 127.0.0.1:8790/store로 POST하니, 로컬 수집 서버가 떠 있으면 운영 데이터에 섞일 수 있다 — 서버 끄고 돌려라
./tools/package.sh        # 배포 zip. check.sh 통과해야만 dist/ 에 생성. 버전은 manifest.json을 따름
```

- 의존성 없음(node 있으면 node, 없으면 JavaScriptCore). ⚠️ JavaScriptCore 대체 경로는 여러 줄 `import`를 못 지워 문법검사가 깨질 수 있으니 되도록 node로 돌려라.
- 소스는 **`extension/src/`** 밑이다(루트에 `src/` 없음). 상태 소유자 `extension/src/background.js`, DOM 추출·스크롤 `extension/src/content.js`, manifest는 `extension/manifest.json`.

## 3. 사장님이 정한 경계 — 깨지 마라

- **새 키워드는 사용자가 승인(컨펌)하기 전엔 절대 수집에 반영되지 않는다.** 자동 추천은 `pending`에서 멈춘다. 이 흐름을 우회하는 코드를 넣지 마라. ⚠️ 단 레퍼런스 **계정**은 다르다 — 기본값 `autoDiscoverRef: true`(storage.js)라 조건 맞는 글이 여러 개인 계정을 **승인 없이 자동 추가**한다(끄려면 설정/계정별 토글). 승인 필수는 **키워드**에 한한다.
- **수집 조건의 정책 기준**은 원글·댓글≥20·판매자글·좋아요≥100(README). 단 **기본값 `adaptiveGate: true`** 라 예열 중엔 좋아요≥30 **또는** 댓글≥5로도 통과하는 등 런타임 동작이 다르다 — 기준을 바꾸려면 `extension/src/storage.js` 기본값 + background 판정 로직을 함께 봐라. 등급(A/B/C)은 저장 안 하고 볼 때마다 재계산.
- **페이싱(봇 감지 회피)을 함부로 빠르게 하지 마라.** 자동 스크롤 기준 2.5초↑, 조회수 확인은 하나씩 8초↑ 랜덤. 메모리 [[banchanddel-distributed-collect]]의 TUNING 범위 안에서만.

## 4. 분산 수집 (여러 컴퓨터) — [collector-node/SETUP.md](collector-node/SETUP.md) 정본

- **중복 방지(샤딩):** 각 컴퓨터에 `shardId`(집=0, 매장=1, 세번째=2) + 공통 `shardCount`를 크롬 확장 서비스워커 콘솔에서 설정. `hash(이름)%shardCount==shardId`로 계정·검색어를 정적 분할 → 같은 계정 두 번 안 긁음. ⚠️ **shardCount=N이면 N대 다 켜져야 전부 수집.** 일부만 켤 땐 shardCount를 켜는 대수로 낮추고 **shardId를 반드시 0..N-1로 연속 재배정**해라 — 집(0)+세번째(2)에 shardCount=2만 주면 둘 다 shard 0이 돼 중복·누락이 난다.
- **합류:** 각 컴퓨터는 자기 `localhost:8790`에만 수집 → `collector-node/collect_daemon.py`가 10분마다 공용 repo `incoming/<host>/`로 push + `nodes/<host>.json` heartbeat. 집 아이맥이 `collect_pull.sh`로 받는다.
- **early-stop(본글 재스크롤 방지):** 프로필에서 '새글0·기존글만' 스캔이 연속 `staleRotateScans`회면 다음 소스로. 첫 방문만 끝까지, 재방문은 맨 위 새글만.

## 5. 폰 검토앱 동기화 (매일 / 수동)

- 바탕화면 **`반찬뜰 동기화.command`** 더블클릭 → `collect_pull.sh`로 공유분 받고 → Claude가 artifact **글 검토앱**(`ACW9z3o3t22z9GQ6KLsfDM`)의 posts를 덤프 → `python3 ~/threads-collector/phone_sync.py` 가 리뷰 반영·주제필터·중복차단(`synced_keys.json`) 후 신규분만 업로드.
- 사장님이 앱에서 `채택(pick)`한 글의 본문은 `picked_store.json` + `prefs.json`의 `pickedKeywords`로 모여 **수집 학습에 반영**된다("채택 → 수집에 영향" 고리). 반영 경로: (GitHub 경유) 각 컴퓨터 로컬 서버의 `/prefs` → 확장이 수집 처리 중 10분 경과를 확인해 당겨감(독립 타이머 아님). GitHub→로컬 서버 구간은 외부 운영이라 이 repo만으로는 확인 불가.
- 자동: launchd `com.banchanddel.refsync`(매일 7:30 `sync_reference.py`), `com.banchanddel.threadscollector`(`reference_server.py` 상주). Claude 예약작업 `banchanddel-phone-sync`, `banchanddel-threads-daily`.
- 검토 기준(어떤 글을 채택/거부)은 [reference_playbook.md](https://github.com/sskk22000-dotcom/threads-collector)가 아니라 런타임 `~/threads-collector/reference_playbook.md` + 메모리 [[banchanddel-thread-playbook]]에 있다.

## 6. 커밋 전

- `./tools/check.sh` 통과 확인. 키워드 고쳤으면 `gen_keyword_doc.py` 돌렸는지 확인.
- 비밀값·수집 데이터·로그는 커밋 금지(`.gitignore` 확인). 공용 저장소 private 유지.
