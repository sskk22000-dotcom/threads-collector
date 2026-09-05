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

  // 글 상세 페이지에서는 URL 의 글만 원글이고 나머지는 전부 답글이다.
  // 쓰레드가 답글에도 글과 똑같은 주소 형식을 주기 때문에 이 구분이 필요하다.
  const PAGE_POST = location.pathname.match(POST_HREF);
  const PAGE_POST_ID = PAGE_POST ? PAGE_POST[2] : null;
  const REPLY_MARK = /(님에게 답글|에게 보내는 답글|답글 대상|Replying to|In reply to)/;
  const UI_NOISE = [
    '답글', '좋아요', '리포스트', '공유', '번역 보기', '더 보기', '더보기',
    '팔로우', '팔로잉', '스레드', 'Translate', 'Reply', 'Repost', 'Share',
    '님이 리포스트함', '님의 스레드', '고정됨', '님에게 답글', 'Replying to'
  ];
  const RELATIVE_TIME = /^\s*\d+\s*(초|분|시간|일|주|개월|년|s|m|h|d|w)\s*$/;

  const sentIds = new Set();
  const matchedIds = new Set();
  let settings = { collecting: false, autoScroll: false, autoScrollDelayMs: 2500, highlight: true, minChars: 10 };
  let accountHandles = new Set();   // 레퍼런스 계정은 짧은 글도 흘려보낸다
  let scanTimer = null;
  let scrollTimer = null;
  let enrichTimer = null;
  let rotateTimer = null;
  let enrichedThisRun = 0;
  let countsModule = null;

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

  /**
   * 글 상세 페이지에서는 DOM 순서로 확실하게 갈린다.
   *   - 페이지 주소의 글보다 "앞"에 있는 항목 = 조상(원글)
   *   - 뒤에 있는 항목 = 그 글에 달린 답글
   * 답글 permalink 를 열면 위에 원글이 먼저 그려지므로 이 규칙이 그대로 통한다.
   *
   * 피드/검색에서는 "…님에게 답글" 표기로만 판단하고, 없으면 판별하지 않는다.
   */
  function classify(entries) {
    const ids = [...entries.keys()];

    if (PAGE_POST_ID && ids.includes(PAGE_POST_ID)) {
      const pivot = ids.indexOf(PAGE_POST_ID);
      const rootId = ids[0];
      const rootUrl = entries.get(rootId).post.url;

      ids.forEach((id, i) => {
        const entry = entries.get(id);
        if (i < pivot) {
          // 페이지 글보다 앞 = 원글 쪽 사슬
          entry.post.type = 'post';
          entry.post.parentId = i > 0 ? rootId : null;
          entry.post.parentUrl = i > 0 ? rootUrl : null;
        } else if (i === pivot) {
          entry.post.type = pivot > 0 ? 'reply' : 'post';
          entry.post.parentId = pivot > 0 ? rootId : null;
          entry.post.parentUrl = pivot > 0 ? rootUrl : null;
        } else {
          entry.post.type = 'reply';
          entry.post.parentId = rootId;
          entry.post.parentUrl = rootUrl;
        }
      });
      return;
    }

    for (const entry of entries.values()) {
      const head = (entry.container.innerText || '').slice(0, 160);
      entry.post.type = REPLY_MARK.test(head) ? 'reply' : 'unknown';
      entry.post.parentId = null;
      entry.post.parentUrl = null;
    }
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

  /**
   * 숫자 문자열을 그대로 넘긴다. 실제 파싱은 background 의 counts.js 가 한다
   * ("1.2만" / "3.4K" / "1,234" 처리를 한 곳에만 두기 위해서).
   */
  function readCountSources(container) {
    const raw = { likes: null, replies: null, reposts: null, views: null };
    const put = (key, value) => { if (value && raw[key] === null) raw[key] = String(value); };

    const keyOf = (label) => {
      if (/조회|view/i.test(label)) return 'views';
      if (/좋아요|like/i.test(label)) return 'likes';
      if (/답글|repl|comment/i.test(label)) return 'replies';
      if (/리포스트|repost/i.test(label)) return 'reposts';
      return null;
    };

    for (const el of container.querySelectorAll('[aria-label], [title]')) {
      const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      const key = keyOf(label);
      if (!key || raw[key] !== null) continue;

      // 레이블 안에 숫자가 있으면 그대로 쓴다 ("좋아요 1,203개")
      if (/\d/.test(label)) { put(key, label); continue; }

      // 쓰레드 피드는 아이콘 옆에 맨숫자만 찍는다. 버튼 주변에서 첫 숫자를 찾는다.
      const near = [el.parentElement, el.parentElement?.parentElement, el.nextElementSibling];
      for (const node of near) {
        const text = node && node.innerText ? node.innerText.trim() : '';
        const m = text.match(/^\s*([\d,.]+\s*[억만천KkMmBb]?)\s*$/) || text.match(/([\d,.]+\s*[억만천KkMmBb]?)/);
        if (m) { put(key, m[1]); break; }
      }
    }

    // 그래도 못 찾으면 본문 텍스트 표기에서 긁는다
    const text = container.innerText || '';
    const grab = (re) => { const m = text.match(re); return m ? m[1] : null; };
    put('views', grab(/조회\s*수?\s*([\d,.]+\s*[억만천KkMmBb]?)/) || grab(/([\d,.]+\s*[KkMmBb]?)\s*views?/i));
    put('likes', grab(/좋아요\s*([\d,.]+\s*[억만천KkMmBb]?)/) || grab(/([\d,.]+\s*[KkMmBb]?)\s*likes?/i));
    put('replies', grab(/답글\s*([\d,.]+\s*[억만천KkMmBb]?)/) || grab(/([\d,.]+\s*[KkMmBb]?)\s*repl/i));
    put('reposts', grab(/리포스트\s*([\d,.]+\s*[억만천KkMmBb]?)/) || grab(/([\d,.]+\s*[KkMmBb]?)\s*reposts?/i));

    return raw;
  }

  /** 본문 이미지. 프로필 사진(작고, 작성자 링크 안에 있음)은 걸러낸다. */
  function readImages(container, author) {
    const out = [];
    for (const img of container.querySelectorAll('img')) {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) continue;

      const alt = img.getAttribute('alt') || '';
      if (/프로필 사진|profile picture|avatar/i.test(alt)) continue;

      const inAuthorLink = img.closest(`a[href*="/@${author}"]`);
      const rect = img.getBoundingClientRect();
      const big = Math.max(rect.width, img.naturalWidth || 0) >= 80;
      if (inAuthorLink && !big) continue;
      if (!big) continue;

      out.push(src);
    }
    return [...new Set(out)].slice(0, 4);
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
      const isReference = accountHandles.has(author.toLowerCase());
      if (!isReference && text.length < (settings.minChars || 10)) continue;

      const timeEl = container.querySelector('time[datetime]');
      byId.set(postId, {
        container,
        post: {
          id: postId,
          author,
          authorUrl: `${location.origin}/@${author}`,
          url: `${location.origin}/@${author}/post/${postId}`,
          text,
          type: 'unknown',
          parentId: null,
          parentUrl: null,
          postedAt: timeEl ? timeEl.getAttribute('datetime') : null,
          countsRaw: readCountSources(container),
          images: readImages(container, author),
          links: externalLinks(container),
          source: location.pathname + location.search
        }
      });
    }

    classify(byId);
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
      if (entry.post.type === 'reply' && settings.collectReplies === false) continue;
      sentIds.add(id);
      posts.push(entry.post);
    }
    if (!posts.length) return;

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

  /**
   * 다음 스크롤까지의 대기 시간. 기준값을 그대로 쓰지 않고 매번 흔든다.
   * 똑같은 간격이 반복되면 사람이 보는 것과 다르게 보이고, 서버에도 규칙적인 부하가 간다.
   */
  function nextScrollDelay() {
    const base = Math.max(1200, settings.autoScrollDelayMs || 2500);
    let delay = base * (0.6 + Math.random() * 1.2);          // 기준의 0.6~1.8배
    if (Math.random() < 0.12) delay += 2500 + Math.random() * 5000;   // 가끔 글을 읽듯 길게 쉼
    return Math.round(delay);
  }

  function humanScrollStep() {
    if (!settings.collecting || !settings.autoScroll) return;

    // 가끔은 살짝 위로 되돌아간다 (놓친 글을 다시 보는 사람의 동작)
    const back = Math.random() < 0.08;
    const ratio = back ? -(0.15 + Math.random() * 0.2) : 0.55 + Math.random() * 0.4;

    window.scrollBy({ top: Math.round(window.innerHeight * ratio), behavior: 'smooth' });
    scheduleScan(900 + Math.round(Math.random() * 800));

    scrollTimer = setTimeout(humanScrollStep, nextScrollDelay());
  }

  function applyAutoScroll() {
    clearTimeout(scrollTimer);
    if (!settings.collecting || !settings.autoScroll) return;
    scrollTimer = setTimeout(humanScrollStep, nextScrollDelay());
  }

  /* ---------------------------------------------------------- 순회 수집 */

  /** 사용자가 뭔가 하고 있으면 페이지를 가로채지 않는다. */
  function userIsBusy() {
    const el = document.activeElement;
    if (el && /^(input|textarea)$/i.test(el.tagName)) return true;
    if (el && el.isContentEditable) return true;
    return Boolean(window.getSelection && String(window.getSelection()));
  }

  function nextRotateDelay() {
    const base = Math.max(20000, settings.rotateDwellMs || 90000);
    return Math.round(base * (0.7 + Math.random() * 0.7));   // 0.7~1.4배
  }

  /**
   * 한 곳에서 충분히 모았으면 다음 소스로 옮긴다.
   * 추천 피드 → 검색어1 → 검색어2 → … → 다시 추천 피드.
   */
  async function rotateStep() {
    if (!settings.collecting || !settings.rotate) return;

    if (userIsBusy()) {                       // 입력 중이면 미루고 다시 기다린다
      rotateTimer = setTimeout(rotateStep, 15000);
      return;
    }

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'ROTATION_NEXT' });
    } catch {
      return;
    }
    if (!res || !res.next) {
      rotateTimer = setTimeout(rotateStep, 30000);
      return;
    }
    location.assign(res.next.url);            // 이동하면 이 스크립트는 새로 뜬다
  }

  function applyRotation() {
    clearTimeout(rotateTimer);
    if (!settings.collecting || !settings.rotate) return;
    rotateTimer = setTimeout(rotateStep, nextRotateDelay());
  }

  /* -------------------------------------------------------- 조회수 보강 */

  // counts.js 는 ES 모듈이라 콘텐츠 스크립트에서 동적으로 불러 쓴다.
  // 숫자 해석 규칙을 한 곳에만 두기 위해서다.
  async function getCounts() {
    if (!countsModule) countsModule = await import(chrome.runtime.getURL('src/counts.js'));
    return countsModule;
  }

  function nextEnrichDelay() {
    const base = Math.max(5000, settings.enrichMinDelayMs || 8000);
    return Math.round(base * (1 + Math.random() * 1.6));   // 기준의 1~2.6배로 흔든다
  }

  /**
   * 큐에서 글을 하나씩 꺼내 상세 페이지를 읽고 조회수를 채운다.
   * 페이지와 같은 출처로 한 번에 하나씩만, 간격도 매번 다르게 요청한다.
   */
  async function enrichStep() {
    if (!settings.collecting) return;
    if (enrichedThisRun >= (settings.enrichMaxPerRun || 40)) return;

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'NEXT_ENRICH' });
    } catch {
      return;   // 확장이 리로드된 경우
    }

    const job = res && res.job;
    if (job) {
      enrichedThisRun += 1;
      let html = '';
      try {
        const response = await fetch(job.url, { credentials: 'include' });
        if (response.ok) html = await response.text();
      } catch { /* 실패해도 확인한 것으로 남긴다 */ }

      try {
        const { extractViewCount, extractOgPost } = await getCounts();
        if (job.kind === 'parent') {
          const og = html ? extractOgPost(html) : { text: null, author: null };
          await chrome.runtime.sendMessage({
            type: 'PARENT_RESULT',
            id: job.id,
            text: og.text,
            author: og.author,
            views: html ? extractViewCount(html) : null
          });
        } else {
          await chrome.runtime.sendMessage({
            type: 'ENRICH_RESULT',
            id: job.id,
            views: html ? extractViewCount(html) : null
          });
        }
      } catch { /* noop */ }
    }

    // 큐가 비어 있으면 느긋하게 다시 확인한다
    enrichTimer = setTimeout(enrichStep, job ? nextEnrichDelay() : 20000);
  }

  function applyEnrich() {
    clearTimeout(enrichTimer);
    if (!settings.collecting) return;
    enrichTimer = setTimeout(enrichStep, 4000 + Math.random() * 4000);
  }

  async function loadSettings() {
    const raw = await chrome.storage.local.get(['settings', 'accounts']);
    settings = { ...settings, ...(raw.settings || {}) };
    accountHandles = new Set((raw.accounts || []).map((a) => String(a.username || '').toLowerCase()));
    applyAutoScroll();
    applyEnrich();
    applyRotation();
    if (!settings.collecting) {
      clearTimeout(scrollTimer);
      clearTimeout(enrichTimer);
      clearTimeout(rotateTimer);
    }
    if (!settings.highlight) clearMarks();
    scheduleScan(200);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings || changes.accounts) loadSettings();
    if (changes.groups || changes.accounts) sentIds.clear();   // 기준이 바뀌면 화면의 글을 다시 판정
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
