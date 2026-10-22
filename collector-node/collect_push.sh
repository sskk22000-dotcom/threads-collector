#!/bin/bash
# ───────────────────────────────────────────────────────────────────
# 분산 수집 — 이 컴퓨터가 모은 수집분(incoming/*.json)을
# 공용 git 저장소의 incoming/<이 컴퓨터 이름>/ 아래로 올린다.
# 집 아이맥(메인)이 이걸 pull 해서 폰 검토앱(Artifact)으로 합친다.
#
# cron/launchd 로 10분마다 돌리면 됨. 집 메인 PC에서는 돌릴 필요 없음(로컬에서 바로 읽음).
# ───────────────────────────────────────────────────────────────────
set -u
DIR="$HOME/threads-collector"
SHARED="$DIR/shared"                  # 공용 저장소 clone 위치
HOST="$(hostname -s | tr -cd 'A-Za-z0-9_-')"
[ -n "$HOST" ] || HOST="node"
DEST="$SHARED/incoming/$HOST"

if [ ! -d "$SHARED/.git" ]; then
  echo "공용 저장소가 없습니다: $SHARED"
  echo "먼저 SETUP.md 대로 'git clone <공용저장소> $SHARED' 하세요."
  exit 1
fi

cd "$SHARED" || exit 1
mkdir -p "$DEST"

# 이 컴퓨터 로컬 수집분을 공용 폴더로 복사(파일명=계정별이라 host 폴더 안에서 안 겹침)
cp "$DIR"/incoming/*.json "$DEST"/ 2>/dev/null

git add -A
if git diff --cached --quiet; then
  echo "변경 없음 — 올릴 것 없음"
  exit 0
fi
git -c user.name="collector-$HOST" -c user.email="collector@banchanddel.local" \
    commit -q -m "collect($HOST): $(date '+%F %T')"

# 동시 push 충돌 대비 — rebase 후 재시도(파일이 host별로 나뉘어 실제 충돌은 거의 없음)
for i in 1 2 3 4 5; do
  git pull --rebase -q origin main 2>/dev/null
  if git push -q origin main 2>/dev/null; then
    echo "push 완료: incoming/$HOST ($(ls "$DEST"/*.json 2>/dev/null | wc -l | tr -d ' ')개 파일)"
    exit 0
  fi
  sleep $((i * 2))
done
echo "push 실패(네트워크/권한 확인). 로컬 커밋은 남아 있으니 다음 번에 다시 올라감."
exit 1
