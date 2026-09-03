#!/usr/bin/env bash
# 다른 컴퓨터에 옮겨 설치할 수 있게 확장을 zip 으로 묶는다.
#
#   ./tools/package.sh
#
# 결과: dist/threads-collector-v<버전>.zip
# 압축을 풀면 threads-collector-v<버전>/ 폴더가 나오고, 크롬에서 그 폴더를 그대로 로드하면 된다.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

version="$(python3 -c "import json;print(json.load(open('$root/extension/manifest.json'))['version'])")"
name="threads-collector-v$version"
dist="$root/dist"
stage="$dist/$name"

echo "── 사전 점검"
"$root/tools/check.sh" >/dev/null || { echo "  FAIL check.sh 실패. 패키징 중단."; exit 1; }
echo "  ok   check.sh 통과"

rm -rf "$stage" "$dist/$name.zip"
mkdir -p "$stage"
cp -R "$root/extension/." "$stage/"

# 개발 부산물이 섞여 들어가지 않게
find "$stage" -name '.DS_Store' -delete

( cd "$dist" && zip -qr "$name.zip" "$name" )
rm -rf "$stage"

size="$(du -h "$dist/$name.zip" | cut -f1)"
echo "── 완료"
echo "  $dist/$name.zip ($size)"
echo "  설치 방법은 docs/INSTALL.md 참고"
