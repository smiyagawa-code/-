// 「設定」（読み取りルールの上書き = overrides）が計算に効くこと、おかしな上書きは無視されること、マスターが画面に渡ることを確かめる
import test from 'node:test';
import assert from 'node:assert/strict';
import { _build, getAiData, getDemoData, _PART } from '../src/data.js';
import { CUSTOMER_CONTACT, SUPPLIERS, applyOverrides, getDefaultMasters, normalizeOverrides } from '../src/masters.js';

const base = '2026-09-25';
const part = (b, id, code) => b.folders.find((f) => f.id === id).parts.find((p) => p.code === code);
const plain = _build(base);

test('納期（lt）を変えると 届く日・遅れ が変わる', () => {
  const before = part(plain, 'f01', 'ISE1176');
  assert.equal(before.lt, 45);
  assert.equal(before.eta, '2026-11-19');
  assert.equal(before.late, 5);
  const b = _build(base, null, { parts: { ISE1176: { lt: 30 } } });
  const after = part(b, 'f01', 'ISE1176');
  assert.equal(after.lt, 30);
  assert.equal(after.eta, '2026-11-04', '9/25 ＋ 30日 ＋ 遅れ連絡 10日');
  assert.equal(after.late, -10, '希望日 11/14 より前に届く');
  assert.ok(after.why.some((l) => l.includes('納期 30日')), '「なぜ？」の文も新しい納期で書かれる');
  assert.equal(after.status, '手配すれば間に合う');
  // 遅れ連絡（delay）だけ変えても同じく効く
  const c = part(_build(base, null, { parts: { ISE1176: { delay: 0 } } }), 'f01', 'ISE1176');
  assert.equal(c.eta, '2026-11-09');
  assert.equal(c.late, -5);
});

test('まとめ買いの単位（lot）を変えると 手配する数 が変わる', () => {
  const before = part(plain, 'f01', 'AS-04-237');
  assert.equal(before.short, 14);
  assert.equal(before.order, 20);
  const after = part(_build(base, null, { parts: { 'AS-04-237': { lot: 1 } } }), 'f01', 'AS-04-237');
  assert.equal(after.short, 14, '足りない数は変わらない');
  assert.equal(after.order, 14, '単位 1 なら足りない数そのまま');
  const ten = part(_build(base, null, { parts: { 'AS-04-237': { lot: 10 } } }), 'f01', 'AS-04-237');
  assert.equal(ten.order, 20);
  const fifty = part(_build(base, null, { parts: { 'AS-04-237': { lot: 50 } } }), 'f01', 'AS-04-237');
  assert.equal(fifty.order, 50);
  assert.ok(fifty.why.some((l) => l.includes('単位 50個')));
  // やることの文面も新しい数になる
  const todo = _build(base, null, { parts: { 'AS-04-237': { lot: 50 } } }).folders.find((f) => f.id === 'f01').todos.find((t) => t.code === 'AS-04-237');
  assert.match(todo.what, /50個/);
});

test('読み替え（bom）の数を変えると いる数 が変わる（案件 id でも 機種 でも指定できる）', () => {
  const before = part(plain, 'f01', 'ISE1176');
  assert.equal(before.needSep, 6);
  const rows = getDefaultMasters().bom.f01.map((r) => (r.code === 'ISE1176' ? { ...r, qty: 3 } : r));
  const byId = part(_build(base, null, { bom: { f01: rows } }), 'f01', 'ISE1176');
  assert.equal(byId.needSep, 9, '3台 × 3個');
  assert.equal(byId.short, 5);
  const byModel = part(_build(base, null, { bom: { 'VIS-200': rows } }), 'f01', 'ISE1176');
  assert.equal(byModel.needSep, 9);
  // ほかの案件・ほかの部品は変わらない
  assert.equal(part(byIdBuild(rows), 'f02', 'AS-04-237').needSep, part(plain, 'f02', 'AS-04-237').needSep);
  assert.equal(part(byIdBuild(rows), 'f01', 'PC-IPC').needSep, 3);
  function byIdBuild(r) { return _build(base, null, { bom: { f01: r } }); }
  // オプションの行は、そのオプションのときだけ数える（オプション付きの行の数を変えても標準には効かない）
  const opt = getDefaultMasters().bom.f02.map((r) => (r.code === 'FR-SG' ? { ...r, qty: 5 } : r));
  const fr = part(_build(base, null, { bom: { f02: opt } }), 'f02', 'FR-SG');
  assert.equal(fr.needSep, 0, '9月版は安全柵なしなので 0');
  assert.equal(fr.needAug, 10, '8月版は安全柵あり 2台 × 5');
});

