// 画面の組み立て。/api/data（src/data.js の getDemoData）の結果だけを描く。計算はここでは一切しない。
import { esc, fmt } from './util.js';
import { setupChat, setChatContext, ask } from './chat.js';

const state = { folder: 'all', base: '', tab: '' };
let aiReady = false;
let data = null;

// テスト（test/render.test.mjs）が待てるように、組み立て完了の Promise を残す
globalThis.__dashboardReady = init().catch((err) => {
  console.error('app', err);
  text('panel', '画面を組み立てられませんでした。src/data.js を確認してください。');
});

async function init() {
  const hash = parseHash();
  state.folder = hash.folder || 'all';
  state.base = hash.base || '';
  state.tab = hash.tab || '';

  const me = await fetch('/api/me').then((r) => r.json()).catch(() => ({}));
  aiReady = Boolean(me.ai);
  if (aiReady) setupChat();
  else {
    document.getElementById('chat').remove();
    document.querySelector('.layout').classList.add('no-chat');
  }

  document.getElementById('basePick').addEventListener('change', (e) => { state.base = e.target.value; load(); });
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
  setupTooltip();
  await load();
}

async function load() {
  const qs = new URLSearchParams({ folder: state.folder });
  if (state.base) qs.set('base', state.base);
  const res = await fetch(`/api/data?${qs}`);
  if (!res.ok) { text('panel', 'データを読み込めませんでした。ページを再読み込みしてください。'); return; }
  data = await res.json();
  state.base = data.base;
  state.folder = data.selectedFolder;
  if (!data.tabs.some((t) => t.id === state.tab)) state.tab = data.defaultTab;

  document.title = data.title || document.title;
  text('title', data.title);
  text('subtitle', data.subtitle);
  text('footNote', data.footNote);
  text('baseNote', data.baseNote);
  const pick = document.getElementById('basePick');
  pick.innerHTML = data.baseOptions.map((o) => `<option value="${esc(o.value)}" ${o.value === data.base ? 'selected' : ''}>${esc(o.label)}</option>`).join('');

  const selected = data.folders.find((f) => f.id === state.folder);
  const scopeName = selected ? `${selected.customer}／${selected.name}` : '全案件（内示が届いている 3 案件）';
  text('scopeName', scopeName);

  safe(() => renderFolders(), 'folders');
  safe(() => renderTabs(), 'tabs');
  safe(() => renderPanel(), 'panel');
  if (aiReady) setChatContext({ folder: state.folder, base: data.base, baseLabel: data.baseLabel, examples: data.examples, scopeName: selected ? selected.name : '全案件' });
  writeHash();
}

// ---------- 左: フォルダ ----------
function renderFolders() {
  const s = data.summary;
  const all = `<button type="button" class="folder ${state.folder === 'all' ? 'on' : ''}" data-folder="all">` +
    `<span class="f-cust">全案件</span><span class="f-name">内示が届いている 3 案件をまとめて見る</span>` +
    `<span class="f-meta">${s.urgent ? `<em class="pill red">急ぐ ${s.urgent}</em>` : ''}${s.late ? `<em class="pill amber">遅れ ${s.late}</em>` : ''}${s.changes ? `<em class="pill blue">変更 ${s.changes}</em>` : ''}</span></button>`;
  const list = data.folders.map((f) => {
    const pills = f.pending
      ? `<em class="pill gray" title="${esc(f.pending)}">9月版 未受領</em>`
      : `${f.urgent ? `<em class="pill red">急ぐ ${f.urgent}</em>` : ''}${f.late ? `<em class="pill amber">遅れ ${f.late}</em>` : ''}<em class="pill blue">${esc(f.status)}</em>`;
    return `<button type="button" class="folder ${state.folder === f.id ? 'on' : ''} ${f.pending ? 'pending' : ''}" data-folder="${esc(f.id)}">` +
      `<span class="f-cust">${esc(f.customer)}</span><span class="f-name">${esc(f.name)}<small>${esc(f.model)}</small></span><span class="f-meta">${pills}</span></button>`;
  }).join('');
  document.getElementById('folders').innerHTML = all + list;
}

// ---------- 中央: タブと中身 ----------
function renderTabs() {
  document.getElementById('tabs').innerHTML = data.tabs.map((t) =>
    `<button type="button" class="tab ${t.id === state.tab ? 'on' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}${t.count ? `<b>${t.count}</b>` : ''}</button>`).join('');
}

