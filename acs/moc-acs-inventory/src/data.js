// 架空データと計算（唯一の置き場）。画面（/api/data）と AI（/api/chat）は、どちらも同じ build() の結果だけを使う。
// 顧客の本物のデータは入れない。数量・単価・会社名・担当者名・型番はすべて架空。
//
// 見せたいこと（ACS 様の 2 課題）
//  ① 内示の突き合わせの手作業 → 「フォルダ」に 8月版／9月版の内示を置くと、変更点（増量・前倒し・オプション・取消）と影響部品が表になる
//  ② 読み取りの属人化 → 「計算の決まり v1」で不足・追加手配・入手見込み・遅れを機械的に出す。AI は計算しない（読み取り・注意書き・文面の下書きだけ）
//
// 仕込んだ気づき（test/insights.test.mjs で守る）
//  A. 第2工場 外観検査ライン増設: 2台→3台。画像検査カメラ ISE1176 はメーカー案内の遅れ 10日が重なり、希望納期に 5日遅れ
//  B. 組立セル AS-500: 希望納期が 11/10→10/15 に前倒し＋安全柵→ライトカーテン仕様。AS-06-148 が新たに必要で 8日遅れ。不要になった安全柵の発注残 2台
//  C. クリーン仕様 搬送ユニット: 1台→取消。発注残 KS-300 30個などが過剰に。うち RB-120 は第2工場で 1台不足 → 振替候補
//  D. AS-04-237（近接センサ）は 3案件で共用。第2工場で不足 14 → ロット 20 で追加手配 20

export const DEFAULT_BASE = '2026-09-25'; // 基準日（内示 9月版を受け取った日の想定）
export const BASE_DATES = [
  { value: '2026-09-25', label: '9/25（9月版の内示を受け取った日・想定）' },
  { value: '2026-10-06', label: '10/6（商談日。今日の日付で見た場合）' },
];
const URGENT_DAYS = 7; // 発注期限が基準日から何日以内なら「急ぐ」
const CUSTOMER = '株式会社大和精密製作所'; // 架空
const OUR_NAME = 'ACS株式会社 購買部 高橋'; // 架空の担当（文面の差出人）

// 部品カタログ [型番, 品名, メーカー, 発注LT_日, ロット, 単価_円, メーカー案内の遅れ_日]
const PARTS = [
  ['ISE1176', '画像検査カメラ 5M', '東和光学', 45, 1, 215000, 10],
  ['PC-IPC', '産業用PC', '中央精密機器', 35, 1, 168000, 14],
  ['LED-RING', 'リング照明', '東和光学', 14, 2, 18500, 0],
  ['AS-04-237', '近接センサ M12', '東和空圧工業', 10, 20, 3200, 0],
  ['AS-06-148', 'ライトカーテン 4段', '東和空圧工業', 21, 1, 86000, 7],
  ['D-1178', '直動ガイド 15幅', '中央精密機器', 28, 2, 24500, 0],
  ['RB-120', 'ベルトコンベア 1.2m', '相模搬送', 25, 1, 96000, 0],
  ['SV-2030', 'サーボモータ 200W', '中央精密機器', 30, 1, 58000, 0],
  ['PL-7', '安全PLC', '東和空圧工業', 40, 1, 142000, 0],
  ['FR-SG', '安全柵 1.8m', '相模搬送', 20, 1, 46000, 0],
  ['KS-300', 'クリーン用ベアリング', '中央精密機器', 35, 10, 4800, 0],
  ['FL-H14', 'HEPAフィルタユニット', '北都クリーン', 20, 2, 38000, 0],
  ['CB-55', 'クリーンブース フレーム', '北都クリーン', 15, 4, 12000, 0],
];
const PART = Object.fromEntries(PARTS.map(([code, name, maker, lt, lot, price, delay]) => [code, { code, name, maker, lt, lot, price, delay }]));

