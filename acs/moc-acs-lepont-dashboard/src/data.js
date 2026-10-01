// 架空データと画面の宣言。画面（/api/data = getDemoData）と AI（getAiData）の両方がここだけを使う。
// 顧客の本物のデータは入れない。
//
// 元データは src/source.js（Lepont デモ用に作った架空 CSV から自動生成。tools/build_source.py）。
//   在庫 300品目（SMC株式会社 144／東和空圧工業 93／中央精密機器 63、2026-09-05 時点）
//   内示 883行（株式会社大和精密製作所・9〜11月分）／出荷実績 12か月（2025-09〜2026-08）
// メーカー名のうち SMC株式会社のみ実在の特約店契約先（公開情報）。数量・単価・顧客名・担当者名はすべて架空。
//
// 仕込んだ気づき:
//  ① 9月の確定注文に対し、有効在庫＋9月中の入荷では足りない品目がある（突き合わせ計算）
//  ② そのうち、希望納期 9/25 に間に合わせるには 1週間以内（9/12 まで）に発注が必要な品目がある
//  ③ 前回内示（8/29）→今回内示（9/5）で、配管ユニットB向けが増え、制御盤No.2向けが減った。11月に省スペース搬送ユニットの新規内示
//  ④ 出荷実績が伸びている品目の多くが、今月不足の品目と重なる
// ※ ③の「前回内示」は、差分把握のデモ用に下の PREV_RULES で作った架空の版（CSV には 9/5 版のみ）。
//
// 注意: これは在庫・入荷予定・内示の「突き合わせ計算」と「過去実績の集計」です。将来需要を予測するモデルではありません。

import { ITEMS, MAKERS, EQUIPS, SHIP_MONTHS, DUE_DATES, CUSTOMER, BASE_DATE } from './source.js';

const PREV_DATE = '2026-08-29';
const MAKER_SHORT = ['SMC', '東和空圧工業', '中央精密機器'];
// 前回内示（8/29 版）の作り方。今回値（9/5 版）から逆算する。対象は 10月・11月の内示（9月は確定注文なので変えない）
const PREV_RULES = {
  配管ユニットB: (q) => Math.round(q / 1.4), // 今回 増えた
  '制御盤No.2': (q) => Math.round(q * 1.3), // 今回 減った
};
const NEW_IN_NOV = '省スペース搬送ユニット'; // 11月分は今回が初めての内示
const URGENT_DAYS = 7; // 基準日から何日以内に発注期限が来たら「急ぎ」
const TREND_RATIO = 1.5; // 直近3か月の平均出荷が、1年前の3か月平均の 1.5倍以上 =「伸びている」

function prevQty(eq, monthIdx, q) {
  if (monthIdx === 0) return q;
  if (eq === NEW_IN_NOV && monthIdx === 2) return 0;
  const rule = PREV_RULES[eq];
  return rule ? rule(q) : q;
}

