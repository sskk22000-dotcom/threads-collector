#!/usr/bin/env bash
# 크롬에 확장을 설치하지 않고 팝업 + background 를 그대로 브라우저에서 돌려보는 개발용 하네스.
#
#   ./tools/harness/serve.sh          # http://localhost:8731/harness.html
#
# chrome.* API 는 tools/harness/chrome-stub.js 의 인메모리 스텁으로 대체된다.
# 브라우저 콘솔에서 await __seed() 를 호출하면 가짜 글 5건이 수집 파이프라인을 통과한다.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
port="${1:-8731}"
out="$root/.harness"

rm -rf "$out"
mkdir -p "$out"
cp "$root"/extension/src/* "$out/"
cp "$root"/tools/harness/chrome-stub.js "$out/"

python3 - "$out" <<'PY'
import sys, pathlib
d = pathlib.Path(sys.argv[1])
html = (d / 'popup.html').read_text(encoding='utf-8')
html = html.replace(
    '<link rel="stylesheet" href="popup.css" />',
    '<link rel="stylesheet" href="popup.css" />\n  <script src="chrome-stub.js"></script>')
html = html.replace(
    '<script src="popup.js"></script>',
    '<script type="module" src="background.js"></script>\n  <script type="module" src="popup.js"></script>')
(d / 'harness.html').write_text(html, encoding='utf-8')

# 결과 페이지도 같은 스텁 위에서 띄운다
r = (d / 'results.html').read_text(encoding='utf-8')
r = r.replace('<link rel="stylesheet" href="results.css" />',
              '<link rel="stylesheet" href="results.css" />\n  <script src="chrome-stub.js"></script>')
r = r.replace('<script type="module" src="results.js"></script>',
              '<script type="module" src="background.js"></script>\n  <script type="module" src="results.js"></script>')
(d / 'results_harness.html').write_text(r, encoding='utf-8')
PY

echo "팝업:   http://localhost:$port/harness.html"
echo "결과:   http://localhost:$port/results_harness.html"
echo "(Ctrl+C 로 종료)"
cd "$out" && python3 -m http.server "$port"
