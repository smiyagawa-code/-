// 画面の組み立て。/api/data（src/data.js の getDemoData）の結果だけを描く。計算はしない。文字は最小限。
import { esc, fmt, mergeCsv } from './util.js';
import { setupChat, setChatContext, ask, openChat } from './chat.js';
import { setupIntake, openMemo } from './intake.js';
import { openRules } from './rules.js';
import { statusChip, onTaskClick, renderProgress, orderable, setTaskData } from './tasks.js';
import { openOrder } from './order.js';
import { load as storeLoad } from './store.js';

const state = { folder: 'all', base: '', tab: '', csv: null, csvName: '', overrides: null, sources: [] }; // sources: 取り込んだ内示（複数可。案件ごとに後から来たものが勝つ）
let aiReady = false;
let data = null;

// テスト（test/render.test.mjs）が待てるように、組み立て完了の Promise を残す
globalThis.__dashboardReady = init().catch((err) => {
  console.error('app', err);
  text('panel', '画面を組み立てられませんでした。');
});

async function init() {
  const hash = parseHash();
  state.folder = hash.folder || 'all';
  state.base = hash.base || '';
  state.tab = hash.tab || '';

  const me = await fetch('/api/me').then((r) => r.json()).catch(() => ({}));
  aiReady = Boolean(me.ai);
  if (aiReady) {
    setupChat();
    document.getElementById('chatFab').hidden = false;
  }

  document.getElementById('folders').addEventListener('click', (e) => {
    const b = e.target.closest('[data-folder]');
    if (!b) return;
    state.folder = b.dataset.folder;
    load();
  });
  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    renderTabs();
    renderPanel();
    writeHash();
  });
  document.getElementById('panel').addEventListener('click', onPanelClick);
  document.getElementById('rulesBtn').addEventListener('click', () => openPop(`<h3>計算のしかた</h3>${data.rules.map((r) => `<div class="rule"><b>${esc(r.name)}</b><span>${esc(r.formula)}</span></div>`).join('')}<p class="muted">AI はこの計算をしません。式はこのとおり固定です。</p>`));
  document.getElementById('overlay').addEventListener('click', closePop);
  document.getElementById('settingsBtn').addEventListener('click', () => openRules({ data, overrides: state.overrides, onChange: (ov) => { state.overrides = ov; load(); } }));
  document.getElementById('memoBtn').addEventListener('click', () => openMemo({ onResult: applyCsv }));
  state.overrides = storeLoad('overrides', null);
  setupIntake({ onResult: applyCsv, onBusy: (name) => openPop(`<div class="drop-play"><div class="spin" aria-hidden="true"></div><p id="dropStep">読み取り中…</p><p class="muted">${esc(name)}</p></div>`), onError: (msg) => openPop(`<h3>読めませんでした</h3><p class="pop-sub">${esc(msg)}</p>`) });
  await load();
}