function renderPanel() {
  const el = document.getElementById('panel');
  const fn = { changes: panelChanges, urgent: panelUrgent, late: panelLate, folders: panelFolders, rules: panelRules, reading: panelReading }[state.tab] || panelChanges;
  el.innerHTML = fn();
  el.scrollIntoView?.({ block: 'nearest' });
}

// 内示の変更点 → 影響部品 → 過剰になる部品 → 次のアクション
function panelChanges() {
  if (!data.changes.length) return empty('この範囲には、8月版 → 9月版 の変更点がありません。');
  const cards = data.changes.map((c) => {
    const rows = c.affected.filter(Boolean);
    const cols = ['型番', '品名', 'オプション', '8月版 必要数', '9月版 必要数', '差', '在庫＋発注残', '不足', '追加手配', '入手見込み', '遅れ', '根拠'];
    const body = rows.map((r) => tr([
      code(r), esc(r.name), esc(r.option || '－'), n(r.needAug), n(r.needSep), diff(r.needSep - r.needAug), `${n(r.stock)}＋${n(r.po)}${r.poDate ? `<small>（入荷 ${esc(r.poDate)}）</small>` : ''}`,
      r.short ? `<b class="bad">${n(r.short)}</b>` : '0', r.order ? `<b>${n(r.order)}</b><small>ロット ${r.lot}</small>` : '－', r.eta ? `${esc(r.eta)}<small>${esc(r.etaKind)}</small>` : '－', lateCell(r), basisBtn(r),
    ], r.late > 0 || r.urgent ? 'hot' : ''));
    const excess = data.excess.filter((e) => e.folderId === c.folderId && (c.kind === '取消' || c.kind === 'オプション'));
    const excessHtml = excess.length ? `<h4 class="sub-h">過剰になる部品（不要になる発注残）</h4>` + table(['型番', '品名', 'メーカー', '発注残', '入荷予定', '金額', '扱い'],
      excess.map((e) => tr([code(e), esc(e.name), esc(e.maker), `<b class="bad">${n(e.excess)}</b>`, esc(e.poDateLabel), `約${esc(e.amountMan)}万円`, e.transfer.length ? `<span class="ok">${e.transfer.map(esc).join('<br>')}</span>` : 'キャンセル可否をメーカーに確認'], 'warn'))) : '';
    return `<article class="card change ${kindClass(c.kind)}">
      <header class="change-head"><span class="kind">${esc(c.kind)}</span><div><h3>${esc(c.title)}</h3><p class="muted">${data.selectedFolder === 'all' ? `${esc(c.folderName)}　` : ''}${esc(c.note || '')}</p></div>
        <div class="ba"><span>8月版</span><b>${esc(c.before)}</b><i>→</i><span>9月版</span><b>${esc(c.after)}</b></div></header>
      ${rows.length ? `<h4 class="sub-h">影響する部品（${rows.length}）</h4>${table(cols, body)}` : '<p class="muted">この変更で数量が変わる部品はありません。</p>'}
      ${excessHtml}
    </article>`;
  }).join('');
  const actions = data.actions.length ? `<article class="card"><h3>次のアクション（文面の下書き）</h3><p class="muted">数字は上の表の値をそのまま差し込んでいます。送る前に内容を確認してください。差出人・宛先は架空です。</p>
    <div class="actions">${data.actions.map((a, i) => `<details class="action"><summary><span class="kind">${esc(a.kind)}</span><b>${esc(a.subject)}</b><small>宛先: ${esc(a.to)}${data.selectedFolder === 'all' ? `／${esc(a.folderName)}` : ''}</small></summary><pre id="draft-${i}">${esc(a.body)}</pre><button type="button" class="ghost" data-copy="draft-${i}">文面をコピー</button></details>`).join('')}</div></article>` : '';
  return cards + actions;
}

