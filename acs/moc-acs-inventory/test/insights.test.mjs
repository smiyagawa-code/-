// 仕込んだ気づきが、数字を直してもデータに残っていることを確かめる（src/data.js 冒頭の A〜D）
import test from 'node:test';
import assert from 'node:assert/strict';
import { _build, getDemoData } from '../src/data.js';

const b = _build();
const f = (id) => b.folders.find((x) => x.id === id);
const part = (id, code) => f(id).parts.find((p) => p.code === code);

test('A. 第2工場: 2台→3台。ISE1176 はメーカー案内の遅れが重なり希望納期に遅れる', () => {
  const f01 = f('f01');
  assert.equal(f01.versions.aug.qty, 2);
  assert.equal(f01.versions.sep.qty, 3);
  assert.ok(f01.changes.some((c) => c.kind === '増量'));
  const p = part('f01', 'ISE1176');
  assert.ok(p.delay > 0, 'メーカー案内の遅れがある');
  assert.ok(p.late > 0, `遅れていない: ${p.late}`);
  assert.ok(p.urgent, '急ぐ');
  assert.match(p.basis.eta, /基準日 .* ＋ リードタイム \d+日 ＋ メーカー案内の遅れ \d+日 ＝ 入手見込み/);
  assert.match(p.basis.late, /＝ \d+日の遅れ/);
});

test('B. 組立セル: 前倒し＋安全柵→ライトカーテン。AS-06-148 が新たに必要で遅れ、安全柵の発注残が過剰', () => {
  const f02 = f('f02');
  assert.ok(f02.changes.some((c) => c.kind === '前倒し'));
  const opt = f02.changes.find((c) => c.kind === 'オプション');
  assert.ok(opt && opt.affected.includes('AS-06-148') && opt.affected.includes('FR-SG'));
  const lc = part('f02', 'AS-06-148');
  assert.equal(lc.needAug, 0);
  assert.ok(lc.needSep > 0 && lc.late > 0);
  assert.ok(f02.excess.some((e) => e.code === 'FR-SG' && e.excess === 2));
});

test('C. クリーン仕様: 取消。発注残が過剰になり、RB-120 は第2工場へ振替候補', () => {
  const f03 = f('f03');
  assert.equal(f03.versions.sep.qty, 0);
  assert.ok(f03.changes.some((c) => c.kind === '取消'));
  assert.ok(f03.excess.length >= 3);
  const rb = f03.excess.find((e) => e.code === 'RB-120');
  assert.ok(rb && rb.transfer.some((t) => t.folderId === 'f01' && t.short > 0));
  assert.ok(f03.actions.some((a) => a.kind === '過剰になる発注残の扱い' && /振替候補/.test(a.body)));
});

test('D. AS-04-237 は 3案件で共用。第2工場で不足 → ロット 20 で切り上げ', () => {
  const users = b.folders.filter((x) => x.parts.some((p) => p.code === 'AS-04-237'));
  assert.equal(users.length, 3);
  const p = part('f01', 'AS-04-237');
  assert.ok(p.short > 0 && p.order % 20 === 0 && p.order >= p.short);
  assert.match(p.basis.order, /ロット 20 の倍数に切り上げ/);
});

test('変更点の導線: 内示の変更点 → 影響部品 → 過剰 → 次のアクション が全案件で出る', () => {
  const d = getDemoData();
  assert.equal(d.defaultTab, 'changes');
  assert.ok(d.changes.length >= 4);
  assert.ok(d.changes.every((c) => c.affected.length > 0 || c.kind === 'オプション'), '影響部品のない変更点');
  assert.ok(d.excess.length >= 3);
  assert.ok(d.actions.some((a) => a.kind === 'お客様への納期ご相談'));
  assert.ok(d.actions.some((a) => a.kind === 'メーカーへの手配・納期確認'));
});