// 案件（フォルダ）。内示は版ごとに 台数・希望納期・オプション。bom は 1台あたりの使用数（option 付きは、そのオプションのときだけ）。
// alloc は「この案件向けに引き当て済み」の在庫と発注残（入荷予定日）。
const FOLDERS = [
  {
    id: 'f01', customer: CUSTOMER, name: '第2工場 外観検査ライン増設', model: 'VIS-200',
    versions: {
      aug: { date: '2026-08-28', qty: 2, due: '2026-11-14', options: [], note: '' },
      sep: { date: '2026-09-25', qty: 3, due: '2026-11-14', options: ['NG排出シュート'], note: '3号機は増産対応のため追加。NG排出シュートは3台とも' },
    },
    bom: [
      ['ISE1176', 2], ['LED-RING', 2], ['PC-IPC', 1], ['AS-04-237', 8], ['D-1178', 4], ['RB-120', 1], ['SV-2030', 1], ['PL-7', 1],
      ['SV-2030', 1, 'NG排出シュート'],
    ],
    alloc: { ISE1176: [2, 2, '2026-10-10'], 'PC-IPC': [1, 1, '2026-10-05'], 'LED-RING': [6, 0, ''], 'AS-04-237': [10, 0, ''], 'D-1178': [4, 4, '2026-10-20'], 'RB-120': [0, 2, '2026-11-01'], 'SV-2030': [2, 2, '2026-10-15'], 'PL-7': [1, 2, '2026-10-30'] },
    reading: [
      { field: '台数', value: '3台', from: '9月版 PDF 2ページ目「数量 3」', check: false },
      { field: '希望納期', value: '2026-11-14', from: '9月版 PDF 1ページ目「納入希望日」', check: false },
      { field: 'オプション', value: 'NG排出シュート（3台とも）', from: '9月版 PDF 備考欄', check: false },
      { field: '備考', value: '「3号機は増産対応のため追加」', from: '9月版 PDF 備考欄', check: false },
      { field: '要確認', value: '備考欄に手書きで「できれば 11/7」とあり、納入希望日の欄（11/14）と食い違う', from: '9月版 PDF 備考欄（手書き）', check: true },
    ],
  },
  {
    id: 'f02', customer: CUSTOMER, name: '組立セル AS-500 導入', model: 'AS-500',
    versions: {
      aug: { date: '2026-08-28', qty: 2, due: '2026-11-10', options: ['安全柵'], note: '' },
      sep: { date: '2026-09-25', qty: 2, due: '2026-10-15', options: ['ライトカーテン仕様'], note: '工場レイアウト変更に伴い前倒し。安全柵はライトカーテン仕様に変更' },
    },
    bom: [
      ['AS-04-237', 12], ['D-1178', 6], ['SV-2030', 4], ['PL-7', 1],
      ['FR-SG', 1, '安全柵'], ['AS-06-148', 2, 'ライトカーテン仕様'],
    ],
    alloc: { 'AS-04-237': [14, 10, '2026-10-01'], 'D-1178': [8, 0, ''], 'SV-2030': [6, 2, '2026-10-20'], 'PL-7': [2, 0, ''], 'FR-SG': [0, 2, '2026-10-10'], 'AS-06-148': [0, 0, ''] },
    reading: [
      { field: '台数', value: '2台（変更なし）', from: '9月版 CSV 行3', check: false },
      { field: '希望納期', value: '2026-10-15（8月版は 2026-11-10）', from: '9月版 CSV 行3「希望納期」', check: false },
      { field: 'オプション', value: 'ライトカーテン仕様（8月版は 安全柵）', from: '9月版 CSV 行3「仕様」', check: false },
      { field: '備考', value: '「工場レイアウト変更に伴い前倒し」', from: '9月版 CSV 行3「備考」', check: false },
      { field: '要確認', value: '「ライトカーテン仕様」の段数の記載がない（4段で読み取り。2段の可能性あり）', from: '9月版 CSV 行3「仕様」', check: true },
    ],
  },
  {
    id: 'f03', customer: CUSTOMER, name: 'クリーン仕様 搬送ユニット', model: 'CV-CL',
    versions: {
      aug: { date: '2026-08-28', qty: 1, due: '2026-12-05', options: [], note: '' },
      sep: { date: '2026-09-25', qty: 0, due: '2026-12-05', options: [], note: 'クリーンルーム計画の見直しのため取消。再開時期は未定' },
    },
    bom: [['KS-300', 24], ['FL-H14', 4], ['CB-55', 8], ['RB-120', 2], ['AS-04-237', 6]],
    alloc: { 'KS-300': [0, 30, '2026-10-25'], 'FL-H14': [0, 4, '2026-10-15'], 'CB-55': [8, 0, ''], 'RB-120': [0, 2, '2026-11-05'], 'AS-04-237': [6, 0, ''] },
    reading: [
      { field: '台数', value: '0台（8月版は 1台）→ 取消', from: '9月版 PDF 1ページ目「数量 0」と備考「取消」', check: false },
      { field: '備考', value: '「クリーンルーム計画の見直しのため取消。再開時期は未定」', from: '9月版 PDF 備考欄', check: false },
      { field: '要確認', value: '「取消」が内示の取消か、注文の取消かが読み取れない（内示段階のため発注残は当社判断）', from: '9月版 PDF 備考欄', check: true },
    ],
  },
  { id: 'f04', customer: '北都電装株式会社', name: '検査装置 更新', model: 'VIS-100', pending: '9月版の内示がまだ届いていません（8月版のみ）。先方の購買ご担当に 10/3 に確認済み、10/8 送付予定' },
  { id: 'f05', customer: '三ツ星機工株式会社', name: 'パレタイザ 追加', model: 'PZ-40', pending: '9月版の内示がまだ届いていません（8月版のみ）。未確認' },
  { id: 'f06', customer: '相模オートメーション株式会社', name: 'ワーク供給装置', model: 'FD-20', pending: '8月版・9月版とも未受領（口頭のみ）。書面の内示を依頼中' },
];

