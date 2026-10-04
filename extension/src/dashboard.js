import { formatCount } from './counts.js';
import { DEFAULT_SETTINGS, DEFAULT_STATS } from './storage.js';

const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null;
const f = { source: 'all', sort: 'reaction', q: '', onlyPicked: false };

const num = (v) => (v === null || v === undefined ? null : v);
const reaction = (p) => (p.counts?.likes || 0) + (p.counts?.replies || 0) * 3;

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
  if (f.onlyPicked) list = list.filter((p) => p.picked);
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
  const when = p.postedAt ? new Date(p.postedAt).toLocaleDateString('ko-KR') : '';
  const img = (p.images || [])[0];
  const badge = k === 'own' ? '<span class="badge own">내 계정</span>'
    : k === 'reference' ? '<span class="badge ref">레퍼런스</span>' : '';
  return `
    <article class="card ${p.picked ? 'picked' : ''}">
      ${img ? `<div class="thumb"><img src="${esc(img)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.thumb').style.display='none'"></div>` : ''}
      <div class="main">
        <div class="chead">
          <a class="author" href="${esc(p.authorUrl || ('https://www.threads.com/@' + p.author))}" target="_blank" rel="noreferrer">@${esc(p.author)}</a>
          ${badge}
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
          <button class="pick ${p.picked ? 'on' : ''}" data-pick="${esc(p.id)}">${p.picked ? '✓ 채택됨' : '채택'}</button>
          <a class="open" href="${esc(p.url)}" target="_blank" rel="noreferrer">원문 열기 →</a>
          <button class="tiny" data-hide="${esc(p.id)}">숨기기</button>
        </div>
      </div>
    </article>`;
}

function renderReview() {
  const km = kindMap();
  const list = filtered();
  const picked = (state.posts || []).filter((p) => p.picked).length;
  $('#reviewCount').textContent = `${list.length}건 표시 · 채택 ${picked}건 / 전체 수집 ${(state.posts || []).length}건`;
  $('#cards').innerHTML = list.length
    ? list.map((p) => card(p, km)).join('')
    : '<div class="empty">조건에 맞는 글이 없습니다. 수집을 켜고 쓰레드를 둘러보면 이곳에 쌓입니다.</div>';
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
$('#onlyPicked').addEventListener('change', (e) => { f.onlyPicked = e.target.checked; renderReview(); });

$('#cards').addEventListener('click', async (e) => {
  const pick = e.target.closest('button[data-pick]');
  const hide = e.target.closest('button[data-hide]');
  if (pick) {
    // 낙관적 반영
    const p = state.posts.find((x) => x.id === pick.dataset.pick);
    if (p) p.picked = !p.picked;
    renderReview();
    await send({ type: 'PICK_POST', id: pick.dataset.pick });
  } else if (hide) {
    if (!confirm('이 글을 목록에서 지울까요?')) return;
    await send({ type: 'DELETE_POST', id: hide.dataset.hide });
    await load();
  }
});

$('#exportPicked').addEventListener('click', () => {
  const ids = (state.posts || []).filter((p) => p.picked).map((p) => p.id);
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
