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
    '<script type="module" src="popup.js"></script>',
    '<script type="module" src="background.js"></script>\n  <script type="module" src="popup.js"></script>')
assert 'background.js' in html, 'popup.html 의 스크립트 태그가 바뀌었습니다 — serve.sh 를 고치세요'
(d / 'harness.html').write_text(html, encoding='utf-8')

# 결과 페이지도 같은 스텁 위에서 띄운다
r = (d / 'results.html').read_text(encoding='utf-8')
r = r.replace('<link rel="stylesheet" href="results.css" />',
              '<link rel="stylesheet" href="results.css" />\n  <script src="chrome-stub.js"></script>')
r = r.replace('<script type="module" src="results.js"></script>',
              '<script type="module" src="background.js"></script>\n  <script type="module" src="results.js"></script>')
assert 'background.js' in r, 'results.html 의 스크립트 태그가 바뀌었습니다 — serve.sh 를 고치세요'
(d / 'results_harness.html').write_text(r, encoding='utf-8')

# 콘텐츠 스크립트(자동 스크롤 · 정지 조건)를 확인하는 하네스
(d / 'content_harness.html').write_text('''<!doctype html>
<meta charset="utf-8"><title>content.js 하네스</title>
<style>body{font:14px/1.6 system-ui;margin:0}#feed div{height:600px;border-bottom:1px solid #ccc;padding:20px}</style>
<h3 style="position:fixed;top:0;background:#fff;width:100%;margin:0;padding:8px">스크롤 횟수: <b id="n">0</b></h3>
<div id="feed"></div>
<script src="chrome-stub.js"></script>
<script>
  for (let i = 0; i < 40; i++) {
    const d = document.createElement('div');
    d.innerHTML = '<a href="/@seller' + i + '/post/p' + i + '">글 ' + i + '</a>'
      + '<time datetime="2026-09-01T00:00:00Z">1시간</time>'
      + '<p>명란젓 파는 사장인데 무료배송 9,900원 지나가다 하트라도 부탁합니다</p>';
    document.getElementById('feed').appendChild(d);
  }
  window.__scrolls = 0;
  const realScrollBy = window.scrollBy.bind(window);
  window.scrollBy = (opts) => { window.__scrolls++; document.getElementById('n').textContent = window.__scrolls; realScrollBy(opts); };
</script>
<script src="content.js"></script>
''', encoding='utf-8')
PY

echo "팝업:   http://localhost:$port/harness.html"
echo "결과:   http://localhost:$port/results_harness.html"
echo "(Ctrl+C 로 종료)"
cd "$out" && python3 -m http.server "$port"