export const RULES = [
  { key: 'need', name: '必要数', formula: '台数 × 1台あたりの使用数（オプション部品は、そのオプションのときだけ）' },
  { key: 'short', name: '不足', formula: '必要数 −（引当済みの在庫 ＋ 発注残）。0 未満は 0' },
  { key: 'order', name: '追加手配', formula: '不足をロットの倍数に切り上げ' },
  { key: 'eta', name: '入手見込み', formula: '基準日 ＋ 発注リードタイム ＋ メーカー案内の遅れ（追加手配する部品）／ 発注残の入荷予定日（追加手配しない部品）' },
  { key: 'late', name: '遅れ', formula: '入手見込み − 希望納期。プラスなら遅れ' },
  { key: 'deadline', name: '発注期限', formula: '希望納期 − 発注リードタイム − メーカー案内の遅れ' },
  { key: 'urgent', name: '急ぐ', formula: `発注期限が基準日から ${URGENT_DAYS}日以内、または過ぎている（追加手配がある部品だけ）` },
  { key: 'excess', name: '過剰', formula: '取消・仕様変更で不要になった部品の発注残（在庫は他案件で使えるため数えない）' },
];

// ---------- 計算（ここだけ） ----------
function build(base = DEFAULT_BASE) {
  const folders = FOLDERS.map((f) => (f.pending ? { ...f, parts: [], changes: [], excess: [], actions: [] } : buildFolder(f, base)));
  // 振替候補: 過剰になった発注残と同じ型番が、ほかの案件で不足している
  for (const f of folders) {
    for (const ex of f.excess) {
      ex.transfer = folders.filter((o) => o.id !== f.id).flatMap((o) => o.parts.filter((p) => p.code === ex.code && p.short > 0).map((p) => ({ folderId: o.id, folderName: o.name, short: p.short })));
    }
  }
  // 次のアクション（文面の下書き）は、振替候補まで決まってから作る
  for (const f of folders) if (!f.pending) f.actions = buildActions(f, f.parts, f.changes, f.excess, base);
  return { base, urgentUntil: addDays(base, URGENT_DAYS), folders };
}

