// 画面向け（getDemoData）と AI 向け（getAiData）が、同じ計算結果から作られているかを確かめる。
// レビュー 2026-10-05 の指摘 1（AI の答えと表の食い違い）を二度と起こさないためのテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAiData, getDemoData, DEFAULT_BASE, BASE_DATES, _FOLDERS } from '../src/data.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const folderIds = ['all', ..._FOLDERS.map((f) => f.id)];
const CODE_RE = /[A-Z]{1,3}-?[A-Z0-9]*-?\d{2,4}(?:-\d{3})?/g;

test('置き換え忘れ（__CUSTOMER__ など）がない', () => {
  const found = JSON.stringify(getDemoData()).match(/__[A-Z_]+__/g);
  assert.equal(found, null, `置き換え忘れ: ${found}`);
});

test('AI に渡す型番は、同じフォルダの表に出ている型番だけ（存在しない型番を AI が言わない）', () => {
  for (const folder of folderIds) {
    const d = getDemoData({ folder });
    const tableCodes = new Set(d.parts.map((r) => r.code));
    const ai = getAiData({ folder });
    const aiCodes = new Set(ai.案件.flatMap((a) => (a.部品 || []).map((p) => p.型番)));
    assert.deepEqual([...aiCodes].sort(), [...tableCodes].sort(), `${folder}: AI と「部品の一覧」の型番が違う`);
    for (const a of ai.案件) {
      const f = _FOLDERS.find((x) => x.name === a.案件);
      const bom = new Set((f.bom || []).map(([c]) => c));
      for (const p of a.部品 || []) assert.ok(bom.has(p.型番), `${a.案件}: AI に BOM 外の型番 ${p.型番}`);
    }
  }
});

test('AI に渡す数字は、表の数字と一致する（足りない・手配・届く日・遅れ・なぜ）', () => {
  for (const folder of folderIds) {
    const d = getDemoData({ folder });
    const ai = getAiData({ folder });
    const aiParts = new Map(ai.案件.flatMap((a) => (a.部品 || []).map((p) => [`${a.案件}/${p.型番}`, p])));
    for (const r of d.parts) {
      const p = aiParts.get(`${r.folderName}/${r.code}`);
      assert.ok(p, `${r.folderName}/${r.code} が AI にない`);
      assert.equal(p.足りない数_個, r.short);
      assert.equal(p.手配する数_個, r.order);
      assert.equal(p.今回いる数_個, r.needSep);
      if (r.eta) assert.equal(p.遅れ_日, r.late);
      assert.equal(p.状態, r.status);
      assert.deepEqual(p.なぜ, r.why, '「なぜ」の文が画面と AI で違う');
    }
    // やることも同じ
    const aiTodos = ai.案件.flatMap((a) => a.やること || []);
    assert.equal(aiTodos.length, d.todos.length, `${folder}: やることの件数が画面と AI で違う`);
  }
});

test('選択中のフォルダだけが AI に渡る（「この案件で」が他案件と混ざらない）', () => {
  for (const f of _FOLDERS) {
    const ai = getAiData({ folder: f.id });
    assert.equal(ai.案件.length, 1, `${f.id}: 案件が ${ai.案件.length} 件渡っている`);
    assert.equal(ai.案件[0].案件, f.name);
    assert.match(ai.context, new RegExp(`いま開いている案件: 「${f.name}」`));
  }
  assert.equal(getAiData().案件.length, 3, 'すべて＝内示が届いている 3 案件');
  assert.equal(getAiData({ folder: 'nope' }).案件.length, 3, '知らないフォルダ id はすべてに戻す');
});

test('質問例は短く、選択中フォルダの表にある型番だけを使う', () => {
  for (const folder of folderIds) {
    const d = getDemoData({ folder });
    assert.ok(d.examples.length >= 1, `${folder}: 質問例がない`);
    const codes = new Set(d.parts.map((r) => r.code));
    for (const q of d.examples) {
      assert.ok(q.length <= 24, `${folder}: 質問例が長い「${q}」`);
      for (const code of q.match(CODE_RE) || []) assert.ok(codes.has(code), `${folder}: 質問例「${q}」の ${code} は表にない`);
    }
  }
});

test('基準日は候補の値だけ受け付け、不正な値は既定に戻す', () => {
  assert.equal(getDemoData({ base: 'xxxx' }).base, DEFAULT_BASE);
  assert.equal(getDemoData({ base: '2026-13-45' }).base, DEFAULT_BASE);
  for (const o of BASE_DATES) assert.equal(getDemoData({ base: o.value }).base, o.value);
  const a = getDemoData({ base: BASE_DATES[0].value, folder: 'f01' });
  const b = getDemoData({ base: BASE_DATES[1].value, folder: 'f01' });
  assert.ok(b.parts.filter((p) => p.late > 0).length >= a.parts.filter((p) => p.late > 0).length, '基準日を後ろにすると遅れは減らない');
});

test('画面の文字は少なく（やること 1 行・タブ 3 つ・用語は現場の言葉）', () => {
  const d = getDemoData();
  assert.equal(d.tabs.length, 3);
  assert.equal(d.defaultTab, 'todo');
  for (const t of d.todos) {
    assert.ok(t.what.length <= 40, `やることが長い: ${t.what}`);
    assert.ok(t.who && t.kind && Array.isArray(t.why) && t.why.length >= 2, `${t.what}: who / kind / why が足りない`);
    assert.ok(['red', 'amber', 'blue'].includes(t.tone));
    if (t.draft) assert.ok(!/〇〇|○○|XX/.test(t.draft.body), `文面にプレースホルダー: ${t.draft.subject}`);
  }
  const text = JSON.stringify([d.todos, d.changes, d.rules, d.tabs]);
  for (const jargon of ['リードタイム', '引当', '発注残', 'BOM', 'ロット', '基準日', 'フォーキャスト']) {
    assert.ok(!text.includes(jargon), `画面の文に専門用語「${jargon}」が残っている`);
  }
  assert.equal(d.folders.length, 6);
  assert.equal(d.folders.filter((f) => f.pending).length, 3);
  for (const r of d.parts) {
    assert.ok(r.code && r.name && r.folderName && r.status && Array.isArray(r.why), `${r.code}: 行の項目が足りない`);
    assert.ok(num(r.short) && num(r.order) && num(r.late));
  }
});

test('「なぜ？」は式に数字が入った短い文の並び', () => {
  const d = getDemoData({ folder: 'f01' });
  const p = d.parts.find((r) => r.code === 'ISE1176');
  assert.deepEqual(p.why, [
    '3台 × 1台に2個 ＝ 6個いる',
    '今ある分 4個（在庫 2 ＋ 頼み済み 2）',
    '6 − 4 ＝ 2個足りない',
    '2個手配',
    '9/25 ＋ 納期 45日 ＋ 遅れ連絡 10日 ＝ 11/19 に届く',
    '11/19 − 希望日 11/14 ＝ 5日遅れ',
    '発注の締切 9/20（希望日 − 納期） → 過ぎている',
  ]);
  for (const r of d.parts) for (const line of r.why) assert.ok(line.length <= 40, `長い: ${line}`);
});

test('AI に渡すデータは短め（費用と速さのため）', () => {
  const size = JSON.stringify(getAiData()).length;
  assert.ok(size < 30000, `AI に渡すデータが ${size} 文字。30,000 文字未満にする`);
});
