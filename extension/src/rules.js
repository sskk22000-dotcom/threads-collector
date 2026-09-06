/**
 * 수집 판단. 조건은 전부 **원글 기준**이고, 셋 다 만족해야 담는다.
 *
 *   1. 댓글 N개 이상   (기본 20)
 *   2. 판매자가 쓴 글   (seller.js 로 판별)
 *   3. 좋아요 N개 이상 (기본 100)
 *
 * 수치를 못 읽었으면 "만족했다"고 볼 수 없으므로 담지 않는다.
 * 각 조건은 0 / false 로 끌 수 있다.
 */

import { detectSeller } from './seller.js';

export const SKIP = {
  REPLY: '답글',
  NO_REPLIES: '댓글수 못 읽음',
  LOW_REPLIES: '댓글 부족',
  NO_LIKES: '좋아요수 못 읽음',
  LOW_LIKES: '좋아요 부족',
  NOT_SELLER: '판매자 글 아님'
};

/**
 * @param {object} post      { type, text, links }
 * @param {object} counts    { likes, replies, ... }
 * @param {object} settings  { postsOnly, minReplies, minLikes, requireSeller, sellerThreshold }
 * @returns {{collect:boolean, reason?:string, seller?:object}}
 */
export function decideCollect(post, counts, settings = {}) {
  // 원글만 수집한다. 답글은 판매자 글을 찾는 단서로만 쓴다.
  if (settings.postsOnly !== false && post.type === 'reply') {
    return { collect: false, reason: SKIP.REPLY };
  }

  const minReplies = Number(settings.minReplies) || 0;
  if (minReplies > 0) {
    if (counts.replies === null || counts.replies === undefined) {
      return { collect: false, reason: SKIP.NO_REPLIES };
    }
    if (counts.replies < minReplies) return { collect: false, reason: SKIP.LOW_REPLIES };
  }

  const minLikes = Number(settings.minLikes) || 0;
  if (minLikes > 0) {
    if (counts.likes === null || counts.likes === undefined) {
      return { collect: false, reason: SKIP.NO_LIKES };
    }
    if (counts.likes < minLikes) return { collect: false, reason: SKIP.LOW_LIKES };
  }

  if (settings.requireSeller !== false) {
    const seller = detectSeller(post.text, { links: post.links }, settings.sellerThreshold);
    if (!seller.isSeller) return { collect: false, reason: SKIP.NOT_SELLER, seller };
    return { collect: true, seller };
  }

  return { collect: true };
}
