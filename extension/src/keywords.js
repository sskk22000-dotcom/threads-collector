/**
 * 시드 키워드 뱅크.
 *
 * status
 *   - "approved" : 사용자가 이미 컨펌한 그룹. 바로 수집에 사용된다.
 *   - "pending"  : 내가 추천만 해둔 그룹. 팝업에서 "승인"을 눌러야 수집에 반영된다.
 *
 * keyword
 *   - value   : phrase는 정규화된(공백/문장부호 제거, 소문자) 부분문자열, regex는 정규화된 문자열에 대한 정규식
 *   - exclude : 이 정규화 문자열이 글에 들어있으면 해당 키워드 매칭을 무효화 (오탐 방지)
 *
 * 정규화 규칙은 matcher.js 의 normalize() 와 반드시 같아야 한다.
 */

export const SEED_GROUPS = [
  {
    id: 'direct_purchase_request',
    label: '직접 구매요청형',
    description: '구매처/링크를 대놓고 물어보는 글. 레퍼런스 가치가 가장 높음.',
    status: 'approved',
    keywords: [
      { value: '어디서사', exclude: ['어디서사진', '어디서사용', '어디서사은', '어디서사인'] },
      { value: '어디서살수있' },
      { value: '어디서구매' },
      { value: '어디서구했' },
      { value: '어디서파', exclude: ['어디서파티', '어디서파도'] },
      { value: '어디서주문' },
      { value: '구매처' },
      { value: '구입처' },
      { value: '판매처' },
      { value: '구매링크' },
      { value: '판매링크' },
      { value: '구매처링크' },
      { value: '링크알려주' },
      { value: '링크좀' },
      { value: '링크주세요' },
      { value: '링크부탁' },
      { value: '링크플리즈' },
      { value: '링크남겨주' },
      { value: '정보좀' },
      { value: '정보부탁' },
      { value: '정보알려주' },
      { value: '어디서사면되', note: '“어디서 사면 되나요”' }
    ]
  },
  {
    id: 'purchase_intent',
    label: '구매의향/후기형',
    description: '사고 싶다 / 나도 샀다 같은 구매 전환 신호가 있는 글.',
    status: 'approved',
    keywords: [
      { value: '사고싶' },
      { value: '사고파', exclude: ['사고파는', '사고팔'] },
      { value: '살까' },
      { value: '사야겠' },
      { value: '사야지' },
      { value: '지르고싶' },
      { value: '지름신' },
      { value: '나도샀' },
      { value: '나도살래' },
      { value: '나도샀어' },
      { value: '저도샀' },
      { value: '저도살래' },
      { value: '재구매' },
      { value: '결제했' },
      { value: '주문했' },
      { value: '장바구니' },
      { value: '품절대란' },
      { value: '완판' },
      { value: '강추' },
      { value: '인생템' }
    ]
  },
  {
    id: 'product_inquiry',
    label: '제품명 문의형',
    description: '제품/브랜드가 뭔지 물어보는 글. 구매 직전 단계.',
    status: 'approved',
    keywords: [
      { value: '이거뭐예요' },
      { value: '이거뭐에요' },
      { value: '이거뭔가요' },
      { value: '이거뭐야' },
      { value: '제품명' },
      { value: '상품명' },
      { value: '제품정보' },
      { value: '브랜드알려주' },
      { value: '브랜드가뭐' },
      { value: '어디꺼', exclude: ['어디꺼나'] },
      { value: '어디거예요' },
      { value: '어디건가요' },
      { value: '뭐쓰세요' },
      { value: '뭐쓰시나요' },
      { value: '무슨제품' },
      { value: '어떤제품' },
      { value: '이름이뭐' },
      { value: '뭐예요그거' }
    ]
  },
  {
    id: 'price_discount',
    label: '가격/할인형',
    description: '가격·할인·공구 언급. 구매 의도는 있지만 잡음도 섞임.',
    status: 'pending',
    keywords: [
      { value: '얼마예요' },
      { value: '얼마에요' },
      { value: '얼마인가요' },
      { value: '가격얼마' },
      { value: '가격알려주' },
      { value: '할인코드' },
      { value: '할인중' },
      { value: '최저가' },
      { value: '쿠폰' },
      { value: '공동구매' },
      { value: '공구합니다' }
    ]
  },
  {
    id: 'commerce_platform',
    label: '커머스 플랫폼 언급형',
    description: '실제 구매처 이름이 나오는 글. 링크가 붙어 있을 확률이 높음.',
    status: 'pending',
    keywords: [
      { value: '스마트스토어' },
      { value: '쿠팡' },
      { value: '네이버쇼핑' },
      { value: '오늘의집' },
      { value: '무신사' },
      { value: '올리브영' },
      { value: '지그재그' },
      { value: '에이블리' },
      { value: '아이허브' },
      { value: '텐바이텐' }
    ]
  }
];

/** 추천 키워드 자동 발굴에 쓰는 구매의도 앵커. 이 근처의 표현을 후보로 뽑는다. */
export const INTENT_ANCHORS = [
  '사', '삽', '샀', '살', '구매', '구입', '주문', '결제', '링크', '가격',
  '얼마', '판매', '품절', '배송', '제품', '브랜드', '어디'
];

/** 후보 추천에서 항상 제외할 일반어(불용어). */
export const STOPWORDS = [
  '그리고', '그래서', '하지만', '진짜로', '너무너무', '이렇게', '저렇게',
  '있습니다', '없습니다', '입니다', '합니다', '감사합니다', '안녕하세요',
  '오늘도', '저는요', '우리는', '여러분', '사람들이', '이야기', '생각이'
];

export function seedKeywordList() {
  return SEED_GROUPS.map((g) => ({
    ...g,
    origin: 'seed',
    keywords: g.keywords.map((k) => ({ exclude: [], note: '', ...k }))
  }));
}
