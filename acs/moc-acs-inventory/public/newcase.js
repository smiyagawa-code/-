// 新しい案件を作る窓（左の案件一覧「＋ 案件を作る」）。
// 入口は 2 つ: (a) 記入・選択で登録、(b) 内示（CSV/Excel/PDF/メール/メモ）を読み込んで下書き → 人が確認して登録。
// 計算はしない。読み取りは public/intake.js に任せる。
//
// ■ index.html に足す要素
//   <nav id="folders"> の直前（または直後）に 1 つ:
//     <button type="button" class="ghost small" id="newCaseBtn">＋ 案件を作る</button>
//   窓は既存の #pop / #overlay を使う（tasks.js の openPop/closePop）。スタイルはこの中で当てる（style.css は触らなくてよい）。
//
// ■ app.js から呼ぶ関数と引数
//   import { openNewCase } from './newcase.js';
//   document.getElementById('newCaseBtn').addEventListener('click', () =>
//     openNewCase({ data, onRegister: (c) => { /* 下記 */ } }));
//   - data: /api/data の返り値（data.folders の customer / name / model を候補と重複チェックに使う。data.masters.folders も見る）
//   - onRegister({ customer, name, model, qty, due, options, note, date }) が「案件として登録」で 1 回呼ばれ、窓は閉じる
//       qty: 数（0 以上の整数）または null（内示待ち）、due: 'yyyy-mm-dd' または ''、options: ['…']、date: 今日 'yyyy-mm-dd'
//     受け取った側は 案件 { id: 'u' + 連番, customer, name, model } を足し、qty が null でなければ
//     buildCsv 相当の 1 行（内示日,得意先,案件,機種,数量,納入希望日,仕様,備考）を state.sources に足して load() する想定。
//     （newcase.js は保存しない。保存先・id の採番は app.js 側で決める）
//   - 読み込みの経路: 窓の「内示を読み込んで下書き」→ intake.js の readFile / openMemo → 確認の窓 → 確定で
//     この窓のフォームに入る（app.js の applyCsv は通らない。登録した後に計算し直すのは onRegister 側）。
//
// ■ できなかったこと
//   - 登録した案件を一覧に出す配線（app.js / index.html）。保存先（localStorage か /api/records）の決定。
//   - 読み込んだ内示が複数行のとき、まとめて登録（1 件ずつ選んで登録する形にした）。
//   - 機種の候補は data.folders / data.masters.folders にある model だけ（部品カタログからは取らない）。
import { esc, parseCsv } from './util.js';
import { readFile, openMemo } from './intake.js';
import { openPop, closePop } from './tasks.js';

const OTHER = '__other__';

// ---------- 純関数（テストあり） ----------

// CSV 文字列（列: 内示日,得意先,案件,機種,数量,納入希望日,仕様,備考）の 2 行目から下書きを作る
export function draftFromCsv(csvText) {
  return draftsFromCsv(csvText)[0] || emptyDraft();
}
// 全行（ヘッダーを除く。空行は飛ばす）
export function draftsFromCsv(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || '').trim());
  const col = (name, fallback) => { const i = header.indexOf(name); return i >= 0 ? i : fallback; };
  const C = { date: col('内示日', 0), customer: col('得意先', 1), name: col('案件', 2), model: col('機種', 3), qty: col('数量', 4), due: col('納入希望日', 5), spec: col('仕様', 6), note: col('備考', 7) };
  const cell = (r, i) => String(r[i] ?? '').trim();
  return rows.slice(1)
    .filter((r) => r.some((c) => String(c || '').trim()))
    .map((r) => ({
      customer: cell(r, C.customer),
      name: cell(r, C.name),
      model: cell(r, C.model),
      qty: toQty(cell(r, C.qty)),
      due: toDate(cell(r, C.due)),
      options: splitOptions(cell(r, C.spec)),
      note: cell(r, C.note),
      date: toDate(cell(r, C.date)) || today(),
    }));
}
export function emptyDraft() {
  return { customer: '', name: '', model: '', qty: null, due: '', options: [], note: '', date: today() };
}

