// 画面向け（getDemoData）と AI 向け（getAiData）が、同じ計算結果から作られているかを確かめる。
// レビュー 2026-10-05 の指摘 1（AI の答えと表の食い違い）を二度と起こさないためのテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAiData, getDemoData, DEFAULT_BASE, BASE_DATES, _FOLDERS } from '../src/data.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const folderIds = ['all', ..._FOLDERS.map((f) => f.id)];

test('置き換え忘れ（__CUSTOMER__ など）がない', () => {
  const found = JSON.stringify(getDemoData()).match(/__[A-Z_]+__/g);
  assert.equal(found, null, `置き換え忘れ: ${found}`);
});

test('AI に渡す型番は、同じフォルダの表に出ている型番だけ（存在しない型番を AI が言わない）', () => {
  for (const folder of folderIds) {
    const d = getDemoData({ folder });
    const tableCodes = new Set([...d.urgent, ...d.late, ...d.changes.flatMap((c) => c.affected), ...d.excess].map((r) => r.code));
    const ai = getAiData({ folder });
    const aiCodes = new Set(ai.案件.flatMap((a) => (a.部品 || []).map((p) => p.型番)));
    // 表に出るのは「変更・急ぎ・遅れ・過剰」のある部品だけなので、AI 側の型番は表の型番を含む（逆は不要）
    for (const c of tableCodes) assert.ok(aiCodes.has(c), `${folder}: 表の ${c} が AI のデータにない`);
    // AI 側の部品は、その案件の BOM にある型番だけ
    for (const a of ai.案件) {
      const f = _FOLDERS.find((x) => x.name === a.案件);
      const bom = new Set((f.bom || []).map(([c]) => c));
      for (const p of a.部品 || []) assert.ok(bom.has(p.型番), `${a.案件}: AI に BOM 外の型番 ${p.型番}`);
    }
  }
});

test('AI に渡す数字は、表の数字と一致する（不足・追加手配・入手見込み・遅れ・根拠）', () => {
  for (const folder of folderIds) {
    const d = getDemoData({ folder });
    const ai = getAiData({ folder });
    const aiParts = new Map(ai.案件.flatMap((a) => (a.部品 || []).map((p) => [`${a.案件}/${p.型番}`, p])));
    for (const r of [...d.urgent, ...d.late, ...d.changes.flatMap((c) => c.affected)]) {
      const p = aiParts.get(`${r.folderName}/${r.code}`);
      assert.ok(p, `${r.folderName}/${r.code} が AI にない`);
      assert.equal(p.不足_個, r.short);
      assert.equal(p.追加手配_個, r.order);
      assert.equal(p['9月版の必要数_個'], r.needSep);
      if (r.eta) assert.equal(p.遅れ_日, r.late);
      assert.deepEqual(p.根拠, Object.values(r.basis).filter(Boolean), '根拠の文が画面と AI で違う');
    }
  }
});

test('選択中のフォルダだけが AI に渡る（「この案件で」が他案件と混ざらない）', () => {
  for (const f of _FOLDERS) {
    const ai = getAiData({ folder: f.id });
    assert.equal(ai.案件.length, 1, `${f.id}: 案件が ${ai.案件.length} 件渡っている`);
    assert.equal(ai.案件[0].案件, f.name);
    assert.match(ai.context, new RegExp(`いま開いている案件: 「${f.name}」`));
  }
  assert.equal(getAiData().案件.length, 3, '全案件は、内示が届いている 3 案件');
  assert.equal(getAiData({ folder: 'nope' }).案件.length, 3, '知らないフォルダ id は全案件に戻す');
});

test('おすすめ質問は、選択中フォルダの表にある型番・数字だけを使う', () => {
  for (const f of _FOLDERS) {
    const d = getDemoData({ folder: f.id });
    assert.ok(d.examples.length >= 1, `${f.id}: おすすめ質問がない`);
    const codesInTable = new Set([...d.urgent, ...d.late, ...d.changes.flatMap((c) => c.affected), ...d.excess].map((r) => r.code));
    for (const q of d.examples) {
      for (const code of q.match(/[A-Z]{1,3}-?[A-Z0-9]*-?\d{2,4}(?:-\d{3})?/g) || []) {
        assert.ok(codesInTable.has(code), `${f.name}: おすすめ質問「${q}」の ${code} は表にない`);
      }
    }
  }
});

test('基準日は候補の値だけ受け付け、不正な値は既定に戻す', () => {
  assert.equal(getDemoData({ base: 'xxxx' }).base, DEFAULT_BASE);
  assert.equal(getDemoData({ base: '2026-13-45' }).base, DEFAULT_BASE);
  for (const o of BASE_DATES) assert.equal(getDemoData({ base: o.value }).base, o.value);
  // 基準日を後ろにずらすと、追加手配する部品の入手見込みも後ろにずれ、遅れは減らない
  const a = getDemoData({ base: BASE_DATES[0].value, folder: 'f01' });
  const b = getDemoData({ base: BASE_DATES[1].value, folder: 'f01' });
  assert.ok(b.summary.late >= a.summary.late);
});

test('画面の宣言の形（タブ・フォルダ・表の行）', () => {
  const d = getDemoData();
  assert.ok(d.tabs.some((t) => t.id === d.defaultTab), 'defaultTab がタブにない');
  assert.equal(d.folders.length, 6);
  assert.equal(d.folders.filter((f) => f.pending).length, 3, '9月版 未受領は 3 フォルダ');
  for (const f of d.folders.filter((f) => f.pending)) assert.ok(f.pending.length > 10, `${f.name}: 未受領の理由がない`);
  for (const r of [...d.urgent, ...d.late]) {
    assert.ok(r.code && r.name && r.folderName && r.basis, `${r.code}: 行の項目が足りない`);
    assert.ok(num(r.short) && num(r.order) && num(r.late));
    assert.ok(r.basis.need && r.basis.short, `${r.code}: 根拠がない`);
  }
  for (const r of d.urgent) assert.ok(r.basis.deadline && r.basis.eta && r.basis.order, `${r.code}: 急ぐ部品に発注期限・入手見込み・追加手配の根拠がない`);
  for (const r of d.late) assert.match(r.basis.late, /日の遅れ/, `${r.code}: 遅れの根拠に日数がない`);
  for (const a of d.actions) assert.ok(!/〇〇|○○|XX/.test(a.body), `文面にプレースホルダーが残っている: ${a.subject}`);
});

test('AI に渡すデータは短め（費用と速さのため）', () => {
  const size = JSON.stringify(getAiData()).length;
  assert.ok(size < 30000, `AI に渡すデータが ${size} 文字。30,000 文字未満にする`);
});
