// やることの「状態」と「進捗」タブ。計算はしない（/api/data の todos・parts をそのまま使う）。保存は public/store.js（localStorage）。
//
// ■ index.html に足す要素
//   なし。「進捗」タブは app.js の renderTabs() で data.tabs の後ろに { id: 'progress', label: '進捗' } を足して描く
//   （src/data.js の tabs は 3 つのまま。test/spec が tabs.length === 3 を見ている）。
//   load() の「state.tab が tabs に無ければ defaultTab」の判定も 'progress' を通すこと。
//   窓は既存の #pop / #overlay をそのまま使う（要素は足さない）。
//
// ■ app.js から呼ぶ関数
//   import { statusChip, onTaskClick, renderProgress, orderable } from './tasks.js';
//   import { openOrder } from './order.js';
//
//   1) panelTodo() の各行（.todo[data-todo]）の .todo-acts に、札と「発注書」ボタンを足す:
//        ${statusChip(t)}                                      ← 状態の札（押すと次の状態を選ぶ窓）。statusChip(taskKey(t), t) でも同じ
//        ${orderable(t) ? `<button type="button" class="ghost" data-order="${esc(t.id)}">発注書</button>` : ''}
//      orderable(t) は 種別が「手配」（メーカーに手配する行）のとき true。tone === 'red' で出すと、お客様への納期相談の行にも
//      発注書が付くので orderable(t) を勧める（付いても落ちはしない。数量が取れず「－」になる）。
//
//   2) onPanelClick(e) の先頭で:
//        if (onTaskClick(e, data, () => renderPanel())) return;   ← 押した行の data-todo から やることを探し、札と発注書の両方を扱う
//      （やること 1 件を自分で探して渡す形 onTaskClick(e, t, renderPanel, data) でも可）
//      「発注書」を別に扱うなら openOrder(t, data, () => renderPanel()) または openOrder(t, data, { onChange })。
//
//   3) タブ: renderTabs() で [...data.tabs, { id: 'progress', label: '進捗' }] を描き、
//      renderPanel() の表に progress: () => renderProgress(data) を足す。load() の「tabs に無ければ defaultTab」は 'progress' を通す。
//      進捗タブの表の行にも data-todo が付くので、2) の配線がそのまま効く。
//
//   4) 「誰が」は store の 'me'（load('me', '担当者')）。設定画面で名前を保存すれば履歴に名前が残る。
//
//   5) 通知文（発注済・完了にしたとき、窓に下書きを出す。送らない）: load() の最後に 1 行
//        setTaskData(data);     ← import { setTaskData } from './tasks.js'
//      を足す。setStatus が /api/data の parts・todos を見て、入荷予定と案件の残り件数を文に入れるため。
//      （onTaskClick(e, data, …) や renderProgress(data) を通れば自動で覚えるが、app.js が openOrder を直接呼ぶ経路では
//        これが無いと残り件数と入荷予定が入らない。無くても落ちない）
//
//   6) 追加発注（配線は不要）: 発注済みにした時の手配数を ordered に残し、更新の内示で手配数が増えると
//      statusChip の横に赤い「追加 +n 個」、減ると黄色の「減 −n 個」が出る（進捗タブの行も同じ）。
//      「発注書」を押すと「追加分の発注書」（数量は差分）。発注済みにすると ordered が更新され、状態はそのまま、
//      履歴に「追加発注」、通知文は【追加発注】。手配数は parts の order（無ければ やることの文「n個を手配」）。
//
// ■ style.css に足すなら（無くても動く。最低限はインラインで当てている）
//   .pill.status { cursor: pointer; border: 0; } .prog-head { display:flex; gap:10px; align-items:center; }
//
import { esc } from './util.js';
import { load, save, appendLog } from './store.js';
import { openOrder } from './order.js';

// 状態（宮川さんの決定で 5 つ。§8 のたたき台から絞った）
export const STATUSES = ['内示待ち', '発注済・回答待ち', '入荷待ち', '完了', '見送り'];
// 札の色
const TONE = { 内示待ち: 'red', '発注済・回答待ち': 'blue', 入荷待ち: 'blue', 完了: 'ok', 見送り: 'gray' };
// 進む順: 内示待ち → 発注済・回答待ち → 入荷待ち → 完了。どこからでも 見送り。見送りからは 内示待ち に戻せる
const NEXT = {
  内示待ち: ['発注済・回答待ち', '見送り'],
  '発注済・回答待ち': ['入荷待ち', '見送り'],
  入荷待ち: ['完了', '見送り'],
  完了: ['見送り'],
  見送り: ['内示待ち'],
};
// まだ発注前の状態（進捗の「残り」に数える）
const OPEN = new Set(['内示待ち']);

