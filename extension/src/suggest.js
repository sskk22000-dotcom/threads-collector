/**
 * 수집한 글에서 새 키워드 후보를 자동 발굴한다.
 *
 * 절대 자동으로 수집에 반영하지 않는다. 후보는 status:"pending" 으로만 쌓이고,
 * 팝업에서 사용자가 "승인"을 눌러야 approved 그룹에 들어간다.
 */

import { INTENT_ANCHORS, STOPWORDS } from './keywords.js';
import { normalize } from './matcher.js';

const MIN_LEN = 3;
const MAX_LEN = 14;
const MIN_COUNT = 2;

function tokenize(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function hasAnchor(normCandidate) {
  return INTENT_ANCHORS.some((a) => normCandidate.includes(normalize(a)));
}

/** 이미 등록된 키워드로 커버되는 후보인지 (부분문자열 양방향 검사) */
function alreadyCovered(normCandidate, existingNorms) {
  return existingNorms.some(
    (e) => e && (normCandidate.includes(e) || e.includes(normCandidate))
  );
}

/**
 * @param {string[]} corpus            최근 스캔한 글 본문들
 * @param {Array}    groups            현재 키워드 그룹 (approved + pending 전부)
 * @param {string[]} rejected          사용자가 거절한 후보들
 * @param {number}   limit
 * @returns {Array<{value:string, count:number, score:number, samples:string[]}>}
 */
export function suggestKeywords(corpus, groups, rejected = [], limit = 12) {
  const existingNorms = [];
  for (const g of groups) for (const k of g.keywords || []) existingNorms.push(normalize(k.value));
  const rejectedNorms = rejected.map(normalize);
  const stopNorms = STOPWORDS.map(normalize);

  const counts = new Map();   // norm -> {count, samples:Set}

  for (const text of corpus) {
    const tokens = tokenize(text);
    const seenInThisPost = new Set();

    for (let n = 1; n <= 3; n += 1) {
      for (let i = 0; i + n <= tokens.length; i += 1) {
        const surface = tokens.slice(i, i + n).join(' ');
        const norm = normalize(surface);
        if (norm.length < MIN_LEN || norm.length > MAX_LEN) continue;
        if (!/[가-힣]/.test(norm)) continue;
        if (!hasAnchor(norm)) continue;
        if (stopNorms.includes(norm)) continue;
        if (rejectedNorms.includes(norm)) continue;
        if (alreadyCovered(norm, existingNorms)) continue;
        if (seenInThisPost.has(norm)) continue;     // 한 글에서 같은 표현은 1회만
        seenInThisPost.add(norm);

        const entry = counts.get(norm) || { count: 0, samples: new Set(), surface };
        entry.count += 1;
        if (entry.samples.size < 3) entry.samples.add(surface);
        counts.set(norm, entry);
      }
    }
  }

  const out = [];
  for (const [norm, entry] of counts) {
    if (entry.count < MIN_COUNT) continue;
    const anchorHits = INTENT_ANCHORS.filter((a) => norm.includes(normalize(a))).length;
    const lengthBonus = norm.length >= 5 ? 1.2 : 1;
    out.push({
      value: norm,
      surface: entry.surface,
      count: entry.count,
      score: Number((entry.count * (1 + anchorHits * 0.35) * lengthBonus).toFixed(2)),
      samples: [...entry.samples]
    });
  }

  out.sort((a, b) => b.score - a.score || b.count - a.count);

  // 서로 겹치는 후보는 점수 높은 쪽만 남긴다 ("어디서사요" vs "어디서사요링크")
  const kept = [];
  for (const cand of out) {
    if (kept.some((k) => k.value.includes(cand.value) || cand.value.includes(k.value))) continue;
    kept.push(cand);
    if (kept.length >= limit) break;
  }
  return kept;
}
