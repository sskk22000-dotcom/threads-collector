import { highlightHtml } from './matcher.js';
import { formatCount } from './counts.js';
import { DEFAULT_SETTINGS, DEFAULT_STATS } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null;
let query = '';

/* ------------------------------------------------------------------ 렌더 */

function renderHeader() {
  const posts = state.posts || [];
  const settings = state.settings || {};
  const stats = { ...DEFAULT_STATS, ...(state.stats || {}) };
  $('#collecting').checked = !!settings.collecting;
  $('#stats').textContent =
    `수집 ${posts.length}건 · 스캔 ${stats.scanned}건` +
    (stats.skippedForeign ? ` · 외국어 ${stats.skippedForeign}` : '') +
    (stats.lastAt ? ` · 최근 ${new Date(stats.lastAt).toLocaleTimeString('ko-KR')}` : '');
}

function renderSettings() {
  // 확장을 새로고침하기 전에는 서비스 워커가 이전 버전 코드로 돌 수 있다.
  // 그때 새 팝업이 없는 설정 값을 읽어 input 에 undefined 를 넣는 사고가 나므로,
  // 팝업 쪽에서도 기본값을 한 번 더 덮어씌운다.
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const stats = { ...DEFAULT_STATS, ...(state.stats || {}) };
  const queue = state.viewQueue || [];
  $('#autoScroll').checked = !!s.autoScroll;
  $('#highlight').checked = !!s.highlight;
  $('#autoScrollDelayMs').value = s.autoScrollDelayMs;
  $('#minChars').value = s.minChars;
  $('#suggestEvery').value = s.suggestEvery;
  $('#collectReplies').checked = s.collectReplies !== false;
  $('#koreanOnly').checked = s.koreanOnly !== false;
  $('#rotate').checked = Boolean(s.rotate);
  $('#rotateFeed').checked = s.rotateFeed !== false;
  $('#rotateDwellMs').value = s.rotateDwellMs;
  const sourceCount = (s.rotateFeed !== false ? 1 : 0) + (state.searchTerms || []).length;
  $('#rotateStats').textContent = s.rotate
    ? (sourceCount > 1
        ? `순회 대상 ${sourceCount}곳 · 지금 ${(state.rotation && state.rotation.index + 1) || 1}번째`
        : '순회할 곳이 하나뿐입니다. 아래에서 검색어를 추가하세요.')
    : '';
  $('#minReplies').value = s.minReplies;
  $('#minLikes').value = s.minLikes;
  $('#requireSeller').checked = s.requireSeller !== false;
  $('#sellerThreshold').value = s.sellerThreshold;
  $('#postsOnly').checked = s.postsOnly !== false;
  const skipped = stats.skipped || {};
  const skipText = Object.entries(skipped).sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason} ${n}`).join(' · ');
  $('#skipStats').textContent = skipText ? `건너뜀 — ${skipText}` : '';
  $('#enrichViews').checked = s.enrichViews !== false;
  $('#enrichMinReplies').value = s.enrichMinReplies;
  $('#enrichMinDelayMs').value = s.enrichMinDelayMs;
  $('#enrichStats').textContent = queue.length || stats.enrichTried
    ? `확인 대기 ${queue.length}건 · 확인 ${stats.enrichTried}건 중 ${stats.enrichFilled}건 채움`
    : '';

  const approved = state.groups.filter((g) => g.status === 'approved');
  $('#searchKeyword').innerHTML = approved
    .flatMap((g) => (g.keywords || []).map((k) =>
      `<option value="${esc(k.value)}">${esc(g.label)} · ${esc(k.value)}</option>`))
    .join('') || '<option value="">승인된 키워드 없음</option>';
}

function renderSearchTerms() {
  const list = state.searchTerms || [];
  $('#searchTerms').innerHTML = list.length
    ? `<div class="chips">${list.map((t) => `
        <span class="chip">
          <button class="link" data-search="${esc(t.value)}" title="쓰레드에서 검색">${esc(t.value)}</button>
          <button data-rmsearch="${esc(t.value)}" title="삭제">×</button>
        </span>`).join('')}</div>`
    : '<p class="muted">저장한 검색어가 없습니다.</p>';
}

function renderAccounts() {
  const list = state.accounts || [];
  const counts = new Map();
  for (const p of state.posts || []) if (p.account) counts.set(p.account, (counts.get(p.account) || 0) + 1);

  $('#accounts').innerHTML = list.length
    ? list.map((a) => `
        <div class="group">
          <div class="group-head">
            <span class="group-title">@${esc(a.username)}
              <span class="badge">${counts.get(a.username) || 0}건</span>
            </span>
            <span>
              <button class="tiny" data-profile="${esc(a.username)}">프로필 열기</button>
              <button class="tiny danger" data-rmaccount="${esc(a.username)}">삭제</button>
            </span>
          </div>
          <label class="row" style="margin:6px 0 0">
            <input type="checkbox" data-collectall="${esc(a.username)}" ${a.collectAll ? 'checked' : ''} />
            키워드가 안 맞아도 이 계정 글은 전부 수집
          </label>
        </div>`).join('')
    : '<div class="empty">등록한 계정이 없습니다. 위에 @아이디를 넣어 추가하세요.</div>';
}

function renderGroups() {
  $('#groups').innerHTML = state.groups.map((g) => {
    const on = g.status === 'approved';
    const chips = (g.keywords || []).map((k) => `
      <span class="chip">${esc(k.value)}
        <button data-remove="${esc(k.value)}" data-group="${esc(g.id)}" title="삭제">×</button>
      </span>`).join('') || '<span class="muted">키워드 없음</span>';
    return `
      <div class="group">
        <div class="group-head">
          <span class="group-title">${esc(g.label)}
            <span class="badge ${on ? 'on' : ''}">${on ? '수집중' : '컨펌 대기'}</span>
          </span>
          <span>
            ${on
              ? `<button class="tiny" data-status="pending" data-group="${esc(g.id)}">끄기</button>`
              : `<button class="tiny primary" data-status="approved" data-group="${esc(g.id)}">승인</button>`}
          </span>
        </div>
        <div class="group-desc">${esc(g.description || '')}</div>
        <div class="chips">${chips}</div>
      </div>`;
  }).join('');
}

function renderSuggestions() {
  const list = state.suggestions || [];
  $('#suggestDot').classList.toggle('hidden', !list.length);
  $('#corpusInfo').textContent = `분석 대상 ${(state.corpus || []).length}건`;
  $('#suggestions').innerHTML = list.length
    ? list.map((s) => `
      <div class="sug">
        <div class="sug-head">
          <span class="sug-value">${esc(s.surface || s.value)}
            <span class="badge">${s.count}회 · 점수 ${s.score}</span>
          </span>
          <span>
            <button class="tiny primary" data-approve="${esc(s.value)}">승인</button>
            <button class="tiny danger" data-reject="${esc(s.value)}">거절</button>
          </span>
        </div>
        <div class="sug-samples">${esc((s.samples || []).join(' / '))}</div>
      </div>`).join('')
    : '<div class="empty">후보 없음. 글을 조금 더 수집한 뒤 “지금 다시 뽑기”를 눌러보세요.</div>';
}

function renderResults() {
  const groupFilter = $('#filterGroup').value;
  const q = query.trim().toLowerCase();
  const items = (state.posts || [])
    .filter((p) => !groupFilter || (p.groups || []).includes(groupFilter))
    .filter((p) => !q || p.text.toLowerCase().includes(q) || p.author.toLowerCase().includes(q))
    .slice()
    .reverse();

  $('#results').innerHTML = items.length
    ? items.map((p) => {
        let text = esc(p.text.slice(0, 400));
        for (const kw of p.keywords || []) text = highlightHtml(text, kw);
        return `
          <div class="post">
            <div class="post-head">
              <a href="${esc(p.url)}" target="_blank" rel="noreferrer">@${esc(p.author)}</a>
              <button class="tiny danger" data-delete="${esc(p.id)}">삭제</button>
            </div>
            <div class="post-text">${text}</div>
            <div class="post-meta">
              <span>${esc(p.type === 'reply' ? '답글' : p.type === 'post' ? '글' : '판별 불가')}</span>
              <span>${esc((p.groupLabels || []).join(', '))}</span>
              <span>${esc((p.keywords || []).join(', '))}</span>
              ${p.counts?.views != null ? `<span>조회 ${formatCount(p.counts.views)}</span>` : ''}
              ${p.counts?.likes != null ? `<span>♥ ${formatCount(p.counts.likes)}</span>` : ''}
              ${p.counts?.replies != null ? `<span>댓글 ${formatCount(p.counts.replies)}</span>` : ''}
              ${p.links?.length ? `<span>🔗 ${p.links.length}</span>` : ''}
              <span>${p.postedAt ? new Date(p.postedAt).toLocaleString('ko-KR') : ''}</span>
            </div>
          </div>`;
      }).join('')
    : '<div class="empty">아직 수집된 글이 없습니다.</div>';
}

function renderFilterOptions() {
  const current = $('#filterGroup').value;
  const counts = new Map();
  for (const p of state.posts || []) for (const g of p.groups || []) counts.set(g, (counts.get(g) || 0) + 1);
  const all = state.accountGroup ? [...(state.groups || []), state.accountGroup] : (state.groups || []);
  $('#filterGroup').innerHTML =
    `<option value="">전체 (${(state.posts || []).length})</option>` +
    all.map((g) => `<option value="${esc(g.id)}">${esc(g.label)} (${counts.get(g.id) || 0})</option>`).join('');
  $('#filterGroup').value = current;
}

function renderAll() {
  renderHeader();
  renderSettings();
  renderGroups();
  renderSearchTerms();
  renderAccounts();
  renderSuggestions();
  renderFilterOptions();
  renderResults();
}

async function refresh() {
  // 서비스 워커가 잠들었다 깨어나는 중이면 응답이 비어서 올 수 있다.
  // 그때는 화면을 건드리지 않고 다음 기회에 갱신한다.
  let next;
  try {
    next = await send({ type: 'GET_STATE' });
  } catch {
    return;
  }
  if (!next || next.error) return;
  state = next;
  renderAll();
}

/* ------------------------------------------------------------------ 이벤트 */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  });
});

async function patchSettings(patch) {
  try {
    await send({ type: 'SET_SETTINGS', settings: patch });
  } catch {
    return;
  }
  await refresh();
}

$('#collecting').addEventListener('change', (e) => patchSettings({ collecting: e.target.checked }));
$('#autoScroll').addEventListener('change', (e) => patchSettings({ autoScroll: e.target.checked }));
$('#highlight').addEventListener('change', (e) => patchSettings({ highlight: e.target.checked }));
$('#collectReplies').addEventListener('change', (e) => patchSettings({ collectReplies: e.target.checked }));
$('#koreanOnly').addEventListener('change', (e) => patchSettings({ koreanOnly: e.target.checked }));
$('#rotate').addEventListener('change', (e) => patchSettings({ rotate: e.target.checked }));
$('#rotateFeed').addEventListener('change', (e) => patchSettings({ rotateFeed: e.target.checked }));
$('#requireSeller').addEventListener('change', (e) => patchSettings({ requireSeller: e.target.checked }));
$('#postsOnly').addEventListener('change', (e) => patchSettings({ postsOnly: e.target.checked }));
$('#enrichViews').addEventListener('change', (e) => patchSettings({ enrichViews: e.target.checked }));
for (const id of ['autoScrollDelayMs', 'minChars', 'suggestEvery', 'enrichMinReplies', 'enrichMinDelayMs', 'minLikes', 'minReplies', 'rotateDwellMs', 'sellerThreshold']) {
  $(`#${id}`).addEventListener('change', (e) => patchSettings({ [id]: Number(e.target.value) }));
}

