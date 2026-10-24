/**
 * 인스타그램에서 릴스를 긁어 background 로 넘긴다.
 *
 * 쓰레드 쪽(content.js)과 역할이 같다. 화면에 보이는 것만 추출하고, 거르는 일과
 * 저장은 전부 background 가 한다.
 *
 * 2026-10-24 로그인 상태로 직접 확인한 것:
 *   프로필 릴스 그리드  www.instagram.com/<핸들>/reels/
 *     - 타일은 a[href*="/reel/"] 이고, 그 안의 글자가 조회수 하나뿐이다 ("58.7만")
 *     - 좋아요·댓글은 그리드에 없다
 *   릴스 상세  www.instagram.com/<핸들>/reel/<코드>/
 *     - 본문은 article/section 안 글, 올린 때는 <time datetime>
 *     - 길이는 <video>.duration (실측 63.77초)
 *     - 좋아요·댓글 수는 svg[aria-label="좋아요"] / svg[aria-label="댓글 달기"] 가
 *       들어 있는 섹션의 숫자 두 개 ("6.4천", "1만") — 라벨 글자가 따로 없다
 *   조회수는 상세에 안 나온다. 그래서 그리드에서 먼저 보고 상세로 채운다.
 */

(() => {
  'use strict';

  const REEL_HREF = /\/([^/]+)\/reel\/([A-Za-z0-9_-]+)/;
  const UNITS = [[/억/, 1e8], [/만/, 1e4], [/천/, 1e3], [/[KkK]$/, 1e3], [/[Mm]$/, 1e6]];

  // "58.7만" -> 587000, "1,234" -> 1234. 못 읽으면 null (0 과 구분)
  function parseCount(text) {
    if (text === null || text === undefined) return null;
    const s = String(text).trim();
    const m = s.match(/(\d[\d,.]*)\s*([억만천KkMm]?)/);
    if (!m) return null;
    const num = Number(m[1].replace(/,/g, ''));
    if (!isFinite(num)) return null;
    const u = m[2] ? UNITS.find((x) => x[0].test(m[2])) : null;
    return Math.round(num * (u ? u[1] : 1));
  }

  const sent = new Set();
  let settings = { collecting: false, autoScroll: false, autoScrollDelayMs: 2500 };
  let scanTimer = null, scrollTimer = null, idleScans = 0;

  function send(type, payload) {
    try { chrome.runtime.sendMessage({ type, ...payload }, () => void chrome.runtime.lastError); }
    catch (e) { /* 확장이 리로드되면 조용히 멈춘다 */ }
  }

  /* ---------- 프로필 릴스 그리드 ---------- */
  function scanGrid() {
    const out = [];
    document.querySelectorAll('a[href*="/reel/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(REEL_HREF);
      if (!m) return;
      const acct = m[1], code = m[2];
      if (sent.has(code)) return;
      // 타일 안 글자는 조회수 하나뿐이다. 여러 개면 가장 큰 수를 조회수로 본다 —
      // 인스타가 타일에 좋아요를 같이 띄우는 레이아웃을 쓸 때가 있다.
      const nums = (a.innerText || '').split('\n').map(parseCount).filter((x) => x !== null);
      const views = nums.length ? Math.max.apply(null, nums) : null;
      sent.add(code);
      out.push({ code, acct, views, src: 'grid' });
    });
    return out;
  }

  /* ---------- 릴스 상세 ---------- */
  function sectionWith(label) {
    const svg = document.querySelector('svg[aria-label="' + label + '"]');
    return svg ? svg.closest('section') : null;
  }

  function scanDetail() {
    const m = location.pathname.match(REEL_HREF);
    if (!m) return null;
    const vid = document.querySelector('video');
    const t = document.querySelector('time[datetime]');

    // 좋아요·댓글은 같은 섹션에 숫자 두 개로만 나온다. 왼쪽이 좋아요, 그다음이 댓글이다.
    const bar = sectionWith('좋아요') || sectionWith('댓글 달기');
    let like = null, cmt = null;
    if (bar) {
      const nums = (bar.innerText || '').split('\n').map(parseCount).filter((x) => x !== null);
      if (nums.length >= 2) { like = nums[0]; cmt = nums[1]; }
      else if (nums.length === 1) { like = nums[0]; }
    }

    // 본문: 작성자 핸들로 시작하는 가장 긴 덩어리. 추천·댓글 영역을 피한다.
    let cap = '';
    document.querySelectorAll('h1, span[dir], div[role="button"] span').forEach((el) => {
      const s = (el.innerText || '').trim();
      if (s.length > cap.length && s.length > 40) cap = s;
    });

    // 댓글에 남기라고 한 키워드 — 전환형의 공통점이라 따로 뽑는다
    const kwm = cap.match(/댓글에\s*['"“”']?([^\s'"“”']{1,12})['"“”']?\s*(남겨|적어|달아)/);

    return {
      code: m[2], acct: m[1], like, cmt,
      dur: vid && isFinite(vid.duration) ? Math.round(vid.duration * 10) / 10 : null,
      ts: t ? t.getAttribute('datetime') : null,
      cap: cap || null,
      kw: kwm ? kwm[1] : null,
      src: 'detail'
    };
  }

  /* ---------- 돌리기 ---------- */
  function tick() {
    if (!settings.collecting) return;
    if (/\/reel\//.test(location.pathname) && !/\/reels\/?$/.test(location.pathname)) {
      const d = scanDetail();
      if (d) send('IG_REEL_DETAIL', { reel: d });
      return;
    }
    const rows = scanGrid();
    if (rows.length) { idleScans = 0; send('IG_REELS', { reels: rows }); }
    else idleScans += 1;
  }

  function autoScroll() {
    if (!settings.collecting || !settings.autoScroll) return;
    // 그리드는 창 스크롤로 더 불러온다. 쓰레드 프로필과 달리 내부 컨테이너가 아니다.
    window.scrollBy(0, Math.round(window.innerHeight * 0.8));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'SETTINGS') settings = { ...settings, ...msg.settings };
  });

  send('GET_STATE', {});
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    settings = { ...settings, ...(res.settings || {}) };
  });

  scanTimer = setInterval(tick, 1500);
  scrollTimer = setInterval(autoScroll, 2500);
  new MutationObserver(() => { if (settings.collecting) tick(); })
    .observe(document.body, { childList: true, subtree: true });
})();
