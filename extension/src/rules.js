/**
 * 수집 판단과 등급.
 *
 * 조건은 전부 **원글 기준**이다.
 *   1. 댓글 N개 이상   (기본 20)
 *   2. 판매자가 쓴 글   (seller.js)
 *   3. 좋아요 N개 이상 (기본 100)
 *
 * 셋 중 몇 개를 만족했느냐로 등급을 매긴다.
 *   A = 전부 만족 · B = 하나 모자람 · C = 하나만 만족 · D = 하나도 못 만족
 *
 * 등급은 **저장하지 않고 볼 때마다 계산한다.** 기준을 나중에 바꿔도
 * 이미 모아둔 글이 그 자리에서 다시 매겨지게 하기 위해서다.
 * 수치를 못 읽은 조건은 "만족했다"고 볼 수 없으므로 미달로 친다.
 */

import { detectSeller } from './seller.js';

export const GRADES = ['D', 'C', 'B', 'A'];
export const SKIP_REPLY = '답글';

/**
 * @param {object} post     { type, text, links, seller? }
 * @param {object} counts   { likes, replies }
 * @param {object} settings { minReplies, minLikes, requireSeller, sellerThreshold }
 * @returns {{grade:string, score:number, required:number, met:object, seller:?object}}
 */
export function gradePost(post, counts = {}, settings = {}) {
  const met = {};
  const enabled = [];

  const minReplies = Number(settings.minReplies) || 0;
  if (minReplies > 0) {
    enabled.push('replies');
    met.replies = counts.replies !== null && counts.replies !== undefined && counts.replies >= minReplies;
  }

  const minLikes = Number(settings.minLikes) || 0;
  if (minLikes > 0) {
    enabled.push('likes');
    met.likes = counts.likes !== null && counts.likes !== undefined && counts.likes >= minLikes;
  }

  // 판별 결과가 이미 있으면 다시 계산하지 않는다 (수집할 때 한 번 해둔 것)
  let seller = post.seller || null;
  if (settings.requireSeller !== false) {
    enabled.push('seller');
    if (!seller) seller = detectSeller(post.text, { links: post.links }, settings.sellerThreshold);
    met.seller = seller.score >= (Number(settings.sellerThreshold) || 3);
  }

  const required = enabled.length;
  const score = enabled.filter((k) => met[k]).length;

  let grade;
  if (!required) grade = 'A';
  else if (score === required) grade = 'A';
  else if (score === required - 1) grade = 'B';
  else if (score > 0) grade = 'C';
  else grade = 'D';

  return { grade, score, required, met, seller };
}

/** 등급 비교: 'B' 이상인가 */
export function gradeAtLeast(grade, floor) {
  return GRADES.indexOf(grade) >= GRADES.indexOf(floor || 'C');
}

/**
 * 수집할지 판단한다. 답글은 담지 않고, 등급이 바닥(minGrade) 이상이어야 담는다.
 * @returns {{collect:boolean, reason?:string, grade:string, seller:?object}}
 */
export function decideCollect(post, counts, settings = {}) {
  if (settings.postsOnly !== false && post.type === 'reply') {
    return { collect: false, reason: SKIP_REPLY, grade: null, seller: null };
  }
  const g = gradePost(post, counts, settings);
  const floor = settings.minGrade || 'C';
  if (!gradeAtLeast(g.grade, floor)) {
    return { collect: false, reason: `${g.grade}등급`, grade: g.grade, seller: g.seller };
  }
  return { collect: true, grade: g.grade, seller: g.seller };
}
