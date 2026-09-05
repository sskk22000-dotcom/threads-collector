/* 키워드 매칭 / 정규화 / 추천 발굴에 대한 회귀 테스트. tests/run.sh 로 실행. */

var OUT = [];
var pass = 0;
var fail = 0;

function check(name, cond) {
  if (cond) { pass += 1; OUT.push('  ok   ' + name); }
  else { fail += 1; OUT.push('  FAIL ' + name); }
}

var groups = seedKeywordList();
function hitsFor(text) {
  return matchKeywords(text, groups, { onlyApproved: true }).hits.map(function (h) { return h.keyword; });
}
function matched(text) { return hitsFor(text).length > 0; }

/* ---------------------------------------------------------- normalize */
OUT.push('normalize');
check('공백/문장부호 제거', normalize('어디서 사요?') === '어디서사요');
check('이모지 제거', normalize('링크 좀요 🙏') === '링크좀요');
check('영문 소문자화', normalize('LINK 좀') === 'link좀');
check('빈 입력', normalize('') === '' && normalize(null) === '');

/* ------------------------------------------------- 직접 구매요청형 매칭 */
OUT.push('직접 구매요청형');
check('어디서 사요', matched('이 청국장 어디서 사요? 너무 맛있어 보여요'));
check('어디서 살 수 있나요', matched('저거 어디서 살 수 있나요??'));
check('구매처', matched('구매처 알려주시면 감사하겠습니다'));
check('판매처', matched('판매처가 어디인지 궁금해요'));
check('링크 좀', matched('링크 좀요!!'));
check('링크 알려주세요', matched('링크 알려주세요 ㅠㅠ'));
check('정보 부탁', matched('정보 부탁드려요'));

/* -------------------------------------------------------- 오탐 방지 */
OUT.push('오탐 방지');
check('“어디서 사진 찍었어요” 제외', !matched('이 사진 어디서 사진 찍었어요?'));
check('“어디서 사용하나요” 제외', !matched('이 앱은 어디서 사용하나요'));
check('일반 잡담은 매칭 안 됨', !matched('오늘 날씨가 참 좋네요 산책 다녀왔습니다'));

/* ------------------------------------------------- 구매의향/후기형 */
OUT.push('구매의향/후기형');
check('사고싶다', matched('이거 진짜 사고싶다...'));
check('나도 샀어', matched('나도 샀어! 배송 기다리는 중'));
check('저도 샀어요', matched('저도 샀어요 완전 만족'));
check('재구매', matched('벌써 세 번째 재구매입니다'));
check('결제했어요', matched('고민하다 결제했어요'));
check('장바구니', matched('장바구니에 담아뒀어요'));

/* --------------------------------------------------- 제품명 문의형 */
OUT.push('제품명 문의형');
check('이거 뭐예요', matched('이거 뭐예요? 넘 예쁘다'));
check('어디꺼', matched('그 가방 어디꺼예요?'));
check('브랜드 알려주세요', matched('브랜드 알려주세요~'));
check('뭐 쓰세요', matched('화장품 뭐 쓰세요?'));

/* ------------------------------------------------ pending 그룹 격리 */
OUT.push('컨펌 대기 그룹은 수집에 안 쓰임');
check('가격/할인형은 기본 미적용', !matched('이거 얼마예요?'));
check('컨펌하면 적용됨', (function () {
  var approvedAll = groups.map(function (g) { return { ...g, status: 'approved' }; });
  return matchKeywords('이거 얼마예요?', approvedAll, { onlyApproved: true }).hits.length > 0;
})());

/* ------------------------------------------------------- 결과 형태 */
OUT.push('매칭 결과');
check('그룹 id 가 함께 나옴', (function () {
  var r = matchKeywords('구매처 링크 좀 알려주세요', groups, { onlyApproved: true });
  return r.groups.indexOf('direct_purchase_request') >= 0;
})());
check('여러 키워드 동시 히트', hitsFor('구매처 링크 좀 알려주세요').length >= 2);
check('스니펫 생성', snippetAround('앞부분 텍스트입니다 구매처 어디인가요 뒷부분', '구매처').indexOf('구매처') >= 0);

