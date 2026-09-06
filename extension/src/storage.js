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
  ROTATION: 'rotation',
  PARENT_QUEUE: 'parentQueue',
  VIEW_FILTERS: 'viewFilters'
};

export const DEFAULT_SETTINGS = {
  collecting: false,      // 수집 on/off
  autoScroll: false,      // 피드 자동 스크롤
  autoScrollDelayMs: 2500,

  // 순회 수집 — 추천 피드와 저장한 검색어들을 번갈아 돈다.
  rotate: false,
  rotateDwellMs: 90000,   // 한 곳에 머무는 기준 시간 (실제로는 0.7~1.4배로 흔듦)
  rotateFeed: true,       // 순회에 추천 피드 포함
  highlight: true,        // 매칭된 글을 페이지에서 표시
  suggestEvery: 60,       // 스캔 N건마다 키워드 후보 재계산
  maxPosts: 5000,         // 보관 상한 (넘으면 오래된 것부터 버림)
  minChars: 10,           // 이보다 짧은 글은 무시
  collectReplies: true,   // 답글도 수집 (구매 문의는 대부분 답글에 있다)

  // ── 수집 조건 (전부 원글 기준, 셋 다 만족해야 담는다) ──
  postsOnly: true,        // 원글만 수집 (답글은 판매자 글을 찾는 단서로만)
  minReplies: 20,         // 1. 댓글 이 수 이상 (0 이면 끔)
  requireSeller: true,    // 2. 판매자가 쓴 글이어야 함
  sellerThreshold: 3,     // 판매자 판별 점수 기준 (낮출수록 느슨)
  minLikes: 100,          // 3. 좋아요 이 수 이상 (0 이면 끔)

  koreanOnly: true,       // 외국어 글은 수집하지 않는다
  koreanMinRatio: 0.3,    // 글자 중 한글 비중이 이보다 낮으면 외국어로 본다

  // 조회수 보강 — 쓰레드는 피드에 조회수를 잘 안 뿌린다.
  // 댓글이 많이 달린 글만 골라 상세 페이지를 한 번 더 읽어 채운다.
  enrichViews: true,
  enrichMinReplies: 20,   // 이 댓글수 이상인 글만 조회수를 확인
  enrichMinDelayMs: 8000, // 확인 간 최소 간격 (실제로는 여기에 랜덤을 더함)
  enrichMaxPerRun: 40     // 한 번 켜둔 동안 확인할 최대 건수
};

export const DEFAULT_STATS = {
  scanned: 0, matched: 0, lastAt: null, sinceSuggest: 0,
  enrichTried: 0, enrichFilled: 0, skippedForeign: 0, parentsFound: 0,
  skipped: {}             // 건너뛴 이유별 건수
};

/** 결과 페이지의 기본 필터. 사용자가 바꾸면 그대로 저장된다. */
export const DEFAULT_VIEW_FILTERS = {
  minViews: 0,
  minReplies: 0,
  minLikes: 0,
  group: '',
  sort: 'views',
  q: '',
  includeUnknown: true,
  onlyImages: false,
  kind: '',               // '' 전체 / 'post' 글만 / 'reply' 답글만
  mode: 'seller',         // 'seller' 판매자 글 랭킹(기본) / 'all' 수집한 글 전체
  minInquiries: 1         // 판매자 글 랭킹에서 최소 구매문의 수
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
    rotation: raw[KEYS.ROTATION] || { index: 0, movedAt: null, url: null },
    parentQueue: raw[KEYS.PARENT_QUEUE] || [],
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
