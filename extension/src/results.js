import { formatCount, passesThreshold } from './counts.js';
import { highlightHtml } from './matcher.js';
import { DEFAULT_VIEW_FILTERS, DEFAULT_SETTINGS, DEFAULT_STATS } from './storage.js';
import { gradePost, gradeAtLeast } from './rules.js';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FIELDS = ['minViews', 'minReplies', 'minLikes', 'minInquiries', 'group', 'kind', 'grade', 'sort', 'q', 'includeUnknown', 'onlyImages'];
const KIND_LABEL = { post: '글', reply: '답글', unknown: '판별 불가' };

let state = null;
let filters = null;
let visible = [];

/* ------------------------------------------------------------------ 필터 */

function applyFilters() {
  // 등급은 저장돼 있지 않다. 지금 기준으로 매번 다시 매긴다.
  for (const p of state.posts) p._g = gradePost(p, p.counts || {}, state.settings);

  const q = (filters.q || '').trim().toLowerCase();
  const inc = filters.includeUnknown;
  const sellerMode = filters.mode !== 'all';

  const pool = sellerMode
    ? state.posts.filter((p) => (p.inquiries || []).length >= (Number(filters.minInquiries) || 1))
    : state.posts;

  visible = pool.filter((p) => {
    const c = p.counts || {};
    if (!passesThreshold(c.views, Number(filters.minViews) || 0, inc)) return false;
    if (!passesThreshold(c.replies, Number(filters.minReplies) || 0, inc)) return false;
    if (!passesThreshold(c.likes, Number(filters.minLikes) || 0, inc)) return false;
    if (filters.group && !(p.groups || []).includes(filters.group)) return false;
    if (!sellerMode && filters.kind && (p.type || 'unknown') !== filters.kind) return false;
    if (!p.pending && !gradeAtLeast(p._g.grade, filters.grade || 'A')) return false;
    if (filters.onlyImages && !(p.images || []).length) return false;
    if (q) {
      const inquiryText = (p.inquiries || []).map((i) => i.text).join(' ');
      const hay = `${p.text} ${p.author} ${(p.keywords || []).join(' ')} ${inquiryText}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const num = (v) => (v === null || v === undefined ? -1 : v);
  const bySort = {
    inquiries: (a, b) => (b.inquiries || []).length - (a.inquiries || []).length,
    views: (a, b) => num(b.counts?.views) - num(a.counts?.views),
    likes: (a, b) => num(b.counts?.likes) - num(a.counts?.likes),
    replies: (a, b) => num(b.counts?.replies) - num(a.counts?.replies),
    reposts: (a, b) => num(b.counts?.reposts) - num(a.counts?.reposts),
    collected: (a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt)),
    posted: (a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || ''))
  };
  visible.sort(sellerMode ? bySort.inquiries : (bySort[filters.sort] || bySort.views));
}

/* ------------------------------------------------------------------ 렌더 */

function metric(label, value) {
  const known = value !== null && value !== undefined;
  return `<span class="metric ${known ? '' : 'unknown'}">
    <span class="label">${label}</span><span class="value">${formatCount(value)}</span>
  </span>`;
}

/** 어떤 조건을 만족했고 뭐가 모자랐는지 한 줄로 */
function metLine(g) {
  const label = { replies: '댓글', likes: '좋아요', seller: '판매자 글' };
  const parts = Object.keys(g.met).map((k) =>
    g.met[k] ? `<b>${label[k]}</b>` : `<span class="no">${label[k]}</span>`);
  return `<span class="met">${parts.join(' · ')}</span>`;
}

function card(p) {
  let text = esc(p.text);
  for (const kw of p.keywords || []) text = highlightHtml(text, kw);

  const images = (p.images || []).slice(0, 2);
  const extra = (p.images || []).length - images.length;
  const thumbs = images.length
    ? `<div class="thumbs">
         ${images.map((src) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"
              onerror="this.style.display='none'" />`).join('')}
         ${extra > 0 ? `<span class="more">+${extra}</span>` : ''}
       </div>`
    : '';

  const when = p.postedAt ? new Date(p.postedAt).toLocaleString('ko-KR') : '';
  const inquiries = p.inquiries || [];
  const inquiryBlock = inquiries.length
    ? `<div class="inquiries">
         <h4>이 글에 달린 구매 문의 ${inquiries.length}건</h4>
         ${inquiries.slice(0, 6).map((q) => `
           <div class="inquiry">
             <a href="${esc(q.url)}" target="_blank" rel="noreferrer">@${esc(q.author)}</a>
             <span class="q">${esc(q.text.slice(0, 160))}</span>
           </div>`).join('')}
         ${inquiries.length > 6 ? `<div class="inquiry q">외 ${inquiries.length - 6}건</div>` : ''}
       </div>`
    : '';
  const tags = [
    ...(p.groupLabels || []).map((l) => `<span class="tag">${esc(l)}</span>`),
    ...(p.keywords || []).map((k) => `<span class="tag">${esc(k)}</span>`)
  ].join('');

  const links = (p.links || []).length
    ? `<div class="links">${p.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noreferrer">${esc(l)}</a>`).join('<br>')}</div>`
    : '';

  return `
    <article class="card">
      ${thumbs}
      <div class="body">
        <div class="head">
          <a class="author" href="${esc(p.authorUrl)}" target="_blank" rel="noreferrer">@${esc(p.author)}</a>
          <span class="when">${esc(when)}</span>
          ${p._g ? `<span class="grade grade-${esc(p._g.grade)}" title="${esc(p._g.score)}/${esc(p._g.required)} 조건 만족">${esc(p._g.grade)}</span>` : ''}
          <span class="tag kind-${esc(p.type || 'unknown')}">${esc(KIND_LABEL[p.type] || '판별 불가')}</span>
          ${p._g ? metLine(p._g) : ''}
          ${p.account ? '<span class="tag">레퍼런스 계정</span>' : ''}
        </div>
        <p class="text${p.pending ? ' pending' : ''}">${p.pending ? '본문 확인 중… (원문 열기를 누르면 바로 채워집니다)' : text}</p>
        <div class="metrics">
          ${inquiries.length ? `<span class="inquiry-count">구매문의 ${inquiries.length}</span>` : ''}
          ${metric('조회', p.counts?.views)}
          ${metric('좋아요', p.counts?.likes)}
          ${metric('댓글', p.counts?.replies)}
          ${metric('리포스트', p.counts?.reposts)}
        </div>
        ${inquiryBlock}
        ${links}
        <div class="tags">${tags}
          <a class="open" href="${esc(p.url)}" target="_blank" rel="noreferrer">원문 열기 →</a>
          <button class="tiny hide-btn" data-hide="${esc(p.id)}">숨기기</button>
        </div>
      </div>
    </article>`;
}

function renderNotice() {
  const { stats, viewQueue } = state;
  const withViews = state.posts.filter((p) => p.counts?.views !== null && p.counts?.views !== undefined).length;

  // 조회수 조건을 걸었는데 조회수가 잡힌 글이 거의 없으면 조용히 비는 대신 알려준다
  if (Number(filters.minViews) > 0 && !filters.includeUnknown && withViews === 0) {
    return `<div class="notice">
      조회수가 확인된 글이 아직 <b>0건</b>이라 “조회수 ≥ ${formatCount(Number(filters.minViews))}” 조건에 걸려 전부 숨겨졌습니다.
      쓰레드는 피드에 조회수를 잘 노출하지 않아서, 댓글 ${state.settings.enrichMinReplies}개 이상인 글만 상세 페이지로 따로 확인합니다
      ${viewQueue.length ? `(확인 대기 <b>${viewQueue.length}건</b>)` : ''}.
      <button id="dropViews">조회수 조건 끄기</button>
      <button id="incUnknown">수치 없는 글도 보기</button>
    </div>`;
  }

  if (viewQueue.length) {
    return `<div class="notice">
      조회수 확인 대기 <b>${viewQueue.length}건</b> · 지금까지 확인 ${stats.enrichTried}건 중 ${stats.enrichFilled}건 채움.
      수집을 켜둔 채 쓰레드 탭을 열어두면 순서대로 채워집니다.
    </div>`;
  }
  return '';
}

function render() {
  applyFilters();

  const sellerMode = filters.mode !== 'all';
  document.querySelectorAll('.mode').forEach((b) =>
    b.classList.toggle('active', (b.dataset.mode === 'seller') === sellerMode));
  document.querySelectorAll('.seller-only').forEach((el) => el.classList.toggle('hidden', !sellerMode));
  document.querySelectorAll('.all-only').forEach((el) => el.classList.toggle('hidden', sellerMode));

  const dist = { A: 0, B: 0, C: 0, D: 0 };
  for (const p of state.posts) if (p._g) dist[p._g.grade] += 1;
  const sellers = state.posts.filter((p) => (p.inquiries || []).length);
  const totalInquiries = sellers.reduce((n, p) => n + p.inquiries.length, 0);
  $('#summary').textContent = sellerMode
    ? `구매 문의가 달린 판매자 글 ${sellers.length}건 (문의 ${totalInquiries}건) 중 ${visible.length}건 표시 · ` +
      `본문 확인 대기 ${state.parentQueue.length}건`
    : `수집한 글 ${state.posts.length}건 중 ${visible.length}건 표시 · ` +
      `A ${dist.A} · B ${dist.B} · C ${dist.C}`;

  $('#list').innerHTML = (sellerMode ? '' : renderNotice()) + (visible.length
    ? visible.map(card).join('')
    : sellerMode
      ? '<div class="empty">아직 구매 문의가 달린 판매자 글이 없습니다.<br>쓰레드에서 “어디서 사” 같은 검색어로 검색한 뒤 스크롤해 보세요.</div>'
      : '<div class="empty">조건에 맞는 글이 없습니다. 위 필터를 낮춰보세요.</div>');

  const drop = $('#dropViews');
  if (drop) drop.addEventListener('click', () => patch({ minViews: 0 }));
  const inc = $('#incUnknown');
  if (inc) inc.addEventListener('click', () => patch({ includeUnknown: true }));
}

function renderGroupOptions() {
  const all = state.accountGroup ? [...state.groups, state.accountGroup] : state.groups;
  $('#group').innerHTML = '<option value="">전체 그룹</option>' +
    all.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');
  $('#group').value = filters.group || '';
}

function syncInputs() {
  for (const key of FIELDS) {
    const el = $(`#${key}`);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(filters[key]);
    else el.value = filters[key] ?? '';
  }
}

/* ------------------------------------------------------------------ 동작 */

async function patch(part) {
  filters = { ...filters, ...part };
  await send({ type: 'SET_VIEW_FILTERS', filters: part });
  syncInputs();
  render();
}

async function load() {
  let next;
  try {
    next = await send({ type: 'GET_STATE' });
  } catch {
    return;
  }
  if (!next || next.error) return;
  state = next;
  // 확장을 새로고침하기 전이면 서비스 워커가 옛 버전일 수 있다. 기본값으로 메꾼다.
  state.posts = state.posts || [];
  state.groups = state.groups || [];
  state.accounts = state.accounts || [];
  state.viewQueue = state.viewQueue || [];
  state.parentQueue = state.parentQueue || [];
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  state.stats = { ...DEFAULT_STATS, ...(state.stats || {}) };
  filters = { ...DEFAULT_VIEW_FILTERS, ...(state.viewFilters || {}) };
  renderGroupOptions();
  syncInputs();
  render();
}

for (const key of FIELDS) {
  const el = document.getElementById(key);
  if (!el) continue;
  const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
  el.addEventListener(evt, () => {
    const value = el.type === 'checkbox' ? el.checked : el.value;
    patch({ [key]: value });
  });
}

document.querySelectorAll('.mode').forEach((btn) =>
  btn.addEventListener('click', () => patch({ mode: btn.dataset.mode })));

$('#list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-hide]');
  if (!btn) return;
  await send({ type: 'DELETE_POST', id: btn.dataset.hide });
  await load();
});

$('#prune').addEventListener('click', async () => {
  if (!confirm('지금 수집 기준에 못 미치는 글을 한 번에 지웁니다.\n구매 문의가 달린 글과 레퍼런스 계정 글은 남습니다. 계속할까요?')) return;
  const r = await send({ type: 'PRUNE_LOW_REACH' });
  alert(`${r.removed}건을 정리했습니다. ${r.kept}건 남음.`);
  await load();
});

$('#reset').addEventListener('click', () => patch({
  minViews: 0, minReplies: 0, minLikes: 0, minInquiries: 1, group: '', kind: '', grade: 'A', sort: 'views', q: '',
  includeUnknown: true, onlyImages: false
}));

for (const [id, format] of [['exportCsv', 'csv'], ['exportJson', 'json'], ['exportMd', 'md']]) {
  $(`#${id}`).addEventListener('click', () => send({ type: 'EXPORT', format, ids: visible.map((p) => p.id) }));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.posts || changes.viewQueue || changes.parentQueue || changes.stats)) load();
});

load();