test('おかしな overrides は無視する（型・範囲・知らない型番・知らない案件）', () => {
  assert.equal(normalizeOverrides(null), null);
  assert.equal(normalizeOverrides('x'), null);
  assert.equal(normalizeOverrides([]), null);
  assert.equal(normalizeOverrides({}), null);
  assert.equal(normalizeOverrides({ parts: { NOPE: { lt: 5 } } }), null, '知らない型番');
  assert.equal(normalizeOverrides({ parts: { ISE1176: { lt: 'abc', lot: -3, delay: 1.5, price: 1 } } }), null, '型・範囲外・直せない項目');
  assert.equal(normalizeOverrides({ parts: { ISE1176: { lt: 9999 } } }), null, '範囲外');
  assert.equal(normalizeOverrides({ bom: { f99: [{ code: 'ISE1176', qty: 1 }] } }), null, '知らない案件');
  assert.equal(normalizeOverrides({ bom: { f01: [{ code: 'NOPE', qty: 1 }, { code: 'ISE1176', qty: -1 }] } }), null, '行が全部おかしい');
  assert.equal(normalizeOverrides({ suppliers: { 架空商事: { person: 'x' } } }), null, '知らないメーカー');
  assert.equal(normalizeOverrides({ suppliers: { 東和光学: { person: '<b>x</b>' } } }), null, 'タグは受けない');
  // 良いところだけ残す
  const mixed = normalizeOverrides({ parts: { ISE1176: { lt: 30, lot: 'x' }, NOPE: { lt: 1 } }, bom: { f01: [{ code: 'NOPE', qty: 1 }, { code: 'ISE1176', qty: 3, option: null }] }, extra: 1 });
  assert.deepEqual(mixed, { parts: { ISE1176: { lt: 30 } }, bom: { f01: [{ code: 'ISE1176', qty: 3, option: '' }] } });
  // 計算結果は既定と同じ
  const bad = { parts: { NOPE: { lt: 5 }, ISE1176: { lt: 'abc', lot: 0 } }, bom: 'x', suppliers: [] };
  assert.deepEqual(getDemoData({ overrides: bad }).parts, getDemoData().parts);
  assert.deepEqual(getDemoData({ overrides: 'x' }).parts, getDemoData().parts);
  assert.deepEqual(getDemoData({ overrides: bad }).overrides, {});
});

