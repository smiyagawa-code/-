// やることの状態・進捗・発注書（public/tasks.js, public/order.js）。localStorage は偽物。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoData, BASE_DATES, _FOLDERS } from '../src/data.js';

// 偽の localStorage（store.js が読む）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const tasks = await import('../public/tasks.js');
const order = await import('../public/order.js');
const { taskKey, taskType, initialStatus, getStatus, setStatus, progressSummary, renderProgress, statusChip, history, STATUSES, nextStatuses, orderable } = tasks;

const all = () => getDemoData({ folder: 'all' });
const BAD = ['undefined', 'NaN', 'Infinity', '[object Object]', 'null'];

test.beforeEach(() => mem.clear());

test('key は 案件×型番×種別 で一意。やることの並び順（id）には依らない', () => {
  for (const base of BASE_DATES.map((b) => b.value)) {
    const d = getDemoData({ folder: 'all', base });
    const keys = d.todos.map(taskKey);
    assert.equal(new Set(keys).size, keys.length, `${base}: key が重なっている ${keys.join(' ')}`);
    for (const t of d.todos) {
      assert.match(taskKey(t), new RegExp(`^${t.folderId}/`));
      assert.equal(taskKey({ ...t, id: 'zzz-99' }), taskKey(t), 'id を変えても key は同じ');
    }
  }
  // 案件ごとに見ても、すべてで見ても同じ key
  const inAll = new Map(all().todos.map((t) => [`${t.folderId}|${t.what}`, taskKey(t)]));
  for (const f of _FOLDERS.filter((x) => !x.pending)) {
    for (const t of getDemoData({ folder: f.id }).todos) assert.equal(taskKey(t), inAll.get(`${t.folderId}|${t.what}`));
  }
  // 型番の無いやること（お客様への連絡・確認）も、内容が違えば別の key
  const a = taskKey({ folderId: 'f01', code: '', kind: 'お客様に確認', what: '希望日は 11/14？' });
  const b = taskKey({ folderId: 'f01', code: '', kind: 'お客様に確認', what: 'ライトカーテンは 4段？' });
  assert.notEqual(a, b);
});

test('種別は 手配／納期相談／余る／確認。初期状態は種別によらず「内示待ち」', () => {
  const d = all();
  const by = (kind, re) => d.todos.find((t) => t.kind === kind && (!re || re.test(t.what)));
  const order1 = by('メーカーに連絡', /手配/);
  const expedite = by('メーカーに連絡', /早められる/);
  const customer = by('お客様に連絡');
  const excess = by('社内で決める');
  const check = by('お客様に確認');
  assert.ok(order1 && expedite && customer && excess && check, '見本データに 5 種類のやることがある');
  assert.equal(taskType(order1), '手配'); assert.ok(orderable(order1));
  assert.equal(taskType(expedite), '納期相談'); assert.ok(!orderable(expedite));
  assert.equal(taskType(customer), '納期相談');
  assert.equal(taskType(excess), '余る');
  assert.equal(taskType(check), '確認');
  for (const t of [order1, expedite, customer, excess, check, { kind: '知らない種類', what: '' }]) assert.equal(initialStatus(t), '内示待ち');
  assert.deepEqual(STATUSES, ['内示待ち', '発注済・回答待ち', '入荷待ち', '完了', '見送り']);
  for (const t of d.todos) assert.equal(getStatus(taskKey(t), t), '内示待ち', `${t.what}: 保存前は 内示待ち`);
});

