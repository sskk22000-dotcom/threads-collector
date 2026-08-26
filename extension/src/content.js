/**
 * threads.com 피드/검색/프로필 페이지에서 글을 긁어 background 로 넘긴다.
 *
 * 키워드 매칭과 저장은 전부 background 에서 한다. 여기서는
 *  - 화면에 보이는 글을 추출하고
 *  - 이미 보낸 글은 다시 안 보내고
 *  - 매칭된 글에 표시를 달아주는 것까지만 한다.
 */

(() => {
  'use strict';

  const POST_HREF = /^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/;
  const UI_NOISE = [
    '답글', '좋아요', '리포스트', '공유', '번역 보기', '더 보기', '더보기',
    '팔로우', '팔로잉', '스레드', 'Translate', 'Reply', 'Repost', 'Share',
    '님이 리포스트함', '님의 스레드', '고정됨'
  ];
  const RELATIVE_TIME = /^\s*\d+\s*(초|분|시간|일|주|개월|년|s|m|h|d|w)\s*$/;

  const sentIds = new Set();
  const matchedIds = new Set();
  let settings = { collecting: false, autoScroll: false, autoScrollDelayMs: 2500, highlight: true, minChars: 10 };
  let scanTimer = null;
  let scrollTimer = null;

  /* ---------------------------------------------------------------- 추출 */

  function postContainer(anchor) {
    const pressable = anchor.closest('[data-pressable-container="true"]');
    if (pressable) return pressable;
    let node = anchor.parentElement;
    let hops = 0;
    while (node && hops < 12) {
      if (node.querySelector('time') && (node.innerText || '').length > 20) return node;
      node = node.parentElement;
      hops += 1;
    }
    return null;
  }

  function cleanText(container, author) {
    const lines = (container.innerText || '').split('\n');
    const kept = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line === author) continue;
      if (RELATIVE_TIME.test(line)) continue;
      if (/^\d[\d,.]*[KkMm만천]?$/.test(line)) continue;      // 좋아요/답글 카운트
      if (UI_NOISE.some((n) => line === n || line.endsWith(n))) continue;
      kept.push(line);
    }
    return kept.join('\n').trim();
  }

  function readCounts(container) {
    const counts = { likes: null, replies: null, reposts: null };
    for (const el of container.querySelectorAll('[aria-label]')) {
      const label = el.getAttribute('aria-label') || '';
      const num = (label.match(/([\d,]+)/) || [])[1];
      if (!num) continue;
      const value = Number(num.replace(/,/g, ''));
      if (/좋아요|like/i.test(label) && counts.likes === null) counts.likes = value;
      else if (/답글|repl/i.test(label) && counts.replies === null) counts.replies = value;
      else if (/리포스트|repost/i.test(label) && counts.reposts === null) counts.reposts = value;
    }
    return counts;
  }

  function externalLinks(container) {
    const out = [];
    for (const a of container.querySelectorAll('a[href^="http"]')) {
      try {
        const u = new URL(a.href);
        if (/threads\.(com|net)$/.test(u.hostname) || /instagram\.com$/.test(u.hostname)) continue;
        out.push(a.href);
      } catch { /* noop */ }
    }
    return [...new Set(out)].slice(0, 5);
  }

  function extractVisiblePosts() {
    const byId = new Map();

    for (const anchor of document.querySelectorAll('a[href*="/post/"]')) {
      let path;
      try {
        path = new URL(anchor.href, location.origin).pathname;
      } catch { continue; }
      const m = path.match(POST_HREF);
      if (!m) continue;

      const author = m[1];
      const postId = m[2];
      if (sentIds.has(postId)) continue;

      const container = postContainer(anchor);
      if (!container) continue;

      // 같은 글의 여러 앵커 중 가장 작은 컨테이너를 쓴다
      const prev = byId.get(postId);
      if (prev && prev.container.contains(container) === false) continue;

      const text = cleanText(container, author);
      if (text.length < (settings.minChars || 10)) continue;

      const timeEl = container.querySelector('time[datetime]');
      byId.set(postId, {
        container,
        post: {
          id: postId,
          author,
          authorUrl: `${location.origin}/@${author}`,
          url: `${location.origin}/@${author}/post/${postId}`,
          text,
          postedAt: timeEl ? timeEl.getAttribute('datetime') : null,
          counts: readCounts(container),
          links: externalLinks(container),
          source: location.pathname + location.search
        }
      });
    }
    return byId;
  }

  /* ---------------------------------------------------------------- 표시 */

  function mark(container, hits) {
    if (!settings.highlight) return;
    if (container.querySelector(':scope > .trc-badge')) return;
    const badge = document.createElement('div');
    badge.className = 'trc-badge';
    badge.textContent = `수집됨 · ${hits.map((h) => h.keyword).slice(0, 3).join(', ')}`;
    container.classList.add('trc-hit');
    container.prepend(badge);
  }

  function clearMarks() {
    document.querySelectorAll('.trc-badge').forEach((el) => el.remove());
    document.querySelectorAll('.trc-hit').forEach((el) => el.classList.remove('trc-hit'));
  }

  /* ---------------------------------------------------------------- 루프 */

  async function scan() {
    if (!settings.collecting) return;
    const found = extractVisiblePosts();
    if (!found.size) return;

    const posts = [];
    for (const [id, entry] of found) {
      sentIds.add(id);
      posts.push(entry.post);
    }

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'POSTS', posts });
    } catch {
      return;   // 확장 리로드 등으로 채널이 끊긴 경우
    }
    if (!res || !res.matched) return;

    for (const m of res.matched) {
      matchedIds.add(m.id);
      const entry = found.get(m.id);
      if (entry) mark(entry.container, m.hits);
    }
  }

  function scheduleScan(delay = 400) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, delay);
  }

  function applyAutoScroll() {
    clearInterval(scrollTimer);
    if (!settings.collecting || !settings.autoScroll) return;
    scrollTimer = setInterval(() => {
      window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: 'smooth' });
      scheduleScan(1200);
    }, Math.max(1000, settings.autoScrollDelayMs || 2500));
  }

  async function loadSettings() {
    const raw = await chrome.storage.local.get('settings');
    settings = { ...settings, ...(raw.settings || {}) };
    applyAutoScroll();
    if (!settings.collecting) clearInterval(scrollTimer);
    if (!settings.highlight) clearMarks();
    scheduleScan(200);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) loadSettings();
    if (changes.groups) sentIds.clear();      // 키워드가 바뀌면 화면의 글을 다시 판정
  });

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', () => scheduleScan(600), { passive: true });

  // SPA 라우팅 감지
  let lastPath = location.pathname + location.search;
  setInterval(() => {
    const now = location.pathname + location.search;
    if (now !== lastPath) {
      lastPath = now;
      sentIds.clear();
      scheduleScan(800);
    }
  }, 1000);

  loadSettings();
})();