test('masters（直した後）と masters_default（既定）が画面に渡る', () => {
  const d = getDemoData();
  assert.equal(d.masters.parts.length, Object.keys(_PART).length);
  assert.deepEqual(Object.keys(d.masters.bom), ['f01', 'f02', 'f03']);
  assert.deepEqual(d.masters.folders.map((f) => f.id), ['f01', 'f02', 'f03']);
  assert.ok(d.masters.rules.length >= 5 && d.masters.rules.every((r) => r.name && r.formula));
  assert.deepEqual(d.masters, d.masters_default, '上書きなしなら同じ');
  assert.deepEqual(d.overrides, {});
  // メーカーごとに 担当者・連絡先・注意 がある（架空）
  const makers = new Set(Object.values(_PART).map((p) => p.maker));
  for (const m of makers) {
    const s = d.masters.suppliers.find((x) => x.maker === m);
    assert.ok(s, `${m} の窓口がない`);
    assert.ok(s.person && /@.*\.example\.jp$/.test(s.email) && s.note, `${m}: 担当者・連絡先（example.jp）・注意が足りない`);
  }
  assert.equal(SUPPLIERS.length, makers.size);
  // 上書きすると masters だけ変わり、masters_default は変わらない
  const o = { parts: { ISE1176: { lt: 30 } }, suppliers: { 東和光学: { person: '山田 花子' } }, bom: { f01: [{ code: 'ISE1176', qty: 3 }] } };
  const e = getDemoData({ overrides: o, folder: 'f01' });
  assert.equal(e.masters.parts.find((p) => p.code === 'ISE1176').lt, 30);
  assert.equal(e.masters_default.parts.find((p) => p.code === 'ISE1176').lt, 45);
  assert.equal(e.masters.suppliers.find((s) => s.maker === '東和光学').person, '山田 花子');
  assert.equal(e.masters_default.suppliers.find((s) => s.maker === '東和光学').person, SUPPLIERS[0].person);
  assert.deepEqual(e.masters.bom.f01, [{ code: 'ISE1176', qty: 3, option: '' }]);
  assert.equal(e.masters_default.bom.f01.length, 9);
  assert.deepEqual(e.overrides, { parts: { ISE1176: { lt: 30 } }, suppliers: { 東和光学: { person: '山田 花子' } }, bom: { f01: [{ code: 'ISE1176', qty: 3, option: '' }] } });
  // 表も変わっている（部品表を 1 行にしたので f01 は 1 部品だけ）
  assert.deepEqual(e.parts.map((r) => r.code), ['ISE1176']);
  assert.equal(e.parts[0].needSep, 9);
  assert.equal(e.parts[0].eta, '11/4');
  assert.deepEqual(applyOverrides(getDefaultMasters(), null), getDefaultMasters());
});

test('AI に渡すデータも同じ上書きで計算される（表と食い違わない）', () => {
  const o = { parts: { ISE1176: { lt: 30 }, 'AS-04-237': { lot: 1 } } };
  const d = getDemoData({ overrides: o, folder: 'f01' });
  const ai = getAiData({ overrides: o, folder: 'f01' });
  for (const r of d.parts) {
    const p = ai.案件[0].部品.find((x) => x.型番 === r.code);
    assert.equal(p.手配する数_個, r.order, r.code);
    assert.equal(p.遅れ_日 ?? 0, r.late, r.code);
    assert.deepEqual(p.なぜ, r.why, r.code);
  }
  assert.equal(ai.案件[0].部品.find((x) => x.型番 === 'AS-04-237').手配する数_個, 14);
});

test('既定のマスターは data.js の値と一致し、毎回同じ', () => {
  const m = getDefaultMasters();
  for (const p of m.parts) assert.deepEqual(p, _PART[p.code]);
  assert.deepEqual(getDefaultMasters(), m);
  // 返したものを書き換えても既定は変わらない
  m.parts[0].lt = 1; m.bom.f01[0].qty = 99; m.suppliers[0].person = 'x';
  assert.equal(getDefaultMasters().parts[0].lt, _PART[m.parts[0].code].lt);
  assert.equal(getDefaultMasters().bom.f01[0].qty, 2);
  assert.equal(getDefaultMasters().suppliers[0].person, SUPPLIERS[0].person);
});

