import { formatCount } from './counts.js';
import { DEFAULT_SETTINGS, DEFAULT_STATS } from './storage.js';

const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null;
const f = { source: 'all', sort: 'reaction', q: '', status: 'todo', category: '' };

const num = (v) => (v === null || v === undefined ? null : v);
const reaction = (p) => (p.counts?.likes || 0) + (p.counts?.replies || 0) * 3;
const reviewOf = (p) => p.review || (p.picked ? 'pick' : null);

// 본문 키워드로 자동 카테고리 분류 (음식 사업 맥락)
const CATEGORIES = [
  ['국물/곰탕', /곰탕|사골|국물|육수|설렁탕|국밥|우거지|해장|탕\b/],
  ['카레', /카레|커리/],
  ['돈까스/분식', /돈까스|돈카츠|카츠|떡볶이|순대|우동|라면|김밥|튀김/],
  ['반찬/김치', /반찬|김치|젓갈|장아찌|나물|밑반찬|무침|겉절이/],
  ['고기/닭', /닭발|닭강정|닭|삼겹|불고기|족발|보쌈|갈비|곱창|고기/],
  ['디저트/베이커리', /디저트|빵|쿠키|케이크|과자|베이커리|마카롱|스콘|크로플|두쫀쿠/],
  ['음료/카페', /카페|커피|음료|라떼|에이드|스무디/],
  ['밀키트/간편식', /밀키트|간편식|즉석|레토르트|데워|데우기/]
];
function categoryOf(p) {
  const t = p.text || '';
  for (const [name, re] of CATEGORIES) if (re.test(t)) return name;
  return '기타';
}

function kindMap() {
  const m = new Map();
  for (const a of state.accounts || []) {
    const h = String(a.username || '').toLowerCase();
    m.set(h, a.kind === 'own' ? 'own' : 'reference');
  }
  return m;
}

function postKind(p, km) {
  if (p.accountKind) return p.accountKind;
  const h = String(p.account || p.author || '').toLowerCase();
  return km.get(h) || null;
}

/* ----------------------------------------------------------- 검토 */

function filtered() {
  const km = kindMap();
  const q = f.q.trim().toLowerCase();
  let list = (state.posts || []).filter((p) => !p.pending && (p.text || '').trim());
  if (f.source !== 'all') list = list.filter((p) => postKind(p, km) === f.source);
  if (f.status === 'todo') list = list.filter((p) => !reviewOf(p));
  else if (f.status === 'pick') list = list.filter((p) => reviewOf(p) === 'pick');
  else if (f.status === 'reject') list = list.filter((p) => reviewOf(p) === 'reject');
  if (f.category) list = list.filter((p) => categoryOf(p) === f.category);
  if (q) list = list.filter((p) => (`${p.text} ${p.author}`).toLowerCase().includes(q));

  const sorters = {
    reaction: (a, b) => reaction(b) - reaction(a),
    likes: (a, b) => (num(b.counts?.likes) ?? -1) - (num(a.counts?.likes) ?? -1),
    replies: (a, b) => (num(b.counts?.replies) ?? -1) - (num(a.counts?.replies) ?? -1),
    views: (a, b) => (num(b.counts?.views) ?? -1) - (num(a.counts?.views) ?? -1),
    recent: (a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt))
  };
  return list.sort(sorters[f.sort] || sorters.reaction);
}

function metric(label, value) {
  const known = value !== null && value !== undefined;
  return `<span class="metric ${known ? '' : 'unknown'}"><b>${label}</b> ${known ? formatCount(value) : '—'}</span>`;
}