const STORE_KEY = 'tasks';
const LOG_KEY = 'task-log';
const NOTICE_STATUSES = new Set(['発注済・回答待ち', '完了']); // この状態になったら通知文の下書きを出す
const NOTICE_TO = '購買部・営業部（Slack #acs-発注 など。送り先は設定で変えられる想定）';

// 最後に見た /api/data の返り値（通知文に 入荷予定・残り件数 を入れるため）
let lastData = null;
export function setTaskData(d) { if (d && Array.isArray(d.todos)) lastData = d; }

// ---------- やること 1 件の種別・key・初期状態 ----------
// 種別: 手配／納期相談／余る／確認（src/data.js buildTodos の kind と文から決める）
export function taskType(item) {
  const kind = item?.kind || '';
  if (kind === 'メーカーに連絡') return /手配/.test(item.what || '') ? '手配' : '納期相談';
  if (kind === 'お客様に連絡') return '納期相談';
  if (kind === '社内で決める') return '余る';
  if (kind === 'お客様に確認') return '確認';
  return 'その他';
}
export function orderable(item) { return taskType(item) === '手配'; }

// key = 案件id ＋ 型番 ＋ 種別。型番が無いもの（お客様への連絡・確認）は内容の文で区別する
export function taskKey(item) {
  const code = item.code || `t${hash(item.what || '')}`;
  return `${item.folderId}/${code}/${taskType(item)}`;
}
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// 初期状態: 種別によらず「内示待ち」（内示を受けて、まだ発注していない）
export function initialStatus() { return '内示待ち'; }

// ---------- 保存 ----------
function allTasks() { return load(STORE_KEY, {}); }
export function getTask(key, item) {
  const t = allTasks()[key];
  if (t) return { ...t, saved: true };
  return { status: initialStatus(item), note: '', at: '', who: '', saved: false };
}
export function getStatus(key, item) { return getTask(key, item).status; }

// 第5引数 d（/api/data の返り値）があれば通知文に使う。無ければ setTaskData で覚えたものを使う
export function setStatus(key, status, note = '', item = null, d = null) {
  if (!STATUSES.includes(status)) throw new Error(`知らない状態: ${status}`);
  d = d || lastData;
  const tasks = allTasks();
  const before = tasks[key]?.status ?? initialStatus(item);
  const who = load('me', '担当者');
  const label = item ? itemLabel(item) : tasks[key]?.label || key;
  const remainBefore = item && d ? remainingOf(d, item.folderId) : -1;
  const prev = tasks[key] || {};
  const rec = { status, note: note || '', at: new Date().toISOString(), who, label, ordered: prev.ordered, orderedEta: prev.orderedEta };
  // 発注済にしたとき、そのときの手配数を ordered に残す（あとで数量が増えたら「追加 +n 個」が出る）
  let added = 0;
  if (item && status === '発注済・回答待ち') {
    const cur = currentQty(item, d);
    if (before === status && prev.ordered != null && cur > prev.ordered) added = cur - prev.ordered; // 追加発注
    rec.ordered = cur;
    rec.orderedEta = partOf(d, item).eta || prev.orderedEta || '';
  }
  tasks[key] = rec;
  save(STORE_KEY, tasks);
  appendLog(LOG_KEY, added ? { key, label, before, after: '追加発注', note: `+${added}個（${prev.ordered} → ${rec.ordered}）${note ? '　' + note : ''}` } : { key, label, before, after: status, note: note || '' });
  // 通知文の下書き（発注済・完了・追加発注のとき。案件の内示待ちが 0 になった瞬間は案件の通知も）
  const notices = [];
  if (item && added) notices.push(buildNotice(item, d, '追加発注', { who, at: rec.at, added, ordered: rec.ordered }));
  else if (item && NOTICE_STATUSES.has(status) && before !== status) notices.push(buildNotice(item, d, status, { who, at: rec.at }));
  if (item && d && remainBefore > 0) {
    const sum = progressSummary(d).find((x) => x.folderId === item.folderId);
    if (sum && sum.remaining === 0) notices.push(buildCaseNotice(folderOf(d, item.folderId), sum));
  }
  for (const n of notices) appendLog(LOG_KEY, { key, label, before: '－', after: '通知文を作成', note: n.subject });
  if (notices.length && typeof document !== 'undefined') setTimeout(() => showNotices(notices), 0); // 発注書の窓が閉じた後に出す
  return tasks[key];
}
function partOf(d, item) { return (d?.parts || []).find((p) => p.folderId === item.folderId && p.code === item.code) || {}; }
// 今の手配数（parts の order。無ければ やることの文「… n個を手配」から）
export function currentQty(item, d = lastData) { const p = partOf(d, item); return p.order || qtyFromText(item?.what); }
// 発注済・入荷待ちのやることで、手配数が発注時（ordered）から変わったか。{ ordered, current, diff, eta }。変わっていなければ null
export function extraOf(key, item, d = lastData) {
  const t = allTasks()[key];
  if (!t || t.ordered == null || !['発注済・回答待ち', '入荷待ち'].includes(t.status)) return null;
  const current = currentQty(item, d);
  const diff = current - t.ordered;
  return diff ? { ordered: t.ordered, current, diff, eta: t.orderedEta || '' } : null;
}
export function extraBadge(key, item, d = lastData) {
  const x = extraOf(key, item, d);
  if (!x) return '';
  return x.diff > 0 ? `<em class="pill red" title="発注時 ${x.ordered}個 → 今 ${x.current}個">追加 +${x.diff} 個</em>` : `<em class="pill amber" title="発注時 ${x.ordered}個 → 今 ${x.current}個">減 −${-x.diff} 個</em>`;
}
function remainingOf(d, folderId) { return progressSummary(d).find((x) => x.folderId === folderId)?.remaining ?? -1; }
function folderOf(d, folderId) { return (d?.folders || []).find((f) => f.id === folderId) || { id: folderId, name: '', customer: '' }; }

