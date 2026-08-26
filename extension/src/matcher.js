/**
 * 텍스트 정규화 + 키워드 매칭.
 * keywords.js 의 value 들은 전부 이 normalize() 를 통과한 형태로 적혀 있어야 한다.
 */

/** 공백·문장부호·이모지를 걷어내고 소문자로. "어디서 사요?" -> "어디서사요" */
export function normalize(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, '')
    .replace(/[\s\u200B-\u200D\uFEFF\u00A0]+/g, '')
    .replace(/[!-\/:-@\[-`{-~]/g, '')
    .replace(/[\u3000-\u303F\u2010-\u205E]/g, '');
}

/**
 * @param {string} text            원본 글 본문
 * @param {Array}  groups          [{id,label,status,keywords:[{value,exclude,type}]}]
 * @param {object} opts            { onlyApproved?: boolean }
 * @returns {{hits: Array<{group:string,label:string,keyword:string}>, groups:string[]}}
 */
export function matchKeywords(text, groups, opts = {}) {
  const onlyApproved = opts.onlyApproved !== false;
  const norm = normalize(text);
  const hits = [];
  if (!norm) return { hits, groups: [] };

  for (const group of groups) {
    if (onlyApproved && group.status !== 'approved') continue;
    for (const kw of group.keywords || []) {
      if (kw.disabled) continue;
      const excluded = (kw.exclude || []).some((ex) => ex && norm.includes(normalize(ex)));
      if (excluded) continue;

      let matched = false;
      if (kw.type === 'regex') {
        try {
          matched = new RegExp(kw.value).test(norm);
        } catch {
          matched = false;
        }
      } else {
        matched = norm.includes(normalize(kw.value));
      }
      if (matched) hits.push({ group: group.id, label: group.label, keyword: kw.value });
    }
  }
  return { hits, groups: [...new Set(hits.map((h) => h.group))] };
}

/** 매칭된 키워드 주변 문맥을 잘라서 미리보기용 스니펫을 만든다. */
export function snippetAround(text, keyword, radius = 40) {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  const normFlat = normalize(flat);
  const idx = normFlat.indexOf(normalize(keyword));
  if (idx < 0) return flat.slice(0, radius * 2);

  // 정규화 인덱스 -> 원문 인덱스 역매핑
  let raw = 0;
  let seen = 0;
  while (raw < flat.length && seen < idx) {
    if (normalize(flat[raw])) seen += normalize(flat[raw]).length;
    raw += 1;
  }
  const start = Math.max(0, raw - radius);
  const end = Math.min(flat.length, raw + radius);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}
