// 「設定」の窓: 読み取りルール（部品カタログ・案件の読み替え・計算の決まり）を画面で見て直す。計算はしない（サーバーの build() が直した値で計算し直す）。
// 保存は public/store.js（localStorage）。直した履歴を残し、前に戻せる。
//
// ■ index.html に足す要素（1 つだけ）
//   右上 .top-meta の中などに  <button type="button" class="ghost" id="settingsBtn">設定</button>
//   窓と覆いの要素は、この module が body に作る（既存の .pop / .overlay の見た目を使う。style.css の追加は不要）
//
// ■ app.js から呼ぶ
//   import { openRules, loadOverrides } from './rules.js';
//   state.overrides = loadOverrides();                       // 起動時に読む（store の 'overrides'）
//   document.getElementById('settingsBtn').addEventListener('click', () =>
//     openRules({ data, overrides: state.overrides, onChange: async (next) => { state.overrides = next; await load(); return data; } }));
//     - data     … /api/data の返り値（masters / masters_default / rules を使う）
//     - onChange … 保存・戻す・既定に戻す のあとに呼ばれる。新しい overrides を受け取って load() し直す。新しい data を返すと窓もそれで描き直す
//
// ■ POST /api/data に overrides を足す（load() の中）
//   いまは「csv があれば POST、なければ GET」。これを「csv か overrides（空でない）があれば POST」に広げる:
//     fetch('/api/data', { method: 'POST', headers: { 'content-type': 'application/json' },
//       body: JSON.stringify({ folder: state.folder, base: state.base || undefined, csv: state.csv || undefined, overrides: state.overrides }) })
//   src/index.js は body.overrides を getDemoData に渡す（済み）。おかしな値はサーバーが無視する
//
// ■ AI にも同じ設定で答えさせる
//   setChatContext({ ..., overrides: state.overrides }) → chat.js の fetch('/api/chat') の body に overrides を足す（src/index.js は受け取る、済み）
//
// ■ 保存先（public/store.js のキー）
//   'overrides' … いま効いている上書き { parts: {型番: {lt, lot, delay, maker}}, bom: {案件id: [{code, qty, option}]}, suppliers: {メーカー: {person, email, note}} }
//   'rules-log' … 直した履歴 [{ at, who, what, code, field, before, after, folderId?, option?, maker? }]
//   'me'        … 自分の名前（履歴の「誰が」）

import { esc, fmt } from './util.js';
import { load, save, appendLog } from './store.js';

const FIELD = { lt: '納期（日）', lot: 'まとめ買いの単位', delay: '遅れ連絡（日）', person: '担当者', email: '連絡先', qty: '1台に使う数' };
const TABS = [['parts', '部品'], ['bom', '読み替え'], ['rules', '計算の決まり'], ['log', '履歴']];

export function loadOverrides() {
  const o = load('overrides', {});
  return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}