// ---------- 通知文（下書き。送らない） ----------
// やること 1 件が 発注済・回答待ち／完了 になったときの文
export function buildNotice(item, d, status, { who = load('me', '担当者'), at = new Date().toISOString(), added = 0, ordered = 0 } = {}) {
  const folder = folderOf(d, item.folderId);
  const part = (d?.parts || []).find((p) => p.folderId === item.folderId && p.code === item.code) || {};
  const head = `${shortName(folder.customer)} ${folder.name || item.folderName || ''}`.trim();
  const qty = part.order || qtyFromText(item.what);
  const thing = item.code ? `${item.code} ${part.name || ''}`.trim() + (qty ? ` ${qty}個` : '') : `「${item.what}」`;
  const maker = part.maker || item.who || '';
  const stamp = `（担当: ${who}、${fmtAt(at)}）`;
  let tag, line;
  if (status === '追加発注') { tag = '【追加発注】'; line = `${item.code ? `${item.code} ${part.name || ''}`.trim() : thing} ${added}個を${maker ? `${maker}へ` : ''}追加で発注しました${stamp}。累計 ${ordered}個。${part.eta ? `追加分の入荷予定 ${part.eta}。` : ''}`; }
  else if (status === '完了') { tag = '【完了】'; line = taskType(item) === '手配' ? `${thing} が入荷し、案件に充てました${stamp}。` : `${thing} の対応が終わりました${stamp}。`; }
  else { tag = '【発注完了】'; line = taskType(item) === '手配' ? `${thing}を${maker ? `${maker}へ` : ''}発注しました${stamp}。${part.eta ? `入荷予定 ${part.eta}。` : ''}` : `${thing} を進めました${stamp}。`; }
  const remain = d ? remainingOf(d, item.folderId) : -1;
  const body = [line, remain >= 0 ? `この案件の残り: 内示待ち ${remain} 件。` : ''].filter(Boolean).join('\n');
  return { to: NOTICE_TO, subject: `${tag}${head} — ${status === '追加発注' ? `${item.code} +${added}個` : thing}`, body };
}
// 案件の内示待ちが 0 件になったときの文（summary は progressSummary の 1 件）
export function buildCaseNotice(folder, summary) {
  const c = summary.counts || {};
  const head = `${shortName(folder.customer)} ${folder.name || ''}`.trim();
  return {
    to: NOTICE_TO,
    subject: `【案件の発注完了】${head}`,
    body: `やること ${summary.total} 件すべて対応済み（発注済 ${c['発注済・回答待ち'] || 0}／入荷待ち ${c['入荷待ち'] || 0}／完了 ${c['完了'] || 0}／見送り ${c['見送り'] || 0}）。\n詳細は画面の「進捗」をご覧ください。`,
  };
}
export function noticeText(n) { return `宛先: ${n.to}\n件名: ${n.subject}\n\n${n.body}`; }
function shortName(s) { return String(s || '').replace(/^株式会社|株式会社$/g, '').trim(); }
function qtyFromText(s) { const m = String(s || '').match(/(\d+)\s*個/); return m ? Number(m[1]) : 0; }

