# -*- coding: utf-8 -*-
"""
분산 수집 노드 데몬 (윈도우·맥 공용).
집 메인이 아닌 컴퓨터(예: 매장 PC)에서 돌린다:
  python collect_daemon.py

하는 일(기본 10분마다 반복):
  1) 이 컴퓨터가 수집한 ~/threads-collector/incoming/*.json 을
     공용 git 저장소의 incoming/<이 컴퓨터 이름>/ 로 복사
  2) heartbeat(shared/nodes/<host>.json) 기록 → 다른 컴퓨터가 "누가 살아있나" 볼 수 있음
  3) git pull --rebase 후 push (충돌 시 재시도). 집 메인이 pull 해서 폰앱으로 합침.

네트워크 설정 불필요 — 각 컴퓨터는 자기 localhost 서버에만 수집하고, 오직 git 으로만 합류.
중복 방지: 계정/검색어는 확장에서 shardId/shardCount 해시로 이미 나눠 돌므로 서로 겹치지 않고,
혹시 겹쳐도 집 메인의 synced_keys 가 같은 글을 한 번만 올린다.
"""
import os, sys, time, shutil, subprocess, socket, json, glob, datetime

HOME = os.path.expanduser("~")
DIR = os.path.join(HOME, "threads-collector")
SHARED = os.path.join(DIR, "shared")
INTERVAL = int(os.environ.get("COLLECT_INTERVAL", "600"))  # 초

def host():
    h = socket.gethostname().split(".")[0]
    return "".join(c for c in h if c.isalnum() or c in "-_") or "node"

def git(*args, check=False):
    return subprocess.run(["git", "-C", SHARED, *args],
                          capture_output=True, text=True, check=check)

def push_once():
    if not os.path.isdir(os.path.join(SHARED, ".git")):
        print("공용 저장소 없음:", SHARED, "— SETUP.md 대로 clone 하세요.", flush=True)
        return False
    H = host()
    dest = os.path.join(SHARED, "incoming", H)
    os.makedirs(dest, exist_ok=True)
    # 로컬 수집분 복사(계정별 파일이라 host 폴더 안에서 안 겹침)
    n = 0
    for f in glob.glob(os.path.join(DIR, "incoming", "*.json")):
        try:
            shutil.copy2(f, os.path.join(dest, os.path.basename(f))); n += 1
        except Exception:
            pass
    # heartbeat — 누가 어떤 샤드로 살아있는지
    try:
        os.makedirs(os.path.join(SHARED, "nodes"), exist_ok=True)
        json.dump({"host": H, "at": datetime.datetime.now().isoformat(), "files": n},
                  open(os.path.join(SHARED, "nodes", H + ".json"), "w", encoding="utf-8"),
                  ensure_ascii=False)
    except Exception:
        pass
    git("add", "-A")
    if git("diff", "--cached", "--quiet").returncode == 0:
        print(ts(), "변경 없음", flush=True); return True
    git("-c", "user.name=collector-" + H, "-c", "user.email=collector@banchanddel.local",
        "commit", "-q", "-m", "collect(%s): %s" % (H, ts()))
    for i in range(1, 6):
        git("pull", "--rebase", "-q", "origin", "main")
        if git("push", "-q", "origin", "main").returncode == 0:
            print(ts(), "push 완료:", "incoming/%s (%d개)" % (H, n), flush=True); return True
        time.sleep(i * 2)
    print(ts(), "push 실패 — 다음 주기에 재시도(로컬 커밋 보존됨)", flush=True); return False

def ts():
    return datetime.datetime.now().strftime("%F %T")

def main():
    once = "--once" in sys.argv
    print(ts(), "분산 수집 데몬 시작 — host=%s, interval=%ds, once=%s" % (host(), INTERVAL, once), flush=True)
    while True:
        try: push_once()
        except Exception as e: print(ts(), "오류:", e, flush=True)
        if once: break
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