$('#groups').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.status) {
    await send({ type: 'SET_GROUP_STATUS', groupId: btn.dataset.group, status: btn.dataset.status });
  } else if (btn.dataset.remove) {
    await send({ type: 'REMOVE_KEYWORD', groupId: btn.dataset.group, value: btn.dataset.remove });
  } else return;
  await refresh();
});

$('#addKeyword').addEventListener('click', async () => {
  const value = $('#newKeyword').value.trim();
  if (!value) return;
  await send({ type: 'ADD_KEYWORD', value });
  $('#newKeyword').value = '';
  await refresh();
});
$('#newKeyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addKeyword').click(); });

$('#suggestions').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.approve) await send({ type: 'APPROVE_SUGGESTION', value: btn.dataset.approve });
  else if (btn.dataset.reject) await send({ type: 'REJECT_SUGGESTION', value: btn.dataset.reject });
  else return;
  await refresh();
});

$('#runSuggest').addEventListener('click', async () => {
  $('#runSuggest').disabled = true;
  await send({ type: 'RUN_SUGGEST' });
  $('#runSuggest').disabled = false;
  await refresh();
});

/* ---- 검색어 ---- */

function flash(sel, message) {
  const el = $(sel);
  if (!message) { el.classList.add('hidden'); return; }
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

$('#addSearchTerm').addEventListener('click', async () => {
  const value = $('#newSearchTerm').value.trim();
  if (!value) return;
  const res = await send({ type: 'ADD_SEARCH_TERM', value });
  if (res?.error) return flash('#searchTermError', res.error);
  if (res?.duplicate) flash('#searchTermError', '이미 저장된 검색어입니다.');
  $('#newSearchTerm').value = '';
  await refresh();
});
$('#newSearchTerm').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addSearchTerm').click(); });

$('#searchTerms').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.search) {
    chrome.tabs.create({ url: `https://www.threads.com/search?q=${encodeURIComponent(btn.dataset.search)}&serp_type=default` });
  } else if (btn.dataset.rmsearch) {
    await send({ type: 'REMOVE_SEARCH_TERM', value: btn.dataset.rmsearch });
    await refresh();
  }
});