// 検査。input は文字のまま（qty, due は文字でも数でもよい）。existing = 既存の案件 [{ customer?, name }]
// 返り値: { ok, errors: { field: message }, value: onRegister に渡す形 }
export function checkCase(input, existing = []) {
  const errors = {};
  const customer = str(input.customer);
  const name = str(input.name);
  const model = str(input.model);
  if (!customer) errors.customer = '得意先を入れてください';
  if (!name) errors.name = '案件名を入れてください';
  if (!model) errors.model = '機種を選んでください';
  const qtyRaw = input.qty == null ? '' : String(input.qty).trim();
  let qty = null;
  if (qtyRaw !== '') {
    if (!/^\d+$/.test(qtyRaw.replace(/,/g, ''))) errors.qty = '台数は 0 以上の整数にしてください';
    else qty = Number(qtyRaw.replace(/,/g, ''));
  }
  const dueRaw = str(input.due);
  let due = '';
  if (dueRaw) {
    due = toDate(dueRaw);
    if (!due) errors.due = '納入希望日は yyyy-mm-dd の形にしてください';
  }
  if (!errors.customer && !errors.name && isDuplicate({ customer, name }, existing)) errors.name = '同じ名前の案件があります';
  const options = Array.isArray(input.options) ? input.options.map(str).filter(Boolean) : splitOptions(str(input.options));
  const value = { customer, name, model, qty, due, options, note: str(input.note), date: toDate(str(input.date)) || today() };
  return { ok: Object.keys(errors).length === 0, errors, value };
}
// 既存に 得意先＋案件名 が同じものがあるか（得意先の無い既存＝masters.folders は案件名だけで見る）
export function isDuplicate({ customer, name }, existing = []) {
  const n = norm(name);
  const c = norm(customer);
  if (!n) return false;
  return existing.some((f) => f && norm(f.name) === n && (!f.customer || !c || norm(f.customer) === c));
}
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function toDate(s) {
  const m = String(s || '').trim().match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/);
  if (!m) return '';
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? '' : d;
}
export function splitOptions(s) {
  return String(s || '').split(/[・、,，\/／]/).map((x) => x.trim()).filter(Boolean);
}
function toQty(s) {
  const t = String(s || '').replace(/[,，台]/g, '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}
function str(v) { return String(v ?? '').trim(); }
function norm(v) { return str(v).replace(/\s+/g, '').toLowerCase(); }

// 機種の候補（重複を除く。出てきた順）
export function modelOptions(data) {
  const seen = new Set();
  for (const f of [...(data?.folders || []), ...(data?.masters?.folders || [])]) { const m = str(f?.model); if (m) seen.add(m); }
  return [...seen];
}
export function customerOptions(data) {
  const seen = new Set();
  for (const f of data?.folders || []) { const c = str(f?.customer); if (c) seen.add(c); }
  return [...seen];
}
function existingCases(data) {
  return [...(data?.folders || []), ...(data?.masters?.folders || [])].map((f) => ({ customer: f?.customer || '', name: f?.name || '' }));
}

// ---------- 窓 ----------
export function openNewCase({ data, onRegister } = {}) {
  ensureStyle();
  const models = modelOptions(data);
  const customers = customerOptions(data);
  const existing = existingCases(data);
  let drafts = [];   // 読み込んだ内示の行
  let picked = 0;    // 選んでいる行

  const pop = openPop(`<h3>案件を作る</h3>
<div class="nc-intake">
  <button type="button" class="ghost" id="ncFile">内示を読み込んで下書き</button>
  <button type="button" class="ghost" id="ncMemo">メモ帳から</button>
  <span class="muted">CSV・Excel・PDF・メール・メモ</span>
</div>
<p class="nc-note" id="ncNote" hidden></p>
<div class="nc-rows" id="ncRows" hidden></div>
<form class="nc-form" id="ncForm" novalidate>
  <label class="nc-field"><span>得意先</span><input name="customer" list="ncCustomers" autocomplete="off" placeholder="例: 株式会社○○"><datalist id="ncCustomers">${customers.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
  <label class="nc-field"><span>案件名</span><input name="name" placeholder="例: 第2工場 ○○ライン"></label>
  <label class="nc-field"><span>機種</span><span class="nc-model"><select name="modelSel"><option value="">選ぶ</option>${models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}<option value="${OTHER}">その他</option></select><input name="modelOther" placeholder="機種を入力" hidden></span></label>
  <label class="nc-field"><span>台数</span><input name="qty" inputmode="numeric" placeholder="空なら内示待ち"></label>
  <label class="nc-field"><span>納入希望日</span><input name="due" type="date"></label>
  <label class="nc-field"><span>仕様・オプション</span><input name="options" placeholder="「・」で区切る"></label>
  <label class="nc-field"><span>備考</span><input name="note"></label>
  <p class="nc-err" id="ncErr" hidden></p>
  <div class="pop-acts"><button type="submit" class="primary">案件として登録</button><button type="button" class="ghost" id="ncCancel">やめる</button></div>
</form>`);

  const form = pop.querySelector('#ncForm');
  const note = pop.querySelector('#ncNote');
  const rowsEl = pop.querySelector('#ncRows');
  const err = pop.querySelector('#ncErr');
  const sel = form.elements.modelSel;
  const other = form.elements.modelOther;
  const q = (n) => form.elements[n];

  sel.addEventListener('change', () => { other.hidden = sel.value !== OTHER; if (!other.hidden) other.focus(); });
  pop.querySelector('#ncCancel').addEventListener('click', closePop);

  // (b) 内示を読み込む
  const intakeOpts = {
    onResult: (csvText, meta) => {
      drafts = draftsFromCsv(csvText);
      if (!drafts.length) { showNote('内示として読める案件がありませんでした'); return; }
      picked = 0;
      fill(drafts[0]);
      showNote(`下書きを作りました。確認して登録してください${meta?.name ? `（${meta.name}）` : ''}`);
      renderRows();
    },
    onError: (msg) => showNote(msg || '読めませんでした'),
  };
  pop.querySelector('#ncFile').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.pdf,.txt,.eml,text/csv,application/pdf';
    input.addEventListener('change', () => { if (input.files?.[0]) readFile(input.files[0], intakeOpts); });
    input.click();
  });
  pop.querySelector('#ncMemo').addEventListener('click', () => openMemo(intakeOpts));
  rowsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-row]'); if (!b) return;
    picked = Number(b.dataset.row);
    fill(drafts[picked]);
    renderRows();
  });

  // (a) 登録
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const model = sel.value === OTHER ? other.value : sel.value;
    const r = checkCase({ customer: q('customer').value, name: q('name').value, model, qty: q('qty').value, due: q('due').value, options: q('options').value, note: q('note').value }, existing);
    form.querySelectorAll('.bad').forEach((el) => el.classList.remove('bad'));
    if (!r.ok) {
      const [field, msg] = Object.entries(r.errors)[0];
      const el = field === 'model' ? (sel.value === OTHER ? other : sel) : q(field);
      el?.classList.add('bad'); el?.focus();
      err.textContent = msg; err.hidden = false;
      return;
    }
    closePop();
    onRegister?.(r.value);
  });

  function fill(d) {
    q('customer').value = d.customer || '';
    q('name').value = d.name || '';
    if (d.model && models.includes(d.model)) { sel.value = d.model; other.value = ''; other.hidden = true; }
    else if (d.model) { sel.value = OTHER; other.value = d.model; other.hidden = false; }
    else { sel.value = ''; other.value = ''; other.hidden = true; }
    q('qty').value = d.qty == null ? '' : String(d.qty);
    q('due').value = d.due || '';
    q('options').value = (d.options || []).join('・');
    q('note').value = d.note || '';
    err.hidden = true;
    form.querySelectorAll('.bad').forEach((el) => el.classList.remove('bad'));
  }
  function showNote(text) { note.textContent = text; note.hidden = false; }
  function renderRows() {
    if (drafts.length < 2) { rowsEl.hidden = true; rowsEl.innerHTML = ''; return; }
    rowsEl.hidden = false;
    rowsEl.innerHTML = `<span class="muted">ほかに ${drafts.length - 1} 件の案件があります（1 件ずつ登録）</span>` +
      drafts.map((d, i) => `<button type="button" class="nc-row ${i === picked ? 'on' : ''}" data-row="${i}">${esc(d.name || '（案件名なし）')}<small>${esc(d.model || '')}${d.qty != null ? `　${d.qty} 台` : ''}</small></button>`).join('');
  }
  q('customer').focus();
  return pop;
}

