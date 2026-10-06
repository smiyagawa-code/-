// 発注書の下書き。やること 1 件（種別「手配」）から、発注書の体裁（表）で窓に出す。
// 数字は /api/data の parts（計算済み）から取る。計算はしない。
// 発注先の担当者・連絡先は d.masters.suppliers（B が足す予定）。無ければ空欄のまま動く。
//
// app.js からは tasks.js の onTaskClick 経由で呼ばれる（行の「発注書」ボタン）。直接呼ぶなら:
//   import { openOrder } from './order.js';  openOrder(todoItem, data, renderPanel);  // または openOrder(t, data, { onChange: renderPanel })
import { esc } from './util.js';
import { taskKey, setStatus, openPop, closePop, extraOf } from './tasks.js';

const SENDER = 'ACS株式会社 購買部 高橋'; // 架空の差出人（src/data.js の文面と同じ）

// 発注書の項目を組み立てる（表示と文字コピーの両方で使う）
export function buildOrder(item, d = {}, today = new Date()) {
  const part = (d.parts || []).find((p) => p.folderId === item.folderId && p.code === item.code) || {};
  const folder = (d.folders || []).find((f) => f.id === item.folderId) || {};
  const maker = part.maker || item.who || '';
  const sup = findSupplier(d.masters?.suppliers, maker);
  // 発注済みのあと手配数が増えていれば「追加分」: 数量は差分だけ
  const extra = extraOf(taskKey(item), item, d);
  const qty = extra && extra.diff > 0 ? extra.diff : part.order || qtyFromText(item.what);
  const notes = [];
  if (extra && extra.diff > 0) notes.push(`追加分（前回 ${extra.ordered}個は発注済み${extra.eta ? `・入荷予定 ${extra.eta}` : ''}）`);
  if (part.late > 0) notes.push(`希望日 ${part.due} に対し ${part.eta} 着の見込み（${part.late}日遅れ）。短縮できる場合は最短の納期をお知らせください。`);
  else if (part.eta) notes.push(`納期 ${part.eta} 着で承知しています。`);
  const delayLine = (item.why || []).find((l) => /遅れ連絡/.test(l));
  if (delayLine) notes.push(`メーカー案内の遅れを含めて見ています（${delayLine}）。`);
  if (part.deadlinePassed) notes.push('発注の締切を過ぎています。至急お願いします。');
  if (sup.note) notes.push(`メーカー窓口の注意: ${sup.note}`);
  return {
    date: fmtDate(today),
    to: maker,
    contact: sup.contact || '',
    tel: sup.tel || '',
    email: sup.email || '',
    customer: folder.customer || '',
    project: item.folderName || folder.name || '',
    model: folder.model || '',
    code: item.code || '',
    name: part.name || item.what || '',
    qty,
    unit: '個',
    due: part.due || '',
    eta: part.eta || '',
    note: notes.join('\n'),
    sender: senderFrom(item) || d.sender || SENDER,
    extra: extra && extra.diff > 0 ? extra : null,
  };
}

// 発注書を文字にする（コピー用）
export function orderText(o) {
  const line = (k, v) => `${k}：${v || ''}`;
  return [
    o.extra ? '追加分の発注書（下書き）' : '発注書（下書き）',
    line('発注日', o.date),
    line('発注先', o.to),
    line('ご担当', [o.contact, o.tel, o.email].filter(Boolean).join('　')),
    '',
    line('案件', [o.customer, o.project].filter(Boolean).join('　')),
    line('装置', o.model),
    line('型番', o.code),
    line('品名', o.name),
    line('数量', o.qty ? `${o.qty}${o.unit}` : ''),
    line('希望納期', o.due),
    line('備考', o.note),
    '',
    line('差出人', o.sender),
  ].join('\n');
}

