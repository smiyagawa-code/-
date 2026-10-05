// 仕込んだ「気づき」がデータに残っているかを確かめる（数字を直して気づきが消えるのを防ぐ）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoData, _roundUnit, _ITEM } from '../src/data.js';

const q = (id) => getDemoData({ folder: id }).requests[0];
const line = (r, label) => r.lines.find((l) => l.label === label);

test('A. みなと浄水場: CV 14sq-3C が 2 ページに分かれ、合算して 300m', () => {
  const r = q('q01');
  const l = line(r, 'CV 14sq-3C');
  assert.equal(l.qty, 300);
  assert.equal(l.qtyParts.length, 2);
  assert.ok(r.alerts.some((a) => a.kind === '合算' && /180m.*120m.*300m/.test(a.text)));
  assert.equal(r.lines.filter((x) => x.label === 'CV 14sq-3C').length, 1, '合算後は 1 行');
});

test('B. みなと浄水場: 芯数なし「CV 8 ×60m」と「〃 -2C」が要確認', () => {
  const r = q('q01');
  const a = line(r, 'CV 8sq-3C');
  const b = line(r, 'CV 8sq-2C');
  assert.match(a.alert, /芯数の記載がありません/);
  assert.match(a.guess, /3C/);
  assert.match(b.alert, /「〃」/);
  assert.ok(r.alerts.filter((x) => x.kind === '明細').length >= 3, '要確認が 3 件以上（芯数なし・〃・かすれ）');
  assert.ok(r.alerts.some((x) => x.kind === '件名'), '件名の要確認（ファイル名に件名なし）');
});

test('C. 細物の端数: EM-IE 2.0sq は小数第 1 位まで、5.5sq は 100 円超で切上、弱電線は単価表の値', () => {
  const r = q('q01');
  assert.equal(line(r, 'EM-IE 2.0sq').unit, 73.1);
  assert.match(line(r, 'EM-IE 2.0sq').roundLabel, /小数第 1 位/);
  assert.equal(line(r, 'EM-IE 5.5sq').unit, 181);
  assert.match(line(r, 'EM-IE 5.5sq').roundLabel, /100 円\/m 超/);
  assert.equal(line(r, 'FCPEV 0.9mm-5P').unit, 420);
  assert.match(line(r, 'FCPEV 0.9mm-5P').roundLabel, /単価表の値/);
  assert.equal(line(q('q02'), 'EM-IE 1.6mm').unit, 52.8, 'ランク B の 1.6mm');
  // 端数処理そのもの
  assert.equal(_roundUnit(73.08, _ITEM.em2).value, 73.1);
  assert.equal(_roundUnit(73.1, _ITEM.em2).value, 73.1);
  assert.equal(_roundUnit(180.96, _ITEM['em5.5']).value, 181);
  assert.equal(_roundUnit(1260, _ITEM['cv14-3']).value, 1260);
  assert.equal(_roundUnit(1260.01, _ITEM['cv14-3']).value, 1261);
});

test('D. 北陽電線の 10 月版で CV 系が約 +3%。前版のままなら CV 38sq-3C は 95 円/m 安い', () => {
  const r = q('q01');
  const l = line(r, 'CV 38sq-3C');
  assert.ok(l.priceChanged);
  assert.equal(l.priceChangePct, 3.3);
  assert.equal(l.unit, 2980);
  assert.equal(l.unit - l.unitPrev, 95);
  assert.ok(r.alerts.some((a) => a.kind === '単価表' && /CV 38sq-3C/.test(a.text) && /95 円/.test(a.text)));
  const d = getDemoData();
  assert.ok(d.priceDiff.length >= 4 && d.priceDiff.every((x) => x.pct > 0));
  assert.ok(d.makers.some((m) => /未着/.test(m.status)) && d.makers.some((m) => /要確認/.test(m.status)));
  assert.equal(d.makers.length, 20);
  assert.equal(d.makers.filter((m) => m.cycle === '毎月').length, 10, '毎月更新は 10 社');
});

test('E. 高台配水池: CVT 100sq は在庫品でないので直送、重量物の注記が見積書に付く', () => {
  const r = q('q03');
  const l = line(r, 'CVT 100sq');
  assert.equal(l.route, 'direct');
  assert.ok(!l.stocked);
  assert.ok(l.heavy && l.weightKg > 1000);
  assert.ok(r.sheet.rows.some((x) => x.kind === 'note' && /重量物/.test(x.text) && /受け取り可否/.test(x.text)));
  assert.ok(r.sheet.rows.some((x) => x.kind === 'note' && /直送/.test(x.text)));
  assert.match(line(r, 'CV 22sq-3C').alert, /不鮮明/);
});

test('F. 同じ品目でも拠点で掛率が違う／在庫不足は補填前提で「在庫」のまま', () => {
  const f = line(q('q01'), 'CV 14sq-3C');
  const o = line(getDemoData({ folder: 'q01', site: 'osaka' }).requests[0], 'CV 14sq-3C');
  assert.equal(f.rate, 0.56);
  assert.equal(o.rate, 0.54);
  const cv38 = line(q('q01'), 'CV 38sq-3C');
  assert.equal(cv38.route, 'stock');
  assert.ok(cv38.stock < cv38.qty);
  assert.ok(q('q01').alerts.some((a) => a.kind === '在庫' && /CV 38sq-3C/.test(a.text) && /補填/.test(a.text)));
});

test('倉庫棟: 数量の内訳（100m×3本）が見積書に残り、備考に 100m巻', () => {
  const r = q('q02');
  const l = line(r, 'IV 5.5sq');
  assert.equal(l.qty, 300);
  assert.equal(l.breakdown, '100m×3本');
  const row = r.sheet.rows.find((x) => x.kind === 'item' && x.name === 'IV 5.5sq');
  assert.match(row.qtyLabel, /300（100m×3本）/);
  assert.equal(row.remark, '100m巻');
  assert.equal(r.rank, 'B');
});

test('回答済みの依頼は承認・送付の記録を持ち、保留の依頼は明細がない', () => {
  const a = q('q04');
  assert.equal(a.status, 'answered');
  assert.ok(a.approvedBy && a.answered && a.shareUrl);
  assert.ok(a.sheet.workflow.every((w) => w.done));
  const p = q('q05');
  assert.ok(p.pending && p.lines.length === 0);
});