function build() {
  const items = ITEMS.map(([code, name, cat, mk, avail, inbound, inDate, lt, lot, unit, price, eqi, , q, ship]) => {
    const eq = EQUIPS[eqi];
    const inbound9 = inDate && inDate <= '2026-09-30' ? inbound : 0;
    const short9 = Math.max(0, q[0] - (avail + inbound9));
    const short10 = short9 > 0 ? 0 : Math.max(0, q[0] + q[1] - (avail + inbound));
    const deadline = addDays(DUE_DATES[0], -lt); // 9/25 に間に合う発注の期限
    const first3 = avg(ship.slice(0, 3)), last3 = avg(ship.slice(-3));
    const prev = q.map((v, i) => prevQty(eq, i, v));
    return {
      code, name, cat, maker: MAKERS[mk], makerShort: MAKER_SHORT[mk], avail, inbound, inDate, inbound9, lt, lot, unit, price, eq, q, ship, prev,
      short9, short10, deadline, urgent: short9 > 0 && deadline <= addDays(BASE_DATE, URGENT_DAYS),
      order: short9 > 0 ? Math.ceil(short9 / lot) * lot : 0,
      trendRatio: first3 > 0 ? Math.round((last3 / first3) * 100) / 100 : 0,
    };
  });
  for (const it of items) it.trend = it.trendRatio >= TREND_RATIO;

  const short9 = items.filter((i) => i.short9 > 0).sort((a, b) => b.short9 * b.price - a.short9 * a.price);
  const short10 = items.filter((i) => i.short10 > 0).sort((a, b) => b.short10 - a.short10);
  const urgent = short9.filter((i) => i.urgent).sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));
  const trend = items.filter((i) => i.trend).sort((a, b) => b.trendRatio - a.trendRatio);
  const trendShort = trend.filter((i) => i.short9 > 0 || i.short10 > 0);

  // 内示の差分（用途設備ごと、10月・11月）
  const diffByEq = EQUIPS.map((eq) => {
    const rows = items.filter((i) => i.eq === eq);
    const cur = (m) => sum(rows.map((i) => i.q[m])), old = (m) => sum(rows.map((i) => i.prev[m]));
    return { 用途設備: eq, 前回_10月: old(1), 今回_10月: cur(1), 前回_11月: old(2), 今回_11月: cur(2) };
  }).map((r) => ({ ...r, 差_10月: r.今回_10月 - r.前回_10月, 差_11月: r.今回_11月 - r.前回_11月 }));
  const changedRows = sum(items.map((i) => [1, 2].filter((m) => i.q[m] !== i.prev[m]).length));
  const changedItems = items.filter((i) => i.q[1] !== i.prev[1] || i.q[2] !== i.prev[2]);

  // 出荷実績（メーカー別・月別）
  const shipByMonth = SHIP_MONTHS.map((month, mi) => {
    const row = { month };
    MAKER_SHORT.forEach((mk) => { row[mk] = sum(items.filter((i) => i.makerShort === mk).map((i) => i.ship[mi])); });
    return row;
  });

  return { items, short9, short10, urgent, trend, trendShort, diffByEq, changedRows, changedItems, shipByMonth };
}

// AI に渡す元データ（画面の宣言は渡さない＝短く・数字は1か所）
export function getAiData() {
  const b = build();
  const pick = (i) => ({
    品目コード: i.code, 品名: i.name, メーカー: i.maker, 単位: i.unit, 用途設備: i.eq,
    有効在庫_数量: i.avail, 入荷予定_数量: i.inbound, 次回入荷予定日: i.inDate || 'なし', 発注LT_日: i.lt, 最小発注ロット_数量: i.lot,
    '9月確定注文_数量': i.q[0], '10月内示_数量': i.q[1], 参考単価_円: i.price,
  });
  return {
    context: `FA機器専門商社のデモ。お客様（${CUSTOMER}、架空）から届く内示（フォーキャスト）と、仕入先3社の在庫・入荷予定を突き合わせた結果。基準日 ${BASE_DATE}。すべて架空データ。`,
    note: 'すべて架空データです。これは在庫・入荷予定・内示の突き合わせ計算と、過去の出荷実績の集計です。将来の需要をAIが予測したものではありません。「予測できる」「正確に予測する」とは言わず、「データから言えること」と「担当の方に確かめること」を分けて答えてください。',
    計算のしかた: {
      '9月の不足_数量': '9月確定注文 −（有効在庫 ＋ 9月中に入荷予定の数量）。0 未満は不足なし',
      '10月までの不足_数量': '（9月確定注文 ＋ 10月内示）−（有効在庫 ＋ 入荷予定の全量）。9月に不足がない品目だけ',
      発注期限: `希望納期（9月分は ${DUE_DATES[0]}）− 発注LT_日。基準日 ${BASE_DATE} から ${URGENT_DAYS}日以内（${addDays(BASE_DATE, URGENT_DAYS)} まで）なら「急ぎ」`,
      推奨発注_数量: '9月の不足を最小発注ロットの倍数に切り上げた数',
      出荷が伸びている: `直近3か月（2026-06〜08）の平均出荷が、1年前の3か月（2025-09〜11）平均の ${TREND_RATIO}倍以上`,
      内示の差分: `前回 ${PREV_DATE} 版と今回 ${BASE_DATE} 版の比較（10月・11月分）`,
    },
    品目数: { 合計: b.items.length, メーカー別: Object.fromEntries(MAKERS.map((m) => [m, b.items.filter((i) => i.maker === m).length])) },
    '9月に不足する品目': b.short9.map((i) => ({ ...pick(i), '9月中の入荷_数量': i.inbound9, '9月の不足_数量': i.short9, 推奨発注_数量: i.order, 発注期限: i.deadline, 急ぎ: i.urgent, 不足金額_円: i.short9 * i.price })),
    '10月までに不足する品目（9月は足りる）': b.short10.map((i) => ({ ...pick(i), '10月までの不足_数量': i.short10 })),
    '内示の差分_用途設備別_数量': b.diffByEq.filter((r) => r.差_10月 || r.差_11月),
    内示の変更行数: b.changedRows,
    出荷実績_メーカー別_月別_数量: b.shipByMonth,
    '出荷が伸びている品目（上位15）': b.trend.slice(0, 15).map((i) => ({
      品目コード: i.code, 品名: i.name, メーカー: i.maker, 単位: i.unit, 伸び_倍: i.trendRatio,
      出荷_2025_09_数量: i.ship[0], 出荷_2026_08_数量: i.ship.at(-1), 有効在庫_数量: i.avail, '9月確定注文_数量': i.q[0], '10月内示_数量': i.q[1],
    })),
    出荷が伸びている品目数: b.trend.length,
    '出荷が伸びていて9月か10月に不足する品目数': b.trendShort.length,
  };
}

