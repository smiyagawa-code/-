// 内示の読み取り（画面側・担当 A）。左上の枠に CSV / Excel / PDF / メール / メモ を置く → /api/intake → 確認の窓 → 確定で CSV 文字列を渡す。
//
// ■ 配線（宮川側）
// index.html に足す要素: なし（既存の #drop / #dropInput / #memoBtn をそのまま使う。窓・スタイルは JS で作る）
//   ※ #dropInput の accept に .xlsx .pdf .eml .txt が入っていること（10/6 時点で入っている）
// app.js から呼ぶ:
//   import { setupIntake, openMemo } from './intake.js';
//   setupIntake({ onResult, onError? });       // setupDrop() の代わりに 1 回だけ呼ぶ（両方呼ぶと二重に読む）
//   memoBtn.addEventListener('click', () => openMemo({ onResult, onError? }));
//   onResult(csvText, { kind, name }) は「この内容で確定」で呼ばれる。csvText は見本 CSV と同じ列なので、
//   今までどおり state.csv = csvText; state.csvName = name; load(); で POST /api/data { csv } に乗る。
//   onError(message) を渡すと、読めなかったときの案内を app.js 側の窓で出せる（渡さなければこの中の窓で出す）。
//   「読み取り中…」と「読み取り結果の確認」はこの中の窓（index.html の #pop とは別に JS で作る）で出すので、onBusy は不要（渡されても使わない）。
// 追加した npm パッケージ: xlsx@0.18.5（サーバー側 src/intake.js。画面側は外部ライブラリなし）
//
// 読み取りの入口は 3 つ: ファイルを置く／クリックで選ぶ（setupIntake）、メモ帳に転記（openMemo）、見本リンクなど他から渡す（readFile）。
// 結果はどれも openReview() で確認してから onResult に渡す。
import { esc } from './util.js';

const MAX_TEXT_CHARS = 20000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const KIND_LABEL = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF', mail: 'メール', memo: 'メモ' };
const CSV_HEADER = ['内示日', '得意先', '案件', '機種', '数量', '納入希望日', '仕様', '備考'];

