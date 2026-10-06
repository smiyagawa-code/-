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

export function setStatus(key, status, note = '', item = null) {
  if (!STATUSES.includes(status)) throw new Error(`知らない状態: ${status}`);
  const tasks = allTasks();
  const before = tasks[key]?.status ?? initialStatus(item);
  const who = load('me', '担当者');
  const label = item ? itemLabel(item) : tasks[key]?.label || key;
  tasks[key] = { status, note: note || '', at: new Date().toISOString(), who, label };
  save(STORE_KEY, tasks);
  appendLog(LOG_KEY, { key, label, before, after: status, note: note || '' });
  return tasks[key];
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
  return `<button type="button" class="pill ${TONE[status] || ''} status" data-task="${esc(key)}" title="押して状態を変える" style="cursor:pointer;border:0">${esc(status)}</button>`;
}

// 行の中の札／「発注書」ボタンが押されたとき。app.js の onPanelClick から呼ぶ。扱ったら true
//   onTaskClick(e, item, rerender, d)  … やること 1 件を渡す
//   onTaskClick(e, d, rerender)        … /api/data の返り値を渡す（押した行の data-todo から やることを探す）
export function onTaskClick(e, a, b, c) {
  const target = e.target;
  let item = a, rerender = b, d = c;
  if (a && Array.isArray(a.todos)) {
    d = a; rerender = b;
    const row = target.closest?.('[data-todo]');
    item = row ? d.todos.find((x) => x.id === row.dataset?.todo) : null;
    if (!item) return false;
  }
  if (target.closest?.('[data-order]')) { openOrder(item, d, rerender); return true; }
  const chip = target.closest?.('[data-task]');
  if (!chip) return false;
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
    ${orderable(item) ? `<div class="pop-acts" style="margin-top:12px"><button type="button" class="primary" data-order-open="1">発注書を書く</button></div>` : ''}`);
  pop.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => {
    setStatus(key, b.dataset.next, pop.querySelector('#taskNote')?.value?.trim() || '', item);
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