function panelUrgent() {
  if (!data.urgent.length) return empty('この範囲には、急いで手配する部品がありません。');
  const cols = ['発注期限', '案件', '型番', '品名', 'メーカー', '必要数', '在庫＋発注残', '不足', '追加手配', '金額', '入手見込み', '遅れ', '根拠'];
  const rows = data.urgent.map((r) => tr([
    `<b class="${r.deadlinePassed ? 'bad' : ''}">${esc(r.deadline)}</b>${r.deadlinePassed ? '<small>期限を過ぎた</small>' : `<small>${esc(data.urgentUntil)} までに</small>`}`,
    esc(r.folderName), code(r), esc(r.name), esc(r.maker), n(r.needSep), `${n(r.stock)}＋${n(r.po)}`, `<b class="bad">${n(r.short)}</b>`, `<b>${n(r.order)}</b><small>ロット ${r.lot}</small>`, `約${esc(r.amount)}万円`, esc(r.eta), lateCell(r), basisBtn(r),
  ], 'hot'));
  return `<article class="card"><h3>手配を急ぐ部品（発注期限の早い順）</h3><p class="muted">「急ぐ」＝ 発注期限が基準日 ${esc(data.baseLabel)} から 7 日以内（${esc(data.urgentUntil)} まで）か、すでに過ぎている部品。</p>${table(cols, rows)}</article>`;
}

function panelLate() {
  if (!data.late.length) return empty('この範囲には、希望納期に遅れる見込みの部品がありません。');
  const cols = ['遅れ', '案件', '型番', '品名', 'メーカー', '種類', '希望納期', '入手見込み', '追加手配', '根拠'];
  const rows = data.late.map((r) => tr([lateCell(r), esc(r.folderName), code(r), esc(r.name), esc(r.maker), esc(r.etaKind), esc(r.due), esc(r.eta), r.order ? n(r.order) : '－', basisBtn(r)], 'hot'));
  return `<article class="card"><h3>納期の遅れ（遅れの大きい順）</h3><p class="muted">入手見込み − 希望納期 がプラスの部品。「追加手配」はこれから発注する部品、「発注残の入荷」は発注済みの入荷予定日が遅い部品です。</p>${table(cols, rows)}</article>`;
}

function panelFolders() {
  return `<article class="card"><h3>フォルダ（内示の置き場）</h3><p class="muted">案件ごとに 8月版・9月版の内示を置くと、差分が「内示の変更点」に出ます。</p>
    ${table(['お客様', '案件', '機種', '8月版', '9月版', '状態'], data.folders.map((f) => tr(f.pending
      ? [esc(f.customer), esc(f.name), esc(f.model), '受領済み', '<b class="muted">未受領</b>', `<span class="muted">${esc(f.pending)}</span>`]
      : [esc(f.customer), esc(f.name), esc(f.model), `${f.versions.aug.qty}台・希望 ${esc(f.versions.aug.dueLabel)}${f.versions.aug.options.length ? `<small>${esc(f.versions.aug.options.join('・'))}</small>` : ''}`,
        `${f.versions.sep.qty ? `${f.versions.sep.qty}台・希望 ${esc(f.versions.sep.dueLabel)}` : '<b class="bad">取消</b>'}${f.versions.sep.options.length ? `<small>${esc(f.versions.sep.options.join('・'))}</small>` : ''}`,
        `<em class="pill blue">${esc(f.status)}</em>`], f.pending ? 'dim' : '')))}
    <p class="muted">「9月版 未受領」＝ 9月版の内示がまだ届いていない案件。差分は出せません。催促の状況はマウスを当てると出ます。</p></article>`;
}

function panelRules() {
  return `<article class="card"><h3>計算の決まり v1（この画面の数字はすべてこの式）</h3><p class="muted">AI はこの計算をしません。式はルール表として固定し、変えるときは版を上げます。</p>
    ${table(['項目', '式'], data.rules.map((r) => tr([`<b>${esc(r.name)}</b>`, esc(r.formula)])))}
    <p class="muted">基準日は右上で切り替えられます（いまは ${esc(data.baseLabel)}）。基準日を変えると、入手見込み・発注期限・急ぐの判定が変わります。</p></article>`;
}

function panelReading() {
  const blocks = data.reading.map((r) => `<article class="card"><h3>${esc(r.folderName)}</h3>
    ${r.items.length ? table(['項目', '読み取った内容', '出どころ', ''], r.items.map((it) => tr([`<b>${esc(it.field)}</b>`, esc(it.value), `<span class="muted">${esc(it.from)}</span>`, it.check ? '<em class="pill amber">要確認</em>' : '<em class="pill gray">転記済み</em>'], it.check ? 'warn' : ''))) : '<p class="muted">読み取るものがありません。</p>'}
    </article>`).join('');
  return `<article class="card note"><h3>AI の読み取り</h3><p>内示の PDF／CSV から AI が読み取った項目です。読み取った値は表に転記するだけで、<b>数字の計算は「計算の決まり v1」が行います</b>。「要確認」は、記載が食い違う・読み取れないなど、担当の方に確かめる項目です。</p>
    ${aiReady ? '<button type="button" class="primary" data-ask="reading">AI に、要確認の点を確認する文面にしてもらう</button>' : ''}</article>${blocks}`;
}

