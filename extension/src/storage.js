/** chrome.storage.local 스키마와 접근 헬퍼. 모든 쓰기는 background 를 통해서만 일어난다. */

import { seedKeywordList } from './keywords.js';

export const KEYS = {
  GROUPS: 'groups',
  POSTS: 'posts',
  SUGGESTIONS: 'suggestions',
  REJECTED: 'rejectedSuggestions',
  SETTINGS: 'settings',
  STATS: 'stats',
  CORPUS: 'corpus',
  ACCOUNTS: 'accounts',
  SEARCH_TERMS: 'searchTerms',
  VIEW_QUEUE: 'viewQueue',
  VIEW_FILTERS: 'viewFilters'
};

export const DEFAULT_SETTINGS = {
  collecting: false,      // 수집 on/off
  autoScroll: false,      // 피드 자동 스크롤
  autoScrollDelayMs: 2500,
  highlight: true,        // 매칭된 글을 페이지에서 표시
  suggestEvery: 60,       // 스캔 N건마다 키워드 후보 재계산
  maxPosts: 5000,         // 보관 상한 (넘으면 오래된 것부터 버림)
  minChars: 10,           // 이보다 짧은 글은 무시

  // 조회수 보강 — 쓰레드는 피드에 조회수를 잘 안 뿌린다.
  // 댓글이 많이 달린 글만 골라 상세 페이지를 한 번 더 읽어 채운다.
  enrichViews: true,
  enrichMinReplies: 20,   // 이 댓글수 이상인 글만 조회수를 확인
  enrichMinDelayMs: 8000, // 확인 간 최소 간격 (실제로는 여기에 랜덤을 더함)
  enrichMaxPerRun: 40     // 한 번 켜둔 동안 확인할 최대 건수
};

export const DEFAULT_STATS = {
  scanned: 0, matched: 0, lastAt: null, sinceSuggest: 0,
  enrichTried: 0, enrichFilled: 0
};

/** 결과 페이지의 기본 필터. 사용자가 바꾸면 그대로 저장된다. */
export const DEFAULT_VIEW_FILTERS = {
  minViews: 10000,
  minReplies: 20,
  minLikes: 0,
  group: '',
  sort: 'views',
  q: '',
  includeUnknown: false,
  onlyImages: false
};

export async function getAll() {
  const raw = await chrome.storage.local.get(Object.values(KEYS));
  return {
    groups: raw[KEYS.GROUPS] || seedKeywordList(),
    posts: raw[KEYS.POSTS] || [],
    suggestions: raw[KEYS.SUGGESTIONS] || [],
    rejected: raw[KEYS.REJECTED] || [],
    settings: { ...DEFAULT_SETTINGS, ...(raw[KEYS.SETTINGS] || {}) },
    stats: { ...DEFAULT_STATS, ...(raw[KEYS.STATS] || {}) },
    corpus: raw[KEYS.CORPUS] || [],
    accounts: raw[KEYS.ACCOUNTS] || [],
    searchTerms: raw[KEYS.SEARCH_TERMS] || [],
    viewQueue: raw[KEYS.VIEW_QUEUE] || [],
    viewFilters: { ...DEFAULT_VIEW_FILTERS, ...(raw[KEYS.VIEW_FILTERS] || {}) }
  };
}

export async function get(key, fallback) {
  const raw = await chrome.storage.local.get(key);
  return raw[key] === undefined ? fallback : raw[key];
}

export async function set(patch) {
  await chrome.storage.local.set(patch);
}

export async function ensureSeeded() {
  const existing = await get(KEYS.GROUPS, null);
  if (!existing) {
    await set({
      [KEYS.GROUPS]: seedKeywordList(),
      [KEYS.SETTINGS]: DEFAULT_SETTINGS,
      [KEYS.STATS]: DEFAULT_STATS
    });
  }
}

/** 수집에 실제로 쓰이는(=컨펌된) 그룹만. */
export function approvedGroups(groups) {
  return groups.filter((g) => g.status === 'approved');
}
