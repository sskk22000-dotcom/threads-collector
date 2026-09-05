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

OUT.push('');
OUT.push('통과 ' + pass + ' / 실패 ' + fail);

(function () {
  var text = OUT.join('\n');
  // node 는 stdout 으로 출력, JXA(osascript)는 마지막 표현식 값이 stdout 으로 나간다
  if (typeof process !== 'undefined' && process.stdout) { console.log(text); return ''; }
  return text;
})();
