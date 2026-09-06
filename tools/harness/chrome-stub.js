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
  const U = (h, id) => `https://www.threads.com/@${h}/post/${id}`;

  const posts = [
    // ① 댓글 87 ② 판매자 글 ③ 좋아요 1203 — 셋 다 만족 → 수집
    { id: 's1', type: 'post', parentId: null, parentUrl: null, author: 'kimchi_boss',
      url: U('kimchi_boss','s1'), authorUrl: 'https://www.threads.com/@kimchi_boss',
      text: '치니들 나는 김치찌개를 판매하는 사장이야💕 1등급 한돈이 통째로 들어간 통돼지김치찌개 믿고 주문해줘🙏',
      postedAt: '2026-09-01T01:00:00.000Z',
      countsRaw: { likes: '1,203', replies: '87', reposts: '12' }, images: [img('a'), img('b'), img('c')], links: [] },

    // 그 글에 달린 구매 문의 답글 (수집되지 않고 문의로만 붙어야 함)
    { id: 'r1', type: 'reply', parentId: 's1', parentUrl: U('kimchi_boss','s1'), author: 'hungry_kim',
      url: U('hungry_kim','r1'), text: '이거 어디서 사요? 링크 좀요!!', postedAt: '2026-09-01T02:00:00.000Z',
      countsRaw: { likes: '3' }, images: [], links: [] },
    { id: 'r2', type: 'reply', parentId: 's1', parentUrl: U('kimchi_boss','s1'), author: 'seoul_mom',
      url: U('seoul_mom','r2'), text: '구매처 알려주세요 저도 사고싶어요', postedAt: '2026-09-01T03:00:00.000Z',
      countsRaw: { likes: '1' }, images: [], links: [] },

    // 판매자 글 + 댓글 113 인데 좋아요 32 → ③ 미달로 제외
    { id: 'x1', type: 'post', parentId: null, parentUrl: null, author: 'few_likes',
      url: U('few_likes','x1'), text: '명란젓 파는 사장인데 언젠가는 인정받고 싶습니다 못난이 명란 400g 9,900원',
      postedAt: '2026-09-02T01:00:00.000Z', countsRaw: { likes: '32', replies: '113' }, images: [], links: [] },

    // 판매자 글 + 좋아요 500 인데 댓글 5 → ① 미달로 제외
    { id: 'x2', type: 'post', parentId: null, parentUrl: null, author: 'few_replies',
      url: U('few_replies','x2'), text: '칼국수 파는 사장입니다 무료배송에 1인분 1,400원인데 지나가다 하트 꾹 눌러주세요',
      postedAt: '2026-09-02T02:00:00.000Z', countsRaw: { likes: '500', replies: '5' }, images: [], links: [] },

    // 수치는 넉넉한데 판매자 글이 아님 → ② 미달로 제외
    { id: 'x3', type: 'post', parentId: null, parentUrl: null, author: 'just_daily',
      url: U('just_daily','x3'), text: '오늘 9시경 용산에서 노량진 오는 지하철 안에서 찍은건데 영화의 한 장면 같더라',
      postedAt: '2026-09-02T03:00:00.000Z', countsRaw: { likes: '2,400', replies: '150' }, images: [img('g')], links: [] },

    // 수치를 못 읽은 판매자 글 → 만족했다고 볼 수 없어 제외
    { id: 'x4', type: 'post', parentId: null, parentUrl: null, author: 'no_counts',
      url: U('no_counts','x4'), text: '껍데기 파는 사장인데 주문이 없습니다 지나가다 하트라도 부탁합니다',
      postedAt: '2026-09-02T04:00:00.000Z', countsRaw: {}, images: [], links: [] },

    // 외국어 판매자 글 → 언어 필터에서 제외
    { id: 'f1', type: 'post', parentId: null, parentUrl: null, author: 'us_seller',
      url: U('us_seller','f1'), text: 'I sell handmade kimchi stew. Free shipping today! Order now please',
      postedAt: '2026-09-03T02:00:00.000Z', countsRaw: { likes: '5,000', replies: '300' }, images: [], links: [] }
  ];
  const res = await chrome.runtime.sendMessage({ type: 'POSTS', posts });
  await chrome.runtime.sendMessage({ type: 'RUN_SUGGEST' });
  return res;
};