function card(p, km) {
  const k = postKind(p, km);
  const rv = reviewOf(p);
  const when = p.postedAt ? new Date(p.postedAt).toLocaleDateString('ko-KR') : '';
  // 캡쳐해둔 썸네일(p.thumb, 데이터URL)이 있으면 그걸(만료 안 됨), 없으면 원본 주소(깨지면 링크로 대체)
  const src = p.thumb || (p.images || [])[0];
  const badge = k === 'own' ? '<span class="badge own">내 계정</span>'
    : k === 'reference' ? '<span class="badge ref">레퍼런스</span>' : '';
  const catBadge = `<span class="badge cat">${esc(categoryOf(p))}</span>`;
  // 깨짐 처리는 CSP 때문에 인라인 onerror 가 막히므로 렌더 후 wireThumbs() 에서 JS로 붙인다.
  const thumb = src
    ? `<a class="thumb" href="${esc(p.url)}" target="_blank" rel="noreferrer">
         <img src="${esc(src)}" loading="lazy" referrerpolicy="no-referrer">
       </a>`
    : '';
  return `
    <article class="card ${rv === 'pick' ? 'picked' : ''} ${rv === 'reject' ? 'rejected' : ''}">
      ${thumb}
      <div class="main">
        <div class="chead">
          <a class="author" href="${esc(p.authorUrl || ('https://www.threads.com/@' + p.author))}" target="_blank" rel="noreferrer">@${esc(p.author)}</a>
          ${badge}${catBadge}
          <span class="when">${esc(when)}</span>
        </div>
        <p class="ctext">${esc(p.text)}</p>
        <div class="metrics">
          ${metric('❤️', p.counts?.likes)}
          ${metric('💬', p.counts?.replies)}
          ${metric('🔁', p.counts?.reposts)}
          ${metric('👁', p.counts?.views)}
        </div>
        <div class="cfoot">
          <button class="pick ${rv === 'pick' ? 'on' : ''}" data-rv="pick" data-id="${esc(p.id)}">${rv === 'pick' ? '✓ 채택됨' : '채택'}</button>
          <button class="reject ${rv === 'reject' ? 'on' : ''}" data-rv="reject" data-id="${esc(p.id)}">${rv === 'reject' ? '✕ 거부됨' : '거부'}</button>
          <a class="open" href="${esc(p.url)}" target="_blank" rel="noreferrer">원문 열기 →</a>
          <button class="tiny" data-hide="${esc(p.id)}">삭제</button>
        </div>
      </div>
    </article>`;
}