// 窓を開く（既存の #pop の見た目。中身は JS で組む）。第3引数は 再描画の関数、または { onChange }
export function openOrder(item, d, rerender) {
  if (rerender && typeof rerender === 'object') rerender = rerender.onChange;
  const o = buildOrder(item, d);
  const row = (k, v, cls = '') => `<tr><th>${esc(k)}</th><td class="${cls}">${v}</td></tr>`;
  const pop = openPop(`<h3>${o.extra ? '追加分の発注書（下書き）' : '発注書（下書き）'}</h3><p class="pop-sub">${esc(o.to)} 宛${o.extra ? `　<em class="pill red">追加 +${o.extra.diff} 個</em>` : ''}</p>
    <div class="table-wrap"><table class="order" style="font-size:13.5px">
      <tbody>
        ${row('発注日', esc(o.date))}
        ${row('発注先', `<b>${esc(o.to)}</b>`)}
        ${row('ご担当', o.contact ? `${esc(o.contact)}<small>${esc([o.tel, o.email].filter(Boolean).join('　'))}</small>` : '<span class="muted">（未登録）</span>')}
        ${row('案件', `${esc(o.customer)}<small>${esc(o.project)}${o.model ? `　${esc(o.model)}` : ''}</small>`)}
        ${row('型番', `<span class="code">${esc(o.code)}</span>`)}
        ${row('品名', esc(o.name))}
        ${row('数量', o.qty ? `<b>${esc(String(o.qty))}</b> ${esc(o.unit)}` : '<span class="muted">－</span>')}
        ${row('希望納期', o.due ? `<b>${esc(o.due)}</b>${o.eta ? `<small>メーカー納期では ${esc(o.eta)} 着</small>` : ''}` : '－')}
        ${row('備考', o.note ? esc(o.note).replace(/\n/g, '<br>') : '－')}
        ${row('差出人', esc(o.sender))}
      </tbody></table></div>
    <pre id="orderText" hidden>${esc(orderText(o))}</pre>
    <div class="pop-acts" style="margin-top:12px"><button type="button" class="ghost" data-order-copy="1">コピー</button><button type="button" class="primary" data-order-done="1">発注済みにする</button></div>
    <p class="muted">${o.extra ? '「発注済みにする」を押すと、発注済みの数が今の手配数に更新されます。' : '「発注済みにする」を押すと、状態が「発注済・回答待ち」になります。'}</p>`);
  // 表の th を左寄せに（style.css の表は右寄せが基本）
  pop.querySelectorAll('table.order th').forEach((th) => { th.style.textAlign = 'left'; th.style.width = '92px'; th.style.whiteSpace = 'nowrap'; });
  pop.querySelectorAll('table.order td').forEach((td) => { td.style.textAlign = 'left'; td.style.whiteSpace = 'normal'; });
  pop.querySelector('[data-order-copy]')?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    const text = orderText(o);
    const done = () => { b.textContent = 'コピーしました'; setTimeout(() => { b.textContent = 'コピー'; }, 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done); else done();
  });
  pop.querySelector('[data-order-done]')?.addEventListener('click', () => {
    setStatus(taskKey(item), '発注済・回答待ち', `${o.extra ? '追加分の' : ''}発注書を出した（${o.to}・${o.qty}${o.unit}）`, item, d);
    closePop();
    rerender?.();
  });
  return pop;
}

// ---------- 小道具 ----------
// d.masters.suppliers は src/masters.js の SUPPLIERS（配列 { maker, person, email, note }）。
// 念のため、別名（contact/担当者、tel/電話、mail/メール）とメーカー名をキーにした辞書も受け付ける。無ければ空
function findSupplier(suppliers, maker) {
  if (!suppliers || !maker) return {};
  let s = null;
  if (Array.isArray(suppliers)) s = suppliers.find((x) => x && (x.maker === maker || x.name === maker || x.メーカー === maker));
  else if (typeof suppliers === 'object') s = suppliers[maker];
  if (!s) return {};
  return {
    contact: s.contact || s.person || s.担当者 || s.担当 || '',
    tel: s.tel || s.phone || s.電話 || '',
    email: s.email || s.mail || s.メール || '',
    note: s.note || s.注意 || '',
  };
}
function qtyFromText(s) { const m = String(s || '').match(/(\d+)\s*個/); return m ? Number(m[1]) : 0; }
function senderFrom(item) { const m = String(item?.draft?.body || '').match(/(ACS株式会社[^\n。]*?)です。/); return m ? m[1] : ''; }
function fmtDate(t) { return `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`; }
