/** 상태의 단일 소유자. 매칭 · 저장 · 추천 · 내보내기를 전부 여기서 처리한다. */

import { KEYS, DEFAULT_SETTINGS, DEFAULT_STATS, DEFAULT_VIEW_FILTERS, getAll, set, ensureSeeded } from './storage.js';
import { matchKeywords, snippetAround, isKorean } from './matcher.js';
import { suggestKeywords } from './suggest.js';
import { ACCOUNT_GROUP, OWN_GROUP, findAccount, normalizeHandle, normalizeSearchTerm, searchUrl, profileUrl, accountKind, groupForAccount, accountPriority } from './accounts.js';
import { parseCount, shouldCollect } from './counts.js';
import { decideCollect, SKIP_REPLY } from './rules.js';

const CORPUS_MAX = 400;
const KIND_LABEL = { post: '글', reply: '답글', unknown: '판별 불가' };
const CUSTOM_GROUP = {
  id: 'custom',
  label: '내가 추가한 키워드',
  description: '팝업에서 직접 추가했거나, 추천 후보 중 승인한 키워드.',
  status: 'approved',
  origin: 'user',
  keywords: []
};

// 처음 설치/실행 시 채워둘 계정 목록. 내 계정 3개 + 레퍼런스 13개.
const SEED_OWN = ['banchanddel', 'gomtangkwak', 'jason_chef_suh'];
const SEED_REFERENCE = [
  'hello_cafe_bloom', 'oh_badahae', 'kangyuneun', 'uncle_woo_curry', 'shigol_jeotgal',
  '7c_rice', 'fruit_matjip', 'apple_ljk', '2harmony_sikhye', 'greemeet.kr',
  'masigguma__', 'jieun_tomato', 'fresh.famer'
];

// 시드 버전. 올리면(빠진 기본 계정 보충) 한 번 병합이 다시 돈다.
const SEED_VERSION = 2;

function makeSeedAccount(username, kind) {
  return {
    username: normalizeHandle(username),
    kind,
    note: '',
    collectAll: true,
    priority: kind === 'own' ? 2 : 1,
    visits: 0,
    lastVisitedAt: null,
    addedAt: new Date().toISOString()
  };
}

/**
 * 기본 계정(내 계정 3 + 레퍼런스 13)을 채운다.
 *   - 계정이 아예 없으면: 전부 시드.
 *   - 이미 있으면: 사용자 계정은 그대로 두고, 빠진 기본 계정만 보충(시드 버전당 1회).
 */
async function ensureAccountsSeeded() {
  const raw = await chrome.storage.local.get([KEYS.ACCOUNTS, 'seededVersion']);
  const existing = raw[KEYS.ACCOUNTS];
  const defaults = [
    ...SEED_OWN.map((u) => makeSeedAccount(u, 'own')),
    ...SEED_REFERENCE.map((u) => makeSeedAccount(u, 'reference'))
  ].filter((a) => a.username);

  if (existing === undefined) {
    await set({ [KEYS.ACCOUNTS]: defaults, seededVersion: SEED_VERSION });
    return;
  }
  if (raw.seededVersion === SEED_VERSION) return;   // 이미 이 버전 시드를 반영함

  const have = new Set(existing.map((a) => normalizeHandle(a.username)));
  const merged = [...existing];
  for (const d of defaults) if (!have.has(d.username)) merged.push(d);
  await set({ [KEYS.ACCOUNTS]: merged, seededVersion: SEED_VERSION });
}

// 사람처럼 안 걸리게 도는 기준값을 한 번만 자동 적용한다(사용자가 손 안 대도 되게).
// 불규칙(0.6~1.8배, 가끔 길게 쉼)은 content.js 가 매 동작마다 흔든다. 여기선 기준값만 정한다.
const TUNING_VERSION = 2;
async function applyRecommendedTuning() {
  const raw = await chrome.storage.local.get([KEYS.SETTINGS, 'tuningVersion']);
  if (raw.tuningVersion === TUNING_VERSION) return;
  const cur = { ...DEFAULT_SETTINGS, ...(raw[KEYS.SETTINGS] || {}) };
  const tuned = {
    ...cur,
    autoScroll: true,
    autoScrollDelayMs: 4000,        // 실제 2.4~7.2초 간격 + 가끔 더 길게 쉼
    rotate: true,
    rotateAccounts: true,
    rotateFeed: true,
    accountPasses: 3,
    rotateRandomWhenDone: true,
    rotateDwellMs: 110000,          // 한 곳에 77~154초 머무름
    collectReplies: true,           // 답글은 원글 찾는 신호로만 사용
    postsOnly: true,                // 실제 저장은 원글만
    koreanOnly: true,
    enrichViews: true,              // 조회수 확인(반응 기준 표본 학습에 필요)
    // 반응 좋은 글만 자동 수집 — 조회 1만~3만 평균 학습 기준
    adaptiveGate: true,
    adaptiveViewMin: 10000,
    adaptiveViewMax: 30000
  };
  await set({ [KEYS.SETTINGS]: tuned, tuningVersion: TUNING_VERSION });
}

// 업데이트/로드 시 지금까지 수집한 글 전체를 로컬 서버로 한 번 밀어 폰 앱과 맞춘다.
// (서버가 url/code로 중복 제거하므로 여러 번 돌아도 안전)
async function bulkSyncToServer() {
  try {
    const posts = (await chrome.storage.local.get(KEYS.POSTS))[KEYS.POSTS] || [];
    if (!posts.length) return;
    const byAcct = {};
    for (const p of posts) {
      if (p.pending || !(p.text || '').trim()) continue;
      const h = normalizeHandle(p.author) || p.author || 'unknown';
      (byAcct[h] = byAcct[h] || []).push({
        account: h, body: p.text,
        like: p.counts?.likes ?? null, reply: p.counts?.replies ?? null, repost: p.counts?.reposts ?? null,
        share: null, url: p.url, date: p.postedAt || null, thumb: ''
      });
    }
    for (const [h, items] of Object.entries(byAcct)) postReference(h, items);
  } catch (_) { /* 서버 꺼져 있어도 수집엔 영향 없음 */ }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSeeded();
  ensureAccountsSeeded();
  applyRecommendedTuning();
  setTimeout(bulkSyncToServer, 3000);
});
chrome.runtime.onStartup?.addListener?.(() => { setTimeout(bulkSyncToServer, 3000); });
chrome.runtime.onStartup?.addListener?.(() => {
  ensureAccountsSeeded();
  applyRecommendedTuning();
});