function renderReview() {
  const km = kindMap();
  const list = filtered();
  const all = state.posts || [];
  const pick = all.filter((p) => reviewOf(p) === 'pick').length;
  const rej = all.filter((p) => reviewOf(p) === 'reject').length;
  const todo = all.filter((p) => !p.pending && (p.text || '').trim() && !reviewOf(p)).length;
  $('#reviewCount').textContent = `${list.length}건 표시 · ✓채택 ${pick} · ✕거부 ${rej} · 미검토 ${todo} / 전체 ${all.length}건`;

  // 카테고리 옵션(현재 데이터에 있는 것 + 건수)
  const catCount = {};
  for (const p of all) { if (p.pending || !(p.text || '').trim()) continue; const c = categoryOf(p); catCount[c] = (catCount[c] || 0) + 1; }
  const cats = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a]);
  const cur = $('#category').value;
  $('#category').innerHTML = `<option value="">전체</option>` +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)} (${catCount[c]})</option>`).join('');
  $('#category').value = cats.includes(cur) ? cur : '';
  $('#cards').innerHTML = list.length
    ? list.map((p) => card(p, km)).join('')
    : '<div class="empty">조건에 맞는 글이 없습니다. 수집을 켜고 쓰레드를 둘러보면 이곳에 쌓입니다.</div>';
  wireThumbs();
}

/** 못 불러온 썸네일을 '원문에서 사진 보기' 링크 박스로 바꾼다(CSP로 인라인 onerror 불가). */
function wireThumbs() {
  for (const a of document.querySelectorAll('.thumb')) {
    const img = a.querySelector('img');
    if (!img) continue;
    const fail = () => {
      if (a.classList.contains('broken')) return;
      img.remove();
      a.classList.add('broken');
      a.textContent = '🖼 원문에서 사진 보기';
    };
    if (img.complete && img.naturalWidth === 0) fail();
    else img.addEventListener('error', fail, { once: true });
  }
}

/* ----------------------------------------------------------- 계정 */

function acctCard(a, count) {
  const kind = a.kind === 'own' ? 'own' : 'reference';
  const prio = Number.isFinite(Number(a.priority)) ? Number(a.priority) : (kind === 'own' ? 2 : 1);
  return `
    <div class="acct">
      <span class="name">@${esc(a.username)}</span>
      <span class="count muted">${count}건</span>
      ${a.auto ? '<span class="badge ref">자동발굴</span>' : ''}
      <span class="sp"></span>
      <label class="muted">우선순위
        <select data-prio="${esc(a.username)}">
          <option value="2" ${prio === 2 ? 'selected' : ''}>높음</option>
          <option value="1" ${prio === 1 ? 'selected' : ''}>보통</option>
          <option value="0" ${prio === 0 ? 'selected' : ''}>낮음</option>
        </select>
      </label>
      <button data-switch="${esc(a.username)}" data-to="${kind === 'own' ? 'reference' : 'own'}">${kind === 'own' ? '레퍼런스로' : '내 계정으로'}</button>
      <button class="danger" data-rm="${esc(a.username)}">삭제</button>
    </div>`;
}

function renderAccounts() {
  const counts = new Map();
  for (const p of state.posts || []) if (p.account) counts.set(p.account, (counts.get(p.account) || 0) + 1);
  const list = state.accounts || [];
  const own = list.filter((a) => a.kind === 'own');
  const ref = list.filter((a) => a.kind !== 'own');
  $('#ownN').textContent = own.length ? `(${own.length})` : '';
  $('#refN').textContent = ref.length ? `(${ref.length})` : '';
  $('#ownList').innerHTML = own.length ? own.map((a) => acctCard(a, counts.get(a.username) || 0)).join('')
    : '<div class="empty">내 계정이 없습니다.</div>';
  $('#refList').innerHTML = ref.length ? ref.map((a) => acctCard(a, counts.get(a.username) || 0)).join('')
    : '<div class="empty">레퍼런스 계정이 없습니다.</div>';
}

/* ----------------------------------------------------------- 설정 */

const BOOLS = ['adaptiveGate', 'postsOnly', 'dedupText', 'koreanOnly',
  'rotate', 'rotateAccounts', 'rotateFeed', 'autoDiscoverRef'];
const NUMS = ['accountPasses', 'autoRefThreshold'];

function renderSettings() {
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  for (const k of BOOLS) { const el = $(`#s_${k}`); if (el) el.checked = s[k] !== false; }
  for (const k of NUMS) { const el = $(`#s_${k}`); if (el) el.value = s[k]; }
}

/* ----------------------------------------------------------- 공통 */

function renderHeader() {
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const st = { ...DEFAULT_STATS, ...(state.stats || {}) };
  $('#collecting').checked = !!s.collecting;
  const b = st.bench || { n: 0 };
  $('#stat').textContent = `수집 ${(state.posts || []).length}건 · 반응기준 표본 ${b.n || 0}개`
    + (st.lastAt ? ` · 최근 ${new Date(st.lastAt).toLocaleTimeString('ko-KR')}` : '');
}

function renderAll() { renderHeader(); renderReview(); renderAccounts(); renderSettings(); }

async function load() {
  let next;
  try { next = await send({ type: 'GET_STATE' }); } catch { return; }
  if (!next || next.error) return;
  state = next;
  state.posts = state.posts || [];
  state.accounts = state.accounts || [];
  renderAll();
}

/* 탭 */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  $(`.panel[data-panel="${t.dataset.tab}"]`).classList.add('active');
}));

/* 수집 스위치 */
$('#collecting').addEventListener('change', async (e) => {
  await send({ type: 'SET_SETTINGS', settings: { collecting: e.target.checked } });
  await load();
});