export function setupIntake({ onResult, onError } = {}) {
  const drop = document.getElementById('drop');
  const input = document.getElementById('dropInput');
  if (!drop || !input) return;
  const opts = { onResult, onError };
  input.addEventListener('change', () => { if (input.files?.[0]) readFile(input.files[0], opts); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) readFile(f, opts); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
}

// ファイル 1 本を読み取る（拡張子で形式を決める）
export async function readFile(file, { onResult, onError } = {}) {
  const kind = kindOf(file.name);
  if (!kind) { fail('この形式は読めません', 'CSV・Excel(.xlsx)・PDF・メール(.eml/.txt)・メモ(.txt) を置いてください。', onError); return; }
  if ((kind === 'pdf' || kind === 'xlsx') && file.size > MAX_FILE_BYTES) { fail('ファイルが大きすぎます', '2MB までです。', onError); return; }
  let payload;
  if (kind === 'pdf' || kind === 'xlsx') {
    payload = { kind, name: file.name, base64: await readBase64(file) };
  } else {
    const text = await readText(file);
    if (text.length > MAX_TEXT_CHARS) { fail('文字が多すぎます', '2万文字までです。', onError); return; }
    payload = { kind: kind === 'txt' ? (looksLikeMail(text) ? 'mail' : 'memo') : kind, name: file.name, text };
  }
  await send(payload, { onResult, onError });
}

// 「メモ帳に転記」: テキスト欄に貼って読み取る
export function openMemo({ onResult, onError } = {}) {
  open(`<h3>メモ帳に転記</h3><p class="pop-sub">メールの本文や口頭メモを貼ってください。</p>
<textarea id="intakeMemo" class="intake-memo" rows="9" maxlength="${MAX_TEXT_CHARS}" placeholder="例: 大和精密の田中さんより電話。VIS-200 を 3台、11/14 希望。NG排出シュート付き。"></textarea>
<div class="pop-acts"><button type="button" class="primary" id="intakeMemoGo">読み取る</button><button type="button" class="ghost" data-intake-close="1">やめる</button></div>`);
  const ta = document.getElementById('intakeMemo');
  ta?.focus();
  document.getElementById('intakeMemoGo')?.addEventListener('click', () => {
    const text = (ta?.value || '').trim();
    if (!text) { ta?.focus(); return; }
    send({ kind: looksLikeMail(text) ? 'mail' : 'memo', name: 'メモ帳', text }, { onResult, onError });
  });
}

async function send(payload, { onResult, onError }) {
  open(`<div class="drop-play"><div class="spin" aria-hidden="true"></div><p>読み取り中…</p><p class="muted">${esc(payload.name)}（${KIND_LABEL[payload.kind]}）</p></div>`);
  let res, body;
  try {
    res = await fetch('/api/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    body = await res.json();
  } catch {
    fail('読めませんでした', '通信に失敗しました。もう一度お試しください。', onError);
    return;
  }
  if (!res.ok) { fail('読めませんでした', body?.error || '形を確認してください。', onError); return; }
  openReview(body, { onResult });
}

// 読み取り結果の確認。人が直して「この内容で確定」→ onResult(csvText, { kind, name })
export function openReview(result, { onResult } = {}) {
  const rows = result.versions || [];
  const readings = result.reading || [];
  if (!rows.length) { open('<h3>読めませんでした</h3><p class="pop-sub">内示として読める案件がありませんでした。</p>'); return; }
  const cases = rows.map((r, i) => {
    const items = readings[i] || [];
    const from = (field) => items.find((it) => it.field === field)?.from || '';
    const checks = items.filter((it) => it.check);
    return `<section class="intake-case" data-i="${i}">
<div class="intake-head"><input class="intake-name" name="name" value="${esc(r.name)}" placeholder="案件名" aria-label="案件">${r.folderId ? '' : '<span class="intake-new">この画面にない案件</span>'}</div>
${field('機種', 'model', r.model, '', 'VIS-200')}
${field('台数', 'qty', r.qty == null ? '' : r.qty, from('台数'), '3', 'inputmode="numeric"')}
${field('希望日', 'due', r.due || '', from('希望日'), '2026-11-14')}
${field('オプション', 'options', (r.options || []).join('・'), from('仕様'), '標準なら空')}
${field('備考', 'note', r.note || '', from('備考'), '')}
${checks.map((c) => `<p class="intake-check">要確認: ${esc(c.ask || c.value)}${c.value && c.ask ? `<span class="intake-from">${esc(c.value)}</span>` : ''}</p>`).join('')}
</section>`;
  });
  open(`<h3>読み取り結果の確認</h3><p class="pop-sub">${esc(result.name)}（${KIND_LABEL[result.kind] || ''}）。違っていれば直してください。</p>
<form id="intakeForm">${cases.join('')}<p class="intake-err" id="intakeErr" hidden></p>
<div class="pop-acts"><button type="submit" class="primary">この内容で確定</button><button type="button" class="ghost" data-intake-close="1">やめる</button></div></form>`, { wide: true });
  document.getElementById('intakeForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fixed = [];
    let bad = null;
    document.querySelectorAll('#intakeForm .intake-case').forEach((sec, i) => {
      const v = (n) => (sec.querySelector(`[name="${n}"]`)?.value || '').trim();
      const qty = Number(v('qty').replace(/[台個,]/g, ''));
      const due = isoDate(v('due'));
      if (!v('name')) bad ||= [sec, 'name', '案件名を入れてください'];
      else if (!Number.isInteger(qty) || qty < 0) bad ||= [sec, 'qty', '台数は 0 以上の数で入れてください'];
      else if (!due && qty > 0) bad ||= [sec, 'due', '希望日は 2026-11-14 の形で入れてください']; // 取消（0台）は希望日なしでよい
      const base = rows[i] || {};
      fixed.push({ date: base.date || '', customer: base.customer || '', name: v('name'), model: v('model'), qty, due, options: v('options').split(/[・、,/／]/).map((o) => o.trim()).filter(Boolean), note: v('note') });
    });
    const err = document.getElementById('intakeErr');
    document.querySelectorAll('#intakeForm .bad').forEach((el) => el.classList.remove('bad'));
    if (bad) { bad[0].querySelector(`[name="${bad[1]}"]`)?.classList.add('bad'); err.textContent = bad[2]; err.hidden = false; return; }
    close();
    onResult?.(buildCsv(fixed), { kind: result.kind, name: result.name });
  });
}

// ---------- 小道具 ----------
// 読めなかったときの案内。onError があれば app.js 側の窓に任せる（こちらの窓は閉じる）
function fail(title, message, onError) {
  if (typeof onError === 'function') { close(); onError(message); return; }
  open(`<h3>${esc(title)}</h3><p class="pop-sub">${esc(message)}</p>`);
}
function field(label, name, value, from, placeholder, extra = '') {
  return `<label class="intake-field"><span>${label}</span><input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra}>${from ? `<span class="intake-from">${esc(from)}</span>` : ''}</label>`;
}
export function kindOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf', eml: 'mail', txt: 'txt' }[m?.[1]] || '';
}
export function looksLikeMail(text) {
  return /^(from|to|subject|date|件名|差出人|宛先|送信者)\s*[:：]/im.test(text) || /^(.+様|.+御中)\s*$/m.test(text.slice(0, 400));
}
// 見本 CSV と同じ列で CSV 文字列を作る（確定した値で作り直す）
export function buildCsv(rows) {
  const cell = (v) => { const s = String(v ?? '').replace(/\r?\n/g, ' '); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [CSV_HEADER.join(','), ...rows.map((r) => [r.date, r.customer, r.name, r.model, r.qty, r.due, (r.options || []).join('・'), r.note].map(cell).join(','))].join('\n');
}
export function isoDate(s) {
  const m = String(s || '').trim().match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/);
  if (!m) return '';
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? '' : d;
}
function readText(file) {
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = () => resolve(''); r.readAsText(file, 'utf-8'); });
}
function readBase64(file) {
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '').split(',')[1] || ''); r.onerror = () => resolve(''); r.readAsDataURL(file); });
}

