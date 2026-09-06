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
    // 판매자 원글 (반응 좋음) — 게이트 통과해야 함
    { id: 's1', type: 'post', parentId: null, parentUrl: null, author: 'kimchi_boss',
      url: U('kimchi_boss','s1'), authorUrl: 'https://www.threads.com/@kimchi_boss',
      text: '김치찌개 파는 사장이야💕 1등급 한돈이 통째로 들어간 통돼지김치찌개 정성담아 만들고 있어',
      postedAt: '2026-09-01T01:00:00.000Z',
      countsRaw: { likes: '1,203', replies: '87', reposts: '12' }, images: [img('a'), img('b'), img('c')], links: [] },

    // 그 글에 달린 구매 문의 답글들
    { id: 'r1', type: 'reply', parentId: 's1', parentUrl: U('kimchi_boss','s1'), author: 'hungry_kim',
      url: U('hungry_kim','r1'), text: '이거 어디서 사요? 링크 좀요!!', postedAt: '2026-09-01T02:00:00.000Z',
      countsRaw: { likes: '3' }, images: [], links: [] },
    { id: 'r2', type: 'reply', parentId: 's1', parentUrl: U('kimchi_boss','s1'), author: 'seoul_mom',
      url: U('seoul_mom','r2'), text: '구매처 알려주세요 저도 사고싶어요', postedAt: '2026-09-01T03:00:00.000Z',
      countsRaw: { likes: '1' }, images: [], links: [] },
    { id: 'r3', type: 'reply', parentId: 's1', parentUrl: U('kimchi_boss','s1'), author: 'foodlover',
      url: U('foodlover','r3'), text: '나도 샀어! 재구매까지 했습니다', postedAt: '2026-09-01T04:00:00.000Z',
      countsRaw: {}, images: [], links: [] },

    // 반응 없는 판매자 원글 — 게이트에서 탈락해야 함
    { id: 's2', type: 'post', parentId: null, parentUrl: null, author: 'tiny_shop',
      url: U('tiny_shop','s2'), text: '껍데기 파는 사장인데 주문이 없습니다 지나가다 하트라도 부탁합니다',
      postedAt: '2026-09-02T01:00:00.000Z', countsRaw: { likes: '3', replies: '1' }, images: [], links: [] },

    // 아직 본문을 모르는 판매자 원글을 가리키는 답글 (자리표시자 + 큐 확인용)
    { id: 'r4', type: 'reply', parentId: 's3', parentUrl: U('unknown_seller','s3'), author: 'curious2',
      url: U('curious2','r4'), text: '이거 뭐예요? 브랜드 알려주세요 어디서 살 수 있나요',
      postedAt: '2026-09-03T01:00:00.000Z', countsRaw: { likes: '2' }, images: [], links: [] },

    // 키워드는 없지만 댓글이 많은 글 — "일단 수집" 규칙으로 담겨야 함
    { id: 'h1', type: 'post', parentId: null, parentUrl: null, author: 'hot_seller',
      url: U('hot_seller','h1'), text: '명란젓 파는 사장인데 언젠가는 인정받고 싶습니다 못난이 명란 400g',
      postedAt: '2026-09-04T01:00:00.000Z', countsRaw: { likes: '32', replies: '113', reposts: '4' }, images: [], links: [] },

    // 키워드는 맞지만 반응이 거의 없는 글 — 게이트에서 탈락해야 함
    { id: 'q1', type: 'post', parentId: null, parentUrl: null, author: 'quiet_one',
      url: U('quiet_one','q1'), text: '이거 어디서 사요? 아무도 안 보는 글',
      postedAt: '2026-09-04T02:00:00.000Z', countsRaw: { likes: '1', replies: '1' }, images: [], links: [] },

    // 수치를 못 읽은 글 — gateAllowUnknown=false 이므로 제외돼야 함
    { id: 'n1', type: 'post', parentId: null, parentUrl: null, author: 'no_counts',
      url: U('no_counts','n1'), text: '구매처 어디인가요 정보 좀 부탁드려요',
      postedAt: '2026-09-04T03:00:00.000Z', countsRaw: {}, images: [], links: [] },

    // 외국어 글 — 언어 필터에서 제외돼야 함
    { id: 'f1', type: 'post', parentId: null, parentUrl: null, author: 'us_seller',
      url: U('us_seller','f1'), text: 'Where can I buy this amazing kimchi stew? Please send me the link!',
      postedAt: '2026-09-03T02:00:00.000Z', countsRaw: { likes: '5,000', replies: '300' }, images: [], links: [] }
  ];
  const res = await chrome.runtime.sendMessage({ type: 'POSTS', posts });
  await chrome.runtime.sendMessage({ type: 'RUN_SUGGEST' });
  return res;
};