test('状態を動かすと保存され、履歴に いつ・誰が・前→後・メモ が残る', () => {
  const d = all();
  const t = d.todos.find((x) => taskType(x) === '手配');
  const key = taskKey(t);
  assert.equal(getStatus(key, t), '内示待ち');
  localStorage.setItem('moc-acs:me', JSON.stringify('高橋'));
  const saved = setStatus(key, '発注済・回答待ち', '発注書を出した', t);
  assert.equal(saved.status, '発注済・回答待ち');
  assert.equal(getStatus(key, t), '発注済・回答待ち');
  assert.equal(getStatus(key), '発注済・回答待ち', 'item 無しでも保存済みなら返る');
  setStatus(key, '入荷待ち', '', t);
  const log = history();
  assert.equal(log.length, 2);
  assert.equal(log[0].after, '入荷待ち'); assert.equal(log[0].before, '発注済・回答待ち');
  assert.equal(log[1].before, '内示待ち'); assert.equal(log[1].after, '発注済・回答待ち'); assert.equal(log[1].note, '発注書を出した');
  for (const e of log) { assert.equal(e.who, '高橋'); assert.equal(e.key, key); assert.ok(e.at && !Number.isNaN(Date.parse(e.at))); assert.ok(e.label.includes(t.code)); }
  // 新しいものが先
  assert.ok(Date.parse(log[0].at) >= Date.parse(log[1].at));
  // ほかのやることには影響しない
  const other = d.todos.find((x) => taskKey(x) !== key);
  assert.equal(getStatus(taskKey(other), other), initialStatus(other));
  assert.throws(() => setStatus(key, 'できた', '', t), /知らない状態/);
  // 進む順: 内示待ち → 発注済・回答待ち → 入荷待ち → 完了。どこからでも 見送り。見送り → 内示待ち に戻せる
  assert.deepEqual(nextStatuses('内示待ち'), ['発注済・回答待ち', '見送り']);
  assert.deepEqual(nextStatuses('発注済・回答待ち'), ['入荷待ち', '見送り']);
  assert.deepEqual(nextStatuses('入荷待ち'), ['完了', '見送り']);
  assert.deepEqual(nextStatuses('完了'), ['見送り']);
  assert.deepEqual(nextStatuses('見送り'), ['内示待ち']);
  for (const s of STATUSES) { const n = nextStatuses(s); assert.ok(!n.includes(s)); n.forEach((x) => assert.ok(STATUSES.includes(x))); }
});

test('進捗の集計: 残り n 件 → 全部動かすと「発注完了」', () => {
  const d = all();
  let sums = progressSummary(d);
  assert.equal(sums.length, d.folders.length, 'すべて＝全案件（未着も含む）');
  const f01 = sums.find((s) => s.folderId === 'f01');
  const n01 = d.todos.filter((t) => t.folderId === 'f01').length;
  assert.ok(n01 > 0);
  assert.equal(f01.total, n01); assert.equal(f01.remaining, n01); assert.equal(f01.done, false);
  for (const s of sums.filter((x) => x.pending)) { assert.equal(s.total, 0); assert.equal(s.done, false); }
  let html = renderProgress(d);
  assert.ok(html.includes(`残り ${n01} 件`));
  assert.ok(!html.includes('発注完了'));
  assert.ok(html.includes('内示 未着'));
  for (const bad of BAD) assert.ok(!html.includes(bad), `進捗に「${bad}」`);

  // f01 を 1 件だけ動かす → 残り n−1
  const f01Items = d.todos.filter((x) => x.folderId === 'f01');
  setStatus(taskKey(f01Items[0]), '発注済・回答待ち', '', f01Items[0]);
  assert.equal(progressSummary(d).find((s) => s.folderId === 'f01').remaining, n01 - 1);
  assert.ok(renderProgress(d).includes(`残り ${n01 - 1} 件`));
  // f01 を全部 発注済・入荷待ち・完了・見送り のどれかに → 発注完了
  f01Items.forEach((t, i) => setStatus(taskKey(t), ['発注済・回答待ち', '入荷待ち', '完了', '見送り'][i % 4], '', t));
  sums = progressSummary(d);
  const f01b = sums.find((s) => s.folderId === 'f01');
  assert.equal(f01b.remaining, 0); assert.equal(f01b.done, true);
  assert.equal(f01b.counts['内示待ち'], 0);
  assert.equal(f01b.counts['発注済・回答待ち'] + f01b.counts['入荷待ち'] + f01b.counts['完了'] + f01b.counts['見送り'], n01);
  // 見送りから 内示待ち に戻すと「残り 1 件」に戻る
  const back = f01Items.find((t) => getStatus(taskKey(t)) === '見送り');
  setStatus(taskKey(back), '内示待ち', '', back);
  assert.equal(progressSummary(d).find((s) => s.folderId === 'f01').remaining, 1);
  setStatus(taskKey(back), '見送り', '', back);
  html = renderProgress(d);
  assert.ok(html.includes('pill ok">発注完了'), '緑の「発注完了」');
  assert.ok(html.includes('履歴'));
  assert.ok(html.includes('内示待ち → <b>発注済・回答待ち</b>'));
  // ほかの案件はまだ残っている
  const f02 = sums.find((s) => s.folderId === 'f02');
  assert.ok(f02.remaining > 0 && !f02.done);
  assert.ok(html.includes(`残り ${f02.remaining} 件`));

  // 案件を 1 つ選ぶと、その案件だけ
  const one = getDemoData({ folder: 'f02' });
  const s2 = progressSummary(one);
  assert.equal(s2.length, 1); assert.equal(s2[0].folderId, 'f02');
  const h2 = renderProgress(one);
  assert.ok(h2.includes('<article') && h2.includes('data-todo='));
  for (const bad of BAD) assert.ok(!h2.includes(bad));
});

