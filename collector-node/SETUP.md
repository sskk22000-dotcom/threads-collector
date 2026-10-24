# 여러 컴퓨터로 나눠 수집하기 (분산 수집)

Threads 수집은 **봇 감지 회피 때문에 일부러 느리게** 돈다. 더 빨리 모으려면
**컴퓨터(= IP)를 늘리는 게 정답**이다. 한 IP에 여러 계정을 돌리면 차단 위험만 커지고
효과는 금방 한계에 부딪힌다. **IP 1개 = 컴퓨터 1대 = 스레드 계정 1개 = 수집 크롬 1개**가 최적.

## 구조 한눈에

```
[컴퓨터 A: 집 아이맥 (메인)]   shardId=0
   확장 → 127.0.0.1:8790 로컬서버 → ~/threads-collector/incoming/
   phone_sync.py 가 로컬 incoming/ + shared/incoming/*/  전부 읽어 폰앱(Artifact)으로 합침

[컴퓨터 B: 매장 PC 등]         shardId=1
   확장 → 127.0.0.1:8790 로컬서버 → ~/threads-collector/incoming/
   collect_push.sh (10분마다) → 공용 git repo  incoming/<host>/  로 push
                                        │
                              집 아이맥이 collect_pull.sh 로 받아 합침
```

- **중복 방지(샤딩):** 각 컴퓨터에 서로 다른 `shardId`(0,1,2…)와 공통 `shardCount`(컴퓨터 총 대수)를
  설정하면, 계정·검색어를 `hash(이름) % shardCount == shardId` 로 나눠 **자기 몫만** 돈다.
  → 같은 계정을 두 컴퓨터가 동시에 긁지 않는다.
- **데이터 합류:** 각 컴퓨터는 자기 **localhost** 서버에만 쏘므로 네트워크 설정이 필요 없다.
  수집분은 **git**으로만 오간다(집PC는 로컬에서 바로 읽고, 나머지는 push→집PC가 pull).

## 1. 공용 저장소 (최초 1회, 집 아이맥에서)

이미 집 아이맥에 private 저장소 `threads-collected` 가 만들어져 있고
`~/threads-collector/shared` 에 clone 돼 있다. (없으면)

```bash
gh repo create threads-collected --private
git clone https://github.com/sskk22000-dotcom/threads-collected.git ~/threads-collector/shared
cd ~/threads-collector/shared && mkdir -p incoming && touch incoming/.keep && git add -A && git commit -m init && git push -u origin main
```

## 2. 새 컴퓨터 추가 (컴퓨터 B에서)

1. **코드 받기**
   ```bash
   git clone https://github.com/sskk22000-dotcom/threads-collector.git ~/projects/threads-collector
   git clone https://github.com/sskk22000-dotcom/threads-collected.git ~/threads-collector/shared
   ```
2. **확장 설치**: 크롬 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드"
   → `~/projects/threads-collector/extension` 선택. 그 컴퓨터의 **스레드 계정으로 로그인**해 둔다.
3. **로컬 서버 상주**: `python3 ~/threads-collector/reference_server.py` 를 launchd로 띄운다
   (집 아이맥의 `com.banchanddel.threadscollector.plist` 와 동일 방식).
4. **샤드 설정**: 확장 대시보드(또는 콘솔)에서 이 컴퓨터의 몫을 지정한다.
   크롬 확장 서비스워커 콘솔에서:
   ```js
   chrome.storage.local.get('settings', r => {
     const s = r.settings || {};
     s.shardId = 1;      // 컴퓨터마다 다르게: 집=0, 두번째=1, 세번째=2 …
     s.shardCount = 2;   // 전체 컴퓨터 대수 (모든 컴퓨터가 같은 값)
     chrome.storage.local.set({ settings: s }, () => console.log('shard set', s.shardId, '/', s.shardCount));
   });
   ```
   > 집 아이맥(shardId=0)에서도 같은 `shardCount` 로 맞춰 준다.
5. **push 자동화** (10분마다 공용 저장소로 올림):
   - **맥**: `collector-node/com.banchanddel.collectpush.plist` 의 `__USER__` 를 실제 사용자명으로
     바꿔 `~/Library/LaunchAgents/` 에 넣고 `launchctl load`.
   - **윈도우/맥 공용(권장, 매장 PC)**: 파이썬 데몬 하나면 끝.
     ```
     python collect_daemon.py
     ```
     켜두면 10분마다 자동 push. 창을 닫아도 돌게 하려면:
     - 윈도우: 작업 스케줄러(Task Scheduler)에 "로그온 시 시작 / `python ...\collector-node\collect_daemon.py`" 등록.
     - 맥: 위 launchd 사용, 또는 `nohup python3 collect_daemon.py &`.
     > 데몬이 `shared/nodes/<host>.json` 에 heartbeat 를 남겨, 어느 컴퓨터가 살아있는지 서로 보인다.

## 매장 PC(윈도우) 빠른 절차
1. [Git](https://git-scm.com) · [Python](https://python.org) · Chrome 설치.
2. `git clone https://github.com/sskk22000-dotcom/threads-collector.git %USERPROFILE%\projects\threads-collector`
   `git clone https://github.com/sskk22000-dotcom/threads-collected.git %USERPROFILE%\threads-collector\shared`
3. Chrome `chrome://extensions` → 개발자 모드 → 압축해제 로드 → `...\projects\threads-collector\extension`.
   매장용 **스레드 계정으로 로그인**.
4. 로컬 서버 실행: `python %USERPROFILE%\threads-collector\reference_server.py` (계속 켜둠).
5. 확장 서비스워커 콘솔에서 샤드 지정: `shardId=1, shardCount=2` (집 아이맥은 0/2).
6. `python %USERPROFILE%\projects\threads-collector\collector-node\collect_daemon.py` 실행(작업 스케줄러 등록 권장).

## 3. 집 아이맥(메인)에서 합치기

동기화 버튼(`반찬뜰 동기화.command`)이 돌 때 **먼저 공유분을 받아온다**:
```bash
bash ~/projects/threads-collector/collector-node/collect_pull.sh
```
그다음 평소대로 `phone_sync.py` 가 `incoming/` + `shared/incoming/*/` 를 전부 읽어 폰앱으로 올린다.
(영구 중복제거 `synced_keys.json` 이 있어 여러 컴퓨터 글이 겹쳐도 한 번만 올라간다.)

## 주의 (codex 리뷰 반영)
- **shardCount 를 바꾸면** 계정 재배치가 크게 일어난다(대수 변경은 가끔만). 계정 추가/삭제는 재배치 없음.
- **해시·정규화 함수는 모든 컴퓨터가 동일해야** 한다 → 같은 확장 코드를 쓰면 자동 보장.
- 공용 저장소는 **private** 유지. 비밀정보(토큰 등)는 절대 커밋하지 않는다(수집 글만 올라감).
- push 는 `incoming/<host>/` 로 분리 + `pull --rebase` 재시도라 충돌이 거의 없다.
