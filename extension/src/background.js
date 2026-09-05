/** 상태의 단일 소유자. 매칭 · 저장 · 추천 · 내보내기를 전부 여기서 처리한다. */

import { KEYS, DEFAULT_SETTINGS, DEFAULT_STATS, getAll, set, ensureSeeded } from './storage.js';
import { matchKeywords, snippetAround } from './matcher.js';
import { suggestKeywords } from './suggest.js';
import { ACCOUNT_GROUP, findAccount, normalizeHandle, normalizeSearchTerm } from './accounts.js';

const CORPUS_MAX = 400;
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

async function handlePosts(incoming) {
  const state = await getAll();
  if (!state.settings.collecting) return { matched: [] };

  const existingIds = new Set(state.posts.map((p) => p.id));
  const matched = [];
  let posts = state.posts;
  const corpus = state.corpus;

  for (const post of incoming) {
    state.stats.scanned += 1;
    state.stats.sinceSuggest += 1;

    corpus.push(post.text);

    const { hits, groups } = matchKeywords(post.text, state.groups, { onlyApproved: true });
    const account = findAccount(post.author, state.accounts);

    // collectAll 계정이면 키워드가 안 맞아도 담는다
    const keep = hits.length > 0 || Boolean(account && account.collectAll);
    if (!keep) continue;

    const displayHits = hits.length
      ? hits
      : [{ group: ACCOUNT_GROUP.id, label: ACCOUNT_GROUP.label, keyword: `@${normalizeHandle(post.author)}` }];
    matched.push({ id: post.id, hits: displayHits });

    if (existingIds.has(post.id)) continue;
    existingIds.add(post.id);

    const postGroups = account ? [...new Set([...groups, ACCOUNT_GROUP.id])] : groups;
    const postLabels = [...new Set(hits.map((h) => h.label))];
    if (account) postLabels.push(ACCOUNT_GROUP.label);

    posts.push({
      ...post,
      keywords: [...new Set(hits.map((h) => h.keyword))],
      groups: postGroups,
      groupLabels: postLabels,
      account: account ? normalizeHandle(post.author) : null,
      snippet: hits.length ? snippetAround(post.text, hits[0].keyword) : post.text.slice(0, 80),
      collectedAt: new Date().toISOString()
    });
    state.stats.matched += 1;
  }

  state.stats.lastAt = new Date().toISOString();
  if (posts.length > state.settings.maxPosts) posts = posts.slice(-state.settings.maxPosts);
  const trimmedCorpus = corpus.slice(-CORPUS_MAX);

  const patch = {
    [KEYS.POSTS]: posts,
    [KEYS.STATS]: state.stats,
    [KEYS.CORPUS]: trimmedCorpus
  };

  // N건마다 새 키워드 후보를 다시 뽑아 pending 으로만 쌓아둔다 (자동 반영 없음)
  if (state.stats.sinceSuggest >= (state.settings.suggestEvery || 60)) {
    state.stats.sinceSuggest = 0;
    patch[KEYS.SUGGESTIONS] = mergeSuggestions(
      state.suggestions,
      suggestKeywords(trimmedCorpus, state.groups, state.rejected)
    );
    patch[KEYS.STATS] = state.stats;
  }

  await set(patch);
  await updateBadge(posts.length);
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
  const cols = ['collectedAt', 'postedAt', 'author', 'referenceAccount', 'url', 'groupLabels', 'keywords', 'likes', 'replies', 'reposts', 'links', 'text'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(',')];
  for (const p of posts) {
    rows.push([
      p.collectedAt, p.postedAt, p.author, p.account || '', p.url,
      (p.groupLabels || []).join(' | '),
      (p.keywords || []).join(' | '),
      p.counts?.likes, p.counts?.replies, p.counts?.reposts,
      (p.links || []).join(' | '),
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

async function exportData(format, filterGroup) {
  const { posts, groups } = await getAll();
  const target = filterGroup ? posts.filter((p) => (p.groups || []).includes(filterGroup)) : posts;
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

  EXPORT: (msg) => exportData(msg.format, msg.groupId),

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
