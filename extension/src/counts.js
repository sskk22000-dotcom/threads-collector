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

/**
 * 부모 글(판매자 글)의 본문을 상세 페이지 HTML 에서 뽑는다.
 *
 * 쓰레드는 permalink 페이지에 og:description 으로 글 본문을,
 * og:title 로 "작성자 (@handle) on Threads" 를 넣어준다. 임베드 JSON 을
 * 헤집는 것보다 이쪽이 훨씬 덜 깨진다.
 */
export function extractOgPost(html) {
  if (!html) return { text: null, author: null };

  const pick = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
    const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
    const m = html.match(re) || html.match(alt);
    return m ? decodeEntities(m[1]) : null;
  };

  const description = pick('og:description') || pick('description');
  const title = pick('og:title');
  const author = title ? (title.match(/\(@([A-Za-z0-9._]+)\)/) || [])[1] || null : null;

  return { text: description ? description.trim() : null, author };
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * 수집 기준(게이트). 키워드가 맞아도 반응이 없는 글은 담지 않기 위한 관문.
 *
 * @param {{likes:?number, replies:?number}} counts
 * @param {{minLikes:number, minReplies:number, gateMode:'or'|'and', gateAllowUnknown:boolean}} rule
 * @returns {'pass'|'fail'|'unknown'}  unknown = 수치를 못 읽어 판단 불가
 */
export function gateResult(counts, rule) {
  const minLikes = Number(rule.minLikes) || 0;
  const minReplies = Number(rule.minReplies) || 0;
  if (!minLikes && !minReplies) return 'pass';

  const likes = counts ? counts.likes : null;
  const replies = counts ? counts.replies : null;

  const checks = [];
  if (minLikes) checks.push(likes === null || likes === undefined ? null : likes >= minLikes);
  if (minReplies) checks.push(replies === null || replies === undefined ? null : replies >= minReplies);

  const known = checks.filter((c) => c !== null);
  if (!known.length) return 'unknown';
  const allKnown = known.length === checks.length;

  if (rule.gateMode === 'and') {
    if (known.some((k) => !k)) return 'fail';   // 하나라도 미달이면 확정 탈락
    return allKnown ? 'pass' : 'unknown';       // 남은 조건을 모르면 단정하지 않는다
  }

  // or 모드
  if (known.some(Boolean)) return 'pass';
  return allKnown ? 'fail' : 'unknown';         // 아직 모르는 조건이 통과시킬 수도 있다
}

/** 게이트 결과를 실제 수집 여부로 바꾼다. */
export function shouldCollect(counts, rule) {
  const r = gateResult(counts, rule);
  if (r === 'unknown') return rule.gateAllowUnknown !== false;
  return r === 'pass';
}
