// 複数の内示（CSV）を 1 つにまとめる（public/util.js の mergeCsv）
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCsv, parseCsv } from '../public/util.js';

const H = '内示日,得意先,案件,機種,数量,納入希望日,仕様,備考';
test('案件が同じ行は後のものに置き換わり、違う案件は足される', () => {
  const a = `${H}\n2026-09-25,大和,第2工場 外観検査ライン増設,VIS-200,3,2026-11-14,NG排出シュート,"3号機, 追加"\n2026-09-25,大和,組立セル AS-500 導入,AS-500,2,2026-10-15,ライトカーテン仕様,`;
  const b = `${H}\n2026-09-26,大和,組立セル AS-500 導入,AS-500,3,2026-10-15,ライトカーテン仕様,電話で 3台に\n2026-09-26,大和,クリーン仕様 搬送ユニット,CV-CL,0,,,取消`;
  const rows = parseCsv(mergeCsv([{ name: 'a', csvText: a }, { name: 'b', csvText: b }]));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].join(','), H);
  assert.deepEqual(rows[1].slice(2, 5), ['第2工場 外観検査ライン増設', 'VIS-200', '3']);
  assert.equal(rows[1][7], '3号機, 追加');
  assert.deepEqual(rows[2].slice(2, 5), ['組立セル AS-500 導入', 'AS-500', '3']);
  assert.deepEqual(rows[3].slice(2, 5), ['クリーン仕様 搬送ユニット', 'CV-CL', '0']);
});
test('引用符・改行・BOM を正しく読む', () => {
  const rows = parseCsv('\uFEFFa,b\r\n"x, ""y""",2\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, "y"', '2']]);
});
