/**
 * "판매자가 쓴 글"인지 판별한다.
 *
 * 신호는 실제로 수집된 피드 글에서 뽑았다. 예:
 *   "껍데기 파는 사장인데 솔직하게 주문이 없습니다"
 *   "칼국수 파는 사장입니다 무료배송에 1인분 1,400원인데 지나가다 하트 꾹 눌러주세요"
 *   "김치찌개를 판매하는 사장이야 믿고 주문해줘"
 *   "재고 없어서 11일 출고인데 지금 주문해도 11일에 나갑니다"
 *
 * 한 단어로 단정하지 않고 신호를 모아 점수로 판단한다. 판매 선언처럼 확실한
 * 신호는 그 자체로 통과시키고, 애매한 신호는 여러 개 모여야 통과한다.
 */

import { normalize } from './matcher.js';

/** weight 3 이상이면 하나만으로도 판매자 글로 본다 (기본 임계값 3). */
export const SELLER_SIGNALS = [
  // ── 판매 선언 (확실) ─────────────────────────────
  { value: '파는사장', weight: 3, label: '판매 선언' },
  { value: '판매하는사장', weight: 3, label: '판매 선언' },
  { value: '파는사람인데', weight: 3, label: '판매 선언' },
  { value: '판매하고있', weight: 3, label: '판매 선언' },
  { value: '판매합니다', weight: 3, label: '판매 선언' },
  { value: '판매중입니다', weight: 3, label: '판매 선언' },
  { value: '팔고있습니다', weight: 3, label: '판매 선언' },
  { value: '팔고싶습니다', weight: 3, label: '판매 선언' },
  { value: '만들어파', weight: 3, label: '판매 선언' },
  { value: '장사하는', weight: 3, label: '판매 선언' },
  { value: '사장인데', weight: 3, label: '판매 선언' },
  { value: '사장입니다', weight: 3, label: '판매 선언' },
  { value: '대표입니다', weight: 3, label: '판매 선언' },

  // ── 주문·재고·발송 (강함) ────────────────────────
  { value: '주문해주', weight: 2, label: '주문 유도' },
  { value: '주문해줘', weight: 2, label: '주문 유도' },
  { value: '주문폭주', weight: 2, label: '주문 유도' },
  { value: '지금주문', weight: 2, label: '주문 유도' },
  { value: '출고', weight: 2, label: '발송' },
  { value: '재고', weight: 2, label: '재고' },
  { value: '품절', weight: 2, label: '재고' },
  { value: '완판', weight: 2, label: '재고' },
  { value: '한정수량', weight: 2, label: '재고' },
  { value: '무료배송', weight: 2, label: '배송' },
  { value: '당일발송', weight: 2, label: '배송' },
  { value: '택배로', weight: 2, label: '배송' },
  { value: '배송비', weight: 2, label: '배송' },

  // ── 구매 유도 문구 (강함) ────────────────────────
  { value: '하트라도', weight: 3, label: '반응 유도' },
  { value: '하트꾹', weight: 3, label: '반응 유도' },
  { value: '하트눌러', weight: 3, label: '반응 유도' },
  { value: '지나가다하트', weight: 3, label: '반응 유도' },
  { value: '프로필링크', weight: 3, label: '구매 유도' },
  { value: '링크는프로필', weight: 3, label: '구매 유도' },
  { value: '프사클릭', weight: 3, label: '구매 유도' },
  { value: '아래링크', weight: 2, label: '구매 유도' },

  // ── 커머스 플랫폼 (강함) ─────────────────────────
  { value: '스마트스토어', weight: 3, label: '판매처' },
  { value: '자사몰', weight: 3, label: '판매처' },
  { value: '쿠팡', weight: 2, label: '판매처' },
  { value: '네이버쇼핑', weight: 2, label: '판매처' },
  { value: '공동구매', weight: 2, label: '판매처' },
  { value: '공구합니다', weight: 3, label: '판매처' },

  // ── 가격 제시 (보조) ─────────────────────────────
  { value: '할인', weight: 1, label: '가격' },
  { value: '특가', weight: 2, label: '가격' },
  { value: '최저가', weight: 2, label: '가격' },
  { value: '1인분', weight: 1, label: '가격' },
  { value: '세트', weight: 1, label: '가격' },
  { value: '쿠폰', weight: 1, label: '가격' }
];

/** "1,400원", "28800원", "2~3만원대" 같은 가격 표기 */
const PRICE_RE = /[\d,]{2,}\s*원|[\d.]+\s*만\s*원/;

/**
 * @param {string} text   글 본문
 * @param {object} extra  { links?: string[] } 외부 링크가 있으면 판매 글일 확률이 오른다
 * @param {number} threshold  이 점수 이상이면 판매자 글 (기본 3)
 * @returns {{isSeller:boolean, score:number, signals:string[]}}
 */
export function detectSeller(text, extra = {}, threshold = 3) {
  const norm = normalize(text);
  const signals = [];
  let score = 0;

  if (norm) {
    for (const sig of SELLER_SIGNALS) {
      if (norm.includes(normalize(sig.value))) {
        score += sig.weight;
        signals.push(sig.value);
      }
    }
  }

  if (PRICE_RE.test(String(text || ''))) {
    score += 1;
    signals.push('가격표기');
  }

  const links = extra.links || [];
  if (links.length) {
    score += 2;
    signals.push('외부링크');
  }

  return { isSeller: score >= threshold, score, signals };
}