test('やることの contact は masters.suppliers と一致し、お客様の行は得意先の窓口、社内の行は null', () => {
  const d = getDemoData();
  const sup = Object.fromEntries(d.masters.suppliers.map((s) => [s.maker, s]));
  for (const kind of ['メーカーに連絡', 'お客様に連絡', '社内で決める', 'お客様に確認']) assert.ok(d.todos.some((t) => t.kind === kind), `${kind} の行がない`);
  for (const t of d.todos) {
    assert.ok(typeof t.caution === 'string' && t.caution.length <= 40, `${t.what}: caution が無い・長い「${t.caution}」`);
    if (t.kind === 'メーカーに連絡') {
      assert.ok(sup[t.who], `${t.who} の窓口がない`);
      assert.deepEqual(t.contact, { maker: t.who, person: sup[t.who].person, email: sup[t.who].email, note: sup[t.who].note }, `${t.what}: contact が窓口と違う`);
    } else if (t.kind === '社内で決める') {
      assert.equal(t.contact, null);
      assert.equal(t.caution, '');
    } else {
      assert.equal(t.contact.maker, t.who, '得意先の窓口の会社名は who と同じ');
      assert.equal(t.contact.maker, CUSTOMER_CONTACT.maker);
      assert.ok(t.contact.person && /@.*\.example\.jp$/.test(t.contact.email));
    }
  }
  // 注意 1 行: 締切を過ぎた手配は「過ぎています。急ぎ」。締切も遅れもなければ窓口の注意
  const ise = d.todos.find((t) => t.code === 'ISE1176' && t.kind === 'メーカーに連絡');
  assert.equal(ise.caution, '締切 9/20 を過ぎています。急ぎ');
  const lc = d.todos.find((t) => t.code === 'AS-06-148' && t.kind === 'メーカーに連絡');
  assert.equal(lc.caution, '締切 9/17 を過ぎています。急ぎ');
  for (const t of d.todos.filter((x) => x.kind === 'メーカーに連絡' && !/過ぎています|遅れ|今週中/.test(x.caution))) assert.equal(t.caution, sup[t.who].note, `${t.what}: 窓口の注意になっていない`);
  // 画面の文に専門用語を入れない（spec と同じ語）
  const text = JSON.stringify(d.todos.map((t) => [t.contact, t.caution]));
  for (const jargon of ['リードタイム', '引当', '発注残', 'BOM', 'ロット', '基準日']) assert.ok(!text.includes(jargon), `専門用語「${jargon}」`);
});

test('overrides で担当者を変えると todos の contact と AI のやることも変わる', () => {
  const o = { suppliers: { 東和光学: { person: '山田 花子', note: '午前中は電話が通じにくい' } } };
  const d = getDemoData({ overrides: o, folder: 'f01' });
  const towa = d.todos.filter((t) => t.kind === 'メーカーに連絡' && t.who === '東和光学');
  assert.ok(towa.length >= 1);
  for (const t of towa) {
    assert.equal(t.contact.person, '山田 花子');
    assert.equal(t.contact.note, '午前中は電話が通じにくい');
    assert.equal(t.contact.email, SUPPLIERS.find((s) => s.maker === '東和光学').email, '直していない連絡先は既定のまま');
  }
  const other = d.todos.find((t) => t.kind === 'メーカーに連絡' && t.who !== '東和光学');
  assert.equal(other.contact.person, SUPPLIERS.find((s) => s.maker === other.who).person, 'ほかのメーカーは変わらない');
  // AI にも同じ担当者・注意
  const ai = getAiData({ overrides: o, folder: 'f01' });
  const aiTodos = ai.案件[0].やること;
  assert.equal(aiTodos.length, d.todos.length);
  d.todos.forEach((t, i) => {
    assert.equal(aiTodos[i].担当者, t.contact?.person, `${t.what}: AI の担当者が違う`);
    assert.equal(aiTodos[i].注意, t.caution || undefined, `${t.what}: AI の注意が違う`);
  });
  assert.ok(aiTodos.some((x) => x.担当者 === '山田 花子'));
  // 既定に戻せば既定の担当者
  assert.equal(getDemoData({ folder: 'f01' }).todos.find((t) => t.who === '東和光学' && t.kind === 'メーカーに連絡').contact.person, SUPPLIERS.find((s) => s.maker === '東和光学').person);
});
