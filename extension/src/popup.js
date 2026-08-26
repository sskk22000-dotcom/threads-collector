'use strict';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => chrome.runtime.sendMessage(msg);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = null;
let query = '';

/* ------------------------------------------------------------------ 렌더 */

function renderHeader() {
  const { stats, posts, settings } = state;
  $('#collecting').checked = !!settings.collecting;
  $('#stats').textContent =
    `수집 ${posts.length}건 · 스캔 ${stats.scanned}건` +
    (stats.lastAt ? ` · 최근 ${new Date(stats.lastAt).toLocaleTimeString('ko-KR')}` : '');
}

function renderSettings() {
  const s = state.settings;
  $('#autoScroll').checked = !!s.autoScroll;
  $('#highlight').checked = !!s.highlight;
  $('#autoScrollDelayMs').value = s.autoScrollDelayMs;
  $('#minChars').value = s.minChars;
  $('#suggestEvery').value = s.suggestEvery;

  const approved = state.groups.filter((g) => g.status === 'approved');
  $('#searchKeyword').innerHTML = approved
    .flatMap((g) => (g.keywords || []).map((k) =>
      `<option value="${esc(k.value)}">${esc(g.label)} · ${esc(k.value)}</option>`))
    .join('') || '<option value="">승인된 키워드 없음</option>';
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
  $('#corpusInfo').textContent = `분석 대상 ${state.corpus.length}건`;
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
  const items = state.posts
    .filter((p) => !groupFilter || (p.groups || []).includes(groupFilter))
    .filter((p) => !q || p.text.toLowerCase().includes(q) || p.author.toLowerCase().includes(q))
    .slice()
    .reverse();

  $('#results').innerHTML = items.length
    ? items.map((p) => {
        let text = esc(p.text.slice(0, 400));
        for (const kw of p.keywords || []) {
          const safe = esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          text = text.replace(new RegExp(safe, 'g'), (m) => `<span class="kw">${m}</span>`);
        }
        return `
          <div class="post">
            <div class="post-head">
              <a href="${esc(p.url)}" target="_blank" rel="noreferrer">@${esc(p.author)}</a>
              <button class="tiny danger" data-delete="${esc(p.id)}">삭제</button>
            </div>
            <div class="post-text">${text}</div>
            <div class="post-meta">
              <span>${esc((p.groupLabels || []).join(', '))}</span>
              <span>${esc((p.keywords || []).join(', '))}</span>
              ${p.counts?.likes != null ? `<span>♥ ${p.counts.likes}</span>` : ''}
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
  for (const p of state.posts) for (const g of p.groups || []) counts.set(g, (counts.get(g) || 0) + 1);
  $('#filterGroup').innerHTML =
    `<option value="">전체 (${state.posts.length})</option>` +
    state.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.label)} (${counts.get(g.id) || 0})</option>`).join('');
  $('#filterGroup').value = current;
}

function renderAll() {
  renderHeader();
  renderSettings();
  renderGroups();
  renderSuggestions();
  renderFilterOptions();
  renderResults();
}

async function refresh() {
  state = await send({ type: 'GET_STATE' });
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
  await send({ type: 'SET_SETTINGS', settings: patch });
  await refresh();
}

$('#collecting').addEventListener('change', (e) => patchSettings({ collecting: e.target.checked }));
$('#autoScroll').addEventListener('change', (e) => patchSettings({ autoScroll: e.target.checked }));
$('#highlight').addEventListener('change', (e) => patchSettings({ highlight: e.target.checked }));
for (const id of ['autoScrollDelayMs', 'minChars', 'suggestEvery']) {
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.posts || changes.stats || changes.suggestions)) refresh();
});
