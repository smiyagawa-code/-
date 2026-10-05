// 画面の組み立て。/api/data（src/data.js の getDemoData）の結果だけを描く。計算はここでは一切しない。
// 画面での手直し（掛率・単価の上書き、在庫／直送、行の追加、注記、空白行）は state.edits に持ち、毎回サーバーに送って計算し直す。
import { esc, fmt } from './util.js';
import { setupChat, setChatContext, ask } from './chat.js';

const state = { folder: 'all', site: '', tab: '', edits: {}, stage: {} };
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
  state.site = hash.site || '';
  state.tab = hash.tab || '';

  const me = await fetch('/api/me').then((r) => r.json()).catch(() => ({}));
  aiReady = Boolean(me.ai);
  if (aiReady) setupChat();
  else {
    document.getElementById('chat').remove();
    document.querySelector('.layout').classList.add('no-chat');
  }

  document.getElementById('sitePick').addEventListener('change', (e) => { state.site = e.target.value; load(); });
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
  const panel = document.getElementById('panel');
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('change', onPanelChange);
  panel.addEventListener('submit', onPanelSubmit);
  setupTooltip();
  await load();
}

async function load() {
  const body = { folder: state.folder, site: state.site || undefined, edits: state.edits };
  const res = await fetch('/api/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { text('panel', 'データを読み込めませんでした。ページを再読み込みしてください。'); return; }
  data = await res.json();
  state.site = data.site;
  state.folder = data.selectedFolder;
  if (!data.tabs.some((t) => t.id === state.tab)) state.tab = data.defaultTab;

  document.title = data.title || document.title;
  text('title', data.title);
  text('subtitle', data.subtitle);
  text('footNote', data.footNote);
  text('siteNote', data.siteNote);
  const pick = document.getElementById('sitePick');
  pick.innerHTML = data.siteOptions.map((o) => `<option value="${esc(o.id)}" ${o.id === data.site ? 'selected' : ''}>${esc(o.name)}</option>`).join('');

  const selected = data.folders.find((f) => f.id === state.folder);
  const scopeName = selected ? `${selected.no}　${selected.title}` : `全依頼（${data.summary.requests} 件・未回答 ${data.summary.open} 件）`;
  text('scopeName', scopeName);

  safe(() => renderFolders(), 'folders');
  safe(() => renderTabs(), 'tabs');
  safe(() => renderPanel(), 'panel');
  if (aiReady) setChatContext({ folder: state.folder, site: data.site, siteName: data.siteName, edits: state.edits, examples: data.examples, scopeName: selected ? selected.title : '全依頼' });
  writeHash();
}

// ---------- 左: 依頼の受信箱 ----------
function renderFolders() {
  const s = data.summary;
  const all = `<button type="button" class="folder ${state.folder === 'all' ? 'on' : ''}" data-folder="all">` +
    `<span class="f-cust">全依頼</span><span class="f-name">受信箱の ${s.requests} 件をまとめて見る</span>` +
    `<span class="f-meta">${s.alerts ? `<em class="pill amber">要確認 ${s.alerts}</em>` : ''}${s.dueSoon ? `<em class="pill red">期限 3 日以内 ${s.dueSoon}</em>` : ''}<em class="pill blue">未回答 ${s.open}</em></span></button>`;
  const list = data.folders.map((f) => {
    const pills = f.pending
      ? `<em class="pill gray" title="${esc(f.pending)}">読み取り保留</em>`
      : `${f.alerts ? `<em class="pill amber">要確認 ${f.alerts}</em>` : ''}<em class="pill ${f.status === 'answered' ? 'gray' : 'blue'}">${esc(f.statusLabel)}</em>`;
    return `<button type="button" class="folder ${state.folder === f.id ? 'on' : ''} ${f.pending ? 'pending' : ''}" data-folder="${esc(f.id)}">` +
      `<span class="f-cust">${esc(f.client)}　<b class="code">${esc(f.no)}</b></span><span class="f-name">${esc(f.title)}<small>${esc(f.kind)}</small></span>` +
      `<span class="f-meta">${pills}${f.due ? `<em class="pill ${f.status === 'answered' ? 'gray' : ''}">期限 ${esc(f.due)}</em>` : ''}</span></button>`;
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
  const fn = { lines: panelLines, pricing: panelPricing, sheet: panelSheet, lists: panelLists, rules: panelRules }[state.tab] || panelLines;
  el.innerHTML = fn();
  el.scrollIntoView?.({ block: 'nearest' });
}

const one = () => (data.requests.length === 1 ? data.requests[0] : null);

// 依頼の見出し（件名・出どころ・依頼元・形・期限）
function requestHead(r) {
  const meta = [['依頼元', `${r.client} ${r.person}`], ['依頼の形', r.kind], ['受領', r.received], ['回答期限', r.due || '－'], ['価格ランク', r.rank], ['状態', r.statusLabel]];
  return `<article class="card head">
    <div class="head-top"><div><span class="code">${esc(r.no)}</span><h3>${esc(r.title)}</h3><p class="muted">件名の出どころ: ${esc(r.titleFrom)}${r.titleAlert ? ` <em class="pill amber">要確認</em>` : ''}</p></div>
      <em class="pill ${r.status === 'answered' ? 'gray' : 'blue'} big">${esc(r.statusLabel)}</em></div>
    <dl class="meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <p class="muted">出どころ: ${esc(r.source)}</p>
  </article>`;
}

// 読み取り結果: 要確認 → 明細 → 読み取り漏れの追加
function panelLines() {
  const r = one();
  if (!r) return panelLinesAll();
  if (r.pending) return requestHead(r) + `<article class="card note"><h3>読み取り保留</h3><p>${esc(r.pending)}</p><p>${esc(r.titleAlert)}</p>${aiReady ? '<button type="button" class="primary" data-ask="pending">AI に、依頼元へ確認する文面を作ってもらう</button>' : ''}</article>`;
  const checks = r.alerts.filter((a) => a.kind === '明細' || a.kind === '件名');
  const infos = r.alerts.filter((a) => a.kind !== '明細' && a.kind !== '件名');
  const alertsHtml = `<article class="card"><h3>人が判断する行（要確認 ${checks.length} 件）</h3><p class="muted">AI が読み取れなかった・推定した箇所です。確認が済んだら「確認済み」にすると、見積書の注記と回答メールから外れます。</p>
    ${checks.length ? `<ul class="alerts">${checks.map((a) => `<li class="alert"><em class="pill amber">${esc(a.kind)}</em><span>${esc(a.text)}</span>${a.lineId ? `<button type="button" class="ghost" data-resolve="${esc(a.lineId)}">確認済みにする</button>` : ''}</li>`).join('')}</ul>` : '<p class="ok">要確認はありません。</p>'}
    ${infos.length ? `<h4 class="sub-h">自動で処理した点（${infos.length}）</h4><ul class="alerts info">${infos.map((a) => `<li class="alert"><em class="pill ${kindPill(a.kind)}">${esc(a.kind)}</em><span>${esc(a.text)}</span></li>`).join('')}</ul>` : ''}
    ${aiReady && checks.length ? '<button type="button" class="primary" data-ask="checks">AI に、要確認の点を依頼元に確認する文面にしてもらう</button>' : ''}
  </article>`;
  const cols = ['#', '読み取った原文', '出どころ', '読み取り結果（品目）', '数量', '状態', ''];
  const rows = r.lines.map((l, i) => tr([
    String(i + 1), `<span class="raw">${esc(l.read)}</span>${l.qtyParts ? `<small>＋ ${esc(l.qtyParts.slice(1).map((p) => `${fmt(p.qty)}m（${p.from}）`).join('、'))}</small>` : ''}`,
    `<span class="muted">${esc(l.from)}</span>`, `<b>${esc(l.label)}</b><small>${esc(l.groupName)}・${esc(l.makerName)}</small>`,
    `${n(l.qty)} m${l.breakdown ? `<small>${esc(l.breakdown)}</small>` : ''}${l.qtyParts ? '<small>合算</small>' : ''}`,
    lineStatus(l), l.alert && !l.resolved ? `<button type="button" class="ghost" data-resolve="${esc(l.id)}">確認済み</button>` : '',
  ], l.alert && !l.resolved ? 'warn' : l.added ? 'hot' : ''));
  const addForm = `<article class="card"><h3>拾えなかった品目を追加</h3><p class="muted">読み取り漏れは、ここから手で足せます。足した行も同じ決まりで単価が付きます。</p>
    <form class="add-form" data-add="1"><select name="itemId" aria-label="品目">${data.items.map((it) => `<option value="${esc(it.id)}">${esc(it.label)}（${esc(it.group)}${it.stocked ? '' : '・直送'}）</option>`).join('')}</select>
      <input name="qty" type="number" min="1" max="999999" step="1" value="100" aria-label="数量 m"><span class="unit">m</span>
      <input name="note" type="text" maxlength="100" placeholder="備考（例: 100m巻）" aria-label="備考">
      <button type="submit" class="primary">行を追加</button></form></article>`;
  return requestHead(r) + alertsHtml + `<article class="card"><h3>読み取った明細（${r.lines.length} 行）</h3><p class="muted">依頼書の行をそのまま読み取り、品目に当てはめた結果です。同一品目が複数ページにあれば合算しています。</p>${table(cols, rows)}</article>` + addForm;
}

function panelLinesAll() {
  const cards = data.requests.map((r) => {
    const checks = r.alerts.filter((a) => a.kind === '明細' || a.kind === '件名');
    return `<article class="card req"><div class="head-top"><div><span class="code">${esc(r.no)}</span><h3>${esc(r.title)}</h3><p class="muted">${esc(r.client)}　${esc(r.kind)}　受領 ${esc(r.received)}${r.due ? `　期限 ${esc(r.due)}` : ''}</p></div><em class="pill ${r.status === 'answered' ? 'gray' : 'blue'} big">${esc(r.statusLabel)}</em></div>
      ${r.pending ? `<p class="muted">${esc(r.pending)}</p>` : `<p class="muted">明細 ${r.lines.length} 行　合計 ${n(r.total)} 円（税別）　要確認 ${checks.length} 件</p>${checks.length ? `<ul class="alerts compact">${checks.slice(0, 3).map((a) => `<li class="alert"><em class="pill amber">${esc(a.kind)}</em><span>${esc(a.text)}</span></li>`).join('')}</ul>` : ''}`}
      <button type="button" class="ghost" data-open="${esc(r.id)}">この依頼を開く →</button></article>`;
  }).join('');
  return `<article class="card note"><h3>受信箱</h3><p>依頼メール・FAX・内訳明細書から AI が明細を読み取り、人が判断する行に「要確認」を付けます。左の一覧か下のカードから依頼を開くと、単価の根拠と見積書が見られます。</p></article>${cards}`;
}

// 単価と根拠: 行ごとに 在庫／直送・ランク・掛率・単価を手直しできる
function panelPricing() {
  const r = one();
  if (!r) return panelPricingAll();
  if (r.pending) return requestHead(r) + `<article class="card"><p class="muted">読み取りが保留のため、単価はまだ付いていません。</p></article>`;
  const locked = r.status === 'answered';
  const cols = ['品目', '納品／ランク', '数量', '単価の計算（建値 × 掛率 ＝ 単価 円/m）', '金額', '根拠'];
  const rows = r.lines.map((l) => {
    const ed = `data-line="${esc(l.id)}"`;
    const route = l.pricing === 'rate' || l.stocked
      ? `<select ${ed} data-field="route" aria-label="納品方式" ${locked ? 'disabled' : ''}><option value="stock" ${l.route === 'stock' ? 'selected' : ''}>在庫</option><option value="direct" ${l.route === 'direct' ? 'selected' : ''}>直送</option></select>${l.stocked ? `<small>${l.route === 'stock' && l.stock < l.qty ? `<span class="bad">在庫 ${n(l.stock)}m（不足分は補填）</span>` : `在庫 ${n(l.stock)}m`}</small>` : '<small>在庫品でない</small>'}`
      : esc(l.routeLabel);
    const rank = `<select ${ed} data-field="rank" aria-label="価格ランク" ${locked ? 'disabled' : ''}><option value="A" ${l.rank === 'A' ? 'selected' : ''}>A</option><option value="B" ${l.rank === 'B' ? 'selected' : ''}>B</option></select>`;
    const base = l.pricing === 'rate'
      ? `${n(l.price)}<small>${l.priceChanged ? `<span class="bad">${esc(l.edition)} ${l.priceChangePct > 0 ? '+' : ''}${l.priceChangePct}%</span>` : `${esc(l.edition)}`}</small>`
      : `${n(l.unit)}<small>${esc(l.rank)}単価（表）</small>`;
    const rate = l.pricing === 'rate'
      ? `<input ${ed} data-field="rate" type="number" step="0.01" min="0.3" max="1" value="${l.rate}" aria-label="掛率" class="${l.rateEdited ? 'edited' : ''}" ${locked ? 'disabled' : ''}>${l.rateEdited ? `<small class="bad">手入力（表は ${l.rateTable}）</small>` : ''}`
      : '<span class="muted">－</span>';
    const unit = `<input ${ed} data-field="unit" type="number" step="0.1" min="0.1" value="${l.unit}" aria-label="単価" class="${l.unitEdited ? 'edited' : ''}" ${locked ? 'disabled' : ''}>${l.unitEdited ? '<small class="bad">手入力で上書き</small>' : l.pricing === 'rate' ? `<small>${esc(fmtDec(l.raw))} → ${esc(l.roundShort)}</small>` : ''}`;
    return tr([
      `<b>${esc(l.label)}</b><small>${esc(l.groupName)}・${esc(l.makerName)}（${esc(l.edition)}）</small>${l.alert && !l.resolved ? '<small class="bad">要確認あり</small>' : ''}${l.added ? '<small>手入力で追加</small>' : ''}`,
      `<div class="sel2">${route}${rank}</div>`, `${n(l.qty)} m${l.breakdown ? `<small>${esc(l.breakdown)}</small>` : ''}`,
      `<div class="calc"><span class="base">${base}</span>${l.pricing === 'rate' ? `<i>×</i><span class="rt">${rate}</span><i>＝</i>` : '<i>→</i>'}<span class="un">${unit}</span></div>`, `<b>${n(l.amount)}</b>`, basisBtn(l),
    ], l.priceChanged ? 'warn' : l.rateEdited || l.unitEdited ? 'hot' : '');
  });
  const total = `<div class="total-line"><span>合計（税別）</span><b>${n(r.total)} 円</b></div>`;
  return requestHead(r) + `<article class="card"><h3>単価と根拠（${r.lines.length} 行）</h3><p class="muted">単価 ＝ 建値 × 掛率（商品群 × 在庫／直送 × 拠点）→ 端数処理。掛率や単価を直接書き換えると、その行だけ上書きされ「根拠」に手入力と残ります。行ごとの備考（100m巻 など）は「見積書」タブで書きます。${locked ? '回答済みの見積は編集できません。' : ''}</p>${table(cols, rows)}${total}</article>` + ratesCard();
}

function panelPricingAll() {
  const rows = data.requests.filter((r) => !r.pending).map((r) => tr([`<span class="code">${esc(r.no)}</span>`, `<b>${esc(r.title)}</b><small>${esc(r.client)}</small>`, esc(r.statusLabel), String(r.lines.length), `<b>${n(r.total)}</b>`, String(r.alerts.filter((a) => a.kind === '明細' || a.kind === '件名').length), `<button type="button" class="ghost" data-open="${esc(r.id)}">開く</button>`]));
  return `<article class="card"><h3>依頼ごとの合計</h3>${table(['No', '件名', '状態', '行数', '合計（税別）', '要確認', ''], rows)}</article>` + ratesCard();
}

function ratesCard() {
  return `<article class="card"><h3>掛率の表（${esc(data.siteName)}）</h3><p class="muted">商品群 × 納品方式。価格ランク B は −0.03。弱電線は掛率ではなく A単価／B単価の表で決まります。拠点を右上で切り替えると表が変わります。</p>
    ${table(['商品群', '在庫 A', '直送 A', '在庫 B', '直送 B'], data.rates.map((x) => tr([`<b>${esc(x.groupName)}</b>`, String(x.stock), String(x.direct), String(x.stockB), String(x.directB)])))}</article>`;
}

// 見積書（Excel 様式のプレビュー）
function panelSheet() {
  const r = one();
  if (!r) return panelSheetAll();
  if (r.pending) return requestHead(r) + `<article class="card"><p class="muted">読み取りが保留のため、見積書はまだ作れません。</p></article>`;
  const s = r.sheet;
  const stage = r.status === 'answered' ? 3 : (state.stage[r.id] || 0);
  const steps = s.workflow.map((w, i) => `<li class="${i <= stage || w.done ? 'done' : ''}"><span>${i + 1}</span>${esc(w.step)}</li>`).join('');
  const locked = r.status === 'answered';
  let no = 0;
  const body = s.rows.map((row) => {
    if (row.kind === 'item') { no += 1; return `<tr class="item"><td>${no}</td><td>${esc(row.name)}</td><td class="r">${esc(row.qtyLabel)}</td><td>${esc(row.unitLabel)}</td><td class="r">${n(row.unit)}</td><td class="r">${n(row.amount)}</td><td>${locked ? esc(row.remark || '') : `<input type="text" maxlength="100" value="${esc(row.remark || '')}" placeholder="例: 100m巻" data-line="${esc(row.lineId)}" data-field="note" aria-label="備考">`}${row.route === '直送' ? '<small>直送</small>' : ''}</td></tr>`; }
    if (row.kind === 'blank') return `<tr class="blank"><td></td><td colspan="5"><input type="text" maxlength="120" value="${esc(row.text)}" placeholder="自由記入（例: 上記 ドラム 2 巻）" data-extra="${esc(row.extraId)}" data-field="text" aria-label="自由記入" ${r.status === 'answered' ? 'disabled' : ''}></td><td><button type="button" class="ghost" data-remove-extra="${esc(row.extraId)}">削除</button></td></tr>`;
    return `<tr class="note"><td></td><td colspan="5">${esc(row.text)}</td><td>${row.extraId ? `<button type="button" class="ghost" data-remove-extra="${esc(row.extraId)}">削除</button>` : ''}</td></tr>`;
  }).join('');
  const lineOpts = r.lines.map((l) => `<option value="${esc(l.id)}">${esc(l.label)}</option>`).join('');
  const tools = locked ? '' : `<div class="sheet-tools"><label>行を足す: <select id="extraAfter" aria-label="どの行の下に">${lineOpts}<option value="">（末尾）</option></select></label>
    <button type="button" class="ghost" data-extra-add="blank">空白行（自由記入）</button><button type="button" class="ghost" data-extra-add="weight">重量（概算）</button><button type="button" class="ghost" data-extra-add="shipping">送料の条件</button></div>`;
  const actions = `<div class="sheet-actions">
    ${locked ? `<span class="ok">承認（${esc(r.approvedBy)}）・${esc(r.answered)} 送付済み</span><a class="ghost link" href="${esc(r.shareUrl)}" onclick="return false">共有リンク（デモ）</a>` : `
    ${stage < 1 ? `<button type="button" class="primary" data-stage="1">承認依頼を出す</button>` : ''}
    ${stage === 1 ? `<button type="button" class="primary" data-stage="2">承認する（営業所長）</button>` : ''}
    ${stage === 2 ? `<button type="button" class="primary" data-stage="3">送付してリンクを共有</button>` : ''}
    ${stage >= 3 ? `<span class="ok">送付済み（デモ）</span>` : ''}`}
    <button type="button" class="ghost" data-toast="Excel 様式（ロゴ付き）でのダウンロードは、デモでは省略しています">Excel で出力</button>
    <button type="button" class="ghost" data-toast="PDF でのダウンロードは、デモでは省略しています">PDF で出力</button>
  </div>`;
  return requestHead(r) + `<article class="card">
    <h3>見積書（Excel 様式のプレビュー）</h3><p class="muted">確定後も Excel で編集できる様式。ケーブル 1 行ごとに注記を付け、任意の場所に空白行・備考を足せます。</p>
    <ol class="steps">${steps}</ol>
    <div class="sheet">
      <div class="sheet-head"><div class="logo">${esc(s.logo)}<small>ロゴ（貴社ロゴに差し替え）</small></div><div class="sheet-title">御 見 積 書</div><div class="sheet-no">No. ${esc(s.no)}<br>見積日 ${esc(fmtDate(s.date))}<br>有効期限 ${esc(fmtDate(s.validUntil))}</div></div>
      <div class="sheet-to"><b>${esc(s.to)}</b><span>件名: ${esc(s.title)}</span><span>合計金額: <b>${n(s.total)} 円</b>（税込）</span></div>
      <div class="sheet-from">${esc(s.from)}<br>${esc(s.person)}</div>
      <div class="table-wrap"><table class="sheet-table"><thead><tr><th>No</th><th>品名・規格</th><th>数量</th><th>単位</th><th>単価</th><th>金額</th><th>備考</th></tr></thead><tbody>${body}</tbody>
      <tfoot><tr><td></td><td>小計</td><td></td><td></td><td></td><td class="r">${n(s.subtotal)}</td><td></td></tr><tr><td></td><td>消費税（10%）</td><td></td><td></td><td></td><td class="r">${n(s.tax)}</td><td></td></tr><tr class="total"><td></td><td>合計</td><td></td><td></td><td></td><td class="r">${n(s.total)}</td><td></td></tr></tfoot></table></div>
      <ul class="terms">${s.terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
    ${tools}${actions}
  </article>
  <article class="card"><h3>回答メールの下書き</h3><p class="muted">数字は上の見積書の値をそのまま差し込んでいます。送る前に内容を確認してください。</p>
    <details class="action" open><summary><span class="kind">メール</span><b>${esc(r.mail.subject)}</b><small>宛先: ${esc(r.client)} ${esc(r.person)} 様</small></summary><pre id="mail-draft">${esc(r.mail.body)}</pre><button type="button" class="ghost" data-copy="mail-draft">文面をコピー</button></details>
  </article>`;
}

function panelSheetAll() {
  const cards = data.requests.filter((r) => !r.pending).map((r) => `<article class="card req"><div class="head-top"><div><span class="code">${esc(r.no)}</span><h3>${esc(r.title)}</h3><p class="muted">${esc(r.client)}　明細 ${r.lines.length} 行　合計 ${n(r.sheet.total)} 円（税込）　${r.status === 'answered' ? `承認 ${esc(r.approvedBy)}・${esc(r.answered)} 送付済み` : '下書き'}</p></div><em class="pill ${r.status === 'answered' ? 'gray' : 'blue'} big">${esc(r.statusLabel)}</em></div><button type="button" class="ghost" data-open="${esc(r.id)}">見積書を開く →</button></article>`).join('');
  return `<article class="card note"><h3>見積書</h3><p>依頼を選ぶと、Excel 様式のプレビューと回答メールの下書きが出ます。</p></article>${cards}`;
}

// 単価表の管理（メーカー単価表の OCR 取込）
function panelLists() {
  const m = data.makers;
  const monthly = m.filter((x) => x.cycle === '毎月').length;
  const pending = m.filter((x) => /未着/.test(x.status)).length;
  const check = m.filter((x) => /要確認/.test(x.status)).length;
  const stats = [[m.length, '社', 'メーカー単価表'], [monthly, '社', '毎月更新'], [pending, '社', '今月分 未着'], [check, '社', 'OCR 要確認'], [data.priceDiff.length, '品目', '今月 単価が変わった']];
  const diff = data.priceDiff.length ? table(['品目', 'メーカー（版）', '前版', '今版', '変化'], data.priceDiff.map((d) => tr([`<b>${esc(d.item)}</b>`, `${esc(d.maker)}<small>${esc(d.edition)}</small>`, n(d.prev), `<b>${n(d.price)}</b>`, `<b class="${d.pct > 0 ? 'bad' : 'ok'}">${d.pct > 0 ? '+' : ''}${d.pct}%</b>`], 'warn'))) : '<p class="muted">今月の差分はありません。</p>';
  const rows = m.map((x) => tr([`<b>${esc(x.name)}</b>`, esc(x.cycle), esc(x.edition), esc(x.last), esc(x.next), String(x.items), x.changed ? `<b class="bad">${x.changed}</b>` : '0', `<em class="pill ${/未着/.test(x.status) ? 'red' : /要確認/.test(x.status) ? 'amber' : /差分/.test(x.status) ? 'blue' : 'gray'}">${esc(x.status)}</em>`], /未着|要確認/.test(x.status) ? 'warn' : ''));
  return `<article class="card"><h3>単価表の管理</h3><p class="muted">メーカーから届く単価表（PDF・Excel）を OCR で取り込み、前版との差分だけを確認して反映します。見やすくするための Excel 加工はいりません。</p>
    <div class="stats">${stats.map(([v, u, l]) => `<div class="stat"><b>${v}</b><small>${esc(u)}</small><span>${esc(l)}</span></div>`).join('')}</div>
    <ol class="flow"><li><b>1. 受領</b>メール添付・FAX の単価表を置く</li><li><b>2. OCR 読み取り</b>品目・サイズ・建値を表にする</li><li><b>3. 差分の確認</b>前版と違う品目だけ表示。読み取りが怪しい行は要確認</li><li><b>4. 反映</b>確認した版を「最新版」にする。以後の見積はこの建値</li></ol></article>
    <article class="card"><h3>今月の差分（反映済み）</h3><p class="muted">銅建値の上昇で CV 系が約 3% 上がっています。前版のまま見積を出すと安く出してしまうため、「単価と根拠」でも行に印を付けています。</p>${diff}</article>
    <article class="card"><h3>メーカー別の更新状況（${m.length} 社）</h3>${table(['メーカー', '更新サイクル', '最新版', '取込日', '次回目安', '品目数', '変更', '状態'], rows)}</article>`;
}

function panelRules() {
  return `<article class="card"><h3>計算の決まり v1（この画面の単価はすべてこの式）</h3><p class="muted">AI はこの計算をしません。式はルール表として固定し、変えるときは版を上げます。</p>
    ${table(['項目', '決まり'], data.rules.map((r) => tr([`<b>${esc(r.name)}</b>`, esc(r.formula)])))}</article>` + ratesCard();
}

// ---------- クリック・変更（手直しはすべてサーバーに送って計算し直す） ----------
function edFor(folder) {
  if (!state.edits[folder]) state.edits[folder] = { lines: {}, added: [], extras: [] };
  return state.edits[folder];
}

function onPanelClick(e) {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const pre = document.getElementById(copy.dataset.copy);
    navigator.clipboard?.writeText(pre.textContent).then(() => { copy.textContent = 'コピーしました'; setTimeout(() => { copy.textContent = '文面をコピー'; }, 1500); });
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) { state.folder = open.dataset.open; load(); return; }
  const resolve = e.target.closest('[data-resolve]');
  if (resolve) { const ed = edFor(state.folder); ed.lines[resolve.dataset.resolve] = { ...(ed.lines[resolve.dataset.resolve] || {}), resolved: true }; load(); return; }
  const extraAdd = e.target.closest('[data-extra-add]');
  if (extraAdd) { const ed = edFor(state.folder); ed.extras.push({ kind: extraAdd.dataset.extraAdd, after: document.getElementById('extraAfter')?.value || '', text: '' }); load(); return; }
  const extraRm = e.target.closest('[data-remove-extra]');
  if (extraRm) { const ed = edFor(state.folder); const i = Number(extraRm.dataset.removeExtra.slice(1)) - 1; ed.extras.splice(i, 1); load(); return; }
  const stage = e.target.closest('[data-stage]');
  if (stage) { state.stage[state.folder] = Number(stage.dataset.stage); renderPanel(); toast(['', '承認依頼を出しました（デモ）', '承認しました（デモ）', '送付し、共有リンクを発行しました（デモ）'][state.stage[state.folder]]); return; }
  const t = e.target.closest('[data-toast]');
  if (t) { toast(t.dataset.toast); return; }
  const askBtn = e.target.closest('[data-ask]');
  if (askBtn && aiReady) {
    const r = one();
    if (askBtn.dataset.ask === 'pending') ask(`「${r.title}」について、依頼元に内訳書の有無と対象範囲を確認する文面を作ってください。`);
    else ask('この依頼の「要確認」の点を、依頼元に確認する文面にしてください。');
    return;
  }
  const b = e.target.closest('.basis');
  if (b) showTooltip(b, true);
}

function onPanelChange(e) {
  const el = e.target;
  if (el.dataset.extra && el.dataset.field === 'text') {
    const ed = edFor(state.folder); const i = Number(el.dataset.extra.slice(1)) - 1;
    if (ed.extras[i]) { ed.extras[i].text = el.value; load(); }
    return;
  }
  if (!el.dataset.line || !el.dataset.field) return;
  const ed = edFor(state.folder);
  const cur = ed.lines[el.dataset.line] || {};
  const f = el.dataset.field;
  if (f === 'route' || f === 'rank' || f === 'note') cur[f] = el.value;
  if (f === 'rate' || f === 'unit') { const v = Number(el.value); if (Number.isFinite(v) && v > 0) cur[f] = v; else delete cur[f]; }
  ed.lines[el.dataset.line] = cur;
  load();
}

function onPanelSubmit(e) {
  const form = e.target.closest('form[data-add]');
  if (!form) return;
  e.preventDefault();
  const item = form.elements.itemId.value;
  const qty = Number(form.elements.qty.value);
  if (!item || !Number.isInteger(qty) || qty <= 0) { toast('数量は 1 以上の整数で入力してください'); return; }
  const ed = edFor(state.folder);
  ed.added.push({ item, qty, note: form.elements.note.value || '' });
  load();
}

// 根拠ツールチップ: 式に実際の数字が入った文を、計算順に出す
function basisBtn(l) {
  return `<button type="button" class="basis" data-tip="${esc(JSON.stringify(l.basis || []))}" aria-label="根拠を見る">根拠</button>`;
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
  tip.style.left = `${Math.max(8, Math.min(r.left, (globalThis.innerWidth || 1200) - 440))}px`;
  tip.style.top = `${r.bottom + 8}px`;
  tip.hidden = false;
  if (pin) tip.dataset.pinned = '1';
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------- 小道具 ----------
function table(cols, rows) { return `<div class="table-wrap"><table><thead><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`; }
function tr(cells, cls = '') { return `<tr class="${cls}">${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`; }
function n(v) { return esc(fmt(v)); }
function fmtDec(v) { return Number(v).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(s) { return s ? s.replace(/-/g, '/') : ''; }
function kindPill(k) { return { 合算: 'blue', 在庫: 'amber', 単価表: 'red', 重量物: 'amber' }[k] || 'gray'; }
function lineStatus(l) {
  if (l.alert && l.resolved) return '<em class="pill gray">確認済み</em>';
  if (l.alert) return `<em class="pill amber">要確認</em><small>${esc(l.guess)}</small>`;
  if (l.added) return '<em class="pill blue">手入力で追加</em>';
  if (l.qtyParts) return '<em class="pill blue">合算</em>';
  return '<em class="pill gray">転記済み</em>';
}
function text(id, v) { const el = document.getElementById(id); if (el && v != null) el.textContent = v; }
function safe(fn, where) { try { fn(); } catch (err) { console.error('app', where, err); } }
function parseHash() {
  const h = (globalThis.location?.hash || '').replace(/^#/, '');
  return Object.fromEntries(new URLSearchParams(h));
}
function writeHash() {
  if (!globalThis.history?.replaceState) return;
  const qs = new URLSearchParams({ folder: state.folder, tab: state.tab, site: state.site });
  globalThis.history.replaceState(null, '', `#${qs}`);
}
