#!/bin/bash
# 집 아이맥(메인)에서 동기화 직전에 실행 — 다른 컴퓨터가 올린 수집분을 받아온다.
# phone_sync.py 가 shared/incoming/<host>/*.json 을 전부 읽어 폰 앱으로 합친다.
set -u
SHARED="$HOME/threads-collector/shared"
[ -d "$SHARED/.git" ] || { echo "공용 저장소 없음: $SHARED (SETUP.md 참고)"; exit 0; }
cd "$SHARED" || exit 0
git pull --rebase -q origin main 2>/dev/null && echo "공유 수집분 pull 완료" || echo "pull 실패(무시하고 로컬분만 동기화)"