function buildFolder(f, base) {
  const { aug, sep } = f.versions;
  const need = (v, code, opt) => (opt && !v.options.includes(opt) ? 0 : v.qty * (f.bom.find(([c, , o]) => c === code && (o || null) === (opt || null))?.[1] ?? 0));
  const codes = [...new Set(f.bom.map(([c]) => c))];
  const parts = codes.map((code) => {
    const p = PART[code];
    const opts = f.bom.filter(([c]) => c === code).map(([, , o]) => o || null);
    const needAug = sum(opts.map((o) => need(aug, code, o)));
    const needSep = sum(opts.map((o) => need(sep, code, o)));
    const [stock, po, poDate] = f.alloc[code] || [0, 0, ''];
    const short = Math.max(0, needSep - (stock + po));
    const order = short > 0 ? Math.ceil(short / p.lot) * p.lot : 0;
    const eta = short > 0 ? addDays(base, p.lt + p.delay) : po > 0 && needSep > 0 ? poDate : '';
    const etaKind = short > 0 ? '追加手配' : eta ? '発注残の入荷' : '';
    const late = eta && sep.qty > 0 ? daysBetween(sep.due, eta) : 0;
    const deadline = short > 0 ? addDays(sep.due, -(p.lt + p.delay)) : '';
    const urgent = Boolean(deadline) && deadline <= addDays(base, URGENT_DAYS);
    const optNames = opts.filter(Boolean);
    const optionOnly = opts.every(Boolean);
    const excess = needSep < needAug && po > 0 ? Math.max(0, Math.min(po, stock + po - needSep)) : 0;
    return {
      code, name: p.name, maker: p.maker, lt: p.lt, lot: p.lot, price: p.price, delay: p.delay,
      option: optNames.join('・'), optionOnly, optNames,
      needAug, needSep, stock, po, poDate, short, order, eta, etaKind, late, deadline, urgent, excess,
      // 根拠（画面のツールチップと AI の両方がこれを使う。式に実際の数字を入れる）
      basis: {
        need: `${sep.qty}台 × ${sep.qty ? needSep / sep.qty : 0}個${optNames.length && !optionOnly ? `（うちオプション「${optNames.join('・')}」分 ${sep.qty ? sum(optNames.map((o) => need(sep, code, o))) : 0}）` : ''} ＝ 必要数 ${needSep}`,
        short: `必要数 ${needSep} −（在庫 ${stock} ＋ 発注残 ${po}）＝ ${needSep - (stock + po) < 0 ? `${needSep - (stock + po)} → 不足なし` : `不足 ${short}`}`,
        order: short > 0 ? `不足 ${short} → ロット ${p.lot} の倍数に切り上げ ＝ 追加手配 ${order}` : '追加手配なし',
        eta: short > 0
          ? `基準日 ${md(base)} ＋ リードタイム ${p.lt}日${p.delay ? ` ＋ メーカー案内の遅れ ${p.delay}日` : ''} ＝ 入手見込み ${md(eta)}`
          : eta ? `発注残 ${po} の入荷予定日 ${md(eta)}` : '',
        late: eta && sep.qty > 0 ? `入手見込み ${md(eta)} − 希望納期 ${md(sep.due)} ＝ ${late > 0 ? `${late}日の遅れ` : `${-late}日の余裕`}` : '',
        deadline: deadline ? `希望納期 ${md(sep.due)} − リードタイム ${p.lt}日${p.delay ? ` − 案内の遅れ ${p.delay}日` : ''} ＝ 発注期限 ${md(deadline)}${deadline < base ? '（期限を過ぎています）' : urgent ? `（${md(addDays(base, URGENT_DAYS))} までに発注）` : ''}` : '',
      },
    };
  });

  // 変更点（8月版 → 9月版）
  const changes = [];
  if (aug.qty > 0 && sep.qty === 0) {
    changes.push({ kind: '取消', title: `${aug.qty}台 → 取消`, before: `${aug.qty}台`, after: '取消', note: sep.note, affected: parts.filter((p) => p.needAug > 0).map((p) => p.code) });
  } else {
    if (sep.qty !== aug.qty) changes.push({ kind: sep.qty > aug.qty ? '増量' : '減量', title: `${aug.qty}台 → ${sep.qty}台`, before: `${aug.qty}台`, after: `${sep.qty}台`, note: sep.note, affected: parts.filter((p) => !p.optionOnly && p.needSep !== p.needAug).map((p) => p.code) });
    if (sep.due !== aug.due) changes.push({ kind: sep.due < aug.due ? '前倒し' : '後ろ倒し', title: `希望納期 ${md(aug.due)} → ${md(sep.due)}`, before: md(aug.due), after: md(sep.due), note: `${Math.abs(daysBetween(aug.due, sep.due))}日の${sep.due < aug.due ? '前倒し' : '後ろ倒し'}`, affected: parts.filter((p) => p.late > 0).map((p) => p.code) });
    const added = sep.options.filter((o) => !aug.options.includes(o)), removed = aug.options.filter((o) => !sep.options.includes(o));
    if (added.length || removed.length) changes.push({ kind: 'オプション', title: `${removed.join('・') || 'なし'} → ${added.join('・') || 'なし'}`, before: removed.join('・') || 'なし', after: added.join('・') || 'なし', note: 'オプションから部品を逆引き', affected: parts.filter((p) => p.optNames.some((o) => added.includes(o) || removed.includes(o))).map((p) => p.code) });
  }
  const excess = parts.filter((p) => p.excess > 0).map((p) => ({ code: p.code, name: p.name, maker: p.maker, excess: p.excess, poDate: p.poDate, amount: p.excess * p.price, option: p.option }));

  return { ...f, parts, changes, excess, actions: [] };
}