export function openRules({ data, overrides, onChange } = {}) {
  closeRules();
  if (!data?.masters_default) { alert('設定を読み込めませんでした。再読み込みしてください。'); return null; }
  const st = { defaults: data.masters_default, rules: data.rules || data.masters_default.rules || [], cur: clone(overrides ?? loadOverrides()), tab: 'parts', msg: '' };
  injectStyle();

  const overlay = el('div', { class: 'overlay', id: 'rulesOverlay' });
  const pop = el('div', { class: 'pop rules-pop', id: 'rulesPop', role: 'dialog', 'aria-label': '設定' });
  document.body.append(overlay, pop);
  overlay.addEventListener('click', closeRules);
  document.addEventListener('keydown', onKey);
  function onKey(e) { if (e.key === 'Escape') closeRules(); }
  pop.addEventListener('click', onClick);
  pop.addEventListener('input', onInput);
  pop.addEventListener('change', (e) => { if (e.target.id === 'rulesMe') save('me', e.target.value.trim() || '担当者'); });
  render();
  return { close: closeRules };

  function render() {
    const eff = apply(st.defaults, st.cur);
    pop.innerHTML = `<button type="button" class="pop-close" aria-label="閉じる">×</button>
      <div class="rules-head"><h3>設定</h3><label class="rules-me">自分の名前 <input id="rulesMe" maxlength="20" value="${esc(load('me', ''))}" placeholder="履歴に残ります"></label></div>
      <nav class="tabs rules-tabs">${TABS.map(([id, label]) => `<button type="button" class="tab ${id === st.tab ? 'on' : ''}" data-rtab="${id}">${label}${id === 'log' ? `<b>${load('rules-log', []).length}</b>` : ''}</button>`).join('')}</nav>
      <div class="rules-body">${{ parts: tabParts, bom: tabBom, rules: tabRules, log: tabLog }[st.tab](eff)}</div>
      <div class="pop-acts rules-acts">${st.tab === 'parts' || st.tab === 'bom' ? '<button type="button" class="primary" data-act="save">保存</button>' : ''}<button type="button" class="ghost" data-act="reset" ${hasAny(st.cur) ? '' : 'disabled'}>既定に戻す</button><span class="muted rules-msg">${esc(st.msg)}</span></div>`;
    st.msg = '';
  }

  // ① 部品: 型番・品名・メーカー・担当者・納期・まとめ買いの単位・遅れ連絡
  function tabParts(eff) {
    const sup = Object.fromEntries(eff.suppliers.map((s) => [s.maker, s]));
    const def = Object.fromEntries(st.defaults.parts.map((p) => [p.code, p]));
    const defSup = Object.fromEntries(st.defaults.suppliers.map((s) => [s.maker, s]));
    const num = (p, k) => `<input type="number" min="${k === 'lot' ? 1 : 0}" max="${k === 'lot' ? 1000 : 365}" step="1" value="${p[k]}" data-part="${esc(p.code)}" data-field="${k}" class="${p[k] !== def[p.code][k] ? 'changed' : ''}" aria-label="${FIELD[k]}">${p[k] !== def[p.code][k] ? `<small>もとは ${fmt(def[p.code][k])}</small>` : ''}`;
    const rows = eff.parts.map((p) => {
      const s = sup[p.maker] || { person: '', email: '' };
      const ds = defSup[p.maker] || { person: '' };
      return `<tr><td><span class="code">${esc(p.code)}</span></td><td>${esc(p.name)}</td><td>${esc(p.maker)}</td>
        <td><input type="text" maxlength="40" value="${esc(s.person)}" data-sup="${esc(p.maker)}" data-field="person" class="${s.person !== ds.person ? 'changed' : ''}" aria-label="担当者">${s.email ? `<small>${esc(s.email)}</small>` : ''}</td>
        <td>${num(p, 'lt')}</td><td>${num(p, 'lot')}</td><td>${num(p, 'delay')}</td></tr>`;
    }).join('');
    return `<p class="pop-sub">数字を直して「保存」を押すと、表とやることが計算し直されます。</p>${table(['型番', '品名', 'メーカー', '担当者', '納期（日）', 'まとめ買いの単位', '遅れ連絡（日）'], rows)}`;
  }

  // ② 読み替え: 案件（機種）× オプション → 部品 × 1台に使う数
  function tabBom(eff) {
    const name = Object.fromEntries(st.defaults.parts.map((p) => [p.code, p.name]));
    const blocks = st.defaults.folders.map((f) => {
      const defRows = st.defaults.bom[f.id] || [];
      const rows = (eff.bom[f.id] || []).map((r, i) => {
        const d = defRows.find((x) => x.code === r.code && (x.option || '') === (r.option || ''));
        const changed = d && d.qty !== r.qty;
        return `<tr><td><span class="code">${esc(r.code)}</span></td><td>${esc(name[r.code] || '')}</td><td>${r.option ? `<span class="tag">${esc(r.option)}</span>` : '<span class="muted">いつも</span>'}</td>
          <td><input type="number" min="0" max="999" step="1" value="${r.qty}" data-bom="${esc(f.id)}" data-i="${i}" class="${changed ? 'changed' : ''}" aria-label="1台に使う数">${changed ? `<small>もとは ${fmt(d.qty)}</small>` : ''}</td></tr>`;
      }).join('');
      return `<h4>${esc(f.name)}<span class="muted">　${esc(f.model)}</span></h4>${table(['型番', '品名', 'いつ使う', '1台に使う数'], rows)}`;
    }).join('');
    return `<p class="pop-sub">機種とオプションごとに、1台に使う部品と数です。数を直せます。</p>${blocks}`;
  }

  // ③ 計算の決まり（文は固定）
  function tabRules() {
    return `<p class="pop-sub">この式のとおり計算します。AI は計算しません。</p>${st.rules.map((r) => `<div class="rule"><b>${esc(r.name)}</b><span>${esc(r.formula)}</span></div>`).join('')}<p class="muted">式は固定です。数字は「部品」「読み替え」で直せます。</p>`;
  }

  // ④ 履歴: いつ・誰が・何を・前→後。各行に「この前に戻す」
  function tabLog() {
    const log = load('rules-log', []);
    if (!log.length) return '<p class="pop-sub">まだ直した記録はありません。</p>';
    const rows = log.map((e, i) => ({ e, i })).reverse().map(({ e, i }) => `<tr>
      <td>${esc(when(e.at))}</td><td>${esc(e.who || '')}</td>
      <td>${esc(label(e))}</td>
      <td>${esc(show(e.before))} → <b>${esc(show(e.after))}</b></td>
      <td><button type="button" class="ghost" data-undo="${i}">この前に戻す</button></td></tr>`).join('');
    return table(['いつ', '誰が', '何を', '前 → 後', ''], rows, 'log');
  }

  function onClick(e) {
    if (e.target.closest('.pop-close')) { closeRules(); return; }
    const t = e.target.closest('[data-rtab]');
    if (t) { st.tab = t.dataset.rtab; render(); return; }
    const act = e.target.closest('[data-act]');
    if (act?.dataset.act === 'save') { commit(collect()); return; }
    if (act?.dataset.act === 'reset') {
      if (!hasAny(st.cur)) return;
      if (!confirm('直した内容をすべて既定に戻します。よろしいですか？')) return;
      appendLog('rules-log', { what: 'すべて', field: '', code: '', before: clone(st.cur), after: {} });
      finish({}, '既定に戻しました');
      return;
    }
    const undo = e.target.closest('[data-undo]');
    if (undo) {
      const entry = load('rules-log', [])[Number(undo.dataset.undo)];
      if (!entry) return;
      if (entry.what === 'すべて') { appendLog('rules-log', { what: 'すべて', field: '', code: '', before: clone(st.cur), after: clone(entry.before) }); finish(clone(entry.before) || {}, '戻しました'); return; }
      commit([{ ...entry, before: current(entry), after: entry.before }], '戻しました');
    }
  }

  // 担当者はメーカー単位。同じメーカーの欄をそろえる
  function onInput(e) {
    const t = e.target;
    if (t.dataset.sup) pop.querySelectorAll(`[data-sup="${cssq(t.dataset.sup)}"]`).forEach((x) => { if (x !== t) x.value = t.value; });
  }

  // 入力欄と今の値を見比べて、変わったところだけ変更の一覧にする
  function collect() {
    const eff = apply(st.defaults, st.cur);
    const changes = [];
    const effPart = Object.fromEntries(eff.parts.map((p) => [p.code, p]));
    pop.querySelectorAll('input[data-part]').forEach((inp) => {
      const v = Number(inp.value);
      const { part: code, field } = inp.dataset;
      if (!Number.isInteger(v) || v < 0 || (field === 'lot' && v < 1) || v > (field === 'lot' ? 1000 : 365)) return;
      if (v !== effPart[code][field]) changes.push({ what: '部品', code, field, before: effPart[code][field], after: v });
    });
    const effSup = Object.fromEntries(eff.suppliers.map((s) => [s.maker, s]));
    const seen = new Set();
    pop.querySelectorAll('input[data-sup]').forEach((inp) => {
      const { sup: maker, field } = inp.dataset;
      if (seen.has(maker)) return;
      seen.add(maker);
      const v = inp.value.trim().slice(0, 40);
      if (effSup[maker] && v !== effSup[maker][field]) changes.push({ what: '窓口', code: maker, maker, field, before: effSup[maker][field], after: v });
    });
    pop.querySelectorAll('input[data-bom]').forEach((inp) => {
      const { bom: folderId, i } = inp.dataset;
      const row = eff.bom[folderId]?.[Number(i)];
      const v = Number(inp.value);
      if (!row || !Number.isInteger(v) || v < 0 || v > 999 || v === row.qty) return;
      changes.push({ what: '読み替え', code: row.code, field: 'qty', before: row.qty, after: v, folderId, option: row.option || '' });
    });
    return changes;
  }

  function commit(changesIn, msg = '保存しました') {
    const changes = changesIn.filter((c) => c.before !== c.after);
    if (!changes.length) { st.msg = '変えたところはありません'; render(); return; }
    const next = clone(st.cur);
    for (const c of changes) { setValue(next, c); appendLog('rules-log', c); }
    finish(next, msg);
  }

  async function finish(next, msg) {
    st.cur = next;
    save('overrides', next);
    st.msg = msg;
    try {
      const d = await onChange?.(clone(next));
      if (d?.masters_default) { st.defaults = d.masters_default; st.rules = d.rules || st.rules; }
    } catch (err) { console.error('rules', err); st.msg = '計算し直せませんでした'; }
    if (document.getElementById('rulesPop') === pop) render();
  }

  // 1 件の変更を overrides に当てる（既定と同じ値になったら上書きを消す）
  function setValue(next, c) {
    if (c.what === '部品') {
      const d = st.defaults.parts.find((p) => p.code === c.code);
      next.parts = next.parts || {};
      next.parts[c.code] = { ...(next.parts[c.code] || {}), [c.field]: c.after };
      if (d && d[c.field] === c.after) delete next.parts[c.code][c.field];
      if (!Object.keys(next.parts[c.code]).length) delete next.parts[c.code];
      if (!Object.keys(next.parts).length) delete next.parts;
    } else if (c.what === '窓口') {
      const d = st.defaults.suppliers.find((s) => s.maker === c.code);
      next.suppliers = next.suppliers || {};
      next.suppliers[c.code] = { ...(next.suppliers[c.code] || {}), [c.field]: c.after };
      if (d && d[c.field] === c.after) delete next.suppliers[c.code][c.field];
      if (!Object.keys(next.suppliers[c.code]).length) delete next.suppliers[c.code];
      if (!Object.keys(next.suppliers).length) delete next.suppliers;
    } else if (c.what === '読み替え') {
      const defRows = st.defaults.bom[c.folderId] || [];
      const rows = clone(next.bom?.[c.folderId] || defRows);
      const r = rows.find((x) => x.code === c.code && (x.option || '') === (c.option || ''));
      if (!r) return;
      r.qty = c.after;
      next.bom = next.bom || {};
      next.bom[c.folderId] = rows;
      if (JSON.stringify(rows) === JSON.stringify(defRows)) delete next.bom[c.folderId];
      if (!Object.keys(next.bom).length) delete next.bom;
    }
  }

  // 履歴の 1 件について、いまの値
  function current(c) {
    const eff = apply(st.defaults, st.cur);
    if (c.what === '部品') return eff.parts.find((p) => p.code === c.code)?.[c.field];
    if (c.what === '窓口') return eff.suppliers.find((s) => s.maker === c.code)?.[c.field];
    if (c.what === '読み替え') return eff.bom[c.folderId]?.find((x) => x.code === c.code && (x.option || '') === (c.option || ''))?.qty;
    return undefined;
  }

  function label(e) {
    if (e.what === 'すべて') return 'すべて既定に戻す';
    const where = e.what === '読み替え' ? `${st.defaults.folders.find((f) => f.id === e.folderId)?.name || e.folderId}${e.option ? `（${e.option}）` : ''} ` : '';
    return `${where}${e.code} の${FIELD[e.field] || e.field}`;
  }
}

