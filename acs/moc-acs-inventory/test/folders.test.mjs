// 画面で作った案件（folders）: 同じ機種の部品表で計算に加わり、内示は案件名で当てはまる
import test from 'node:test';
import assert from 'node:assert/strict';
import { _build, getDemoData, getAiData, normalizeFolders, findFolder, folderList } from '../src/data.js';

const NEW = { customer: '株式会社大和精密製作所', name: '第3工場 検査ライン新設', model: 'VIS-200', qty: 2, due: '2026-12-10', date: '2026-09-30', options: [], note: '予算承認は 10 月中' };

test('登録した案件が一覧に増え、同じ機種の部品表で部品・やることが出る（前回＝今回なので変わった点はない）', () => {
  const b = _build(undefined, null, null, [NEW]);
  const f = b.folders.find((x) => x.id === 'u1');
  assert.ok(f && !f.pending && f.user);
  assert.equal(f.customer, NEW.customer);
  assert.ok(f.parts.length > 0, '部品表が流用される');
  assert.equal(f.changes.length, 0);
  assert.ok(f.parts.every((p) => p.short === p.needSep), '引き当て済みは無いので いる数 ＝ 足りない');
  const d = getDemoData({ folder: 'u1', folders: [NEW] });
  assert.ok(d.folders.some((x) => x.id === 'u1'));
  assert.ok(d.todos.length > 0);
  assert.ok(getAiData({ folder: 'u1', folders: [NEW] }));
});

test('台数・希望日が無いときは「内示を待っています」で登録され、内示 CSV が案件名で当てはまる（初回なので前回＝今回）', () => {
  const waiting = { ...NEW, qty: null, due: '' };
  const b0 = _build(undefined, null, null, [waiting]);
  assert.match(b0.folders.find((x) => x.id === 'u1').pending, /内示を待っています/);
  const csv = '内示日,得意先,案件,機種,数量,納入希望日,仕様,備考\n2026-10-03,株式会社大和精密製作所,第3工場 検査ライン新設,VIS-200,3,2026-11-28,NG排出シュート,前倒し';
  const b1 = _build(undefined, csv, null, [waiting]);
  const f = b1.folders.find((x) => x.id === 'u1');
  assert.ok(!f.pending && f.fromCsv && f.firstVersion);
  assert.equal(f.versions.sep.qty, 3);
  assert.equal(b1.csv.matched[0].folderId, 'u1');
  // 既存の第2工場（同じ機種 VIS-200）には当てはまらない
  assert.ok(!b1.folders.find((x) => x.id === 'f01').fromCsv);
});

test('登録済みの案件に新しい内示が来ると、前回（登録時）との差分が出る', () => {
  const csv = '内示日,得意先,案件,機種,数量,納入希望日,仕様,備考\n2026-10-03,株式会社大和精密製作所,第3工場 検査ライン新設,VIS-200,3,2026-11-28,NG排出シュート,前倒し';
  const f = _build(undefined, csv, null, [NEW]).folders.find((x) => x.id === 'u1');
  const kinds = f.changes.map((c) => c.kind);
  assert.ok(kinds.includes('増えた') && kinds.includes('前倒し') && kinds.includes('仕様変更'), kinds.join(','));
});

test('機種が同じ案件が複数あるとき、案件名の無い行は当てはめない。案件名があれば案件名で', () => {
  const all = folderList([NEW]);
  assert.equal(findFolder({ model: 'VIS-200', name: '' }, all), null);
  assert.equal(findFolder({ model: 'VIS-200', name: '第2工場 外観検査ライン増設' }, all).id, 'f01');
  assert.equal(findFolder({ model: 'AS-500', name: '' }, all).id, 'f02');
});

test('おかしな案件は無視する（必須が無い・知らない機種は部品表なしで保留）', () => {
  assert.equal(normalizeFolders([{ name: 'x' }, null, 'a']).length, 0);
  const f = _build(undefined, null, null, [{ ...NEW, model: 'ZZ-9' }]).folders.find((x) => x.id === 'u1');
  assert.match(f.pending, /部品表/);
});