async function load() {
  const qs = new URLSearchParams({ folder: state.folder });
  if (state.base) qs.set('base', state.base);
  // 置かれた内示 CSV があれば、その中身ごと送って計算し直してもらう（サーバーは保存しない）
  const hasOv = state.overrides && Object.keys(state.overrides).length > 0;
  const res = state.csv || hasOv
    ? await fetch('/api/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: state.folder, base: state.base || undefined, csv: state.csv || undefined, overrides: hasOv ? state.overrides : undefined }) })
    : await fetch(`/api/data?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (state.csv) { state.csv = null; state.csvName = ''; openPop(`<h3>読めませんでした</h3><p class="pop-sub">${esc(body.error || 'CSV の形を確認してください')}</p>`); return load(); }
    text('panel', '読み込めませんでした。再読み込みしてください。'); return;
  }
  data = await res.json();
  const nameEl = document.getElementById('csvName');
  if (nameEl) { nameEl.hidden = !state.csv; nameEl.innerHTML = state.csv ? `${state.sources.map((src, i) => `<span class="src">${esc(src.name)}<button type="button" class="x" data-src-clear="${i}" aria-label="外す">×</button></span>`).join('')}` : ''; }
  state.base = data.base;
  state.folder = data.selectedFolder;
  if (!data.tabs.some((t) => t.id === state.tab) && state.tab !== 'progress') state.tab = data.defaultTab;

  document.title = data.title || document.title;
  text('title', data.title);
  text('asOf', `${data.asOf} 時点`);
  text('footNote', data.footNote);
  const selected = data.folders.find((f) => f.id === state.folder);
  text('scopeName', selected ? `${selected.customer}　${selected.name}` : 'すべての案件');

  safe(() => renderFolders(), 'folders');
  safe(() => renderTabs(), 'tabs');
  safe(() => renderPanel(), 'panel');
  setTaskData(data);
  if (aiReady) setChatContext({ folder: state.folder, base: data.base, examples: data.examples, scopeName: selected ? selected.name : 'すべての案件', csv: state.csv, overrides: state.overrides });
  writeHash();
}

// ---------- 左: 案件 ----------
function renderFolders() {
  const redAll = data.folders.reduce((s, f) => s + f.red, 0);
  const all = `<button type="button" class="folder ${state.folder === 'all' ? 'on' : ''}" data-folder="all"><span class="f-name">すべて</span><span class="f-meta">${redAll ? `<em class="pill red">${redAll}</em>` : ''}</span></button>`;
  const list = data.folders.map((f) =>
    `<button type="button" class="folder ${state.folder === f.id ? 'on' : ''} ${f.pending ? 'pending' : ''}" data-folder="${esc(f.id)}" ${f.pending ? `title="${esc(f.pending)}"` : ''}>` +
    `<span class="f-cust">${esc(f.customer)}</span><span class="f-name">${esc(f.name)}</span>` +
    `<span class="f-meta">${f.pending ? '<em class="pill gray">未着</em>' : `<em class="pill blue">${esc(f.status)}</em>${f.red ? `<em class="pill red">${f.red}</em>` : ''}`}</span></button>`).join('');
  document.getElementById('folders').innerHTML = all + list;
}

// ---------- 中央 ----------
function renderTabs() {
  const tabs = [...data.tabs, { id: 'progress', label: '進捗' }];
  document.getElementById('tabs').innerHTML = tabs.map((t) =>
    `<button type="button" class="tab ${t.id === state.tab ? 'on' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}${t.count ? `<b>${t.count}</b>` : ''}</button>`).join('');
}

function renderPanel() {
  const fn = { todo: panelTodo, changes: panelChanges, parts: panelParts, progress: () => renderProgress(data) }[state.tab] || panelTodo;
  document.getElementById('panel').innerHTML = fn();
}

// やること: 1件 1行。「なぜ？」と「文面」は押したときだけ
function panelTodo() {
  if (!data.todos.length) return empty(data.selectedFolder !== 'all' && data.folders.find((f) => f.id === data.selectedFolder)?.pending ? '今回の内示がまだ届いていません' : 'やることはありません');
  const all = data.selectedFolder === 'all';
  return `<article class="card list">${data.todos.map((t) => `
    <div class="todo ${esc(t.tone)}" data-todo="${esc(t.id)}">
      <span class="dot" aria-hidden="true"></span>
      <div class="todo-body">
        <div class="todo-main"><span class="who">${esc(t.who)}${t.contact?.person ? `（${esc(t.contact.person.replace(/（.*?）/g, '').trim().split(/\s/).pop())}）` : ''}</span><b>${esc(t.what)}</b></div>
        <div class="todo-sub">${all ? `<span class="tag">${esc(t.folderName)}</span>` : ''}${esc(t.sub)}${t.caution ? `<span class="caution">${esc(t.caution)}</span>` : ''}</div>
      </div>
      <div class="todo-acts">
        ${statusChip(t)}
        <button type="button" class="ghost why" data-why="${esc(t.id)}">なぜ？</button>
        ${t.draft ? `<button type="button" class="ghost" data-draft="${esc(t.id)}">文面</button>` : ''}
        ${orderable(t) ? `<button type="button" class="ghost" data-order="${esc(t.id)}">発注書</button>` : ''}
      </div>
    </div>`).join('')}</article>`;
}

// 内示の変わった点: 読み取り札 → 変更カード → 影響する部品（5列）→ 余る部品
function panelChanges() {
  if (!data.changes.length) return empty('変わった点はありません');
  const all = data.selectedFolder === 'all';
  const readings = data.readings.filter((r) => r.chips).map((r) => `
    <div class="reading"><span class="reading-title">${all ? `${esc(r.folderName)}　` : ''}今回の内示（${esc(r.date)}）</span>
      ${r.chips.map((c) => `<span class="chip ${c.changed ? 'changed' : ''}"><small>${esc(c.label)}</small>${esc(c.value)}</span>`).join('')}</div>`).join('');
  const cards = data.changes.map((c) => `
    <article class="card change ${kindClass(c.kind)}">
      <header class="change-head"><span class="kind">${esc(c.kind)}</span><h3>${esc(c.title)}</h3>${all ? `<span class="tag">${esc(c.folderName)}</span>` : ''}${c.note ? `<span class="muted">${esc(c.note)}</span>` : ''}</header>
      ${c.affected.length ? table(['部品', 'いる数', '今ある分', '足りない', '手配', '届く日'], c.affected.map((r) => tr([
        `${code(r)}<small>${esc(r.name)}</small>`, `${n(r.needAug)} → <b>${n(r.needSep)}</b>`, n(r.have), r.short ? `<b class="bad">${n(r.short)}</b>` : '－',
        r.order ? `<b>${n(r.order)}</b>` : '－', r.eta ? `${esc(r.eta)}<small class="${r.late > 0 ? 'bad' : 'ok'}">${esc(r.status)}</small>` : '－',
      ], r.tone === 'red' ? 'hot' : '', `data-why-row="${esc(r.folderId)}/${esc(r.code)}"`))) : ''}
      ${c.excess.length ? `<div class="excess"><span class="excess-title">余る</span>${c.excess.map((e) => `<span class="chip amber">${esc(e.name)} <b>${n(e.excess)}</b>個${e.transfer.length ? `<small>${esc(e.transfer[0])}</small>` : `<small>約${esc(e.amountMan)}万円</small>`}</span>`).join('')}</div>` : ''}
    </article>`).join('');
  return readings + cards;
}

// 部品の一覧: 全部。行を押すと「なぜ？」
function panelParts() {
  if (!data.parts.length) return empty('部品はありません');
  const all = data.selectedFolder === 'all';
  const cols = [...(all ? ['案件'] : []), '部品', 'メーカー', 'いる数', '今ある分', '足りない', '手配', '届く日', '状態'];
  return `<article class="card">${table(cols, data.parts.map((r) => tr([
    ...(all ? [`<span class="tag">${esc(r.folderName)}</span>`] : []),
    `${code(r)}<small>${esc(r.name)}</small>`, esc(r.maker), n(r.needSep), `${n(r.have)}<small>在庫 ${n(r.stock)}・頼み済み ${n(r.po)}</small>`,
    r.short ? `<b class="bad">${n(r.short)}</b>` : '－', r.order ? `<b>${n(r.order)}</b>` : '－', r.eta ? esc(r.eta) : '－',
    `<em class="pill ${esc(r.tone)}">${esc(r.status)}</em>`,
  ], '', `data-why-row="${esc(r.folderId)}/${esc(r.code)}"`)))}<p class="muted">行を押すと「なぜ？」が出ます</p></article>`;
}

// ---------- クリック ----------
function onPanelClick(e) {
  const order = e.target.closest('[data-order]');
  if (order) { const t = data.todos.find((x) => x.id === order.dataset.order); if (t) openOrder(t, data, { onChange: () => renderPanel() }); return; }
  if (onTaskClick(e, data, () => renderPanel())) return;
  const why = e.target.closest('[data-why]');
  if (why) { const t = data.todos.find((x) => x.id === why.dataset.why); if (t) openPop(whyHtml(t.what, t.why)); return; }
  const draft = e.target.closest('[data-draft]');
  if (draft) {
    const t = data.todos.find((x) => x.id === draft.dataset.draft);
    if (t?.draft) openPop(`<h3>${esc(t.draft.subject)}</h3><pre id="draftText">${esc(t.draft.body)}</pre><div class="pop-acts"><button type="button" class="primary" data-copy="draftText">コピー</button>${aiReady ? '<button type="button" class="ghost" data-ask-draft="1">AI に言い回しを変えてもらう</button>' : ''}</div>`);
    return;
  }
  const row = e.target.closest('[data-why-row]');
  if (row) {
    const [fid, code] = row.dataset.whyRow.split('/');
    const r = data.parts.find((x) => x.folderId === fid && x.code === code);
    if (r) openPop(whyHtml(`${r.code} ${r.name}`, r.why));
  }
}
document.addEventListener('click', (e) => {
  const clr = e.target.closest('[data-src-clear]');
  if (clr) { state.sources.splice(Number(clr.dataset.srcClear), 1); state.csv = state.sources.length ? mergeCsv(state.sources) : null; state.csvName = state.sources.map((x) => x.name).join(' + '); load(); return; }
  if (e.target.closest('#sampleBtn')) {
    openPop(`<h3>見本の内示</h3><p class="pop-sub">架空の内示です。保存して、左上の枠に落としてください。同じ内示を、届く形ごとに用意しています。</p><ul class="files">
      <li><a href="/sample/内示_前回_2026-08-28.csv" download>内示_前回_2026-08-28.csv</a><small>前回と同じ → 変わった点なし</small></li>
      <li><a href="/sample/内示_今回_2026-09-25.csv" download>内示_今回_2026-09-25.csv</a><small>CSV（いま画面に出ている内示）</small></li>
      <li><a href="/sample/内示_今回_2026-09-25.xlsx" download>内示_今回_2026-09-25.xlsx</a><small>Excel（同じ内示）</small></li>
      <li><a href="/sample/内示_今回_2026-09-25.pdf" download>内示_今回_2026-09-25.pdf</a><small>PDF の内示書（同じ内示。手書きの希望日あり）</small></li>
      <li><a href="/sample/内示_メール本文_2026-09-25.txt" download>内示_メール本文_2026-09-25.txt</a><small>メール本文（同じ内示を文章で）</small></li>
      <li><a href="/sample/内示_電話メモ_2026-09-25.txt" download>内示_電話メモ_2026-09-25.txt</a><small>電話の走り書き（「メモ帳に転記」に貼る）</small></li>
      <li><a href="/sample/内示_今回_修正版.csv" download>内示_今回_修正版.csv</a><small>台数・希望日を変えたもの → 表が変わる</small></li></ul>`);
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const pre = document.getElementById(copy.dataset.copy);
    navigator.clipboard?.writeText(pre.textContent).then(() => { copy.textContent = 'コピーしました'; setTimeout(() => { copy.textContent = 'コピー'; }, 1500); });
  }
  if (e.target.closest('[data-ask-draft]') && aiReady) {
    const subject = document.querySelector('#pop h3')?.textContent || '';
    closePop();
    openChat();
    ask(`「${subject}」の文面を、もう少しやわらかい言い回しにしてください。数字は変えないでください。`);
  }
});

function whyHtml(title, lines) {
  return `<h3>なぜ？</h3><p class="pop-sub">${esc(title)}</p><ol class="why-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol><p class="muted">「？ 計算のしかた」のとおり。AI は計算していません。</p>`;
}

// ---------- 吹き出し（なぜ？／文面／計算のしかた） ----------
function openPop(html) {
  const pop = document.getElementById('pop');
  pop.innerHTML = `<button type="button" class="pop-close" aria-label="閉じる">×</button>${html}`;
  pop.hidden = false;
  document.getElementById('overlay').hidden = false;
  pop.querySelector('.pop-close').addEventListener('click', closePop);
}
function closePop() {
  document.getElementById('pop').hidden = true;
  document.getElementById('overlay').hidden = true;
}

// 読み取り（intake.js）で確定した内示を、CSV の形で受け取って計算し直す
async function applyCsv(csvText, meta = {}) {
  openPop(`<div class="drop-play"><div class="spin" aria-hidden="true"></div><p id="dropStep">計算中…</p><p class="muted">${esc(meta.name || '')}</p></div>`);
  const before = JSON.stringify((data?.folders || []).map((f) => [f.id, f.status]));
  // 同じ名前のものは入れ替え、違うものは足す。複数の書類が 1 つの内示にまとまる（案件ごとに後から来た方が勝つ）
  const name = meta.name || '内示';
  state.sources = [...state.sources.filter((x) => x.name !== name), { name, csvText }];
  state.csv = mergeCsv(state.sources);
  state.csvName = state.sources.map((x) => x.name).join(' + ');
  await wait(500);
  await load();
  if (!state.csv) return; // 読めなかった（load() が案内を出している）
  const m = data.csv?.matched || [];
  const changedFolders = data.folders.filter((f) => f.fromCsv);
  const first = changedFolders.find((f) => f.status !== '変更なし') || changedFolders[0];
  const after = JSON.stringify(data.folders.map((f) => [f.id, f.status]));
  const summary = m.length
    ? `<ul class="why-list">${m.map((x) => `<li>${esc(x.name)}</li>`).join('')}</ul>${data.csv.unmatched.length ? `<p class="muted">読めたが部品表がない行: ${data.csv.unmatched.map((u) => esc(u.name)).join('、')}</p>` : ''}${before === after && first ? '<p class="muted">前と同じ内示でした</p>' : ''}`
    : '<p class="pop-sub">この画面の案件に当てはまる行がありませんでした（機種か案件名で照合）</p>';
  openPop(`<h3>${m.length} 件の案件を読み取りました</h3>${summary}`);
  await wait(1400);
  closePop();
  if (first) { state.folder = first.id; state.tab = 'changes'; await load(); }
}
// ---------- 小道具 ----------
function table(cols, rows) { return `<div class="table-wrap"><table><thead><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`; }
function tr(cells, cls = '', attrs = '') { return `<tr class="${cls}" ${attrs}>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`; }
function n(v) { return esc(fmt(v)); }
function code(r) { return `<span class="code">${esc(r.code)}</span>`; }
function kindClass(k) { return { 増えた: 'k-up', 減った: 'k-down', 前倒し: 'k-up', 後ろ倒し: 'k-down', 仕様変更: 'k-opt', 取消: 'k-cancel' }[k] || ''; }
function empty(msg) { return `<article class="card"><p class="muted">${esc(msg)}</p></article>`; }
function text(id, v) { const el = document.getElementById(id); if (el && v != null) el.textContent = v; }
function safe(fn, where) { try { fn(); } catch (err) { console.error('app', where, err); } }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function parseHash() { return Object.fromEntries(new URLSearchParams((globalThis.location?.hash || '').replace(/^#/, ''))); }
function writeHash() {
  if (!globalThis.history?.replaceState) return;
  const qs = new URLSearchParams({ folder: state.folder, tab: state.tab });
  if (state.base && state.base !== '2026-09-25') qs.set('base', state.base);
  globalThis.history.replaceState(null, '', `#${qs}`);
}