/* ----------------------------------------------------- 추천 발굴 */
OUT.push('키워드 추천 발굴');
var corpus = [
  '배송 얼마나 걸려요 너무 궁금해요',
  '혹시 배송 얼마나 걸리나요',
  '배송 얼마나 걸렸어요 저도 주문했어요',
  '날씨가 좋아서 산책했어요',
  '오늘도 산책했어요'
];
var sugs = suggestKeywords(corpus, groups, []);
check('반복되는 구매의도 표현을 후보로 뽑음', sugs.length > 0);
check('구매의도 앵커 없는 표현은 제외', sugs.every(function (s) { return s.value.indexOf('산책했어요') < 0; }));
check('이미 등록된 키워드는 후보에서 제외', sugs.every(function (s) { return s.value !== '구매처'; }));
check('후보는 자동 반영되지 않음(단순 목록)', sugs.every(function (s) { return s.count >= 2; }));

/* ------------------------------------------------- 레퍼런스 계정 / 검색어 */
OUT.push('레퍼런스 계정');
check('@ 접두사 제거', normalizeHandle('@banchan') === 'banchan');
check('프로필 URL 에서 핸들 추출', normalizeHandle('https://www.threads.com/@banchan') === 'banchan');
check('글 URL 에서도 핸들 추출', normalizeHandle('threads.com/@banchan/post/abc123') === 'banchan');
check('대문자 통일', normalizeHandle('@BanChan') === 'banchan');
check('잘못된 입력은 빈 문자열', normalizeHandle('한글아이디') === '' && normalizeHandle('') === '');

var accounts = [{ username: 'banchan', collectAll: true }, { username: 'foodie', collectAll: false }];
check('등록된 계정 찾기', findAccount('banchan', accounts) !== null);
check('@ 붙여도 찾기', findAccount('@BANCHAN', accounts) !== null);
check('미등록 계정은 null', findAccount('stranger', accounts) === null);
check('중복 등록 판정', hasAccount('https://www.threads.com/@foodie', accounts) === true);
check('빈 목록 안전', findAccount('banchan', []) === null && findAccount('banchan', undefined) === null);

OUT.push('검색어');
check('연속 공백 정리', normalizeSearchTerm('  청국장   어디서  사요 ') === '청국장 어디서 사요');
check('검색 URL 인코딩', searchUrl('어디서 사요').indexOf('%EC%96%B4%EB%94%94%EC%84%9C') > 0);
check('프로필 URL 생성', profileUrl('@BanChan') === 'https://www.threads.com/@banchan');

/* ---------------------------------------------------- 숫자 표기 파싱 */
OUT.push('숫자 표기 파싱');
check('천 단위 구분자', parseCount('1,234') === 1234);
check('만 단위', parseCount('1.2만') === 12000);
check('억 단위', parseCount('2억') === 200000000);
check('K 접미사', parseCount('3.4K') === 3400);
check('M 접미사', parseCount('2.1M') === 2100000);
check('레이블이 붙어 있어도 추출', parseCount('조회수 1.2만회') === 12000);
check('좋아요 레이블', parseCount('좋아요 523개') === 523);
check('숫자 0 은 0 으로 (모름 아님)', parseCount('0') === 0);
check('숫자 없으면 null', parseCount('좋아요') === null && parseCount('') === null && parseCount(null) === null);
check('숫자 타입 그대로', parseCount(4321) === 4321);

OUT.push('숫자 표기 출력');
check('만 단위로 축약', formatCount(12345) === '1.2만');
check('만 미만은 구분자', formatCount(1234) === '1,234');
check('모르면 대시', formatCount(null) === '—');