function showNotices(notices) {
  const pop = openPop(`<h3>通知文の下書き</h3><p class="pop-sub">送っていません。コピーして使ってください。</p>
    ${notices.map((n, i) => `<div class="notice" style="margin-top:${i ? 14 : 0}px">
      <p class="muted" style="margin:0 0 4px">宛先: ${esc(n.to)}</p>
      <p style="font-size:14px;font-weight:700;color:#0B2A59">${esc(n.subject)}</p>
      <pre id="noticeText${i}">${esc(n.body)}</pre>
      <div class="pop-acts"><button type="button" class="ghost" data-notice-copy="${i}">コピー</button></div>
    </div>`).join('')}
    <div class="pop-acts" style="margin-top:14px"><button type="button" class="primary" data-notice-close="1">閉じる</button></div>`);
  pop.querySelectorAll('[data-notice-copy]').forEach((b) => b.addEventListener('click', () => {
    const n = notices[Number(b.dataset.noticeCopy)];
    const done = () => { b.textContent = 'コピーしました'; setTimeout(() => { b.textContent = 'コピー'; }, 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(noticeText(n)).then(done, done); else done();
  }));
  pop.querySelector('[data-notice-close]')?.addEventListener('click', closePop);
}
export function nextStatuses(status) { return NEXT[status] || STATUSES.filter((s) => s !== status); }
export function history(filter) {
  const log = load(LOG_KEY, []);
  return (filter ? log.filter(filter) : log).slice().reverse();
}
function itemLabel(item) { return [item.folderName, item.code, item.what].filter(Boolean).join('　'); }

// ---------- 札（押すと次の状態を選ぶ） ----------
export function statusChip(key, item) {
  if (key && typeof key === 'object') { item = key; key = taskKey(item); } // statusChip(t) でも可
  const status = getStatus(key, item);
  return `<button type="button" class="pill ${TONE[status] || ''} status" data-task="${esc(key)}" title="押して状態を変える" style="cursor:pointer;border:0">${esc(status)}</button>${item ? extraBadge(key, item) : ''}`;
}

// 行の中の札／「発注書」ボタンが押されたとき。app.js の onPanelClick から呼ぶ。扱ったら true
//   onTaskClick(e, item, rerender, d)  … やること 1 件を渡す
//   onTaskClick(e, d, rerender)        … /api/data の返り値を渡す（押した行の data-todo から やることを探す）
export function onTaskClick(e, a, b, c) {
  const target = e.target;
  let item = a, rerender = b, d = c;
  if (a && Array.isArray(a.todos)) {
    d = a; rerender = b;
    setTaskData(d);
    const row = target.closest?.('[data-todo]');
    item = row ? d.todos.find((x) => x.id === row.dataset?.todo) : null;
    if (!item) return false;
  }
  if (target.closest?.('[data-order]')) { openOrder(item, d, rerender); return true; }
  const chip = target.closest?.('[data-task]');
  if (!chip) return false;
  setTaskData(d);
  openStatusMenu(chip.dataset?.task || taskKey(item), item, rerender, d);
  return true;
}

function openStatusMenu(key, item, rerender, d) {
  const now = getTask(key, item);
  const pop = openPop(`<h3>状態を変える</h3><p class="pop-sub">${esc(itemLabel(item))}</p>
    <p style="font-size:13.5px">いま　<em class="pill ${esc(TONE[now.status] || '')}">${esc(now.status)}</em>${now.at ? `<small class="muted">　${esc(fmtAt(now.at))}　${esc(now.who)}</small>` : ''}</p>
    <p class="muted" style="margin:10px 0 6px">次へ</p>
    <div class="pop-acts">${nextStatuses(now.status).map((s) => `<button type="button" class="ghost" data-next="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <textarea id="taskNote" rows="2" maxlength="200" placeholder="メモ（任意）" style="width:100%;margin-top:12px;font:inherit;font-size:13px;border:1px solid #E6EAF0;border-radius:10px;padding:8px 10px;resize:none">${esc(now.note)}</textarea>
    ${orderable(item) && (now.status === '内示待ち' || extraOf(key, item, d)?.diff > 0) ? `<div class="pop-acts" style="margin-top:12px"><button type="button" class="primary" data-order-open="1">${extraOf(key, item, d)?.diff > 0 ? '追加分の発注書を書く' : '発注書を書く'}</button></div>` : ''}`);
  pop.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => {
    setStatus(key, b.dataset.next, pop.querySelector('#taskNote')?.value?.trim() || '', item, d);
    closePop();
    rerender?.();
  }));
  pop.querySelector('[data-order-open]')?.addEventListener('click', () => openOrder(item, d, rerender));
}

// ---------- 進捗タブ ----------
// 案件ごとの集計。第三者が見て「発注が全部済んでいる／残り n 件」が分かる。残り ＝ 内示待ち の件数。
// 発注完了 ＝ やることが 1 件以上あり、全部が 発注済・回答待ち／入荷待ち／完了／見送り（内示待ちが 0）
export function progressSummary(d) {
  const folders = (d.folders || []).filter((f) => d.selectedFolder === 'all' || f.id === d.selectedFolder);
  return folders.map((f) => {
    const items = (d.todos || []).filter((t) => t.folderId === f.id);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const t of items) counts[getStatus(taskKey(t), t)]++;
    const remaining = STATUSES.filter((s) => OPEN.has(s)).reduce((n, s) => n + counts[s], 0);
    return { folderId: f.id, name: f.name, customer: f.customer, pending: Boolean(f.pending), total: items.length, counts, remaining, done: items.length > 0 && remaining === 0, items };
  });
}

export function renderProgress(d) {
  setTaskData(d);
  const sums = progressSummary(d);
  if (!sums.length) return `<article class="card"><p class="muted">案件がありません</p></article>`;
  const cards = sums.map((s) => {
    const head = s.pending ? '<em class="pill gray">内示 未着</em>' : s.total === 0 ? '<em class="pill gray">やることなし</em>' : s.done ? '<em class="pill ok">発注完了</em>' : `<em class="pill red">残り ${s.remaining} 件</em>`;
    const pills = STATUSES.filter((st) => s.counts[st] > 0).map((st) => `<em class="pill ${esc(TONE[st] || '')}">${esc(st)} ${s.counts[st]}</em>`).join(' ');
    const rows = s.items.map((t) => {
      const key = taskKey(t);
      const task = getTask(key, t);
      return `<tr data-todo="${esc(t.id)}"><td><span class="code">${esc(t.code || '－')}</span></td><td>${esc(t.what)}<small>${esc(taskType(t))}　${esc(t.who)}</small></td><td>${statusChip(key, t)}</td><td>${task.at ? esc(fmtAt(task.at)) : '－'}</td><td>${task.who ? esc(task.who) : '－'}</td></tr>`;
    });
    return `<article class="card prog" data-folder="${esc(s.folderId)}">
      <header class="change-head prog-head"><h3>${esc(s.name)}</h3>${head}${pills ? `<span class="prog-pills">${pills}</span>` : ''}</header>
      ${s.items.length ? `<div class="table-wrap"><table><thead><tr><th>型番</th><th>内容</th><th>状態</th><th>最終更新</th><th>誰が</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : ''}
    </article>`;
  }).join('');
  const ids = new Set(sums.map((s) => s.folderId));
  const log = history((e) => ids.has(String(e.key || '').split('/')[0])).slice(0, 30);
  const hist = `<article class="card"><h3 style="font-size:15px;margin-bottom:6px">履歴</h3>${log.length
    ? `<div class="table-wrap"><table><thead><tr><th>いつ</th><th>誰が</th><th>何を</th><th>変更</th><th>メモ</th></tr></thead><tbody>${log.map((e) => `<tr><td>${esc(fmtAt(e.at))}</td><td>${esc(e.who || '')}</td><td>${esc(e.label || e.key)}</td><td>${esc(e.before || '－')} → <b>${esc(e.after)}</b></td><td>${esc(e.note || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">まだ動かしていません。札を押すと状態を変えられます。</p>'}</article>`;
  return `${cards}${hist}`;
}

// ---------- 窓（既存の #pop / #overlay を使う。無ければ作る） ----------
export function openPop(html) {
  let pop = document.getElementById('pop');
  if (!pop) { pop = document.createElement('div'); pop.id = 'pop'; pop.className = 'pop'; pop.setAttribute('role', 'dialog'); document.body?.append(pop); }
  let overlay = document.getElementById('overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'overlay'; overlay.className = 'overlay'; overlay.addEventListener('click', closePop); document.body?.append(overlay); }
  pop.innerHTML = `<button type="button" class="pop-close" aria-label="閉じる">×</button>${html}`;
  pop.hidden = false;
  overlay.hidden = false;
  pop.querySelector('.pop-close')?.addEventListener('click', closePop);
  return pop;
}
export function closePop() {
  const pop = document.getElementById('pop'); if (pop) pop.hidden = true;
  const overlay = document.getElementById('overlay'); if (overlay) overlay.hidden = true;
}

// ---------- 小道具 ----------
export function fmtAt(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getMonth() + 1}/${t.getDate()} ${p(t.getHours())}:${p(t.getMinutes())}`;
}