/* ---- 레퍼런스 계정 ---- */

$('#addAccount').addEventListener('click', async () => {
  const username = $('#newAccount').value.trim();
  if (!username) return;
  const res = await send({ type: 'ADD_ACCOUNT', username });
  if (res?.error) return flash('#accountError', res.error);
  if (res?.duplicate) flash('#accountError', '이미 등록된 계정입니다.');
  $('#newAccount').value = '';
  await refresh();
});
$('#newAccount').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#addAccount').click(); });

$('#accounts').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.profile) {
    chrome.tabs.create({ url: `https://www.threads.com/@${btn.dataset.profile}` });
  } else if (btn.dataset.rmaccount) {
    await send({ type: 'REMOVE_ACCOUNT', username: btn.dataset.rmaccount });
    await refresh();
  }
});

$('#accounts').addEventListener('change', async (e) => {
  const box = e.target.closest('input[data-collectall]');
  if (!box) return;
  await send({ type: 'UPDATE_ACCOUNT', username: box.dataset.collectall, patch: { collectAll: box.checked } });
  await refresh();
});

$('#filterGroup').addEventListener('change', renderResults);
$('#search').addEventListener('input', (e) => { query = e.target.value; renderResults(); });

$('#results').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-delete]');
  if (!btn) return;
  await send({ type: 'DELETE_POST', id: btn.dataset.delete });
  await refresh();
});