// ---------- クリック（根拠・コピー・AI へ） ----------
function onPanelClick(e) {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const pre = document.getElementById(copy.dataset.copy);
    navigator.clipboard?.writeText(pre.textContent).then(() => { copy.textContent = 'コピーしました'; setTimeout(() => { copy.textContent = '文面をコピー'; }, 1500); });
    return;
  }
  const askBtn = e.target.closest('[data-ask]');
  if (askBtn && aiReady) {
    ask('この案件の「要確認」の項目を、お客様に確認する文面にしてください。');
    return;
  }
  const b = e.target.closest('.basis');
  if (b) showTooltip(b, true);
}

// 根拠ツールチップ: 式に実際の数字が入った文を、計算順に出す
function basisBtn(r) {
  const lines = ['need', 'short', 'order', 'eta', 'late', 'deadline'].map((k) => r.basis?.[k]).filter(Boolean);
  return `<button type="button" class="basis" data-tip="${esc(JSON.stringify(lines))}" aria-label="根拠を見る">根拠</button>`;
}

function setupTooltip() {
  const tip = document.getElementById('tooltip');
  document.addEventListener('mouseover', (e) => { const b = e.target.closest?.('.basis'); if (b) showTooltip(b, false); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('.basis') && !tip.dataset.pinned) tip.hidden = true; });
  document.addEventListener('click', (e) => { if (!e.target.closest?.('.basis')) { tip.hidden = true; delete tip.dataset.pinned; } });
}

function showTooltip(btn, pin) {
  const tip = document.getElementById('tooltip');
  let lines = [];
  try { lines = JSON.parse(btn.dataset.tip || '[]'); } catch { lines = []; }
  tip.innerHTML = `<div class="t-title">根拠（計算の決まり v1）</div>${lines.map((l) => `<div class="t-row">${esc(l)}</div>`).join('')}`;
  const r = btn.getBoundingClientRect?.() || { left: 0, bottom: 0 };
  tip.style.left = `${Math.max(8, Math.min(r.left, (globalThis.innerWidth || 1200) - 340))}px`;
  tip.style.top = `${r.bottom + 8}px`;
  tip.hidden = false;
  if (pin) tip.dataset.pinned = '1';
}

// ---------- 小道具 ----------
function table(cols, rows) { return `<div class="table-wrap"><table><thead><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`; }
function tr(cells, cls = '') { return `<tr class="${cls}">${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`; }
function n(v) { return esc(fmt(v)); }
function code(r) { return `<span class="code">${esc(r.code)}</span>`; }
function diff(v) { return v > 0 ? `<b class="bad">+${n(v)}</b>` : v < 0 ? `<b class="ok">−${n(-v)}</b>` : '±0'; }
function lateCell(r) { return r.late > 0 ? `<b class="bad">${r.late}日遅れ</b>` : r.eta ? `<span class="ok">${-r.late}日の余裕</span>` : '－'; }
function kindClass(k) { return { 増量: 'k-up', 減量: 'k-down', 前倒し: 'k-up', 後ろ倒し: 'k-down', オプション: 'k-opt', 取消: 'k-cancel' }[k] || ''; }
function empty(msg) { return `<article class="card"><p class="muted">${esc(msg)}</p></article>`; }
function text(id, v) { const el = document.getElementById(id); if (el && v != null) el.textContent = v; }
function safe(fn, where) { try { fn(); } catch (err) { console.error('app', where, err); } }
function parseHash() {
  const h = (globalThis.location?.hash || '').replace(/^#/, '');
  return Object.fromEntries(new URLSearchParams(h));
}
function writeHash() {
  if (!globalThis.history?.replaceState) return;
  const qs = new URLSearchParams({ folder: state.folder, tab: state.tab, base: state.base });
  globalThis.history.replaceState(null, '', `#${qs}`);
}
