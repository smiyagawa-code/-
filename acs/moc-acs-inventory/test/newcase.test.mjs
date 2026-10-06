// 新しい案件を作る（public/newcase.js）。下書きの作成と検査の純関数だけを見る。窓は開かない。
import test from 'node:test';
import assert from 'node:assert/strict';

// 偽の localStorage（newcase.js → tasks.js → store.js が読む）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { draftFromCsv, draftsFromCsv, checkCase, isDuplicate, modelOptions, customerOptions, today, toDate, splitOptions } = await import('../public/newcase.js');

const HEADER = '内示日,得意先,案件,機種,数量,納入希望日,仕様,備考';

test('draftFromCsv: 2 行目から下書きを作る（引用符・カンマ入り）', () => {
  const csv = `${HEADER}\n2026-09-25,株式会社大和精密製作所,"第2工場 外観検査ライン増設",VIS-200,3,2026-11-14,NG排出シュート・安全柵,"3号機は増産対応のため追加。できれば 11/7, 早めに"`;
  const d = draftFromCsv(csv);
  assert.deepEqual(d, {
    customer: '株式会社大和精密製作所',
    name: '第2工場 外観検査ライン増設',
    model: 'VIS-200',
    qty: 3,
    due: '2026-11-14',
    options: ['NG排出シュート', '安全柵'],
    note: '3号機は増産対応のため追加。できれば 11/7, 早めに',
    date: '2026-09-25',
  });
});

test('draftFromCsv: 空欄は null / 空文字。内示日が無ければ今日', () => {
  const d = draftFromCsv(`${HEADER}\n,大和精密,組立セル,AS-500,,,,`);
  assert.equal(d.qty, null);
  assert.equal(d.due, '');
  assert.deepEqual(d.options, []);
  assert.equal(d.note, '');
  assert.equal(d.date, today());
  // 2 行目が無い
  const e = draftFromCsv(HEADER);
  assert.equal(e.customer, '');
  assert.equal(e.qty, null);
  assert.equal(e.date, today());
});

test('draftsFromCsv: 複数行。空行は飛ばす。列の順が違っても見出しで拾う', () => {
  const csv = `${HEADER}\n2026-09-25,大和精密,案件A,VIS-200,3,2026-11-14,,\n\n2026-09-25,大和精密,案件B,AS-500,2,2026/10/15,ライトカーテン仕様,前倒し\n`;
  const ds = draftsFromCsv(csv);
  assert.equal(ds.length, 2);
  assert.equal(ds[0].name, '案件A');
  assert.equal(ds[1].name, '案件B');
  assert.equal(ds[1].due, '2026-10-15');
  assert.equal(draftFromCsv(csv).name, '案件A');
  const swapped = '案件,機種,得意先,数量\n案件C,VIS-200,大和精密,4';
  const s = draftFromCsv(swapped);
  assert.equal(s.name, '案件C');
  assert.equal(s.model, 'VIS-200');
  assert.equal(s.customer, '大和精密');
  assert.equal(s.qty, 4);
});

test('checkCase: 得意先・案件名・機種は必須', () => {
  const r = checkCase({ customer: '', name: ' ', model: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['customer', 'model', 'name']);
  for (const m of Object.values(r.errors)) assert.match(m, /ください/);
});

test('checkCase: 台数は 0 以上の整数か空。日付は yyyy-mm-dd', () => {
  const base = { customer: '大和精密', name: '新規', model: 'VIS-200' };
  assert.equal(checkCase({ ...base, qty: '' }).ok, true);
  assert.equal(checkCase({ ...base, qty: '' }).value.qty, null);
  assert.equal(checkCase({ ...base, qty: '0' }).value.qty, 0);
  assert.equal(checkCase({ ...base, qty: 3 }).value.qty, 3);
  assert.equal(checkCase({ ...base, qty: '1,200' }).value.qty, 1200);
  assert.equal(checkCase({ ...base, qty: '-1' }).errors.qty !== undefined, true);
  assert.equal(checkCase({ ...base, qty: '1.5' }).errors.qty !== undefined, true);
  assert.equal(checkCase({ ...base, qty: 'abc' }).errors.qty !== undefined, true);
  assert.equal(checkCase({ ...base, due: '' }).ok, true);
  assert.equal(checkCase({ ...base, due: '2026-11-14' }).value.due, '2026-11-14');
  assert.equal(checkCase({ ...base, due: '2026/11/14' }).value.due, '2026-11-14');
  assert.equal(checkCase({ ...base, due: '11/14' }).errors.due !== undefined, true);
  assert.equal(checkCase({ ...base, due: '2026-13-40' }).errors.due !== undefined, true);
});

test('checkCase: 既存と同じ 得意先＋案件名 なら止める', () => {
  const existing = [{ customer: '株式会社大和精密製作所', name: '第2工場 外観検査ライン増設' }, { name: '組立セル AS-500 導入' }];
  const r = checkCase({ customer: '株式会社大和精密製作所', name: '第2工場 外観検査ライン増設', model: 'VIS-200' }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.errors.name, '同じ名前の案件があります');
  // 得意先が違えば通る
  assert.equal(checkCase({ customer: '別の会社', name: '第2工場 外観検査ライン増設', model: 'VIS-200' }, existing).ok, true);
  // 得意先の無い既存（masters.folders）は案件名だけで見る
  assert.equal(checkCase({ customer: '誰でも', name: '組立セル AS-500 導入', model: 'AS-500' }, existing).ok, false);
  assert.equal(isDuplicate({ customer: '', name: '' }, existing), false);
  assert.equal(isDuplicate({ customer: '株式会社大和精密製作所', name: '第2工場  外観検査ライン増設 ' }, existing), true);
});

test('checkCase: onRegister に渡す形（options は配列、date は今日）', () => {
  const r = checkCase({ customer: ' 大和精密 ', name: '新規', model: 'VIS-200', qty: '2', due: '2026-12-01', options: 'NG排出シュート・安全柵', note: 'メモ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { customer: '大和精密', name: '新規', model: 'VIS-200', qty: 2, due: '2026-12-01', options: ['NG排出シュート', '安全柵'], note: 'メモ', date: today() });
  assert.deepEqual(checkCase({ customer: 'a', name: 'b', model: 'c', options: ['x', ' ', 'y'] }).value.options, ['x', 'y']);
  assert.match(r.value.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('候補: 機種は重複を除く。得意先も', () => {
  const data = { folders: [{ customer: 'A社', name: '1', model: 'VIS-200' }, { customer: 'A社', name: '2', model: 'AS-500' }, { customer: 'B社', name: '3', model: 'VIS-200' }], masters: { folders: [{ id: 'f1', name: '1', model: 'VIS-200' }, { id: 'f9', name: '9', model: 'RB-10' }] } };
  assert.deepEqual(modelOptions(data), ['VIS-200', 'AS-500', 'RB-10']);
  assert.deepEqual(customerOptions(data), ['A社', 'B社']);
  assert.deepEqual(modelOptions(null), []);
});

test('小道具: toDate / splitOptions', () => {
  assert.equal(toDate('2026年11月14日'), '2026-11-14');
  assert.equal(toDate('2026.1.5'), '2026-01-05');
  assert.equal(toDate('来週'), '');
  assert.deepEqual(splitOptions('A・B、C/D'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(splitOptions(''), []);
});
