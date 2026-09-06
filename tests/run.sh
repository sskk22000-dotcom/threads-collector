#!/usr/bin/env bash
# 의존성 없는 테스트 러너.
#   - node 가 있으면 node 로 실행
#   - 없으면 macOS 기본 JavaScriptCore(osascript -l JavaScript)로 실행
# ES 모듈 문법(export)만 걷어내고 소스를 그대로 이어붙여 검증한다.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/extension/src"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

bundle="$tmp/bundle.js"
{
  for f in keywords.js matcher.js suggest.js accounts.js counts.js seller.js rules.js; do
    sed -E 's/^export (default )?//; /^import .*from .*;$/d' "$src/$f"
  done
  cat "$root/tests/matcher.test.js"
} > "$bundle"

if command -v node >/dev/null 2>&1; then
  output="$(node "$bundle" 2>&1)"
else
  output="$(osascript -l JavaScript "$bundle" 2>&1)"
fi

echo "$output"
if grep -q "FAIL" <<<"$output"; then
  exit 1
fi
