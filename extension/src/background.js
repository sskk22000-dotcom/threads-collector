/** 상태의 단일 소유자. 매칭 · 저장 · 추천 · 내보내기를 전부 여기서 처리한다. */

import { KEYS, DEFAULT_SETTINGS, DEFAULT_STATS, DEFAULT_VIEW_FILTERS, getAll, set, ensureSeeded } from './storage.js';
import { matchKeywords, snippetAround, isKorean } from './matcher.js';
import { suggestKeywords } from './suggest.js';
import { ACCOUNT_GROUP, findAccount, normalizeHandle, normalizeSearchTerm } from './accounts.js';
import { parseCount, shouldCollect } from './counts.js';

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

chrome.runtime.onInstalled.addListener(() => {
  ensureSeeded();
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

/* -------------------------------------------------------------- 핵심 로직 */

/**
 * 판매자 원글 레코드를 찾거나 만든다.
 *
 * 판매자 원글에는 "어디서 사요" 같은 구매 키워드가 없다. 그래서 키워드 매칭만으로는
 * 절대 저장되지 않는다. 대신 같은 화면에서 함께 본 글(seen)이 있으면 그 내용으로
 * 바로 채우고, 없으면 본문을 나중에 확인할 자리표시자를 만든다.
 */
function ensureParent(posts, byId, parentId, parentUrl, seen, gate) {
  const existing = byId.get(parentId);
  if (existing) return existing;

  const fresh = seen.get(parentId);
  const handle = (String(parentUrl || '').match(/\/@([^/]+)\/post\//) || [])[1] || '';

  // 화면에서 같이 본 원글이면 수집 기준을 바로 적용한다
  if (fresh && !shouldCollect(fresh.counts, gate)) return null;

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
  const gate = {
    minLikes: settings.minLikes,
    minReplies: settings.minReplies,
    gateMode: settings.gateMode,
    gateAllowUnknown: settings.gateAllowUnknown
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

    // 외국어 글은 여기서 걸러낸다 (레퍼런스 계정 글은 예외)
    const account = findAccount(post.author, state.accounts);
    const isReference = Boolean(account && account.collectAll);
    if (settings.koreanOnly && !isReference && !isKorean(post.text, settings.koreanMinRatio)) {
      state.stats.skippedForeign = (state.stats.skippedForeign || 0) + 1;
      continue;
    }

    const { hits, groups } = matchKeywords(post.text, state.groups, { onlyApproved: true });
    if (!hits.length && !isReference) continue;

    const counts = seen.get(post.id).counts;
    delete post.countsRaw;

    const displayHits = hits.length
      ? hits
      : [{ group: ACCOUNT_GROUP.id, label: ACCOUNT_GROUP.label, keyword: `@${normalizeHandle(post.author)}` }];
    matched.push({ id: post.id, hits: displayHits });

    // ── 구매 문의 답글이면, 그 답글이 달린 판매자 원글에 붙인다 ──
    if (post.type === 'reply' && hits.length && post.parentId && post.parentUrl) {
      const parent = ensureParent(posts, byId, post.parentId, post.parentUrl, seen, gate);
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
      if (parent && parent.pending) parentQueue.add(parent.id);
    }

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

    // ── 수집 기준: 원글은 반응이 있어야 담는다 ──
    const isParentSide = post.type !== 'reply';
    if (isParentSide && !isReference && !shouldCollect(counts, gate)) continue;

    const record = {
      ...post,
      type: post.type || 'unknown',
      counts,
      images: post.images || [],
      keywords: [...new Set(hits.map((h) => h.keyword))],
      groups: account ? [...new Set([...groups, ACCOUNT_GROUP.id])] : groups,
      groupLabels: [...new Set([...hits.map((h) => h.label), ...(account ? [ACCOUNT_GROUP.label] : [])])],
      account: account ? normalizeHandle(post.author) : null,
      inquiries: [],
      snippet: hits.length ? snippetAround(post.text, hits[0].keyword) : post.text.slice(0, 80),
      collectedAt: new Date().toISOString()
    };
    posts.push(record);
    byId.set(post.id, record);
    state.stats.matched += 1;
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
  const cols = ['collectedAt', 'postedAt', 'kind', 'author', 'referenceAccount', 'url', 'groupLabels', 'keywords',
    'views', 'likes', 'replies', 'reposts', 'links', 'images', 'text'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(',')];
  for (const p of posts) {
    rows.push([
      p.collectedAt, p.postedAt, KIND_LABEL[p.type] || '판별 불가', p.author, p.account || '', p.url,
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
  for (const g of [...groups, ACCOUNT_GROUP]) {
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
    const state = await getAll();
    state.groups = ensureCustomGroup(state.groups);
    state.accountGroup = ACCOUNT_GROUP;
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
    const next = [...accounts, {
      username: handle,
      note: msg.note || '',
      collectAll: msg.collectAll !== false,
      addedAt: new Date().toISOString()
    }];
    await set({ [KEYS.ACCOUNTS]: next });
    return { accounts: next };
  },

  UPDATE_ACCOUNT: async (msg) => {
    const { accounts } = await getAll();
    const handle = normalizeHandle(msg.username);
    const next = accounts.map((a) =>
      normalizeHandle(a.username) === handle ? { ...a, ...msg.patch } : a);
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
    const { posts, viewQueue, stats } = await getAll();
    const now = new Date().toISOString();
    const next = posts.map((p) => (p.id !== msg.id ? p : {
      ...p,
      counts: { ...p.counts, views: msg.views ?? p.counts?.views ?? null },
      viewsCheckedAt: now
    }));
    stats.enrichTried += 1;
    if (msg.views !== null && msg.views !== undefined) stats.enrichFilled += 1;

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

  /* ---- 결과 페이지 필터 ---- */

  SET_VIEW_FILTERS: async (msg) => {
    const { viewFilters } = await getAll();
    const next = { ...DEFAULT_VIEW_FILTERS, ...viewFilters, ...msg.filters };
    await set({ [KEYS.VIEW_FILTERS]: next });
    return { viewFilters: next };
  },

  EXPORT: (msg) => exportData(msg.format, msg.groupId, msg.ids),

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