/* ------------------------------------------------------------------ 유틸 */

async function updateBadge(count) {
  const text = count > 999 ? '999+' : count ? String(count) : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: '#007aff' });
}

function ensureCustomGroup(groups) {
  if (!groups.some((g) => g.id === 'custom')) groups.push({ ...CUSTOM_GROUP, keywords: [] });
  return groups;
}

/* ------------------------------------------------- 반응 기준 자동학습 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 본문 정규화 — 공백 접어서 같은 내용 판별(중복글 제거용). */
const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// 레퍼런스 글을 로컬 수신서버로 보내 슬랙 daily 풀(reference_pool)로 흘려보낸다.
// (서비스워커 fetch + host_permissions 127.0.0.1 사용 → 페이지 CSP 영향 없음)
const REF_SERVER = 'http://127.0.0.1:8790/store';
const REVIEW_SERVER = 'http://127.0.0.1:8790/review';
function postReview(url, review, post) {
  if (!url) return;
  try {
    const body = { url, review };
    if (review === 'pick' && post) body.post = post;   // 채택이면 원본(사진 포함) 같이 보냄
    fetch(REVIEW_SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(() => {});
  } catch (_) { /* noop */ }
}
function postReference(handle, items) {
  if (!handle || !Array.isArray(items) || !items.length) return;
  try {
    fetch(REF_SERVER + '?acct=' + encodeURIComponent(handle), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items)
    }).catch(() => {});   // 서버가 꺼져 있어도 수집엔 영향 없음
  } catch (_) { /* noop */ }
}

/** 자동발굴로 레퍼런스에 넣을 계정 레코드. */
function makeDiscoveredAccount(handle) {
  return {
    username: handle,
    kind: 'reference',
    note: '자동발굴',
    auto: true,
    collectAll: false,
    priority: 1,
    visits: 0,
    lastVisitedAt: null,
    addedAt: new Date().toISOString()
  };
}

/** 조회수가 표본 구간(1만~3만)이면 그 글의 좋아요·댓글·리포를 표본에 더한다. */
function addBench(bench, counts, settings) {
  const views = num(counts && counts.views);
  if (views === null) return false;
  const lo = Number(settings.adaptiveViewMin) || 10000;
  const hi = Number(settings.adaptiveViewMax) || 30000;
  if (views < lo || views > hi) return false;
  bench.n = (bench.n || 0) + 1;
  bench.likes = (bench.likes || 0) + (num(counts.likes) || 0);
  bench.replies = (bench.replies || 0) + (num(counts.replies) || 0);
  bench.reposts = (bench.reposts || 0) + (num(counts.reposts) || 0);
  return true;
}

/**
 * 반응 기준으로 이 원글을 담을지 판단한다.
 *  - 표본이 충분하면: 좋아요·댓글·리포 3개 중 N개가 학습 평균 이상이면 담는다.
 *  - 표본 예열 중이면: 임시 하한(좋아요/댓글)만 넘으면 담아 표본을 모은다.
 */
function adaptiveDecision(counts, settings, bench) {
  const n = (bench && bench.n) || 0;
  const minS = Number(settings.adaptiveMinSamples) || 6;
  const likes = num(counts.likes);
  const replies = num(counts.replies);
  const reposts = num(counts.reposts);

  if (n < minS) {
    const okL = (likes || 0) >= (Number(settings.coldStartMinLikes) || 30);
    const okR = (replies || 0) >= (Number(settings.coldStartMinReplies) || 5);
    return (okL || okR)
      ? { collect: true, grade: '예열' }
      : { collect: false, reason: '예열 하한 미달' };
  }

  const avgL = bench.likes / n;
  const avgR = bench.replies / n;
  const avgP = bench.reposts / n;
  let met = 0;
  if (likes !== null && likes >= avgL) met += 1;
  if (replies !== null && replies >= avgR) met += 1;
  if (reposts !== null && reposts >= avgP) met += 1;
  const need = Number(settings.adaptiveMetricsNeeded) || 2;
  return met >= need
    ? { collect: true, grade: '반응상위' }
    : { collect: false, reason: '평균 미달' };
}

/* -------------------------------------------------------------- 핵심 로직 */

/**
 * 판매자 원글 레코드를 찾거나 만든다.
 *
 * 판매자 원글에는 "어디서 사요" 같은 구매 키워드가 없다. 그래서 키워드 매칭만으로는
 * 절대 저장되지 않는다. 대신 같은 화면에서 함께 본 글(seen)이 있으면 그 내용으로
 * 바로 채우고, 없으면 본문을 나중에 확인할 자리표시자를 만든다.
 */
