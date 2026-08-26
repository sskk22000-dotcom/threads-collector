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
  const posts = [
    { id: 'p1', author: 'banchan', url: 'https://www.threads.com/@banchan/post/p1', text: '이 청국장 어디서 사요? 너무 맛있어 보여요 링크 좀요', postedAt: '2026-08-20T01:00:00.000Z', counts: { likes: 42, replies: 3, reposts: 1 }, links: [], source: '/' },
    { id: 'p2', author: 'foodie', url: 'https://www.threads.com/@foodie/post/p2', text: '나도 샀어! 재구매까지 했습니다 배송 얼마나 걸려요', postedAt: '2026-08-21T01:00:00.000Z', counts: { likes: 10, replies: 0, reposts: 0 }, links: ['https://smartstore.naver.com/x'], source: '/' },
    { id: 'p3', author: 'nolink', url: 'https://www.threads.com/@nolink/post/p3', text: '오늘 날씨가 참 좋네요 산책 다녀왔습니다', postedAt: '2026-08-22T01:00:00.000Z', counts: {}, links: [], source: '/' },
    { id: 'p4', author: 'curious', url: 'https://www.threads.com/@curious/post/p4', text: '이거 뭐예요? 브랜드 알려주세요 배송 얼마나 걸리나요', postedAt: '2026-08-23T01:00:00.000Z', counts: { likes: 7 }, links: [], source: '/' },
    { id: 'p5', author: 'photo', url: 'https://www.threads.com/@photo/post/p5', text: '이 사진 어디서 사진 찍었어요? 배송 얼마나 걸렸어요', postedAt: '2026-08-24T01:00:00.000Z', counts: {}, links: [], source: '/' }
  ];
  const res = await chrome.runtime.sendMessage({ type: 'POSTS', posts });
  await chrome.runtime.sendMessage({ type: 'RUN_SUGGEST' });
  return res;
};
