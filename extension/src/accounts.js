/**
 * 레퍼런스 계정 · 검색어 관리.
 *
 * 레퍼런스 계정 = 내가 계속 참고하는 쓰레드 계정.
 *   collectAll 이 켜져 있으면 키워드가 하나도 안 맞아도 그 계정 글은 전부 수집한다.
 *   꺼져 있으면 평소처럼 키워드가 맞을 때만 수집하되, 결과에 계정 태그가 붙는다.
 */

export const ACCOUNT_GROUP = {
  id: 'reference_account',
  label: '레퍼런스 계정',
  description: '참고용으로 등록한 계정의 글.'
};

/** 내 계정 = 내가 운영하는 계정. 조건 없이 전부 수집한다(내 글 전체 아카이브). */
export const OWN_GROUP = {
  id: 'own_account',
  label: '내 계정',
  description: '내가 운영하는 계정의 글 (전부 수집).'
};

export const ACCOUNT_KINDS = { OWN: 'own', REFERENCE: 'reference' };

/** 계정 종류. 기본은 레퍼런스. */
export function accountKind(a) {
  return a && a.kind === 'own' ? 'own' : 'reference';
}

/** 계정 종류에 맞는 결과 그룹(태그). */
export function groupForAccount(a) {
  return accountKind(a) === 'own' ? OWN_GROUP : ACCOUNT_GROUP;
}

/** 순회 우선순위 기본값 — 내 계정(2)이 레퍼런스(1)보다 먼저. */
export function accountPriority(a) {
  const p = Number(a && a.priority);
  if (Number.isFinite(p)) return p;
  return accountKind(a) === 'own' ? 2 : 1;
}

/**
 * 사용자가 아무렇게나 넣어도 핸들만 뽑아낸다.
 *   "@banchan" / "banchan" / "https://www.threads.com/@banchan" / "threads.com/@banchan/post/xxx"
 *   -> "banchan"
 * 형식이 아니면 빈 문자열.
 */
export function normalizeHandle(input) {
  if (!input) return '';
  let s = String(input).trim();

  const urlMatch = s.match(/threads\.(?:com|net)\/@([^/?#\s]+)/i);
  if (urlMatch) s = urlMatch[1];

  s = s.replace(/^@+/, '').split(/[/?#\s]/)[0].toLowerCase();

  // 쓰레드 핸들에 쓰이는 문자만 허용
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : '';
}

/** 글 작성자가 등록된 레퍼런스 계정인지. 아니면 null. */
export function findAccount(author, accounts) {
  const handle = normalizeHandle(author);
  if (!handle) return null;
  return (accounts || []).find((a) => normalizeHandle(a.username) === handle) || null;
}

/** 이미 등록된 계정인지 (중복 추가 방지) */
export function hasAccount(username, accounts) {
  return Boolean(findAccount(username, accounts));
}

/** 검색어 정리. 앞뒤 공백만 걷어내고 원문을 유지한다(검색은 띄어쓰기가 의미를 가짐). */
export function normalizeSearchTerm(input) {
  return String(input || '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** 쓰레드 검색 URL */
export function searchUrl(term) {
  return `https://www.threads.com/search?q=${encodeURIComponent(term)}&serp_type=default`;
}

/** 계정 프로필 URL */
export function profileUrl(username) {
  return `https://www.threads.com/@${normalizeHandle(username)}`;
}