test('札は状態の名前と key を持つ', () => {
  const t = all().todos[0];
  const html = statusChip(taskKey(t), t);
  assert.ok(html.includes(`data-task="${taskKey(t)}"`));
  assert.ok(html.includes(initialStatus(t)));
  assert.ok(html.includes('class="pill'));
});

test('発注書: parts の数字・案件・差出人・メーカー担当者が入る。masters が無くても空欄で動く', () => {
  const d = getDemoData({ folder: 'f01' });
  const t = d.todos.find((x) => taskType(x) === '手配' && x.code === 'ISE1176');
  assert.ok(t);
  const part = d.parts.find((p) => p.code === 'ISE1176');
  const today = new Date(2026, 9, 6);
  const o = order.buildOrder(t, d, today);
  assert.equal(o.date, '2026/10/6');
  assert.equal(o.to, '東和光学');
  assert.equal(o.code, 'ISE1176');
  assert.equal(o.name, part.name);
  assert.equal(o.qty, part.order);
  assert.equal(o.due, part.due);
  assert.equal(o.project, '第2工場 外観検査ライン増設');
  assert.equal(o.model, 'VIS-200');
  assert.equal(o.customer, '株式会社大和精密製作所');
  assert.equal(o.sender, 'ACS株式会社 購買部 高橋');
  assert.ok(o.note.includes(`${part.late}日遅れ`));
  // src/masters.js の SUPPLIERS（架空）から担当者・連絡先・注意
  const sup = d.masters.suppliers.find((s) => s.maker === '東和光学');
  assert.ok(sup, 'masters.suppliers に 東和光学 がある');
  assert.equal(o.contact, sup.person); assert.equal(o.email, sup.email); assert.equal(o.tel, '');
  assert.ok(o.note.includes(sup.note));
  const text = order.orderText(o);
  for (const must of ['発注書', '東和光学', 'ISE1176', `${part.order}個`, part.due, '高橋', sup.person, sup.email]) assert.ok(text.includes(must), `文字に「${must}」が無い`);
  for (const bad of BAD) assert.ok(!text.includes(bad));

  // masters が無い → 空欄のまま
  const o0 = order.buildOrder(t, { ...d, masters: undefined }, today);
  assert.equal(o0.contact, ''); assert.equal(o0.tel, ''); assert.equal(o0.email, '');
  assert.ok(!o0.note.includes('メーカー窓口'));
  assert.equal(o0.qty, part.order);

  // 配列の masters.suppliers（別名の項目でも読める）
  const d2 = { ...d, masters: { suppliers: [{ maker: '東和光学', contact: '山田', tel: '03-0000-0000', email: 'yamada@example.test' }] } };
  const o2 = order.buildOrder(t, d2, today);
  assert.equal(o2.contact, '山田'); assert.equal(o2.tel, '03-0000-0000'); assert.equal(o2.email, 'yamada@example.test');
  assert.ok(order.orderText(o2).includes('山田'));
  // 辞書の masters.suppliers
  const d3 = { ...d, masters: { suppliers: { 東和光学: { 担当者: '佐藤', 電話: '03-1111-1111' } } } };
  const o3 = order.buildOrder(t, d3, today);
  assert.equal(o3.contact, '佐藤'); assert.equal(o3.tel, '03-1111-1111');
  // masters が無くても落ちない
  assert.doesNotThrow(() => order.buildOrder(t, { todos: d.todos }, today));
});