function ensureParent(posts, byId, parentId, parentUrl, seen, settings) {
  const existing = byId.get(parentId);
  if (existing) return existing;

  const fresh = seen.get(parentId);
  const handle = (String(parentUrl || '').match(/\/@([^/]+)\/post\//) || [])[1] || '';

  // 화면에서 같이 본 원글이면 수집 조건을 바로 적용한다
  if (fresh && !decideCollect(fresh.post, fresh.counts, settings).collect) return null;

  const parent = fresh
    ? {
        ...fresh.post,
        type: 'post',
        counts: fresh.counts,
        images: fresh.post.images || [],
        links: fresh.post.links || [],
        keywords: [],
        groups: [],
        groupLabels: [],
        account: null,
        inquiries: [],
        pending: false,
        collectedAt: new Date().toISOString()
      }
    : {
        id: parentId,
        url: parentUrl,
        author: handle,
        authorUrl: handle ? `https://www.threads.com/@${handle}` : null,
        text: '',
        type: 'post',
        pending: true,                 // 본문/수치를 아직 못 읽음
        counts: { views: null, likes: null, replies: null, reposts: null },
        images: [],
        links: [],
        keywords: [],
        groups: [],
        groupLabels: [],
        inquiries: [],
        collectedAt: new Date().toISOString()
      };

  delete parent.countsRaw;
  posts.push(parent);
  byId.set(parentId, parent);
  return parent;
}

async function handlePosts(incoming) {
  const state = await getAll();
  if (!state.settings.collecting) return { matched: [] };

  const settings = state.settings;
  const bench = state.stats.bench = state.stats.bench || { n: 0, likes: 0, replies: 0, reposts: 0 };

  // 중복글 제거 — 이미 저장된 본문 집합(이번 배치에서 담을 때마다 추가)
  const seenTexts = new Set();
  if (settings.dedupText !== false) {
    for (const p of state.posts) { const t = normText(p.text); if (t) seenTexts.add(t); }
  }
  // 자동 추천계정 발굴 — 미등록 계정의 '조건 맞는 원글' 누적
  const known = new Set((state.accounts || []).map((a) => normalizeHandle(a.username)));
  const cand = state.stats.candidateAuthors = state.stats.candidateAuthors || {};
  const newlyAdded = [];
  const refOut = [];   // 레퍼런스 계정에서 담은 글 → 로컬 서버로 전송(슬랙 풀용)
  const rejWords = state.stats.rejectedKeywords || [];   // 거부 학습 단어(싫어하는 주제)
  const pickWords = state.stats.pickedKeywords || [];

  const bump = (reason) => {
    state.stats.skipped = state.stats.skipped || {};
    state.stats.skipped[reason] = (state.stats.skipped[reason] || 0) + 1;
  };

  let posts = state.posts;
  const byId = new Map(posts.map((p) => [p.id, p]));
  const matched = [];
  const corpus = state.corpus;
  const parentQueue = new Set(state.parentQueue);

  // 1차: 이번에 화면에서 본 글을 전부 기록해 둔다.
  // 판매자 원글은 키워드가 안 맞아 그냥 두면 버려지는데, 답글의 부모로 필요하다.
  const seen = new Map();
  for (const post of incoming) {
    const raw = post.countsRaw || {};
    seen.set(post.id, {
      post,
      counts: {
        views: parseCount(raw.views),
        likes: parseCount(raw.likes),
        replies: parseCount(raw.replies),
        reposts: parseCount(raw.reposts)
      }
    });
  }

  // 2차: 매칭하고 판매자 원글에 문의를 붙인다
  for (const post of incoming) {
    state.stats.scanned += 1;
    state.stats.sinceSuggest += 1;
    corpus.push(post.text);

    const account = findAccount(post.author, state.accounts);
    const isOwn = Boolean(account && accountKind(account) === 'own');
    // 내 계정은 무조건 전부, 레퍼런스는 전체수집(collectAll)일 때 전부.
    const isReference = Boolean(account && (isOwn || account.collectAll));
    // 외국어 글은 전 계정에서 걸러낸다(사용자 요청: 외국어 수집 안 함).
    if (settings.koreanOnly && !isKorean(post.text, settings.koreanMinRatio)) {
      state.stats.skippedForeign = (state.stats.skippedForeign || 0) + 1;
      continue;
    }

    // 거부 학습 반영 — 미등록(피드/검색) 글이 '싫어하는 단어'를 담고 '좋아하는 단어'는 없으면 건너뛴다
    if (!account && rejWords.length) {
      const t = post.text || '';
      if (rejWords.some((w) => t.includes(w)) && !pickWords.some((w) => t.includes(w))) {
        bump('거부학습 제외');
        continue;
      }
    }

    const { hits, groups } = matchKeywords(post.text, state.groups, { onlyApproved: true });

    const counts = seen.get(post.id).counts;
    delete post.countsRaw;

    // 조회수가 잡힌 글이면 반응 기준 표본(1만~3만)에 반영
    addBench(bench, counts, settings);

    // 수집 판단
    //  1) 답글은 저장하지 않는다 — 원글을 찾는 신호로만 쓴다(실제 저장은 원글만).
    //  2) 반응 기준(adaptiveGate) ON: 내 계정·레퍼런스 포함 전부 학습 평균으로 거른다.
    //  3) OFF: 기존 방식(전체수집 계정은 그대로, 나머지는 등급 기준).
    let decision;
    if (settings.postsOnly !== false && post.type === 'reply') {
      decision = { collect: false, reason: SKIP_REPLY };
    } else if (settings.adaptiveGate !== false) {
      decision = adaptiveDecision(counts, settings, bench);
    } else if (isReference) {
      decision = { collect: true };
    } else {
      decision = decideCollect(post, counts, settings);
    }

    // 자동 추천계정 발굴 — 미등록 계정의 조건 맞는 원글이 임계치 이상이면 레퍼런스로 추가
    if (settings.autoDiscoverRef !== false && decision.collect && post.type !== 'reply') {
      const h = normalizeHandle(post.author);
      if (h && !known.has(h)) {
        cand[h] = (cand[h] || 0) + 1;
        if (cand[h] >= (Number(settings.autoRefThreshold) || 2)) {
          newlyAdded.push(makeDiscoveredAccount(h));
          known.add(h);
          delete cand[h];
          state.stats.autoAdded = [...new Set([...(state.stats.autoAdded || []), h])];
        }
      }
    }

    if (hits.length || decision.collect) {
      const displayHits = hits.length
        ? hits
        : [{ group: 'seller_post', label: '판매자 글', keyword: `점수 ${decision.seller ? decision.seller.score : '-'}` }];
      matched.push({ id: post.id, hits: displayHits });
    }

    // ── 구매 문의 답글이면, 그 답글이 달린 판매자 원글에 붙인다 ──
    let attached = false;
    if (post.type === 'reply' && hits.length && post.parentId && post.parentUrl) {
      const parent = ensureParent(posts, byId, post.parentId, post.parentUrl, seen, settings);
      if (parent && !parent.inquiries.some((q) => q.id === post.id)) {
        parent.inquiries.push({
          id: post.id,
          author: post.author,
          url: post.url,
          text: post.text.slice(0, 300),
          keywords: [...new Set(hits.map((h) => h.keyword))],
          at: new Date().toISOString()
        });
      }
      if (parent) {
        attached = true;                      // 부모에 붙였으면 따로 또 저장하지 않는다
        if (parent.pending) parentQueue.add(parent.id);
      }
    }
    if (attached) continue;

    if (byId.has(post.id)) {
      // 자리표시자로 먼저 만들어 둔 원글을 실제 내용으로 채운다
      const existing = byId.get(post.id);
      if (existing.pending && post.text) {
        Object.assign(existing, {
          text: post.text,
          counts,
          images: post.images || [],
          links: post.links || [],
          postedAt: post.postedAt,
          type: post.type || existing.type,
          pending: false
        });
        parentQueue.delete(post.id);
      }
      continue;
    }

    if (!decision.collect) { bump(decision.reason); continue; }

    // 중복글(본문 동일)은 담지 않는다
    if (settings.dedupText !== false) {
      const nt = normText(post.text);
      if (nt && seenTexts.has(nt)) { bump('중복글'); continue; }
      if (nt) seenTexts.add(nt);
    }

    bump(`수집 ${decision.grade}등급`);

    const record = {
      ...post,
      type: post.type || 'unknown',
      counts,
      images: post.images || [],
      seller: decision.seller || null,   // 등급은 볼 때 계산하므로 저장하지 않는다
      keywords: [...new Set(hits.map((h) => h.keyword))],
      groups: account ? [...new Set([...groups, groupForAccount(account).id])] : groups,
      groupLabels: [...new Set([...hits.map((h) => h.label), ...(account ? [groupForAccount(account).label] : [])])],
      account: account ? normalizeHandle(post.author) : null,
      accountKind: account ? accountKind(account) : null,
      inquiries: [],
      snippet: hits.length ? snippetAround(post.text, hits[0].keyword) : post.text.slice(0, 80),
      collectedAt: new Date().toISOString()
    };
    posts.push(record);
    byId.set(post.id, record);
    state.stats.matched += 1;

    // 모든 수집글을 서버로 보낸다(폰 검토앱 동기화 + 레퍼런스는 슬랙 풀).
    refOut.push({
      account: normalizeHandle(post.author) || post.author || '',
      body: post.text,
      like: counts.likes, reply: counts.replies, repost: counts.reposts,
      share: null,
      url: record.url,
      date: post.postedAt || null,
      thumb: record.thumb || ''
    });
  }

  // 조회수가 안 잡혔는데 댓글이 많이 달린 글은 나중에 상세 페이지로 확인한다
  const queue = new Set(state.viewQueue);
  if (settings.enrichViews) {
    for (const p of posts) {
      if (p.counts?.views === null && (p.counts?.replies ?? 0) >= (settings.enrichMinReplies || 20)) {
        if (!p.viewsCheckedAt) queue.add(p.id);
      }
    }
  }

  state.stats.lastAt = new Date().toISOString();
  if (posts.length > settings.maxPosts) posts = posts.slice(-settings.maxPosts);
  const trimmedCorpus = corpus.slice(-CORPUS_MAX);

  const patch = {
    [KEYS.POSTS]: posts,
    [KEYS.STATS]: state.stats,
    [KEYS.CORPUS]: trimmedCorpus,
    [KEYS.VIEW_QUEUE]: [...queue].slice(0, 500),
    [KEYS.PARENT_QUEUE]: [...parentQueue].slice(0, 300)
  };

  // 자동발굴로 새로 찾은 레퍼런스 계정 반영
  if (newlyAdded.length) patch[KEYS.ACCOUNTS] = [...state.accounts, ...newlyAdded];

  if (state.stats.sinceSuggest >= (settings.suggestEvery || 60)) {
    state.stats.sinceSuggest = 0;
    patch[KEYS.SUGGESTIONS] = mergeSuggestions(
      state.suggestions,
      suggestKeywords(trimmedCorpus, state.groups, state.rejected)
    );
    patch[KEYS.STATS] = state.stats;
  }

  await set(patch);
  await updateBadge(posts.filter((p) => !p.pending).length);

  // 레퍼런스 글을 계정별로 로컬 서버에 전송(슬랙 daily 풀로 흘려보냄)
  if (refOut.length) {
    const byAcct = {};
    for (const r of refOut) (byAcct[r.account] = byAcct[r.account] || []).push(r);
    for (const [h, items] of Object.entries(byAcct)) postReference(h, items);
  }
  return { matched };
}

function mergeSuggestions(previous, fresh) {
  const byValue = new Map(previous.map((s) => [s.value, s]));
  for (const s of fresh) {
    const prev = byValue.get(s.value);
    byValue.set(s.value, prev ? { ...prev, ...s, count: Math.max(prev.count, s.count) } : s);
  }
  return [...byValue.values()].sort((a, b) => b.score - a.score).slice(0, 30);
}

/* ------------------------------------------------------------- 내보내기 */

function toCsv(posts) {
  const cols = ['collectedAt', 'postedAt', 'kind', 'author', 'account', 'accountKind', 'url', 'groupLabels', 'keywords',
    'views', 'likes', 'replies', 'reposts', 'links', 'images', 'text'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(',')];
  for (const p of posts) {
    rows.push([
      p.collectedAt, p.postedAt, KIND_LABEL[p.type] || '판별 불가', p.author, p.account || '',
      p.accountKind === 'own' ? '내 계정' : p.accountKind === 'reference' ? '레퍼런스' : '', p.url,
      (p.groupLabels || []).join(' | '),
      (p.keywords || []).join(' | '),
      p.counts?.views, p.counts?.likes, p.counts?.replies, p.counts?.reposts,
      (p.links || []).join(' | '),
      (p.images || []).join(' | '),
      p.text
    ].map(esc).join(','));
  }
  return '﻿' + rows.join('\n');
}

function toMarkdown(posts, groups) {
  const lines = ['# 쓰레드 레퍼런스 수집 결과', '', `- 수집 시각: ${new Date().toISOString()}`, `- 총 ${posts.length}건`, ''];
  for (const g of [...groups, OWN_GROUP, ACCOUNT_GROUP]) {
    const items = posts.filter((p) => (p.groups || []).includes(g.id));
    if (!items.length) continue;
    lines.push(`## ${g.label} (${items.length}건)`, '');
    for (const p of items) {
      lines.push(`- [@${p.author}](${p.url}) — \`${(p.keywords || []).join('`, `')}\``);
      lines.push(`  > ${p.text.replace(/\n+/g, ' ').slice(0, 240)}`);
      if (p.links?.length) lines.push(`  - 링크: ${p.links.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function exportData(format, filterGroup, ids) {
  const { posts, groups } = await getAll();
  let target = posts;
  if (Array.isArray(ids)) {
    const wanted = new Set(ids);
    target = posts.filter((p) => wanted.has(p.id));
  } else if (filterGroup) {
    target = posts.filter((p) => (p.groups || []).includes(filterGroup));
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  let body;
  let mime;
  let ext;
  if (format === 'csv') { body = toCsv(target); mime = 'text/csv'; ext = 'csv'; }
  else if (format === 'md') { body = toMarkdown(target, groups); mime = 'text/markdown'; ext = 'md'; }
  else { body = JSON.stringify({ exportedAt: new Date().toISOString(), groups, posts: target }, null, 2); mime = 'application/json'; ext = 'json'; }

  const url = `data:${mime};charset=utf-8,${encodeURIComponent(body)}`;
  await chrome.downloads.download({ url, filename: `threads-refs-${stamp}.${ext}`, saveAs: true });
  return { count: target.length };
}

/* --------------------------------------------------------------- 메시지 */

const handlers = {
  POSTS: (msg) => handlePosts(msg.posts || []),

  GET_STATE: async () => {
    await ensureSeeded();
    await ensureAccountsSeeded();
    await applyRecommendedTuning();
    const state = await getAll();
    state.groups = ensureCustomGroup(state.groups);
    state.accountGroup = ACCOUNT_GROUP;
    state.ownGroup = OWN_GROUP;
    return state;
  },

  SET_SETTINGS: async (msg) => {
    const { settings } = await getAll();
    const next = { ...DEFAULT_SETTINGS, ...settings, ...msg.settings };
    await set({ [KEYS.SETTINGS]: next });
    return { settings: next };
  },

  /** pending 그룹 컨펌 */
  SET_GROUP_STATUS: async (msg) => {
    const { groups } = await getAll();
    const next = groups.map((g) => (g.id === msg.groupId ? { ...g, status: msg.status } : g));
    await set({ [KEYS.GROUPS]: next });
    return { groups: next };
  },

  ADD_KEYWORD: async (msg) => {
    const { groups } = await getAll();
    const next = ensureCustomGroup(groups).map((g) => {
      if (g.id !== (msg.groupId || 'custom')) return g;
      if ((g.keywords || []).some((k) => k.value === msg.value)) return g;
      return { ...g, keywords: [...(g.keywords || []), { value: msg.value, exclude: [], note: msg.note || '' }] };
    });
    await set({ [KEYS.GROUPS]: next });
    return { groups: next };
  },

  REMOVE_KEYWORD: async (msg) => {
    const { groups } = await getAll();
    const next = groups.map((g) =>
      g.id === msg.groupId ? { ...g, keywords: (g.keywords || []).filter((k) => k.value !== msg.value) } : g
    );
    await set({ [KEYS.GROUPS]: next });
    return { groups: next };
  },

  /** 추천 후보 승인 -> custom 그룹으로 편입 */
  APPROVE_SUGGESTION: async (msg) => {
    const { groups, suggestions } = await getAll();
    const next = ensureCustomGroup(groups).map((g) => {
      if (g.id !== (msg.groupId || 'custom')) return g;
      if ((g.keywords || []).some((k) => k.value === msg.value)) return g;
      return { ...g, keywords: [...(g.keywords || []), { value: msg.value, exclude: [], note: '추천 승인' }] };
    });
    await set({
      [KEYS.GROUPS]: next,
      [KEYS.SUGGESTIONS]: suggestions.filter((s) => s.value !== msg.value)
    });
    return { groups: next };
  },

  REJECT_SUGGESTION: async (msg) => {
    const { suggestions, rejected } = await getAll();
    await set({
      [KEYS.SUGGESTIONS]: suggestions.filter((s) => s.value !== msg.value),
      [KEYS.REJECTED]: [...new Set([...rejected, msg.value])]
    });
    return { ok: true };
  },

  RUN_SUGGEST: async () => {
    const { corpus, groups, rejected, suggestions } = await getAll();
    const fresh = suggestKeywords(corpus, groups, rejected);
    const merged = mergeSuggestions(suggestions, fresh);
    await set({ [KEYS.SUGGESTIONS]: merged });
    return { suggestions: merged, corpusSize: corpus.length };
  },

  /* ---- 레퍼런스 계정 ---- */

  ADD_ACCOUNT: async (msg) => {
    const { accounts } = await getAll();
    const handle = normalizeHandle(msg.username);
    if (!handle) return { error: '계정 형식을 알아볼 수 없습니다. @아이디 또는 프로필 주소를 넣어주세요.' };
    if (findAccount(handle, accounts)) return { accounts, duplicate: true };
    const kind = msg.kind === 'own' ? 'own' : 'reference';
    const next = [...accounts, {
      username: handle,
      kind,
      note: msg.note || '',
      // 내 계정은 항상 전부 수집. 레퍼런스는 기본 전부지만 끌 수 있다.
      collectAll: kind === 'own' ? true : msg.collectAll !== false,
      priority: Number.isFinite(Number(msg.priority)) ? Number(msg.priority) : (kind === 'own' ? 2 : 1),
      visits: 0,
      lastVisitedAt: null,
      addedAt: new Date().toISOString()
    }];
    await set({ [KEYS.ACCOUNTS]: next });
    return { accounts: next };
  },

  UPDATE_ACCOUNT: async (msg) => {
    const { accounts } = await getAll();
    const handle = normalizeHandle(msg.username);
    const next = accounts.map((a) => {
      if (normalizeHandle(a.username) !== handle) return a;
      const merged = { ...a, ...msg.patch };
      if (merged.kind === 'own') merged.collectAll = true;   // 내 계정은 항상 전부 수집
      return merged;
    });
    await set({ [KEYS.ACCOUNTS]: next });
    return { accounts: next };
  },

  /** 계정 수집 진행(방문 횟수)을 0으로 되돌린다 — 다시 우선 수집시키고 싶을 때. */
  RESET_ACCOUNT_PROGRESS: async (msg) => {
    const { accounts } = await getAll();
    const handle = msg.username ? normalizeHandle(msg.username) : null;
    const next = accounts.map((a) =>
      (!handle || normalizeHandle(a.username) === handle)
        ? { ...a, visits: 0, lastVisitedAt: null } : a);
    await set({ [KEYS.ACCOUNTS]: next });
    return { accounts: next };
  },

  REMOVE_ACCOUNT: async (msg) => {
    const { accounts } = await getAll();
    const handle = normalizeHandle(msg.username);
    const next = accounts.filter((a) => normalizeHandle(a.username) !== handle);
    await set({ [KEYS.ACCOUNTS]: next });
    return { accounts: next };
  },

  /* ---- 검색어 ---- */

  ADD_SEARCH_TERM: async (msg) => {
    const { searchTerms } = await getAll();
    const value = normalizeSearchTerm(msg.value);
    if (!value) return { error: '검색어가 비어 있습니다.' };
    if (searchTerms.some((t) => t.value === value)) return { searchTerms, duplicate: true };
    const next = [...searchTerms, { value, addedAt: new Date().toISOString() }];
    await set({ [KEYS.SEARCH_TERMS]: next });
    return { searchTerms: next };
  },

  REMOVE_SEARCH_TERM: async (msg) => {
    const { searchTerms } = await getAll();
    const next = searchTerms.filter((t) => t.value !== msg.value);
    await set({ [KEYS.SEARCH_TERMS]: next });
    return { searchTerms: next };
  },

  /* ---- 조회수 보강 큐 ---- */

  /**
   * content.js 가 다음에 확인할 작업 하나를 받아간다.
   *   kind 'parent' — 구매 문의가 달린 판매자 원글의 본문을 채운다 (우선)
   *   kind 'views'  — 조회수를 채운다
   */
  NEXT_ENRICH: async () => {
    const { viewQueue, parentQueue, posts, settings } = await getAll();
    if (!settings.collecting) return { job: null };
    const byId = new Map(posts.map((p) => [p.id, p]));

    const parents = [...parentQueue];
    while (parents.length) {
      const id = parents[0];
      const post = byId.get(id);
      if (post && post.pending && !post.contentCheckedAt) {
        return { job: { kind: 'parent', id, url: post.url }, remaining: parents.length + viewQueue.length };
      }
      parents.shift();
    }
    if (parents.length !== parentQueue.length) await set({ [KEYS.PARENT_QUEUE]: parents });

    if (!settings.enrichViews) return { job: null };
    const views = [...viewQueue];
    while (views.length) {
      const id = views[0];
      const post = byId.get(id);
      if (post && post.counts?.views === null && !post.viewsCheckedAt) {
        return { job: { kind: 'views', id, url: post.url }, remaining: views.length };
      }
      views.shift();
    }
    if (views.length !== viewQueue.length) await set({ [KEYS.VIEW_QUEUE]: views });
    return { job: null, remaining: 0 };
  },

  /** 조회수 확인 결과. 못 찾았어도 확인 시각을 남겨 다시 시도하지 않는다. */
  ENRICH_RESULT: async (msg) => {
    const { posts, viewQueue, stats, settings } = await getAll();
    const now = new Date().toISOString();
    const target = posts.find((p) => p.id === msg.id);
    const next = posts.map((p) => (p.id !== msg.id ? p : {
      ...p,
      counts: { ...p.counts, views: msg.views ?? p.counts?.views ?? null },
      viewsCheckedAt: now
    }));
    stats.enrichTried += 1;
    if (msg.views !== null && msg.views !== undefined) stats.enrichFilled += 1;

    // 조회수가 채워졌고 표본 구간이면 반응 기준 표본에 반영
    if ((msg.views ?? null) !== null && target) {
      stats.bench = stats.bench || { n: 0, likes: 0, replies: 0, reposts: 0 };
      addBench(stats.bench, { ...target.counts, views: msg.views }, settings);
    }

    await set({
      [KEYS.POSTS]: next,
      [KEYS.VIEW_QUEUE]: viewQueue.filter((id) => id !== msg.id),
      [KEYS.STATS]: stats
    });
    return { ok: true };
  },

  /** 판매자 원글 본문 확인 결과. */
  PARENT_RESULT: async (msg) => {
    const { posts, parentQueue, stats, settings } = await getAll();
    const now = new Date().toISOString();

    let dropped = false;
    const next = posts.map((p) => {
      if (p.id !== msg.id) return p;
      const text = msg.text || p.text || '';
      // 본문을 받아왔는데 외국어면 담지 않는다
      if (text && settings.koreanOnly && !isKorean(text, settings.koreanMinRatio)) {
        dropped = true;
        return null;
      }
      return {
        ...p,
        text,
        author: msg.author || p.author,
        authorUrl: msg.author ? `https://www.threads.com/@${msg.author}` : p.authorUrl,
        counts: { ...p.counts, views: msg.views ?? p.counts?.views ?? null },
        pending: !text,
        contentCheckedAt: now
      };
    }).filter(Boolean);

    if (msg.text) stats.parentsFound = (stats.parentsFound || 0) + 1;
    if (dropped) stats.skippedForeign = (stats.skippedForeign || 0) + 1;

    await set({
      [KEYS.POSTS]: next,
      [KEYS.PARENT_QUEUE]: parentQueue.filter((id) => id !== msg.id),
      [KEYS.STATS]: stats
    });
    return { ok: true };
  },

  /* ---- 순회 수집 ---- */

  /**
   * 다음에 갈 곳을 정한다.
   *
   *  우선순위 단계 — 아직 목표 바퀴(accountPasses)를 못 채운 계정이 있으면
   *    그 계정부터 방문한다. (내 계정 우선, priority 높은 순, 방문 적은 순)
   *    쓰레드가 한 번에 최근 몇 글만 주므로 한 계정을 여러 바퀴 돌며 누적한다.
   *
   *  랜덤 단계 — 모든 계정이 목표 바퀴를 채우면, 그때부턴 계정·추천 피드·검색어를
   *    무작위로 재방문한다(새 글 확인 + 더 깊이 긁기).
   */
  ROTATION_NEXT: async () => {
    const { settings, searchTerms, accounts } = await getAll();
    if (!settings.collecting || !settings.rotate) return { sources: [], next: null };

    const passes = Math.max(1, Number(settings.accountPasses) || 3);
    const useAccounts = settings.rotateAccounts !== false;
    const randomWhenDone = settings.rotateRandomWhenDone !== false;

    const feedSources = [];
    if (settings.rotateFeed !== false) {
      feedSources.push({ type: 'feed', label: '추천 피드', url: 'https://www.threads.com/' });
    }
    const searchSources = (searchTerms || []).map((t) => ({
      type: 'search', label: `검색: ${t.value}`, url: searchUrl(t.value)
    }));
    const acctSources = useAccounts ? (accounts || []).map((a) => ({
      type: 'account',
      username: normalizeHandle(a.username),
      label: `계정: @${a.username}`,
      url: profileUrl(a.username),
      kind: accountKind(a),
      priority: accountPriority(a),
      visits: Number(a.visits) || 0
    })).filter((s) => s.username) : [];

    const allSources = [...acctSources, ...feedSources, ...searchSources];
    if (!allSources.length) return { sources: [], next: null };

    // 우선순위 단계: 아직 목표 바퀴를 못 채운 계정
    const undone = acctSources.filter((s) => s.visits < passes);
    let next;
    let phase;
    if (undone.length && (randomWhenDone || true)) {
      phase = 'priority';
      undone.sort((a, b) =>
        (b.priority - a.priority) || (a.visits - b.visits) || a.username.localeCompare(b.username));
      next = undone[0];
    } else {
      phase = 'random';
      const pool = randomWhenDone ? allSources : (acctSources.length ? acctSources : allSources);
      next = pool[Math.floor(Math.random() * pool.length)];
    }

    // 방문한 계정의 진행도를 올린다
    if (next.type === 'account') {
      const uname = next.username;
      const nextAccounts = (accounts || []).map((a) =>
        normalizeHandle(a.username) === uname
          ? { ...a, visits: (Number(a.visits) || 0) + 1, lastVisitedAt: new Date().toISOString() }
          : a);
      await set({ [KEYS.ACCOUNTS]: nextAccounts });
    }
    await set({ [KEYS.ROTATION]: { index: 0, movedAt: new Date().toISOString(), url: next.url, phase } });

    const accountsDone = acctSources.length - undone.length;
    return {
      sources: allSources, next, total: allSources.length,
      phase, accountsTotal: acctSources.length, accountsDone
    };
  },

  /* ---- 결과 페이지 필터 ---- */

  SET_VIEW_FILTERS: async (msg) => {
    const { viewFilters } = await getAll();
    const next = { ...DEFAULT_VIEW_FILTERS, ...viewFilters, ...msg.filters };
    await set({ [KEYS.VIEW_FILTERS]: next });
    return { viewFilters: next };
  },

  EXPORT: (msg) => exportData(msg.format, msg.groupId, msg.ids),

  /** 지금 기준으로 반응이 낮은 글을 한 번에 정리한다. 기준이 바뀌었을 때 쓴다. */
  PRUNE_LOW_REACH: async () => {
    const { posts, settings } = await getAll();

    const kept = posts.filter((p) => {
      if (p.account) return true;                            // 레퍼런스 계정 글은 남긴다
      if (p.pending) return true;                            // 아직 본문 확인 중인 원글
      return decideCollect(p, p.counts || {}, settings).collect;
    });

    const removed = posts.length - kept.length;
    await set({ [KEYS.POSTS]: kept });
    await updateBadge(kept.filter((p) => !p.pending).length);
    return { removed, kept: kept.length };
  },

  CLEAR_POSTS: async () => {
    await set({ [KEYS.POSTS]: [], [KEYS.STATS]: { ...DEFAULT_STATS } });
    await updateBadge(0);
    return { ok: true };
  },

  DELETE_POST: async (msg) => {
    const { posts } = await getAll();
    const next = posts.filter((p) => p.id !== msg.id);
    await set({ [KEYS.POSTS]: next });
    await updateBadge(next.length);
    return { ok: true };
  },

  /** 지금까지 수집한 글 전체를 로컬 서버로 올린다(폰 검토앱 초기 동기화용). */
  SYNC_ALL_TO_SERVER: async () => {
    const { posts } = await getAll();
    const byAcct = {};
    let count = 0;
    for (const p of posts) {
      if (p.pending || !(p.text || '').trim()) continue;
      const h = normalizeHandle(p.author) || p.author || 'unknown';
      (byAcct[h] = byAcct[h] || []).push({
        account: h, body: p.text,
        like: p.counts?.likes ?? null, reply: p.counts?.replies ?? null, repost: p.counts?.reposts ?? null,
        share: null, url: p.url, date: p.postedAt || null, thumb: ''   // 용량 위해 썸네일 제외(원문 링크로 봄)
      });
      count += 1;
    }
    for (const [h, items] of Object.entries(byAcct)) postReference(h, items);
    return { ok: true, count, accounts: Object.keys(byAcct).length };
  },

  /** 글 '채택' 토글 — 괜찮다고 고른 글에 표시를 남긴다. */
  PICK_POST: async (msg) => {
    const { posts } = await getAll();
    const next = posts.map((p) =>
      p.id === msg.id ? { ...p, picked: msg.picked === undefined ? !p.picked : !!msg.picked } : p);
    await set({ [KEYS.POSTS]: next });
    return { ok: true };
  },

  /** 검토 상태 지정 — 'pick'(채택) / 'reject'(거부) / null(미검토). 같은 값 누르면 해제. */
  REVIEW_POST: async (msg) => {
    const { posts } = await getAll();
    let url = null, finalReview = null, rec = null;
    const next = posts.map((p) => {
      if (p.id !== msg.id) return p;
      const cur = p.review || (p.picked ? 'pick' : null);
      const review = (cur === msg.review) ? null : msg.review;
      url = p.url; finalReview = review;
      rec = {
        account: p.account || p.author, author: p.author, url: p.url,
        body: p.text, postedAt: p.postedAt || null, thumb: p.thumb || null,
        like: p.counts?.likes ?? null, reply: p.counts?.replies ?? null,
        repost: p.counts?.reposts ?? null, views: p.counts?.views ?? null
      };
      return { ...p, review, picked: review === 'pick' };
    });
    await set({ [KEYS.POSTS]: next });
    postReview(url, finalReview, rec);   // 슬랙 풀 + 캡쳐 아카이브에 반영되도록 서버에 전달
    return { ok: true };
  },

  /**
   * 채택 반영(고도화) — 내가 '채택'한 글들의 반응 수준을 수집 기준(bench)으로 삼고,
   * 자주 나온 단어를 뽑아 둔다. 누를수록 수집기가 내 취향 쪽으로 좁혀진다.
   */
  APPLY_PICKS_LEARNING: async () => {
    const { posts, stats, settings } = await getAll();
    const picked = posts.filter((p) => p.review === 'pick' || p.picked);
    const rejected = posts.filter((p) => p.review === 'reject');
    if (picked.length < 3 && rejected.length < 3) {
      return { error: '채택/거부가 너무 적어요. 합쳐서 3개 이상 해주세요.' };
    }

    let avgLike = null, avgReply = null;
    if (picked.length) {
      let sl = 0, sr = 0, sp = 0, n = 0;
      for (const p of picked) {
        const c = p.counts || {};
        if (c.likes != null || c.replies != null) { sl += c.likes || 0; sr += c.replies || 0; sp += c.reposts || 0; n += 1; }
      }
      n = n || picked.length;
      const nn = Math.max(n, Number(settings.adaptiveMinSamples) || 6);
      stats.bench = { n: nn, likes: Math.round((sl / n) * nn), replies: Math.round((sr / n) * nn), reposts: Math.round((sp / n) * nn) };
      avgLike = Math.round(sl / n); avgReply = Math.round(sr / n);
    }

    const STOP = new Set(['그리고', '그래서', '진짜', '너무', '하는', '해서', '있는', '없는', '그냥', '이거', '저도', '우리', '제가', '근데', '그게', '이게', '정말', '너무너무', '오늘', '지금']);
    const freq = (arr) => { const w = {}; for (const p of arr) for (const t of String(p.text || '').split(/[^가-힣a-zA-Z0-9]+/)) if (t.length >= 2 && !STOP.has(t)) w[t] = (w[t] || 0) + 1; return w; };
    const pw = freq(picked), rw = freq(rejected);
    const pickTop = Object.entries(pw).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);
    // 거부 단어 = 거부에 많고 채택엔 없는 단어(싫어하는 주제) → 피드 수집에서 제외하는 데 쓴다
    const rejTop = Object.entries(rw).filter(([w]) => !pw[w]).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w);
    stats.pickedKeywords = pickTop;
    stats.rejectedKeywords = rejTop;

    await set({ [KEYS.STATS]: stats });
    return { ok: true, pickCount: picked.length, rejectCount: rejected.length, avgLike, avgReply, pickTop, rejTop };
  },

  /** 반응 낮은 글 정리 — 좋아요<minLikes 또는 댓글<minReplies 인 글 삭제(채택/확인중 글은 남김). */
  PRUNE_REACTION: async (msg) => {
    const { posts } = await getAll();
    const minL = Number(msg.minLikes) || 0;
    const minR = Number(msg.minReplies) || 0;
    const kept = posts.filter((p) => {
      if (p.pending) return true;
      if (p.review === 'pick' || p.picked) return true;      // 채택한 건 남김
      const l = p.counts?.likes, r = p.counts?.replies;
      if (l != null && l < minL) return false;               // 좋아요 미달 → 삭제
      if (r != null && r < minR) return false;               // 댓글 미달 → 삭제
      return true;
    });
    const removed = posts.length - kept.length;
    await set({ [KEYS.POSTS]: kept });
    await updateBadge(kept.filter((p) => !p.pending).length);
    return { removed, kept: kept.length };
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then(sendResponse)
    .catch((err) => sendResponse({ error: String(err) }));
  return true;   // 비동기 응답
});