function buildActions(f, parts, changes, excess, base) {
  const { sep } = f.versions;
  const out = [];
  const lateOrders = parts.filter((p) => p.short > 0 && p.late > 0);
  const orders = parts.filter((p) => p.short > 0);
  const byMaker = groupBy(orders, (p) => p.maker);
  for (const [maker, list] of byMaker) {
    const lines = list.map((p) => `・${p.code} ${p.name}：${p.order}個（${p.late > 0 ? `希望納期 ${md(sep.due)} に対し入手見込み ${md(p.eta)}、${p.late}日遅れの見込み。短縮の可否をご確認ください` : `入手見込み ${md(p.eta)}`}）`);
    out.push({ to: `${maker} 営業ご担当`, kind: 'メーカーへの手配・納期確認', subject: `【手配・納期確認】${f.name}向け 部品`, body: `${maker} 営業ご担当者様\n\nいつもお世話になっております。${OUR_NAME}です。\n${CUSTOMER}様の「${f.name}」向けに、下記の手配をお願いします。\n\n${lines.join('\n')}\n\n納期の短縮が可能な場合、最短の納期をお知らせください。\nよろしくお願いいたします。` });
  }
  if (lateOrders.length) {
    out.push({ to: `${CUSTOMER} 購買ご担当`, kind: 'お客様への納期ご相談', subject: `【納期ご相談】${f.name}（${md(sep.date)} 内示分）`, body: `${CUSTOMER} 購買ご担当者様\n\nいつもお世話になっております。${OUR_NAME}です。\n${md(sep.date)} 付の内示（${f.name}）について、下記の部品はメーカーの納期から、希望納期 ${md(sep.due)} に間に合わない見込みです。\n\n${lateOrders.map((p) => `・${p.code} ${p.name}：入手見込み ${md(p.eta)}（${p.late}日遅れ）`).join('\n')}\n\n分納、または納期のご相談をさせていただけないでしょうか。\nよろしくお願いいたします。` });
  }
  if (excess.length) {
    out.push({ to: '社内（購買・営業）', kind: '過剰になる発注残の扱い', subject: `【要判断】${f.name} 不要になる発注残 ${excess.length}件`, body: `${f.name}（${changes.map((c) => c.title).join('、')}）により、下記の発注残が不要になる見込みです。\n\n${excess.map((e) => `・${e.code} ${e.name}：発注残 ${e.excess}個（入荷予定 ${md(e.poDate)}、約${man(e.amount)}万円）${e.transfer?.length ? ` → ${e.transfer.map((t) => `「${t.folderName}」で ${t.short}個不足。振替候補`).join('／')}` : ''}`).join('\n')}\n\nキャンセル可否をメーカーに確認するか、他案件へ振り替えるかをご判断ください。` });
  }
  const checks = (f.reading || []).filter((r) => r.check);
  if (checks.length) {
    out.push({ to: `${CUSTOMER} 購買ご担当`, kind: '内示の記載の確認', subject: `【ご確認】${f.name} 内示の記載について`, body: `${CUSTOMER} 購買ご担当者様\n\nいつもお世話になっております。${OUR_NAME}です。\n${md(sep.date)} 付の内示（${f.name}）について、下記をご確認させてください。\n\n${checks.map((r) => `・${r.value}`).join('\n')}\n\nお手数ですが、ご回答をお願いいたします。` });
  }
  void base;
  return out;
}

