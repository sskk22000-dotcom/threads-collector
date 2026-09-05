import { formatCount, passesThreshold } from './counts.js';
import { highlightHtml } from './matcher.js';
import { DEFAULT_VIEW_FILTERS, DEFAULT_SETTINGS, DEFAULT_STATS } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FIELDS = ['minViews', 'minReplies', 'minLikes', 'group', 'sort', 'q', 'includeUnknown', 'onlyImages'];

let state = null;
let filters = null;
let visible = [];

/* ------------------------------------------------------------------ 필터 */

function applyFilters() {
  const q = (filters.q || '').trim().toLowerCase();
  const inc = filters.includeUnknown;

  visible = state.posts.filter((p) => {
    const c = p.counts || {};
    if (!passesThreshold(c.views, Number(filters.minViews) || 0, inc)) return false;
    if (!passesThreshold(c.replies, Number(filters.minReplies) || 0, inc)) return false;
    if (!passesThreshold(c.likes, Number(filters.minLikes) || 0, inc)) return false;
    if (filters.group && !(p.groups || []).includes(filters.group)) return false;
    if (filters.onlyImages && !(p.images || []).length) return false;
    if (q) {
      const hay = `${p.text} ${p.author} ${(p.keywords || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const num = (v) => (v === null || v === undefined ? -1 : v);
  const bySort = {
    views: (a, b) => num(b.counts?.views) - num(a.counts?.views),
    likes: (a, b) => num(b.counts?.likes) - num(a.counts?.likes),
    replies: (a, b) => num(b.counts?.replies) - num(a.counts?.replies),
    reposts: (a, b) => num(b.counts?.reposts) - num(a.counts?.reposts),
    collected: (a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt)),
    posted: (a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || ''))
  };
  visible.sort(bySort[filters.sort] || bySort.views);
}

/* ------------------------------------------------------------------ 렌더 */

function metric(label, value) {
  const known = value !== null && value !== undefined;
  return `<span class="metric ${known ? '' : 'unknown'}">
    <span class="label">${label}</span><span class="value">${formatCount(value)}</span>
  </span>`;
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
          ${p.account ? '<span class="tag">레퍼런스 계정</span>' : ''}
        </div>
        <p class="text">${text}</p>
        <div class="metrics">
          ${metric('조회', p.counts?.views)}
          ${metric('좋아요', p.counts?.likes)}
          ${metric('댓글', p.counts?.replies)}
          ${metric('리포스트', p.counts?.reposts)}
        </div>
        ${links}
        <div class="tags">${tags}
          <a class="open" href="${esc(p.url)}" target="_blank" rel="noreferrer">원문 열기 →</a>
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

  const withViews = state.posts.filter((p) => p.counts?.views != null).length;
  $('#summary').textContent =
    `전체 ${state.posts.length}건 중 ${visible.length}건 표시 · 조회수 확인된 글 ${withViews}건 · ` +
    `수집 계정 ${state.accounts.length}개`;

  $('#list').innerHTML = renderNotice() + (visible.length
    ? visible.map(card).join('')
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

$('#reset').addEventListener('click', () => patch({
  minViews: 10000, minReplies: 20, minLikes: 0, group: '', sort: 'views', q: '',
  includeUnknown: false, onlyImages: false
}));

for (const [id, format] of [['exportCsv', 'csv'], ['exportJson', 'json'], ['exportMd', 'md']]) {
  $(`#${id}`).addEventListener('click', () => send({ type: 'EXPORT', format, ids: visible.map((p) => p.id) }));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.posts || changes.viewQueue || changes.stats)) load();
});

load();
