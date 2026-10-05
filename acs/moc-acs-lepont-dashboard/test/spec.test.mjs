// 画面の宣言（getDemoData）の書き間違いを、公開前に見つけるテスト。
// どのモックでもそのまま使える（中身の業種には依存しない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAiData, getDemoData } from '../src/data.js';

const d = getDemoData();
const TYPES = new Set(['stacked', 'line', 'bars', 'hbars', 'table', 'cards']);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

test('置き換え忘れ（ACS株式会社 など）がない', () => {
  const found = JSON.stringify(d).match(/__[A-Z_]+__/g);
  assert.equal(found, null, `置き換え忘れ: ${found}`);
});

test('上部の数字（kpis）は2〜4個で、値と単位がある', () => {
  assert.ok(d.kpis.length >= 2 && d.kpis.length <= 4, `kpis は ${d.kpis.length} 個`);
  for (const k of d.kpis) {
    assert.ok(k.label, 'label がない');
    assert.ok(num(k.value) || typeof k.value === 'string', `${k.label}: value が数字でも文字でもない`);
    if (k.delta != null) assert.ok(num(k.delta), `${k.label}: delta が数字でない`);
    if (k.spark) assert.ok(k.spark.every(num), `${k.label}: spark に数字以外`);
  }
});

test('気づき（insights）は AI への質問付き', () => {
  for (const it of d.insights ?? []) {
    assert.ok(it.tag && it.head && it.fig != null && it.question, `気づき「${it.head}」に tag / head / fig / question が足りない`);
    assert.ok(!/__[A-Z_]+__/.test(it.question), '置き換え忘れ');
  }
});

test('グラフの宣言が正しい（種類・長さ・数字）', () => {
  assert.ok(d.sections.length > 0);
  const ids = d.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `区画 id が重複: ${ids}`);
  assert.ok(Array.isArray(d.examples ?? []), 'examples は質問の配列にする');
  for (const s of d.sections) {
    assert.ok(/^[a-z0-9-]+$/.test(s.id), `区画 id「${s.id}」は英小文字・数字・ハイフンで`);
    assert.ok(s.title, `区画「${s.id}」に title がない`);
    for (const c of s.cards) {
      assert.ok(c.title, `区画「${s.title}」に title のないカードがある`);
      const ch = c.chart;
      const where = `${s.title} / ${c.title}`;
      assert.ok(ch && TYPES.has(ch.type), `${where}: chart.type が不正`);
      if (['stacked', 'line', 'bars'].includes(ch.type)) assert.ok(ch.labels?.length > 1, `${where}: labels がない`);
      if (ch.type === 'stacked') {
        assert.equal(ch.rows.length, ch.labels.length, `${where}: rows と labels の数が違う`);
        for (const r of ch.rows) for (const k of ch.keys) assert.ok(num(r[k]), `${where}: ${k} に数字以外`);
        if (ch.max === 100) for (const r of ch.rows) assert.ok(Math.abs(ch.keys.reduce((a, k) => a + r[k], 0) - 100) < 0.6, `${where}: 100%積み上げの合計が100でない`);
      }
      if (ch.type === 'line') {
        for (const sr of ch.series) {
          assert.equal(sr.values.length, ch.labels.length, `${where}: ${sr.name} の長さが labels と違う`);
          assert.ok(sr.values.every((v) => v === null || num(v)), `${where}: ${sr.name} に数字・null 以外`);
          assert.ok(sr.values.some(num), `${where}: ${sr.name} の値が全部空`);
          if (ch.max != null) assert.ok(sr.values.every((v) => v === null || v <= ch.max), `${where}: ${sr.name} に max（${ch.max}）を超える値`);
          if (ch.min != null) assert.ok(sr.values.every((v) => v === null || v >= ch.min), `${where}: ${sr.name} に min（${ch.min}）より小さい値`);
        }
        for (const mk of ch.marks ?? []) {
          assert.ok(mk.i >= 0 && mk.i < ch.labels.length, `${where}: marks の i が範囲外`);
          assert.ok(num(ch.series[mk.series ?? 0]?.values[mk.i]), `${where}: marks が値のない点を指している`);
        }
      }
      if (ch.type === 'bars') {
        assert.equal(ch.values.length, ch.labels.length, `${where}: values の長さが labels と違う`);
        assert.ok(ch.values.every(num), `${where}: values に数字以外（入荷のない月などは 0 にする）`);
        if (ch.max != null) assert.ok(ch.values.every((v) => v <= ch.max), `${where}: max を超える値`);
      }
      if (ch.type === 'stacked' && ch.max != null && ch.max !== 100) {
        for (const r of ch.rows) assert.ok(ch.keys.reduce((a, k) => a + r[k], 0) <= ch.max, `${where}: 合計が max（${ch.max}）を超える`);
      }
      if (ch.type === 'hbars') assert.ok(ch.rows.every((r) => r.name && num(r.value)), `${where}: rows に name / value が足りない`);
      if (ch.type === 'table') assert.ok(ch.rows.every((r) => r.length === ch.columns.length), `${where}: 列の数が合わない`);
      if (ch.type === 'cards') assert.ok(ch.items.every((it) => num(it.count) && it.title), `${where}: items に count / title が足りない`);
    }
  }
});

test('AI に渡すデータは短め（費用と速さのため）', () => {
  const size = JSON.stringify(getAiData()).length;
  assert.ok(size < 30000, `AI に渡すデータが ${size} 文字。30,000 文字未満にする`);
});