// 自前の小さな窓（既存の .pop / .overlay と同じ見た目。index.html は触らず JS で作る）
let pop, overlay;
function ensure() {
  if (pop) return;
  const style = document.createElement('style');
  style.textContent = `
.pop.intake-wide { width: min(680px, calc(100vw - 32px)); }
.intake-case { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 10px 0; display: grid; gap: 8px; }
.intake-head { display: flex; align-items: center; gap: 8px; }
.intake-name { flex: 1; font: inherit; font-size: 14px; font-weight: 700; color: var(--navy); border: 0; border-bottom: 1px solid var(--line); padding: 4px 2px; background: transparent; }
.intake-new { font-size: 11px; color: var(--bad); white-space: nowrap; }
.intake-field { display: grid; grid-template-columns: 72px 1fr; align-items: center; gap: 2px 10px; font-size: 12.5px; color: var(--ink-2); }
.intake-field input, .intake-memo { font: inherit; font-size: 13.5px; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; background: #FAFBFD; width: 100%; }
.intake-field input:focus, .intake-memo:focus, .intake-name:focus { outline: 2px solid var(--orange); outline-offset: -1px; background: #fff; }
.intake-field input.bad { border-color: var(--bad); background: #FDECEE; }
.intake-from { grid-column: 2; font-size: 11px; color: var(--muted); }
.intake-check { font-size: 12.5px; color: var(--bad); font-weight: 700; display: grid; gap: 2px; }
.intake-check .intake-from { grid-column: auto; font-weight: 400; }
.intake-memo { display: block; resize: vertical; margin: 4px 0 12px; }
.intake-err { font-size: 12.5px; color: var(--bad); margin: 0 0 8px; }
`;
  document.head.append(style);
  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.hidden = true;
  overlay.addEventListener('click', close);
  pop = document.createElement('div');
  pop.className = 'pop';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  pop.addEventListener('click', (e) => { if (e.target.closest('.pop-close, [data-intake-close]')) close(); });
  document.body.append(overlay, pop);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) close(); });
}
function open(html, { wide = false } = {}) {
  ensure();
  pop.classList.toggle('intake-wide', wide);
  pop.innerHTML = `<button type="button" class="pop-close" aria-label="閉じる">×</button>${html}`;
  pop.hidden = false;
  overlay.hidden = false;
}
function close() {
  if (!pop) return;
  pop.hidden = true;
  overlay.hidden = true;
}
