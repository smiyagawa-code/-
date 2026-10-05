// 画面向け（getDemoData）と AI 向け（getAiData）が、同じ計算結果から作られているかを確かめる。
// 「AI の答えと表の食い違い」を起こさないためのテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAiData, getDemoData, DEFAULT_SITE, SITES, _REQUESTS } from '../src/data.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const folderIds = ['all', ..._REQUESTS.map((r) => r.id)];

test('置き換え忘れ（__CUSTOMER__ など）やプレースホルダーがない', () => {
  const s = JSON.stringify(getDemoData());
  assert.equal(s.match(/__[A-Z_]+__/g), null);
  assert.ok(!/〇〇|○○|XX/.test(s), '〇〇 などのプレースホルダーが残っている');
});

test('AI に渡す品目は、同じ依頼の表に出ている品目だけ（存在しない品目を AI が言わない）', () => {
  for (const folder of folderIds) {
    const d = getDemoData({ folder });
    const ai = getAiData({ folder });
    const tableLabels = new Set(d.requests.flatMap((r) => r.lines.map((l) => l.label)));
    const aiLabels = new Set(ai.依頼.flatMap((r) => (r.明細 || []).map((l) => l.品目)));
    assert.deepEqual([...aiLabels].sort(), [...tableLabels].sort(), `${folder}: AI と表の品目が違う`);
  }
});

test('AI に渡す数字は、表の数字と一致する（数量・単価・金額・根拠）', () => {
  for (const folder of folderIds) {
    const d = getDemoData({ folder });
    const ai = getAiData({ folder });
    const aiLines = new Map(ai.依頼.flatMap((r) => (r.明細 || []).map((l) => [`${r.見積番号}/${l.品目}/${l.出どころ}`, l])));
    for (const r of d.requests) {
      for (const l of r.lines) {
        const a = aiLines.get(`${r.no}/${l.label}/${l.from}`);
        assert.ok(a, `${r.no}/${l.label} が AI にない`);
        assert.equal(a.数量_m, l.qty);
        assert.equal(a.算出単価_円, l.unit);
        assert.equal(a.金額_円, l.amount);
        assert.deepEqual(a.根拠, l.basis, '根拠の文が画面と AI で違う');
      }
      const aiReq = ai.依頼.find((x) => x.見積番号 === r.no);
      if (!r.pending) assert.equal(aiReq.合計_円_税別, r.total);
    }
  }
});

test('選択中の依頼だけが AI に渡る（「この依頼」が他の依頼と混ざらない）', () => {
  for (const r of _REQUESTS) {
    const ai = getAiData({ folder: r.id });
    assert.equal(ai.依頼.length, 1, `${r.id}: 依頼が ${ai.依頼.length} 件渡っている`);
    assert.equal(ai.依頼[0].見積番号, r.no);
    assert.match(ai.context, new RegExp(`いま開いている依頼: 「${r.title.replace(/[()（）]/g, '.')}」`));
  }
  assert.equal(getAiData().依頼.length, _REQUESTS.length, '全依頼は全部');
  assert.equal(getAiData({ folder: 'nope' }).依頼.length, _REQUESTS.length, '知らない id は全依頼に戻す');
});

test('おすすめ質問は、選択中の依頼の表にある品目・数字だけを使う', () => {
  for (const r of _REQUESTS) {
    const d = getDemoData({ folder: r.id });
    assert.ok(d.examples.length >= 1, `${r.id}: おすすめ質問がない`);
    const labels = d.requests[0].lines.map((l) => l.label);
    const units = new Set(d.requests[0].lines.map((l) => l.unit.toLocaleString('ja-JP', { maximumFractionDigits: 1 })));
    for (const q of d.examples) {
      for (const m of q.match(/(CV|CVT|IV|EM-IE|CVV|VVF|CPEV|FCPEV) [0-9.]+(sq|mm)(-\d+[CP])?/g) || []) assert.ok(labels.includes(m), `${r.no}: 質問「${q}」の ${m} は表にない`);
      for (const m of q.match(/単価 ([\d,.]+) 円/g) || []) assert.ok(units.has(m.replace(/単価 | 円/g, '')), `${r.no}: 質問「${q}」の単価が表にない`);
    }
  }
});

test('拠点は候補の値だけ受け付け、不正な値は既定に戻す。拠点で掛率が変わる', () => {
  assert.equal(getDemoData({ site: 'xxx' }).site, DEFAULT_SITE);
  for (const s of SITES) assert.equal(getDemoData({ site: s.id }).site, s.id);
  const f = getDemoData({ folder: 'q01', site: 'fukuoka' }).requests[0].lines.find((l) => l.label === 'CV 14sq-3C');
  const o = getDemoData({ folder: 'q01', site: 'osaka' }).requests[0].lines.find((l) => l.label === 'CV 14sq-3C');
  assert.equal(f.rate, 0.56);
  assert.equal(o.rate, 0.54);
  assert.notEqual(f.unit, o.unit);
});