export function closeRules() {
  document.getElementById('rulesPop')?.remove();
  document.getElementById('rulesOverlay')?.remove();
}

// ---------- 小道具 ----------
function apply(def, o) {
  return {
    parts: def.parts.map((p) => ({ ...p, ...(o?.parts?.[p.code] || {}) })),
    bom: Object.fromEntries(Object.entries(def.bom).map(([id, rows]) => [id, o?.bom?.[id] || rows])),
    suppliers: def.suppliers.map((s) => ({ ...s, ...(o?.suppliers?.[s.maker] || {}) })),
  };
}
function hasAny(o) { return Boolean(o && (o.parts || o.bom || o.suppliers)); }
function show(v) {
  if (v == null || v === '') return 'なし';
  if (typeof v === 'object') { const n = Object.values(v).reduce((s, x) => s + Object.keys(x || {}).length, 0); return n ? `直した所 ${n} 件` : 'なし'; }
  return fmt(v);
}
function when(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function table(cols, rows, cls = '') { return `<div class="table-wrap ${cls}"><table><thead><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`; }
function el(tag, attrs) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }
function injectStyle() {
  if (document.getElementById('rulesStyle')) return;
  const s = document.createElement('style');
  s.id = 'rulesStyle';
  s.textContent = `
.rules-pop { width: min(920px, calc(100vw - 32px)); }
.rules-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-right: 36px; margin-bottom: 10px; }
.rules-head h3 { margin: 0; }
.rules-me { font-size: 12.5px; color: var(--ink-2, #44536A); display: flex; align-items: center; gap: 6px; }
.rules-me input, .rules-pop td input { font: inherit; font-size: 13px; border: 1px solid var(--line, #E6EAF0); border-radius: 8px; padding: 5px 8px; background: #fff; color: inherit; }
.rules-pop td input[type="number"] { width: 64px; text-align: right; font-variant-numeric: tabular-nums; }
.rules-pop td input[type="text"] { width: 104px; }
.rules-pop th, .rules-pop td { padding: 7px 8px; }
.rules-pop td input:focus { outline: 2px solid var(--orange, #EB6311); outline-offset: -1px; }
.rules-pop td input.changed { border-color: var(--orange, #EB6311); background: var(--orange-soft, #FFF1E7); font-weight: 700; }
.rules-tabs { margin-bottom: 12px; }
.rules-body { max-height: calc(100vh - 230px); overflow: auto; }
.rules-pop h4 { font-size: 13.5px; margin: 14px 0 4px; color: var(--navy, #0B2A59); }
.rules-pop .tag { font-size: 11px; background: var(--surface, #F3F5F9); border-radius: 999px; padding: 2px 8px; }
.rules-pop th, .rules-pop td { text-align: left; }
.rules-pop .log td { white-space: normal; }
.rules-acts { margin-top: 14px; align-items: center; }
.rules-msg { margin: 0 0 0 4px; }
`;
  document.head.append(s);
}
