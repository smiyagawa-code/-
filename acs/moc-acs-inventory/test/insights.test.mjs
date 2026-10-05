// 仕込んだ気づきが、数字を直してもデータに残っていることを確かめる（src/data.js 冒頭の A〜D）
import test from 'node:test';
import assert from 'node:assert/strict';
import { _build, getDemoData } from '../src/data.js';

const b = _build();
const f = (id) => b.folders.find((x) => x.id === id);
const part = (id, code) => f(id).parts.find((p) => p.code === code);

test('A. 第2工場: 2台→3台。ISE1176 はメーカーの遅れ連絡が重なり希望日に遅れる', () => {
  const f01 = f('f01');
  assert.equal(f01.versions.aug.qty, 2);
  assert.equal(f01.versions.sep.qty, 3);
  assert.ok(f01.changes.some((c) => c.kind === '増えた'));
  const p = part('f01', 'ISE1176');
  assert.ok(p.delay > 0 && p.late > 0 && p.urgent);
  assert.ok(p.why.some((l) => /＋ 納期 \d+日 ＋ 遅れ連絡 \d+日 ＝ .* に届く/.test(l)));
  assert.ok(p.why.some((l) => /＝ \d+日遅れ$/.test(l)));
});

test('B. 組立セル: 前倒し＋安全柵→ライトカーテン。AS-06-148 が新たに必要で遅れ、安全柵の頼み済み分が余る', () => {
  const f02 = f('f02');
  assert.ok(f02.changes.some((c) => c.kind === '前倒し'));
  const opt = f02.changes.find((c) => c.kind === '仕様変更');
  assert.ok(opt && opt.affected.includes('AS-06-148') && opt.affected.includes('FR-SG'));
  const lc = part('f02', 'AS-06-148');
  assert.equal(lc.needAug, 0);
  assert.ok(lc.needSep > 0 && lc.late > 0);
  assert.ok(f02.excess.some((e) => e.code === 'FR-SG' && e.excess === 2));
});

test('C. クリーン仕様: 取消。頼み済み分が余り、RB-120 は第2工場へ回せる', () => {
  const f03 = f('f03');
  assert.equal(f03.versions.sep.qty, 0);
  assert.ok(f03.changes.some((c) => c.kind === '取消'));
  assert.ok(f03.excess.length >= 3);
  const rb = f03.excess.find((e) => e.code === 'RB-120');
  assert.ok(rb && rb.transfer.some((t) => t.folderId === 'f01' && t.short > 0));
  assert.ok(f03.todos.some((t) => t.kind === '社内で決める' && /回せる/.test(t.sub)));
});

test('D. AS-04-237 は 3案件で共用。第2工場で足りない → 単位 20 で切り上げ', () => {
  const users = b.folders.filter((x) => x.parts.some((p) => p.code === 'AS-04-237'));
  assert.equal(users.length, 3);
  const p = part('f01', 'AS-04-237');
  assert.ok(p.short > 0 && p.order % 20 === 0 && p.order >= p.short);
  assert.ok(p.why.some((l) => /まとめ買いの単位 20個 → 20個手配/.test(l)));
});

test('やることの導線: 遅れ（赤）→ 余る（黄）→ 確認（青）の順。文面は数字入り', () => {
  const d = getDemoData();
  const tones = d.todos.map((t) => t.tone);
  const order = { red: 0, amber: 1, blue: 2 };
  for (let i = 1; i < tones.length; i++) assert.ok(order[tones[i]] >= order[tones[i - 1]], '赤→黄→青の順でない');
  assert.ok(d.todos.some((t) => t.kind === 'メーカーに連絡' && t.draft));
  assert.ok(d.todos.some((t) => t.kind === 'お客様に連絡' && /間に合わない/.test(t.what)));
  assert.ok(d.todos.some((t) => t.kind === 'お客様に確認'));
  const mk = d.todos.find((t) => t.kind === 'メーカーに連絡' && t.tone === 'red');
  assert.match(mk.draft.body, /\d+個/);
  assert.match(mk.draft.body, /ACS株式会社 購買部 高橋/);
});

test('内示の読み取り札: 変わった項目だけに印', () => {
  const d = getDemoData({ folder: 'f02' });
  const r = d.readings[0];
  assert.deepEqual(r.chips.map((c) => [c.label, c.changed]), [['台数', false], ['希望日', true], ['仕様', true], ['確かめること', true]]);
});