// ---------- 画面向け ----------
export function getDemoData({ base = DEFAULT_BASE, folder = 'all' } = {}) {
  base = normalizeBase(base);
  const b = build(base);
  const selected = b.folders.find((f) => f.id === folder) || null;
  const active = b.folders.filter((f) => !f.pending);
  const scope = selected ? [selected] : active;
  const rows = scope.flatMap((f) => f.parts.map((p) => ({ ...p, base, folderId: f.id, folderName: f.name, due: f.versions.sep.due, qty: f.versions.sep.qty })));
  const urgent = rows.filter((p) => p.urgent).sort((a, c) => cmp(a.deadline, c.deadline));
  const late = rows.filter((p) => p.late > 0).sort((a, c) => c.late - a.late);
  const changes = scope.flatMap((f) => f.changes.map((c) => ({ ...c, folderId: f.id, folderName: f.name, affectedRows: c.affected.map((code) => rows.find((r) => r.folderId === f.id && r.code === code)) })));
  const excess = scope.flatMap((f) => f.excess.map((e) => ({ ...e, folderId: f.id, folderName: f.name })));
  const actions = scope.flatMap((f) => f.actions.map((a) => ({ ...a, folderId: f.id, folderName: f.name })));

  return {
    title: 'ACS株式会社様 在庫・内示モック',
    subtitle: '内示の版を置くだけで、変更点・影響部品・手配の急ぎ順が表になります。AI は読み取りと文面の下書きだけで、数字は計算しません。',
    base, baseLabel: md(base), baseOptions: BASE_DATES, urgentUntil: md(b.urgentUntil),
    baseNote: base === DEFAULT_BASE
      ? `基準日は ${md(base)}（9月版の内示を受け取った日）の想定です。「期限を過ぎた」は、その日の時点で発注期限を過ぎていた部品です。`
      : `基準日を ${md(base)}（今日）にして見ています。9/25 に発注していない前提なので、入手見込みが ${daysBetween(DEFAULT_BASE, base)}日後ろにずれ、遅れが増えます。`,
    footNote: '数量・単価・会社名・担当者名・型番はすべて架空のデモデータです。計算は「計算の決まり v1」のとおり機械的に行い、AI は計算しません。',
    selectedFolder: selected ? selected.id : 'all',
    defaultTab: 'changes',
    tabs: [
      { id: 'changes', label: '内示の変更点', count: changes.length },
      { id: 'urgent', label: '手配を急ぐ部品', count: urgent.length },
      { id: 'late', label: '納期の遅れ', count: late.length },
      { id: 'folders', label: 'フォルダ', count: b.folders.length },
      { id: 'rules', label: '計算の決まり', count: RULES.length },
      { id: 'reading', label: 'AI の読み取り', count: scope.reduce((s, f) => s + (f.reading || []).filter((r) => r.check).length, 0) },
    ],
    folders: b.folders.map((f) => ({
      id: f.id, customer: f.customer, name: f.name, model: f.model, pending: f.pending || '',
      status: f.pending ? '9月版 未受領' : f.changes.map((c) => c.kind).join('・') || '変更なし',
      urgent: f.parts.filter((p) => p.urgent).length, late: f.parts.filter((p) => p.late > 0).length,
      versions: f.pending ? null : { aug: { ...f.versions.aug, dueLabel: md(f.versions.aug.due) }, sep: { ...f.versions.sep, dueLabel: md(f.versions.sep.due) } },
    })),
    summary: {
      urgent: urgent.length, late: late.length, changes: changes.length, excess: excess.length,
      excessAmount: Math.round(sum(excess.map((e) => e.amount)) / 10000),
    },
    urgent: urgent.map(row),
    late: late.map(row),
    changes: changes.map((c) => ({ kind: c.kind, title: c.title, before: c.before, after: c.after, note: c.note, folderId: c.folderId, folderName: c.folderName, affected: c.affectedRows.map(row) })),
    excess: excess.map((e) => ({ ...e, amountMan: man(e.amount), poDateLabel: md(e.poDate), transfer: (e.transfer || []).map((t) => `「${t.folderName}」で ${t.short}個 不足 → 振替候補`) })),
    actions,
    rules: RULES,
    reading: scope.map((f) => ({ folderId: f.id, folderName: f.name, items: f.reading || [] })),
    examples: suggestQuestions(selected, rows, changes),
    aiNote: 'AI は、この画面の表に出ている数字をそのまま読み上げるだけで、計算や予測はしません。',
  };
}