// 画面の宣言
export function getDemoData() {
  const b = build();
  const labels = SHIP_MONTHS.map((m) => m.slice(2).replace('-', '/'));
  const n = b.items.length;
  const shortYen = sum(b.short9.map((i) => i.short9 * i.price));
  const pipeB = b.diffByEq.find((r) => r.用途設備 === '配管ユニットB');
  const ctrl2 = b.diffByEq.find((r) => r.用途設備 === '制御盤No.2');
  const space = b.diffByEq.find((r) => r.用途設備 === NEW_IN_NOV);
  const pipeBPct = pct(pipeB.今回_10月, pipeB.前回_10月);
  const ctrl2Pct = pct(ctrl2.今回_10月, ctrl2.前回_10月);
  const shortByMaker = MAKER_SHORT.map((mk) => ({ mk, n9: b.short9.filter((i) => i.makerShort === mk).length, n10: b.short10.filter((i) => i.makerShort === mk).length, urgent: b.urgent.filter((i) => i.makerShort === mk).length }));
  const topMaker = shortByMaker.reduce((a, c) => (c.n9 > a.n9 ? c : a));
  const shipTotals = b.shipByMonth.map((r) => sum(MAKER_SHORT.map((k) => r[k])));
  const peak = shipTotals.indexOf(Math.max(...shipTotals));
  const top3 = b.trend.slice(0, 3);
  const diffEqs = b.diffByEq.filter((r) => r.差_10月 || r.差_11月);

  return {
    title: 'ACS株式会社様 在庫・内示 AIダッシュボード',
    subtitle: 'お客様の内示と、仕入先の在庫・入荷予定を、ひとつの画面で突き合わせ。気になった品目は、その場で AI に。',
    period: `基準日 ${md(BASE_DATE)}（在庫）／内示 9〜11月分／出荷実績 ${ym(SHIP_MONTHS[0])}〜${ym(SHIP_MONTHS.at(-1))}`,
    footNote: '数量・単価・顧客名・担当者名はすべて架空のデモデータです（メーカー名のうち SMC株式会社のみ実在の特約店契約先）。在庫・入荷予定・内示の突き合わせ計算と出荷実績の集計であり、需要予測モデルではありません。',
    kpis: [
      { label: '9月に不足する品目', value: b.short9.length, unit: '品目', sub: `${n}品目中（不足額 約${fmt(Math.round(shortYen / 10000))}万円）` },
      { label: '1週間以内に発注が必要', value: b.urgent.length, unit: '品目', sub: `${md(addDays(BASE_DATE, URGENT_DAYS))}までに発注しないと ${md(DUE_DATES[0])} に間に合わない` },
      { label: '10月までに不足する品目', value: b.short10.length, unit: '品目', sub: '9月は足りるが、10月内示まで見ると不足' },
      { label: '前回内示からの変更', value: b.changedRows, unit: '行', sub: `${md(PREV_DATE)} 版 → ${md(BASE_DATE)} 版（10・11月分）` },
    ],
    insights: [
      { tag: '突き合わせ', accent: 'red', head: '9月の確定注文に、在庫と入荷が足りない品目', fig: `${b.short9.length}`, unit: '品目', question: '9月に不足する品目を、急いで手配すべき順に教えてください。理由も添えてください。' },
      { tag: '発注期限', accent: 'red', head: `${md(addDays(BASE_DATE, URGENT_DAYS))}までに発注しないと、${md(DUE_DATES[0])} の希望納期に間に合わない`, fig: `${b.urgent.length}`, unit: '品目', question: '1週間以内に発注が必要な品目を、発注期限の早い順に教えてください。仕入先に確認すべきことも添えてください。' },
      { tag: '内示の差分', accent: 'blue', head: '配管ユニットB向けの10月内示が、前回から増えた', fig: `+${pipeBPct}`, unit: '%', question: '前回の内示から変わった点と、発注に影響しそうな品目を教えてください。' },
      { tag: '出荷の傾向', accent: 'green', head: `出荷が伸びている${b.trend.length}品目のうち、今月・来月に不足`, fig: `${b.trendShort.length}`, unit: '品目', question: '過去1年で出荷が伸びている品目のうち、今の在庫水準で注意すべきものは？' },
    ],
    examples: ['SMCの品目で、9月に不足するものを一覧にして', 'VF3000-14-002 の状況を教えて', '10月の内示まで見たときに注意すべき品目は？', '最小発注ロットを踏まえた発注数をまとめて'],
    sections: [
      {
        id: 'match', title: '① 在庫 × 内示の突き合わせ（9月・10月）',
        cards: [
          {
            title: '9月に不足する品目（不足額の大きい順・上位10）',
            takeaway: `${n}品目中 **${b.short9.length}品目** が不足。うち **${b.urgent.length}品目** は ${md(addDays(BASE_DATE, URGENT_DAYS))} までに発注が必要です`,
            chart: {
              type: 'table',
              columns: ['品目コード', '品名', 'メーカー', '有効在庫', '9月入荷', '9月確定', '不足', '推奨発注', '発注期限'],
              rows: b.short9.slice(0, 10).map((i) => [i.code, i.name, i.makerShort, `${i.avail}${i.unit}`, `${i.inbound9}${i.unit}`, `${i.q[0]}${i.unit}`, `${i.short9}${i.unit}`, `${i.order}${i.unit}`, i.urgent ? `${md(i.deadline)}（急ぎ）` : md(i.deadline)]),
              hot: b.short9.slice(0, 10).map((i, k) => (i.urgent ? k : -1)).filter((k) => k >= 0),
            },
          },
          {
            size: 'half', title: 'メーカー別の不足品目数',
            takeaway: `最も多いのは **${topMaker.mk}（${topMaker.n9}品目）**`,
            chart: { type: 'stacked', labels: MAKER_SHORT, keys: ['9月に不足', '10月までに不足'], rows: shortByMaker.map((r) => ({ '9月に不足': r.n9, '10月までに不足': r.n10 })), unit: '品目', total: true, max: 24 },
          },
          {
            size: 'half', title: '10月までに不足する品目（上位6）',
            takeaway: `9月は足りても、10月内示まで見ると **${b.short10.length}品目** が不足`,
            chart: { type: 'hbars', rows: b.short10.slice(0, 6).map((i, k) => ({ name: i.code, value: i.short10, unit: i.unit, sub: `${i.makerShort}・${i.name}`, highlight: k === 0 })) },
          },
        ],
      },
      {
        id: 'diff', title: '② 内示の差分（前回 → 今回）',
        cards: [
          {
            size: 'half', title: '用途設備別 内示数量の増減（変更のあった設備）',
            takeaway: `10月は **配管ユニットB +${pipeBPct}%**、制御盤No.2 ${ctrl2Pct}%`,
            chart: {
              type: 'table',
              columns: ['用途設備', '10月 前回→今回', '差', '11月 前回→今回', '差'],
              rows: diffEqs.map((r) => [r.用途設備, `${fmt(r.前回_10月)} → ${fmt(r.今回_10月)}`, signed(r.差_10月), `${fmt(r.前回_11月)} → ${fmt(r.今回_11月)}`, signed(r.差_11月)]),
              hot: diffEqs.map((r, k) => (r.用途設備 === '配管ユニットB' ? k : -1)).filter((k) => k >= 0),
            },
          },
          {
            size: 'half', title: '前回から変わった内示',
            takeaway: `**${b.changedItems.length}品目・${b.changedRows}行** が変更。11月は${NEW_IN_NOV}が新規`,
            chart: {
              type: 'cards',
              items: [
                { count: b.items.filter((i) => i.eq === '配管ユニットB' && i.q[1] > i.prev[1]).length, unit: '品目', title: '増えた（配管ユニットB）', meta: `10月 ${pipeB.前回_10月} → ${pipeB.今回_10月}`, badge: '増' },
                { count: b.items.filter((i) => i.eq === '制御盤No.2' && i.q[1] < i.prev[1]).length, unit: '品目', title: '減った（制御盤No.2）', meta: `10月 ${ctrl2.前回_10月} → ${ctrl2.今回_10月}`, badge: '減' },
                { count: b.items.filter((i) => i.eq === NEW_IN_NOV && i.prev[2] === 0 && i.q[2] > 0).length, unit: '品目', title: `新規（${NEW_IN_NOV}・11月）`, meta: `11月 ${space.前回_11月} → ${space.今回_11月}`, badge: '新規' },
              ],
            },
          },
        ],
      },
      {
        id: 'trend', title: '③ 出荷実績の傾向（過去12か月）',
        cards: [
          {
            title: 'メーカー別の出荷実績（数量）',
            takeaway: `最も多いのは **${Number(SHIP_MONTHS[peak].slice(5))}月の ${fmt(shipTotals[peak])}**（年度末）。メーカー比率はほぼ一定`,
            chart: { type: 'stacked', labels, keys: MAKER_SHORT, rows: b.shipByMonth.map((r) => Object.fromEntries(MAKER_SHORT.map((k) => [k, r[k]]))), unit: '', total: true, max: 8000 },
          },
          {
            title: '出荷が伸びている品目（上位3）',
            takeaway: `**${top3[0].code}** は ${top3[0].ship[0]} → ${top3[0].ship.at(-1)}${top3[0].unit}/月。いまの有効在庫は ${top3[0].avail}${top3[0].unit}`,
            chart: { type: 'line', labels, unit: '', min: 0, max: 40, series: top3.map((i, k) => ({ name: `${i.code}（${i.unit}）`, values: i.ship, highlight: k === 0 })) },
          },
        ],
      },
      {
        id: 'next', title: '④ これからの進め方（ご提案の範囲）',
        cards: [
          {
            title: 'このダッシュボードの元になる作業と、thomas でお手伝いできること',
            takeaway: '**① 内示の差分把握** と **② 発注管理のためのデータ整理** を一体で。見積は今後のご検討',
            chart: {
              type: 'cards',
              items: [
                { count: b.items.length, unit: '品目', title: '在庫 × 内示の突き合わせを自動で（Lepont）', meta: '在庫・入荷予定・内示を毎回まとめ直す手間をなくす', badge: '今回の範囲' },
                { count: b.changedRows, unit: '行', title: '内示の版ごとの差分を一覧に（Lepont）', meta: '読み取りを特定の方に頼らず、変更点をチームで確認', badge: '今回の範囲' },
                { count: MAKERS.length, unit: '社', title: '仕入先見積の読み取り・自社様式への転記（Edison AI-OCR）', meta: '9/11 のご返信どおり、今後のご検討領域', badge: '今後' },
              ],
            },
          },
        ],
      },
    ],
  };
}

function sum(a) { return a.reduce((s, v) => s + v, 0); }
function avg(a) { return sum(a) / a.length; }
function pct(now, before) { return Math.round(((now - before) / before) * 1000) / 10; }
function fmt(v) { return v.toLocaleString('ja-JP'); }
function signed(v) { return v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : '±0'; }
function ym(s) { return `${s.slice(0, 4)}年${Number(s.slice(5))}月`; }
function md(s) { return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`; }
function addDays(s, d) {
  const t = new Date(`${s}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}
