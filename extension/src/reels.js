/**
 * 인스타 릴스 레퍼런스 저장소.
 *
 * 쓰레드 쪽(posts)과 같은 생각으로 만든다: 전부 모으지 않고 "터진 것"만 남긴다.
 * 다만 터졌다는 기준이 쓰레드와 다르다 — 릴스는 조회수가 그리드에 그대로 보이고,
 * 조회수가 높다고 팔린 건 아니다. 과일맛집 160편을 세어보니 633만회 글의 댓글이
 * 28개(0.00%)였고 58만회 글은 1만 개(1.72%)였다. 그래서 두 단계로 거른다.
 *
 *   1단 (그리드): 조회수가 그 계정 중앙값의 REACH_MULT 배 이상이거나 REACH_MIN 이상
 *   2단 (상세):   댓글률 = 댓글/조회. CONV_RATE 이상이면 '전환형'으로 표시
 *
 * 1단만 통과한 것도 버리지 않고 남긴다. 2단은 상세를 열어야 알 수 있어서 늦게 채워진다.
 */

export const REELS_KEY = 'igReels';
export const REELS_STATS_KEY = 'igReelStats';

export const REEL_DEFAULTS = {
  reachMin: 100000,   // 이 조회수를 넘으면 계정 평균과 무관하게 후보
  reachMult: 3,       // 그 계정 중앙값의 몇 배부터 '터진 것'으로 볼지
  convRate: 0.3,      // 댓글률(%) — 이 위면 전환형
  maxReels: 3000
};

const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

export function median(xs) {
  const a = xs.filter((x) => typeof x === 'number' && isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/** 댓글률(%). 조회수나 댓글이 없으면 null — 0 과 구분해야 한다. */
export function commentRate(reel) {
  const v = n(reel.views), c = n(reel.cmt);
  if (!v || c === null) return null;
  return Math.round((c / v) * 10000) / 100;
}

/**
 * 이 릴스를 남길까. 계정 중앙값을 같이 받는다(없으면 절대 기준만 본다).
 * 조회수를 모르면 버리지 않는다 — 그리드를 못 읽은 것일 뿐이고, 조용히
 * 사라지는 쪽이 더 나쁘다.
 */
export function isBigReach(reel, accMedian, opt) {
  const o = { ...REEL_DEFAULTS, ...(opt || {}) };
  const v = n(reel.views);
  if (v === null) return true;
  if (v >= o.reachMin) return true;
  if (accMedian && v >= accMedian * o.reachMult) return true;
  return false;
}

/** 전환형/도달형/약함 — 수집 탭에서 쓰는 것과 같은 말을 쓴다. */
export function verdictOf(reel, accMedian, opt) {
  const o = { ...REEL_DEFAULTS, ...(opt || {}) };
  const rate = commentRate(reel);
  const big = isBigReach(reel, accMedian, o);
  if (rate === null) return big ? '미확인' : '약함';
  if (rate >= o.convRate && big) return '둘 다';
  if (rate >= o.convRate) return '전환형';
  if (big) return '도달형';
  return '약함';
}

/** 같은 릴스를 다시 만났을 때, 아는 값은 지우지 않고 새로 안 값만 덮는다. */
export function mergeReel(old, next) {
  const out = { ...(old || {}) };
  Object.keys(next || {}).forEach((k) => {
    const v = next[k];
    if (v === null || v === undefined || v === '') return;
    out[k] = v;
  });
  out.code = out.code || next.code;
  out.seenAt = out.seenAt || Date.now();
  out.updatedAt = Date.now();
  return out;
}

export async function readReels() {
  const got = await chrome.storage.local.get([REELS_KEY]);
  return got[REELS_KEY] || {};
}

export async function writeReels(map) {
  await chrome.storage.local.set({ [REELS_KEY]: map });
}

/** 계정별 조회수 중앙값. 그리드에서 본 것만으로 계산한다. */
export function accountMedians(map) {
  const by = {};
  Object.values(map).forEach((r) => {
    if (!r.acct || !n(r.views)) return;
    (by[r.acct] = by[r.acct] || []).push(r.views);
  });
  const out = {};
  Object.keys(by).forEach((a) => { out[a] = median(by[a]); });
  return out;
}

/** 상세를 열어 볼 차례인 릴스 — 조회수는 알지만 댓글을 아직 모르는 것부터. */
export function nextToEnrich(map, limit = 1) {
  const med = accountMedians(map);
  return Object.values(map)
    .filter((r) => r.code && n(r.views) && r.cmt === undefined && isBigReach(r, med[r.acct]))
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, limit);
}

/** 앱(릴스 공방) 수집 탭에 그대로 넣을 수 있는 모양으로 */
export function toWorkshopRows(map, opt) {
  const med = accountMedians(map);
  return Object.values(map)
    .filter((r) => r.code)
    .map((r) => ({
      id: 'ig' + r.code,
      code: r.code,
      acct: r.acct || '',
      date: (r.ts || '').slice(0, 10),
      plays: n(r.views) || 0,
      cmt: n(r.cmt) || 0,
      rate: commentRate(r) || 0,
      dur: n(r.dur) || 0,
      hook: (r.cap || '').split('\n').filter(Boolean).slice(0, 2).join(' / '),
      cap: r.cap || '',
      verdict: verdictOf(r, med[r.acct], opt),
      kw: r.kw || '',
      stake: 0,
      dev: 0
    }))
    .sort((a, b) => b.rate - a.rate);
}