OUT.push('임계값 필터');
check('기준 미달은 탈락', passesThreshold(500, 10000, false) === false);
check('기준 이상은 통과', passesThreshold(20000, 10000, false) === true);
check('기준이 0 이면 항상 통과', passesThreshold(null, 0, false) === true);
check('모르는 값은 기본적으로 탈락', passesThreshold(null, 10000, false) === false);
check('모르는 값 포함 옵션', passesThreshold(null, 10000, true) === true);

OUT.push('상세 페이지 조회수 추출');
check('임베드 JSON 에서 추출', extractViewCount('{"a":1,"view_count":45210,"b":2}') === 45210);
check('문자열로 감싼 값', extractViewCount('"views_count":"8800"') === 8800);
check('화면 표기에서 추출', extractViewCount('<span>조회수 3.2만회</span>') === 32000);
check('영문 표기에서 추출', extractViewCount('<span>12.5K views</span>') === 12500);
check('없으면 null', extractViewCount('<html>아무것도 없음</html>') === null && extractViewCount('') === null);

/* ---------------------------------------------------- 수집 기준(게이트) */
OUT.push('수집 기준');
var OR = { minLikes: 100, minReplies: 20, gateMode: 'or', gateAllowUnknown: true };
var AND = { minLikes: 100, minReplies: 20, gateMode: 'and', gateAllowUnknown: true };

check('or: 좋아요만 넘어도 통과', gateResult({ likes: 500, replies: 3 }, OR) === 'pass');
check('or: 댓글만 넘어도 통과', gateResult({ likes: 5, replies: 40 }, OR) === 'pass');
check('or: 둘 다 미달이면 탈락', gateResult({ likes: 5, replies: 3 }, OR) === 'fail');
check('or: 하나만 미달이고 하나는 모르면 단정 안 함', gateResult({ likes: 5, replies: null }, OR) === 'unknown');
check('and: 둘 다 넘어야 통과', gateResult({ likes: 500, replies: 40 }, AND) === 'pass');
check('and: 하나만 넘으면 탈락', gateResult({ likes: 500, replies: 3 }, AND) === 'fail');
check('and: 하나를 모르면 단정 안 함', gateResult({ likes: 500, replies: null }, AND) === 'unknown');
check('둘 다 모르면 판단 불가', gateResult({ likes: null, replies: null }, OR) === 'unknown');
check('기준이 0 이면 전부 통과', gateResult({ likes: null, replies: null }, { minLikes: 0, minReplies: 0 }) === 'pass');

check('모르는 값 허용 시 수집', shouldCollect({ likes: null, replies: null }, OR) === true);
check('모르는 값 불허 시 제외', shouldCollect({ likes: null, replies: null }, { ...OR, gateAllowUnknown: false }) === false);
check('미달은 허용 설정과 무관하게 제외', shouldCollect({ likes: 1, replies: 1 }, OR) === false);

/* ---------------------------------------------------------- 언어 판별 */
OUT.push('언어 판별');
check('한국어 글', isKorean('이 청국장 어디서 사요? 너무 맛있어 보여요') === true);
check('영어 글 제외', isKorean('Where can I buy this? It looks so delicious') === false);
check('일본어 글 제외', isKorean('これはどこで買えますか。とても美味しそうです') === false);
check('한글 섞인 영어는 비중으로 판단', isKorean('Threads 마케팅 레퍼런스를 모으는 중입니다 정말 좋네요') === true);
check('글자가 거의 없으면 거르지 않음', isKorean('🔥🔥 !!') === true && isKorean('') === true);
check('한글 비중 계산', Math.round(koreanRatio('한글abc') * 100) === 40);

OUT.push('');
OUT.push('통과 ' + pass + ' / 실패 ' + fail);

(function () {
  var text = OUT.join('\n');
  // node 는 stdout 으로 출력, JXA(osascript)는 마지막 표현식 값이 stdout 으로 나간다
  if (typeof process !== 'undefined' && process.stdout) { console.log(text); return ''; }
  return text;
})();