let styled = false;
function ensureStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
.nc-intake { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0 10px; }
.nc-note { font-size: 12.5px; color: var(--muted); margin: 0 0 8px; }
.nc-rows { display: grid; gap: 4px; margin: 0 0 10px; }
.nc-row { text-align: left; font: inherit; font-size: 13px; color: var(--ink); border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; background: #fff; display: flex; justify-content: space-between; gap: 8px; }
.nc-row small { color: var(--muted); }
.nc-row.on { border-color: var(--orange); background: var(--orange-soft); }
.nc-form { display: grid; gap: 8px; }
.nc-field { display: grid; grid-template-columns: 110px 1fr; align-items: center; gap: 10px; font-size: 12.5px; color: var(--ink-2); }
.nc-field input, .nc-field select { font: inherit; font-size: 13.5px; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; background: #FAFBFD; width: 100%; }
.nc-field input:focus, .nc-field select:focus { outline: 2px solid var(--orange); outline-offset: -1px; background: #fff; }
.nc-field .bad { border-color: var(--bad); background: #FDECEE; }
.nc-model { display: grid; gap: 6px; }
.nc-err { font-size: 12.5px; color: var(--bad); margin: 0; }
.nc-form .pop-acts { margin-top: 6px; }
`;
  document.head.append(style);
}
