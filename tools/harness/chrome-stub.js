// 브라우저에서 popup + background 를 실제로 붙여 돌려보기 위한 chrome API 스텁.
const mem = {};
const listeners = { message: [], changed: [] };
window.__log = [];

window.chrome = {
  runtime: {
    onInstalled: { addListener: (fn) => fn() },
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    sendMessage: (msg) => new Promise((resolve) => {
      window.__log.push('send:' + msg.type);
      let answered = false;
      for (const fn of listeners.message) {
        const ret = fn(msg, {}, (res) => { answered = true; resolve(res); });
        if (ret === true) return;
      }
      if (!answered) resolve(undefined);
    })
  },
  storage: {
    local: {
      get: async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (k in mem) out[k] = mem[k];
        return out;
      },
      set: async (patch) => {
        const changes = {};
        for (const [k, v] of Object.entries(patch)) { changes[k] = { newValue: v }; mem[k] = v; }
        listeners.changed.forEach((fn) => fn(changes, 'local'));
      }
    },
    onChanged: { addListener: (fn) => listeners.changed.push(fn) }
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  downloads: { download: async (o) => window.__log.push('download:' + o.filename) },
  tabs: {
    query: async () => [{ url: 'https://www.threads.com/' }],
    create: (o) => window.__log.push('tab:' + o.url)
  }
};

// 수집 상태를 켜고 가짜 글을 흘려보내 background 파이프라인 전체를 태운다.
window.__seed = async () => {
  await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: { collecting: true } });
  const img = (seed) => `https://picsum.photos/seed/${seed}/300/300`;
  const posts = [
    { id: 'p1', type: 'post', author: 'banchan', url: 'https://www.threads.com/@banchan/post/p1', authorUrl: 'https://www.threads.com/@banchan', text: '이 청국장 어디서 사요? 너무 맛있어 보여요 링크 좀요\n진짜 며칠째 생각나서 잠이 안 옴', postedAt: '2026-08-20T01:00:00.000Z', countsRaw: { views: '조회수 4.2만회', likes: '좋아요 1,203개', replies: '답글 87개', reposts: '리포스트 12개' }, images: [img('a'), img('b'), img('c')], links: [], source: '/' },
    { id: 'p2', type: 'reply', author: 'foodie', url: 'https://www.threads.com/@foodie/post/p2', authorUrl: 'https://www.threads.com/@foodie', text: '나도 샀어! 재구매까지 했습니다 배송 얼마나 걸려요', postedAt: '2026-08-21T01:00:00.000Z', countsRaw: { views: '조회수 8,300회', likes: '좋아요 210개', replies: '답글 34개', reposts: null }, images: [img('d')], links: ['https://smartstore.naver.com/x'], source: '/' },
    { id: 'p3', author: 'nolink', url: 'https://www.threads.com/@nolink/post/p3', authorUrl: 'https://www.threads.com/@nolink', text: '오늘 날씨가 참 좋네요 산책 다녀왔습니다', postedAt: '2026-08-22T01:00:00.000Z', countsRaw: {}, images: [], links: [], source: '/' },
    { id: 'p4', type: 'reply', author: 'curious', url: 'https://www.threads.com/@curious/post/p4', authorUrl: 'https://www.threads.com/@curious', text: '이거 뭐예요? 브랜드 알려주세요 배송 얼마나 걸리나요', postedAt: '2026-08-23T01:00:00.000Z', countsRaw: { views: '12.5K views', likes: '740', replies: '답글 21개' }, images: [img('e'), img('f')], links: [], source: '/' },
    { id: 'p5', author: 'photo', url: 'https://www.threads.com/@photo/post/p5', authorUrl: 'https://www.threads.com/@photo', text: '이 사진 어디서 사진 찍었어요? 배송 얼마나 걸렸어요', postedAt: '2026-08-24T01:00:00.000Z', countsRaw: {}, images: [], links: [], source: '/' },
    { id: 'p6', author: 'lowview', url: 'https://www.threads.com/@lowview/post/p6', authorUrl: 'https://www.threads.com/@lowview', text: '구매처 어디인가요? 정보 좀 부탁드려요', postedAt: '2026-08-25T01:00:00.000Z', countsRaw: { views: '조회수 900회', likes: '12', replies: '답글 3개' }, images: [], links: [], source: '/' },
    { id: 'p7', type: 'post', author: 'noviews', url: 'https://www.threads.com/@noviews/post/p7', authorUrl: 'https://www.threads.com/@noviews', text: '이거 어디서 살 수 있나요? 댓글 많이 달렸네요', postedAt: '2026-08-26T01:00:00.000Z', countsRaw: { likes: '좋아요 980개', replies: '답글 64개' }, images: [img('g')], links: [], source: '/' }
  ];
  const res = await chrome.runtime.sendMessage({ type: 'POSTS', posts });
  await chrome.runtime.sendMessage({ type: 'RUN_SUGGEST' });
  return res;
};