/* 검토 필터 */
$('#source').addEventListener('change', (e) => { f.source = e.target.value; renderReview(); });
$('#sort').addEventListener('change', (e) => { f.sort = e.target.value; renderReview(); });
$('#q').addEventListener('input', (e) => { f.q = e.target.value; renderReview(); });
$('#status').addEventListener('change', (e) => { f.status = e.target.value; renderReview(); });
$('#category').addEventListener('change', (e) => { f.category = e.target.value; renderReview(); });

$('#applyLearning').addEventListener('click', async () => {
  const r = await send({ type: 'APPLY_PICKS_LEARNING' });
  if (r?.error) { alert(r.error); return; }
  alert(`채택 ${r.count}건을 수집 기준에 반영했어요.\n`
    + `→ 앞으로 "평균 이상"의 기준: ❤️ ${r.avgLike} · 💬 ${r.avgReply} 수준\n`
    + (r.top?.length ? `→ 채택 글에 자주 나온 단어: ${r.top.join(', ')}` : ''));
  await load();
});

$('#cards').addEventListener('click', async (e) => {
  const rv = e.target.closest('button[data-rv]');
  const hide = e.target.closest('button[data-hide]');
  if (rv) {
    const p = state.posts.find((x) => x.id === rv.dataset.id);
    if (p) {   // 낙관적 반영(같은 값 다시 누르면 해제)
      const cur = reviewOf(p);
      p.review = (cur === rv.dataset.rv) ? null : rv.dataset.rv;
      p.picked = p.review === 'pick';
    }
    renderReview();
    await send({ type: 'REVIEW_POST', id: rv.dataset.id, review: rv.dataset.rv });
  } else if (hide) {
    if (!confirm('이 글을 완전히 지울까요?')) return;
    await send({ type: 'DELETE_POST', id: hide.dataset.hide });
    await load();
  }
});

$('#exportPicked').addEventListener('click', () => {
  const ids = (state.posts || []).filter((p) => reviewOf(p) === 'pick').map((p) => p.id);
  if (!ids.length) { alert('채택한 글이 없습니다. 카드의 "채택"을 눌러 골라주세요.'); return; }
  send({ type: 'EXPORT', format: 'json', ids });
});

/* 계정 */
function flash(msg) { const el = $('#accountError'); if (!msg) { el.classList.add('hidden'); return; }
  el.textContent = msg; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 4000); }

$('#addAccount').addEventListener('click', async () => {
  const username = $('#newAccount').value.trim();
  if (!username) return;
  const res = await send({ type: 'ADD_ACCOUNT', username, kind: $('#newKind').value });
  if (res?.error) return flash(res.error);
  if (res?.duplicate) flash('이미 등록된 계정입니다.');
  $('#newAccount').value = '';
  await load();
});
$('#newAccount').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addAccount').click(); });

for (const id of ['ownList', 'refList']) {
  $(`#${id}`).addEventListener('click', async (e) => {
    const rm = e.target.closest('button[data-rm]');
    const sw = e.target.closest('button[data-switch]');
    if (rm) { await send({ type: 'REMOVE_ACCOUNT', username: rm.dataset.rm }); await load(); }
    else if (sw) { await send({ type: 'UPDATE_ACCOUNT', username: sw.dataset.switch, patch: { kind: sw.dataset.to } }); await load(); }
  });
  $(`#${id}`).addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-prio]');
    if (sel) { await send({ type: 'UPDATE_ACCOUNT', username: sel.dataset.prio, patch: { priority: Number(sel.value) } }); await load(); }
  });
}

/* 설정 */
for (const k of BOOLS) $(`#s_${k}`)?.addEventListener('change', async (e) => {
  await send({ type: 'SET_SETTINGS', settings: { [k]: e.target.checked } }); });
for (const k of NUMS) $(`#s_${k}`)?.addEventListener('change', async (e) => {
  await send({ type: 'SET_SETTINGS', settings: { [k]: Number(e.target.value) } }); });

/* 외부에서 상태 바뀌면 갱신 (검토 입력 중 방해 안 되게 설정/계정/글만) */
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && (ch.posts || ch.accounts || ch.settings || ch.stats)) load();
});

load();