function row(p) {
  return {
    folderId: p.folderId, folderName: p.folderName, code: p.code, name: p.name, maker: p.maker, option: p.option,
    qty: p.qty, needAug: p.needAug, needSep: p.needSep, stock: p.stock, po: p.po, poDate: p.poDate ? md(p.poDate) : '',
    short: p.short, order: p.order, lot: p.lot, lt: p.lt, delay: p.delay,
    eta: p.eta ? md(p.eta) : '', etaKind: p.etaKind, late: p.late, due: md(p.due),
    deadline: p.deadline ? md(p.deadline) : '', deadlinePassed: Boolean(p.deadline) && p.deadline < p.base, urgent: p.urgent,
    amount: man(p.order * p.price), basis: p.basis,
  };
}

// おすすめ質問は、選択中のフォルダの表に実在する型番・数字から作る（固定文を出さない）
function suggestQuestions(selected, rows, changes) {
  const q = [];
  if (!selected) {
    q.push('全案件で、手配を急ぐ部品を発注期限の早い順に読み上げてください');
    q.push('内示の変更点を案件ごとに一言ずつまとめてください');
    q.push('過剰になる発注残のうち、他の案件に振り替えられそうなものは？');
    return q;
  }
  if (selected.pending) {
    q.push(`「${selected.name}」で、今できることは何ですか`);
    return q;
  }
  const late = rows.filter((r) => r.late > 0).sort((a, c) => c.late - a.late)[0];
  const urgent = rows.filter((r) => r.urgent)[0];
  if (changes.length) q.push(`この案件の内示の変更点（${changes.map((c) => c.kind).join('・')}）を、お客様に確認する文面にしてください`);
  if (late) q.push(`${late.code} が ${late.late}日遅れる根拠を、式のとおりに説明してください`);
  if (urgent) q.push(`${urgent.code} の追加手配 ${urgent.order}個の内訳を教えてください`);
  if (selected.excess.length) q.push(`取消で過剰になる ${selected.excess[0].code} の発注残は、どう扱うのがよいですか`);
  if (!q.length) q.push('この案件で注意すべき点を、表の数字をもとに教えてください');
  return q.slice(0, 4);
}