test('画面での手直し（掛率・単価・在庫／直送・ランク・追加・注記・空白行）が計算に反映され、根拠に残る', () => {
  const edits = { q01: {
    lines: { l1: { rate: 0.5 }, l2: { unit: 1300, note: '100m巻' }, l3: { route: 'direct', resolved: true }, l6: { rank: 'B' } },
    added: [{ item: 'iv14', qty: 100, note: '追加分' }],
    extras: [{ kind: 'weight', after: 'l1' }, { kind: 'blank', text: '上記 ドラム 2 巻', after: 'l2' }, { kind: 'shipping' }],
  } };
  const r = getDemoData({ folder: 'q01', edits }).requests[0];
  const by = Object.fromEntries(r.lines.map((l) => [l.id, l]));
  assert.equal(by.l1.rate, 0.5); assert.ok(by.l1.rateEdited); assert.equal(by.l1.unit, Math.ceil(5320 * 0.5)); assert.match(by.l1.basis.join(' '), /手入力で 0\.5/);
  assert.equal(by.l2.unit, 1300); assert.ok(by.l2.unitEdited); assert.equal(by.l2.amount, 1300 * 300); assert.match(by.l2.basis.join(' '), /手入力で 1,300/); assert.equal(by.l2.note, '100m巻');
  assert.equal(by.l3.route, 'direct'); assert.equal(by.l3.rate, 0.5); assert.ok(by.l3.resolved);
  assert.equal(by.l6.rank, 'B'); assert.equal(by.l6.rate, 0.55);
  assert.ok(by.a1 && by.a1.added && by.a1.qty === 100 && by.a1.label === 'IV 14sq' && by.a1.note === '追加分');
  assert.equal(r.total, r.lines.reduce((s, l) => s + l.amount, 0));
  const kinds = r.sheet.rows.map((x) => x.kind);
  assert.ok(kinds.includes('blank') && kinds.filter((k) => k === 'note').length >= 3);
  assert.ok(r.sheet.rows.some((x) => /概算重量: 約 379kg/.test(x.text || '')), '重量の行が CV 38sq の数量で計算されている');
  assert.ok(r.sheet.rows.some((x) => x.text === '上記 ドラム 2 巻'));
  assert.ok(!r.alerts.some((a) => a.lineId === 'l3' && a.kind === '明細'), '確認済みにした行の要確認が消える');
  // AI にも同じ値が渡る
  const ai = getAiData({ folder: 'q01', edits }).依頼[0];
  assert.equal(ai.明細.find((l) => l.品目 === 'CV 14sq-3C').算出単価_円, 1300);
  assert.ok(ai.明細.some((l) => l.品目 === 'IV 14sq'));
  assert.equal(ai.合計_円_税別, r.total);
});

test('不正な手直しは無視される（画面から来る値は信用しない）', () => {
  const base = getDemoData({ folder: 'q01' }).requests[0];
  const bad = getDemoData({ folder: 'q01', edits: { q01: { lines: { l1: { rate: 5, unit: -1, route: 'teleport', rank: 'Z', qty: 1.5, note: 123 }, '../x': { rate: 0.5 } }, added: [{ item: 'nope', qty: 1 }, { item: 'iv14', qty: 0 }], extras: [{ kind: 'evil' }] }, zzz: {} } }).requests[0];
  assert.deepEqual(bad, base);
  assert.deepEqual(getDemoData({ folder: 'q01', edits: 'str' }).requests[0], base);
  assert.deepEqual(getDemoData({ folder: 'q01', edits: [1] }).requests[0], base);
});

test('画面の宣言の形（タブ・依頼・行）', () => {
  const d = getDemoData();
  assert.ok(d.tabs.some((t) => t.id === d.defaultTab), 'defaultTab がタブにない');
  assert.equal(d.folders.length, _REQUESTS.length);
  assert.equal(d.folders.filter((f) => f.pending).length, 1, '読み取り保留は 1 件');
  for (const r of d.requests.filter((r) => !r.pending)) {
    assert.ok(r.lines.length > 0);
    for (const l of r.lines) {
      assert.ok(l.label && l.from && l.read && l.basis.length >= 3, `${r.no}/${l.id}: 行の項目が足りない`);
      assert.ok(num(l.qty) && num(l.unit) && num(l.amount) && num(l.stock));
      assert.equal(l.amount, Math.round(l.unit * l.qty));
    }
    assert.ok(r.sheet.rows.filter((x) => x.kind === 'item').length === r.lines.length);
    assert.equal(r.sheet.subtotal, r.total);
    assert.ok(!/〇〇|○○/.test(r.mail.body));
  }
});

test('AI に渡すデータは短め（費用と速さのため）', () => {
  const size = JSON.stringify(getAiData()).length;
  assert.ok(size < 30000, `AI に渡すデータが ${size} 文字。30,000 文字未満にする`);
});
