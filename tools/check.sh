#!/usr/bin/env bash
# 의존성 없는 사전 점검: manifest JSON 유효성 + 모든 소스 문법 검사 + 회귀 테스트.
#   ./tools/check.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
status=0

echo "── manifest.json"
if python3 -c "import json,sys; json.load(open('$root/extension/manifest.json'))"; then
  echo "  ok   유효한 JSON"
else
  echo "  FAIL manifest.json 파싱 실패"; status=1
fi

echo "── 문법 검사"
for f in "$root"/extension/src/*.js; do
  sed -E 's/^export (default )?//; /^import .*from .*;$/d' "$f" > "$tmp/x.js"
  python3 - "$tmp/x.js" "$tmp/check.js" <<'PY'
import sys, io, json
src = io.open(sys.argv[1], encoding='utf-8').read()
io.open(sys.argv[2], 'w', encoding='utf-8').write(
    "try { new Function(%s); 'ok' } catch (e) { 'FAIL ' + e.message }" % json.dumps(src))
PY
  if command -v node >/dev/null 2>&1; then
    result="$(node --check "$tmp/x.js" >/dev/null 2>&1 && echo ok || echo 'FAIL 문법 오류')"
  else
    result="$(osascript -l JavaScript "$tmp/check.js" 2>&1)"
  fi
  printf "  %-4s %s\n" "$result" "$(basename "$f")"
  [[ "$result" == ok ]] || status=1
done

echo "── 회귀 테스트"
"$root/tests/run.sh" | sed 's/^/  /' || status=1

echo "── 키워드 문서 최신 여부"
before="$(shasum "$root/docs/KEYWORDS.md" | cut -d' ' -f1)"
python3 "$root/tools/gen_keyword_doc.py" >/dev/null
after="$(shasum "$root/docs/KEYWORDS.md" | cut -d' ' -f1)"
if [[ "$before" == "$after" ]]; then echo "  ok   docs/KEYWORDS.md 최신"; else echo "  갱신됨 docs/KEYWORDS.md 재생성함 (커밋 필요)"; fi

exit $status