// ---------- AI 向け（画面と同じ build() の結果。選択中のフォルダだけを渡す） ----------
export function getAiData({ base = DEFAULT_BASE, folder = 'all' } = {}) {
  base = normalizeBase(base);
  const b = build(base);
  const selected = b.folders.find((f) => f.id === folder) || null;
  const scope = selected ? [selected] : b.folders.filter((f) => !f.pending);
  const partRow = (f, p) => ({
    型番: p.code, 品名: p.name, メーカー: p.maker, ...(p.option ? { オプション: p.option } : {}),
    '8月版の必要数_個': p.needAug, '9月版の必要数_個': p.needSep, 引当済み在庫_個: p.stock, 発注残_個: p.po, ...(p.poDate ? { 発注残の入荷予定日: p.poDate } : {}),
    不足_個: p.short, 追加手配_個: p.order, ...(p.eta ? { 入手見込み: p.eta, 入手見込みの種類: p.etaKind, 希望納期: f.versions.sep.due, 遅れ_日: p.late } : {}),
    ...(p.deadline ? { 発注期限: p.deadline, 急ぐ: p.urgent } : {}), ...(p.excess ? { 過剰になる発注残_個: p.excess } : {}),
    根拠: Object.values(p.basis).filter(Boolean),
  });
  return {
    context: `FA機器商社のデモ。お客様（${CUSTOMER}、架空）から届いた内示（8月版 → 9月版）と、部品の在庫・発注残を突き合わせた結果。基準日 ${base}。${selected ? `利用者がいま開いている案件: 「${selected.name}」。質問の「この案件」はこれを指す。ほかの案件のことは聞かれたときだけ答える。` : '利用者は「全案件」を開いている。'}`,
    note: 'すべて架空データ。数字は下の表の値をそのまま使い、新しい数字を計算しない（足し算もしない）。表に無い型番・数字は出さない。根拠を聞かれたら「根拠」の文をそのまま示す。',
    計算の決まり_v1: Object.fromEntries(RULES.map((r) => [r.name, r.formula])),
    急ぐの条件: `発注期限が ${b.urgentUntil} 以前`,
    案件: scope.map((f) => f.pending
      ? { 案件: f.name, お客様: f.customer, 状態: f.pending }
      : {
        案件: f.name, お客様: f.customer, 機種: f.model,
        内示: { '8月版': f.versions.aug, '9月版': f.versions.sep },
        変更点: f.changes.map((c) => ({ 種類: c.kind, 内容: c.title, 影響する型番: c.affected, 備考: c.note })),
        部品: f.parts.map((p) => partRow(f, p)),
        過剰になる発注残: f.excess.map((e) => ({ 型番: e.code, 品名: e.name, 発注残_個: e.excess, 入荷予定日: e.poDate, 金額_円: e.amount, 振替候補: (e.transfer || []).map((t) => `${t.folderName}で${t.short}個不足`) })),
        内示からの読み取り: f.reading,
        次のアクションの下書き: f.actions.map((a) => ({ 宛先: a.to, 種類: a.kind, 件名: a.subject })),
      }),
  };
}

// テスト用に計算結果をそのまま出す
export function _build(base = DEFAULT_BASE) { return build(normalizeBase(base)); }
export { FOLDERS as _FOLDERS, PART as _PART };

// ---------- 小道具 ----------
function normalizeBase(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? String(s) : DEFAULT_BASE; }
function sum(a) { return a.reduce((s, v) => s + v, 0); }
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function man(yen) { return (Math.round(yen / 1000) / 10).toLocaleString('ja-JP'); }
function md(s) { return s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : ''; }
function groupBy(list, key) { const m = new Map(); for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
function addDays(s, d) { const t = new Date(`${s}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
function daysBetween(from, to) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000); }
