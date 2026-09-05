/**
 * 쓰레드가 화면에 뿌리는 숫자 표기를 정수로 바꾸고, 다시 사람이 읽기 좋게 되돌린다.
 *
 * 쓰레드는 로케일에 따라 "1,234" / "1.2만" / "3.4K" / "2.1M" / "조회수 1.2만회" 처럼
 * 제각각으로 표기한다. 이걸 그대로 두면 "조회수 10000 이상" 같은 필터를 걸 수 없다.
 */

const UNITS = [
  { re: /억/, mul: 100000000 },
  { re: /만/, mul: 10000 },
  { re: /천/, mul: 1000 },
  { re: /\bB\b|b$/i, mul: 1000000000 },
  { re: /\bM\b|m$/i, mul: 1000000 },
  { re: /\bK\b|k$/i, mul: 1000 }
];

/**
 * "조회수 1.2만회" -> 12000, "1,234" -> 1234, "3.4K" -> 3400
 * 숫자를 못 찾으면 null (0 과 구분해야 한다: 0 은 "정말 0개", null 은 "모름")
 */
export function parseCount(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;

  const text = String(input).trim();
  if (!text) return null;

  const m = text.match(/(\d[\d,.]*)\s*([억만천KkMmBb]?)/);
  if (!m) return null;

  const rawNumber = m[1];
  // "1,234" 는 천 단위 구분자, "1.2만" 은 소수점 -> 둘 다 안전하게 처리
  const numeric = Number(rawNumber.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;

  const suffix = m[2] || '';
  const unit = suffix ? UNITS.find((u) => u.re.test(suffix)) : null;
  return Math.round(numeric * (unit ? unit.mul : 1));
}

/** 12345 -> "1.2만", 1234 -> "1,234" */
export function formatCount(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만`;
  return n.toLocaleString('ko-KR');
}

/**
 * 필터 통과 여부.
 * 값이 null(모름)이면 includeUnknown 에 따른다 — 조건에 걸려 조용히 사라지는 걸 막기 위해서다.
 */
export function passesThreshold(value, min, includeUnknown) {
  if (!min) return true;
  if (value === null || value === undefined) return Boolean(includeUnknown);
  return value >= min;
}

/**
 * 글 상세 페이지 HTML 에서 조회수를 뽑는다.
 *
 * 쓰레드는 피드에 조회수를 잘 노출하지 않아서, 댓글이 많이 달린 글만 골라
 * 상세 페이지를 한 번 더 읽어 채운다. 서버가 내려주는 임베드 JSON 의 키 이름이
 * 바뀔 수 있으므로 여러 후보를 순서대로 시도하고, 못 찾으면 null 을 준다.
 */
const VIEW_PATTERNS = [
  /"view_count"\s*:\s*"?(\d+)"?/,
  /"views_count"\s*:\s*"?(\d+)"?/,
  /"video_view_count"\s*:\s*"?(\d+)"?/,
  /"impression_count"\s*:\s*"?(\d+)"?/,
  /"viewCount"\s*:\s*"?(\d+)"?/,
  /조회\s*수?\s*([\d,.]+\s*[억만천]?)\s*회/,
  /([\d,.]+\s*[KkMmBb]?)\s*views\b/i
];

export function extractViewCount(html) {
  if (!html) return null;
  for (const re of VIEW_PATTERNS) {
    const m = html.match(re);
    if (!m) continue;
    const value = parseCount(m[1]);
    if (value !== null && value >= 0) return value;
  }
  return null;
}
