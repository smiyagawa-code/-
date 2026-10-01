import test from 'node:test';
import assert from 'node:assert/strict';
import { getAiData, getDemoData } from '../src/data.js';

const ai = getAiData();

test('① 9月に不足する品目がある（突き合わせ）', () => {
  const s = ai['9月に不足する品目'];
  assert.ok(s.length >= 30, `9月不足が少なすぎる: ${s.length}`);
  for (const i of s) assert.ok(i['9月の不足_数量'] > 0);
});

test('② 1週間以内に発注が必要な品目がある', () => {
  const urgent = ai['9月に不足する品目'].filter((i) => i.急ぎ);
  assert.ok(urgent.length >= 5, `急ぎが少なすぎる: ${urgent.length}`);
  assert.ok(urgent.every((i) => i.発注期限 <= '2026-09-12'));
});

test('③ 内示の差分: 配管ユニットBが増え、制御盤No.2が減り、省スペース搬送ユニットの11月が新規', () => {
  const d = Object.fromEntries(ai['内示の差分_用途設備別_数量'].map((r) => [r.用途設備, r]));
  assert.ok(d['配管ユニットB'].差_10月 > 0);
  assert.ok(d['制御盤No.2'].差_10月 < 0);
  assert.equal(d['省スペース搬送ユニット'].前回_11月, 0);
  assert.ok(d['省スペース搬送ユニット'].今回_11月 > 0);
});

test('④ 出荷が伸びている品目の多くが、9月か10月に不足する', () => {
  assert.ok(ai.出荷が伸びている品目数 >= 40);
  assert.ok(ai['出荷が伸びていて9月か10月に不足する品目数'] / ai.出荷が伸びている品目数 >= 0.8);
});

test('AI には「予測ではない」ことを伝えている', () => {
  assert.match(ai.note, /予測したものではありません/);
});

test('出荷実績のピークは3月', () => {
  const m = ai.出荷実績_メーカー別_月別_数量;
  const tot = (r) => r.SMC + r.東和空圧工業 + r.中央精密機器;
  const peak = m.reduce((a, b) => (tot(b) > tot(a) ? b : a));
  assert.equal(peak.month, '2026-03');
  assert.ok(Math.max(...m.map(tot)) <= 8000, 'グラフの max(8000) を超えた');
  assert.ok(getDemoData().sections.length === 4);
});