$('#clearPosts').addEventListener('click', async () => {
  if (!confirm('수집한 글을 전부 삭제할까요? (키워드 설정은 유지됩니다)')) return;
  await send({ type: 'CLEAR_POSTS' });
  await refresh();
});

$('#openResults').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/results.html') });
});

$('#exportCsv').addEventListener('click', () => send({ type: 'EXPORT', format: 'csv', groupId: $('#filterGroup').value }));
$('#exportJson').addEventListener('click', () => send({ type: 'EXPORT', format: 'json', groupId: $('#filterGroup').value }));
$('#exportMd').addEventListener('click', () => send({ type: 'EXPORT', format: 'md', groupId: $('#filterGroup').value }));

$('#openSearch').addEventListener('click', () => {
  const kw = $('#searchKeyword').value;
  if (!kw) return;
  chrome.tabs.create({ url: `https://www.threads.com/search?q=${encodeURIComponent(kw)}&serp_type=default` });
});

$('#openThreads').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://www.threads.com/' });
});

/* --------------------------------------------------------------- 초기화 */

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onThreads = /https:\/\/(www\.)?threads\.(com|net)\//.test(tab?.url || '');
  $('#notOnThreads').classList.toggle('hidden', onThreads);
  await refresh();
})();

// background 가 상태를 바꾸면 팝업도 따라 갱신한다
const WATCHED = ['posts', 'stats', 'suggestions', 'groups', 'accounts', 'searchTerms', 'settings'];
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && WATCHED.some((k) => k in changes)) refresh();
});
