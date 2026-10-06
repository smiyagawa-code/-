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

import { CUSTOMER_CONTACT, applyOverrides, getDefaultMasters, normalizeOverrides, supplierLookup } from './masters.js';

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
      { field: '要確認', ask: '希望日は 11/14？ それとも手書きの 11/7？', value: '備考欄に手書きで「できれば 11/7」とあり、納入希望日の欄（11/14）と食い違う', from: '9月版 PDF 備考欄（手書き）', check: true },
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
      { field: '要確認', ask: 'ライトカーテンは 4段？ 2段？', value: '「ライトカーテン仕様」の段数の記載がない（4段で読み取り。2段の可能性あり）', from: '9月版 CSV 行3「仕様」', check: true },
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
      { field: '要確認', ask: '「取消」は内示の取消？ 注文の取消？', value: '「取消」が内示の取消か、注文の取消かが読み取れない（内示の段階なので、頼み済み分の扱いは当社判断）', from: '9月版 PDF 備考欄', check: true },
    ],
  },
  { id: 'f04', customer: '北都電装株式会社', name: '検査装置 更新', model: 'VIS-100', pending: '9月版の内示がまだ届いていません（8月版のみ）。先方の購買ご担当に 10/3 に確認済み、10/8 送付予定' },
  { id: 'f05', customer: '三ツ星機工株式会社', name: 'パレタイザ 追加', model: 'PZ-40', pending: '9月版の内示がまだ届いていません（8月版のみ）。未確認' },
  { id: 'f06', customer: '相模オートメーション株式会社', name: 'ワーク供給装置', model: 'FD-20', pending: '8月版・9月版とも未受領（口頭のみ）。書面の内示を依頼中' },
];

// 計算のしかた（現場の言葉。画面の「？」と AI の両方がこれを使う）
export const RULES = [
  { key: 'need', name: 'いる数', formula: '台数 × 1台に使う数' },
  { key: 'short', name: '足りない数', formula: 'いる数 − 今ある分（在庫 ＋ メーカーに頼み済み）' },
  { key: 'order', name: '手配する数', formula: '足りない数を、まとめ買いの単位に切り上げ' },
  { key: 'eta', name: '届く日', formula: '今日 ＋ メーカーの納期 ＋ メーカーからの遅れ連絡' },
  { key: 'late', name: '遅れ', formula: '届く日 − お客様の希望日' },
  { key: 'deadline', name: '発注の締切', formula: '希望日 − メーカーの納期。締切まで 1週間を切ったら「急ぎ」' },
  { key: 'excess', name: '余る数', formula: '取消・変更でいらなくなった、頼み済みの分' },
];

// ---------- 内示 CSV の読み取り（お客様から届く内示の形を想定。列名のゆれを吸収） ----------
const COLS = {
  date: ['内示日', '日付', '発行日'], customer: ['得意先', 'お客様', '顧客'], name: ['案件', '案件名', '件名'], model: ['機種', '型式', 'モデル'],
  qty: ['数量', '台数'], due: ['納入希望日', '希望日', '希望納期', '納期'], options: ['仕様', 'オプション'], note: ['備考', 'コメント'],
};
export function parseNaishiCsv(text) {
  const rows = csvRows(String(text || '').replace(/^\uFEFF/, ''));
  if (rows.length < 2) return { rows: [], errors: ['表が空です'] };
  const header = rows[0].map((h) => h.trim());
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  const errors = [];
  for (const k of ['name', 'qty', 'due']) if (idx[k] < 0) errors.push(`列「${COLS[k][0]}」がありません`);
  if (errors.length) return { rows: [], errors };
  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
  const out = [];
  rows.slice(1).forEach((r, i) => {
    if (r.every((c) => !c.trim())) return;
    const line = i + 2;
    const qtyText = get(r, 'qty').replace(/[台個,]/g, '').trim();
    const qty = qtyText === '' ? NaN : Number(qtyText); // 空欄は 0 ではなく「読めない」
    const due = isoDate(get(r, 'due'));
    if (!Number.isInteger(qty) || qty < 0) { errors.push(`${line}行目: 数量「${get(r, 'qty')}」が読めません`); return; }
    if (!due && qty > 0) { errors.push(`${line}行目: 納入希望日「${get(r, 'due')}」が読めません`); return; } // 取消（0台）は希望日が無くてもよい
    out.push({
      line, date: isoDate(get(r, 'date')) || '', customer: get(r, 'customer'), name: get(r, 'name'), model: get(r, 'model'), qty, due,
      options: get(r, 'options').split(/[・、,/／]/).map((o) => o.trim()).filter((o) => o && o !== '標準' && o !== 'なし'),
      note: get(r, 'note'),
    });
  });
  return { rows: out, errors };
}
function csvRows(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function isoDate(s) {
  const m = String(s).trim().match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/);
  if (!m) return '';
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? '' : d;
}
// CSV の行を案件に当てはめる（機種 → 案件名 の順で照合）。当てはまった案件は「今回の内示」を CSV の値に差し替える
// 内示の行をどの案件に当てはめるか: 案件名が同じもの → 機種が同じものが 1 つだけならそれ（同じ機種の案件が複数あるときは案件名で）
export function findFolder(r, folders = FOLDERS) {
  if (r.name) { const byName = folders.find((x) => x.name === r.name && (!x.pending || x.user)); if (byName) return byName; }
  if (r.model) { const byModel = folders.filter((x) => !x.pending && x.model === r.model); if (byModel.length === 1) return byModel[0]; }
  return null;
}

// 画面で作った案件（得意先・案件名・機種・内示）。部品表（bom）は同じ機種の既存の案件から流用する。引き当て済みの在庫・発注残は無し
const MAX_USER_FOLDERS = 20;
export function normalizeFolders(raw) {
  if (!Array.isArray(raw)) return [];
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const out = [];
  for (const u of raw.slice(0, MAX_USER_FOLDERS)) {
    if (!u || typeof u !== 'object') continue;
    const customer = str(u.customer, 60), name = str(u.name, 80), model = str(u.model, 40);
    if (!customer || !name || !model) continue;
    const qty = Number.isInteger(u.qty) && u.qty >= 0 && u.qty <= 9999 ? u.qty : null;
    const due = isoDate(str(u.due, 20)), date = isoDate(str(u.date, 20));
    const options = Array.isArray(u.options) ? u.options.map((o) => str(o, 40)).filter(Boolean).slice(0, 10) : [];
    out.push({ id: `u${out.length + 1}`, customer, name, model, qty, due, date, options, note: str(u.note, 200) });
  }
  return out;
}
export function folderList(extra) {
  const users = normalizeFolders(extra).map((u) => {
    const tpl = FOLDERS.find((f) => !f.pending && f.model === u.model);
    const base = { id: u.id, customer: u.customer, name: u.name, model: u.model, user: true, registered: u.date };
    if (!tpl) return { ...base, pending: `機種 ${u.model} の部品表がまだありません（読み替えルールの登録が要ります）` };
    if (u.qty == null || !u.due) return { ...base, pending: '内示を待っています（案件は登録済み）', bom: tpl.bom, alloc: {} };
    const sep = { date: u.date || DEFAULT_BASE, qty: u.qty, due: u.due, options: u.options, note: u.note };
    return { ...base, bom: tpl.bom, alloc: {}, versions: { aug: sep, sep }, reading: readingFromRegistration(sep) };
  });
  return users.length ? [...FOLDERS, ...users] : FOLDERS;
}
function readingFromRegistration(v) {
  return [
    { field: '台数', value: `${v.qty}台`, from: '案件の登録', check: false },
    { field: '希望日', value: v.due, from: '案件の登録', check: false },
    { field: '仕様', value: v.options.join('・') || '標準', from: '案件の登録', check: false },
    ...(v.note ? [{ field: '備考', value: `「${v.note}」`, from: '案件の登録', check: false }] : []),
  ];
}

function applyCsv(rows, folders = FOLDERS) {
  const matched = [], unmatched = [];
  const over = {};
  for (const r of rows) {
    const f = findFolder(r, folders);
    if (!f || (f.pending && !f.user)) { unmatched.push(r); continue; }
    over[f.id] = r;
    matched.push({ folderId: f.id, name: f.name, line: r.line });
  }
  return { over, matched, unmatched };
}
// CSV から読み取った内示の「確かめること」（記載のゆれを機械的に拾う。AI は使わない）
function readingFromCsv(f, r) {
  const src = (col) => `CSV ${r.line}行目「${col}」`;
  const items = [
    { field: '台数', value: r.qty ? `${r.qty}台` : '0台 → 取消', from: src('数量'), check: false },
    { field: '希望日', value: r.due, from: src('納入希望日'), check: false },
    { field: '仕様', value: r.options.join('・') || '標準', from: src('仕様'), check: false },
  ];
  if (r.note) items.push({ field: '備考', value: `「${r.note}」`, from: src('備考'), check: false });
  if (r.options.some((o) => /ライトカーテン/.test(o) && !/段/.test(o))) items.push({ field: '要確認', ask: 'ライトカーテンは 4段？ 2段？', value: '「ライトカーテン仕様」の段数の記載がない（4段で読み取り）', from: src('仕様'), check: true });
  if (r.qty === 0) items.push({ field: '要確認', ask: '「取消」は内示の取消？ 注文の取消？', value: '「取消」が内示の取消か、注文の取消かが読み取れない', from: src('備考'), check: true });
  const m = r.note.match(/(\d{1,2})\/(\d{1,2})/);
  if (m && `${Number(m[1])}/${Number(m[2])}` !== md(r.due)) items.push({ field: '要確認', ask: `希望日は ${md(r.due)}？ それとも備考の ${Number(m[1])}/${Number(m[2])}？`, value: `備考に「${m[0]}」とあり、納入希望日（${md(r.due)}）と食い違う`, from: src('備考'), check: true });
  return items;
}

// ---------- 計算（ここだけ） ----------
// overrides = 画面の「設定」で直した値（検証済み。src/masters.js の normalizeOverrides）。部品カタログと案件の部品表に当ててから計算する
function build(base = DEFAULT_BASE, csvRowsIn = null, overrides = null, extraFolders = null) {
  const ALL = folderList(extraFolders);
  const { over, matched, unmatched } = csvRowsIn ? applyCsv(csvRowsIn, ALL) : { over: {}, matched: [], unmatched: [] };
  const catalog = overrides?.parts ? Object.fromEntries(Object.entries(PART).map(([code, p]) => [code, { ...p, ...(overrides.parts[code] || {}) }])) : PART;
  const withCsv = (f) => {
    const r = over[f.id];
    if (!r) return f;
    if (f.pending && f.user) { // 内示待ちで登録した案件に、初めての内示が来た（比べる前回はまだない）
      const first = { date: r.date || base, qty: r.qty, due: r.due, options: r.options, note: r.note };
      const { pending, ...rest } = f;
      return { ...rest, versions: { aug: first, sep: first }, reading: readingFromCsv(f, r), fromCsv: true, firstVersion: true };
    }
    const sep = { date: r.date || f.versions.sep.date, qty: r.qty, due: r.due || f.versions.sep.due, options: r.options, note: r.note };
    return { ...f, versions: { aug: f.versions.aug, sep }, reading: readingFromCsv(f, r), fromCsv: true };
  };
  const withBom = (f) => (overrides?.bom?.[f.id] ? { ...f, bom: overrides.bom[f.id].map((r) => (r.option ? [r.code, r.qty, r.option] : [r.code, r.qty])) } : f);
  const folders = ALL.map(withCsv).map((f) => (f.pending ? { ...f, parts: [], changes: [], excess: [], todos: [] } : buildFolder(withBom(f), base, catalog)));
  // 回せる先: 余った頼み済み分と同じ型番が、ほかの案件で足りない
  for (const f of folders) {
    for (const ex of f.excess) {
      ex.transfer = folders.filter((o) => o.id !== f.id).flatMap((o) => o.parts.filter((p) => p.code === ex.code && p.short > 0).map((p) => ({ folderId: o.id, folderName: o.name, short: p.short })));
    }
  }
  const suppliers = supplierLookup(overrides); // メーカーの窓口（「設定」で直した担当者を反映）
  for (const f of folders) if (!f.pending) f.todos = buildTodos(f, base, suppliers);
  return { base, urgentUntil: addDays(base, URGENT_DAYS), folders, csv: csvRowsIn ? { matched, unmatched: unmatched.map((r) => ({ line: r.line, name: r.name || r.model || '(案件名なし)' })) } : null };
}

function buildFolder(f, base, catalog = PART) {
  const { aug, sep } = f.versions;
  // 表記のゆれ（「NGシュート（3台とも）」と「NG排出シュート」など）は、括弧・空白・「排出」「仕様」を除いて比べる
  const norm = (x) => String(x).replace(/（.*?）|\(.*?\)|\s|排出|仕様/g, '');
  const hasOpt = (v, opt) => v.options.some((o) => { const a = norm(o), b = norm(opt); return a && b && (a === b || a.includes(b) || b.includes(a)); });
  const need = (v, code, opt) => (opt && !hasOpt(v, opt) ? 0 : v.qty * (f.bom.find(([c, , o]) => c === code && (o || null) === (opt || null))?.[1] ?? 0));
  const codes = [...new Set(f.bom.map(([c]) => c))];
  const parts = codes.map((code) => {
    const p = catalog[code];
    const opts = f.bom.filter(([c]) => c === code).map(([, , o]) => o || null);
    const needAug = sum(opts.map((o) => need(aug, code, o)));
    const needSep = sum(opts.map((o) => need(sep, code, o)));
    const [stock, po, poDate] = f.alloc[code] || [0, 0, ''];
    const have = stock + po;
    const short = Math.max(0, needSep - have);
    const order = short > 0 ? Math.ceil(short / p.lot) * p.lot : 0;
    const eta = short > 0 ? addDays(base, p.lt + p.delay) : po > 0 && needSep > 0 ? poDate : '';
    const etaKind = short > 0 ? '手配' : eta ? '頼み済み分の入荷' : '';
    const late = eta && sep.qty > 0 ? daysBetween(sep.due, eta) : 0;
    const deadline = short > 0 ? addDays(sep.due, -(p.lt + p.delay)) : '';
    const urgent = Boolean(deadline) && deadline <= addDays(base, URGENT_DAYS);
    const optNames = opts.filter(Boolean);
    const optionOnly = opts.every(Boolean);
    const excess = needSep < needAug && po > 0 ? Math.max(0, Math.min(po, have - needSep)) : 0;
    const perUnit = sep.qty ? needSep / sep.qty : 0;
    // 「なぜ？」で出す文（現場の言葉・1行ずつ・実際の数字入り）。画面と AI の両方がこれを使う
    const why = [
      sep.qty ? `${sep.qty}台 × 1台に${perUnit}個 ＝ ${needSep}個いる` : `取消なので 0個でよい（前回は ${needAug}個）`,
      `今ある分 ${have}個（在庫 ${stock} ＋ 頼み済み ${po}）`,
      short > 0 ? `${needSep} − ${have} ＝ ${short}個足りない` : needSep > 0 ? `${needSep} − ${have} ≦ 0 → 足りている` : excess ? `頼み済み ${po}個のうち ${excess}個が余る` : '',
      short > 0 && order !== short ? `${short}個 → まとめ買いの単位 ${p.lot}個 → ${order}個手配` : short > 0 ? `${order}個手配` : '',
      short > 0 ? `${md(base)} ＋ 納期 ${p.lt}日${p.delay ? ` ＋ 遅れ連絡 ${p.delay}日` : ''} ＝ ${md(eta)} に届く` : eta ? `頼み済み分が ${md(eta)} に届く` : '',
      eta && sep.qty > 0 ? `${md(eta)} − 希望日 ${md(sep.due)} ＝ ${late > 0 ? `${late}日遅れ` : `${-late}日前に届く`}` : '',
      deadline ? `発注の締切 ${md(deadline)}（希望日 − 納期）${deadline < base ? ' → 過ぎている' : urgent ? ' → 今週中' : ''}` : '',
    ].filter(Boolean);
    return {
      code, name: p.name, maker: p.maker, lt: p.lt, lot: p.lot, price: p.price, delay: p.delay,
      option: optNames.join('・'), optionOnly, optNames,
      needAug, needSep, stock, po, poDate, have, short, order, eta, etaKind, late, deadline, urgent, excess, why,
      status: sep.qty === 0 ? (excess ? '余る' : '－') : late > 0 ? `${late}日遅れ` : short > 0 ? '手配すれば間に合う' : excess ? '余る' : '足りている',
      tone: late > 0 ? 'red' : short > 0 && urgent ? 'amber' : excess ? 'amber' : short > 0 ? 'blue' : 'ok',
    };
  });

  // 変わった点（前回 → 今回）
  const changes = [];
  if (aug.qty > 0 && sep.qty === 0) {
    changes.push({ kind: '取消', title: `${aug.qty}台 → 取消`, note: sep.note, affected: parts.filter((p) => p.needAug > 0).map((p) => p.code) });
  } else {
    if (sep.qty !== aug.qty) changes.push({ kind: sep.qty > aug.qty ? '増えた' : '減った', title: `${aug.qty}台 → ${sep.qty}台`, note: sep.note, affected: parts.filter((p) => !p.optionOnly && p.needSep !== p.needAug).map((p) => p.code) });
    if (sep.due !== aug.due) changes.push({ kind: sep.due < aug.due ? '前倒し' : '後ろ倒し', title: `希望日 ${md(aug.due)} → ${md(sep.due)}`, note: `${Math.abs(daysBetween(aug.due, sep.due))}日${sep.due < aug.due ? '早く' : '遅く'}`, affected: parts.filter((p) => p.late > 0).map((p) => p.code) });
    const added = sep.options.filter((o) => !aug.options.includes(o)), removed = aug.options.filter((o) => !sep.options.includes(o));
    const touches = (list, o) => list.some((x) => x === o || x.includes(o) || o.includes(x));
    if (added.length || removed.length) changes.push({ kind: '仕様変更', title: `${removed.join('・') || 'なし'} → ${added.join('・') || 'なし'}`, note: '', affected: parts.filter((p) => p.optNames.some((o) => touches(added, o) || touches(removed, o))).map((p) => p.code) });
  }
  const excess = parts.filter((p) => p.excess > 0).map((p) => ({ code: p.code, name: p.name, maker: p.maker, excess: p.excess, poDate: p.poDate, amount: p.excess * p.price }));
  return { ...f, parts, changes, excess, todos: [] };
}

// やること（1件 = 1行で言えること）。文面は頼まれたときだけ開く
// contact = 連絡先（メーカーの窓口は「設定」で直した担当者。お客様は得意先の窓口。社内の行は null）
// caution = 注意 1 行（計算はしない。締切超過 → メーカー案内の遅れ → 今週中 → 窓口の注意 の順で、あるものを 1 つだけ）
function buildTodos(f, base, suppliers = {}) {
  const { sep } = f.versions;
  const out = [];
  const sign = `${OUR_NAME}です。`;
  const openers = (to) => `${to}\n\nいつもお世話になっております。${sign}\n`;
  const makerContact = (maker) => suppliers[maker] || { maker, person: '', email: '', note: '' };
  const customerContact = { ...CUSTOMER_CONTACT, maker: CUSTOMER };
  const makerCaution = (p) => (p.deadline && p.deadline < base ? `締切 ${md(p.deadline)} を過ぎています。急ぎ`
    : p.delay > 0 ? `メーカー案内の遅れ ${p.delay}日`
      : p.urgent ? `締切 ${md(p.deadline)}。今週中`
        : makerContact(p.maker).note || '');
  // メーカーへ: 手配（遅れるなら短縮も聞く）
  for (const p of f.parts.filter((x) => x.short > 0)) {
    out.push({
      tone: p.late > 0 ? 'red' : p.urgent ? 'amber' : 'blue', kind: 'メーカーに連絡', who: p.maker,
      what: `${p.name} ${p.order}個を手配`,
      sub: p.late > 0 ? `${md(sep.due)} に ${p.late}日遅れ → 短縮できるか聞く` : p.urgent ? `締切 ${md(p.deadline)}${p.deadline < base ? '（過ぎている）' : ''}` : `${md(p.eta)} に届く`,
      code: p.code, why: p.why, contact: makerContact(p.maker), caution: makerCaution(p),
      draft: { subject: `【手配】${p.code} ${p.name} ${p.order}個`, body: `${openers(`${p.maker} 営業ご担当者様`)}${CUSTOMER}様「${f.name}」向けに、下記をお願いします。\n\n・${p.code} ${p.name}：${p.order}個\n${p.late > 0 ? `\n希望納期 ${md(sep.due)} に対し、御社納期では ${md(p.eta)} 着の見込みです。短縮が可能でしたら最短の納期をお知らせください。` : `\n納期は ${md(p.eta)} 着で承知しています。`}\n\nよろしくお願いいたします。` },
    });
  }
  // メーカーへ: 頼み済み分の入荷が遅い
  for (const p of f.parts.filter((x) => x.short === 0 && x.late > 0)) {
    out.push({
      tone: 'red', kind: 'メーカーに連絡', who: p.maker, what: `${p.name} 頼み済み ${p.po}個の入荷を早められるか聞く`, sub: `${md(p.poDate)} 入荷 → ${p.late}日遅れ`, code: p.code, why: p.why,
      contact: makerContact(p.maker), caution: p.delay > 0 ? `メーカー案内の遅れ ${p.delay}日` : makerContact(p.maker).note || '',
      draft: { subject: `【納期前倒しのご相談】${p.code} ${p.name}`, body: `${openers(`${p.maker} 営業ご担当者様`)}発注済みの ${p.code} ${p.name} ${p.po}個（入荷予定 ${md(p.poDate)}）について、${md(sep.due)} までに入荷できないかご相談です。\n\n可能な最短の納期をお知らせください。よろしくお願いいたします。` },
    });
  }
  // お客様へ: 間に合わない
  const lateParts = f.parts.filter((x) => x.late > 0);
  if (lateParts.length) {
    out.push({
      tone: 'red', kind: 'お客様に連絡', who: CUSTOMER, what: `${md(sep.due)} に間に合わない部品 ${lateParts.length}点 → 納期を相談`, sub: lateParts.map((p) => `${p.name} ${p.late}日`).join('、'), code: '', why: lateParts.flatMap((p) => [`■ ${p.code} ${p.name}`, ...p.why.slice(-2)]),
      contact: customerContact, caution: '',
      draft: { subject: `【納期ご相談】${f.name}`, body: `${openers(`${CUSTOMER} 購買ご担当者様`)}${md(sep.date)} 付の内示（${f.name}）について、下記はメーカー納期の都合で希望日 ${md(sep.due)} に間に合わない見込みです。\n\n${lateParts.map((p) => `・${p.code} ${p.name}：${md(p.eta)} 着（${p.late}日遅れ）`).join('\n')}\n\n分納、または納期のご相談をさせていただけないでしょうか。よろしくお願いいたします。` },
    });
  }
  // 社内: 余る分
  for (const e of f.excess) {
    const t = e.transfer?.[0];
    out.push({
      tone: 'amber', kind: '社内で決める', who: '購買・営業', what: `${e.name} 頼み済み ${e.excess}個が余る`, sub: t ? `「${t.folderName}」で ${t.short}個足りない → 回せる` : `約${man(e.amount)}万円 → キャンセルできるか聞く`, code: e.code,
      contact: null, caution: '',
      why: [`前回は使う予定だった（${f.changes.map((c) => c.title).join('、')}）`, `頼み済み ${e.excess}個・入荷 ${md(e.poDate)}・約${man(e.amount)}万円`, t ? `${t.folderName} で同じ型番が ${t.short}個足りない` : 'ほかの案件で使う予定なし'],
      draft: { subject: `【要判断】${e.code} ${e.name} 頼み済み ${e.excess}個の扱い`, body: `${f.name}（${f.changes.map((c) => c.title).join('、')}）により、${e.code} ${e.name} の頼み済み ${e.excess}個（入荷 ${md(e.poDate)}、約${man(e.amount)}万円）が不要になります。\n\n${t ? `「${t.folderName}」で同じ型番が ${t.short}個足りないため、そちらへ回すことを提案します。` : 'メーカーにキャンセル可否を確認するか、在庫として持つかをご判断ください。'}` },
    });
  }
  // お客様へ: 内示の読み取りで確かめること
  for (const r of (f.reading || []).filter((x) => x.check)) {
    out.push({
      tone: 'blue', kind: 'お客様に確認', who: CUSTOMER, what: r.ask || r.value, sub: r.value, code: '', why: [`内示の記載: ${r.value}`, `読み取り元: ${r.from}`],
      contact: customerContact, caution: '',
      draft: { subject: `【ご確認】${f.name} 内示の記載`, body: `${openers(`${CUSTOMER} 購買ご担当者様`)}${md(sep.date)} 付の内示（${f.name}）について、1点ご確認させてください。\n\n・${r.value}\n\nお手数ですが、ご回答をお願いいたします。` },
    });
  }
  const order = { red: 0, amber: 1, blue: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

// ---------- 画面向け ----------
export function getDemoData({ base = DEFAULT_BASE, folder = 'all', csv = null, overrides = null, folders = null } = {}) {
  base = normalizeBase(base);
  overrides = normalizeOverrides(overrides);
  const b = build(base, normalizeCsv(csv), overrides, folders);
  const mastersDefault = getDefaultMasters();
  const selected = b.folders.find((f) => f.id === folder) || null;
  const active = b.folders.filter((f) => !f.pending);
  const scope = selected ? [selected] : active;
  const rows = scope.flatMap((f) => f.parts.map((p) => row(p, f, base)));
  const toneOrder = { red: 0, amber: 1, blue: 2 };
  const todos = scope.flatMap((f) => f.todos.map((t, i) => ({ ...t, id: `${f.id}-${i}`, folderId: f.id, folderName: f.name }))).sort((a, c) => toneOrder[a.tone] - toneOrder[c.tone]);
  const changes = scope.flatMap((f) => f.changes.map((c) => ({
    kind: c.kind, title: c.title, note: c.note, folderId: f.id, folderName: f.name,
    affected: c.affected.map((code) => rows.find((r) => r.folderId === f.id && r.code === code)).filter(Boolean),
    excess: f.excess.filter((e) => c.affected.includes(e.code) || c.kind === '取消').map((e) => ({ ...e, amountMan: man(e.amount), poDateLabel: md(e.poDate), transfer: (e.transfer || []).map((t) => `「${t.folderName}」で ${t.short}個足りない → 回せる`) })),
  })));
  const readings = scope.filter((f) => !f.pending).map((f) => ({
    folderId: f.id, folderName: f.name, date: md(f.versions.sep.date),
    chips: [
      { label: '台数', value: f.versions.sep.qty ? `${f.versions.sep.qty}台` : '取消', changed: f.versions.sep.qty !== f.versions.aug.qty },
      { label: '希望日', value: md(f.versions.sep.due), changed: f.versions.sep.due !== f.versions.aug.due },
      { label: '仕様', value: f.versions.sep.options.join('・') || '標準', changed: f.versions.sep.options.join() !== f.versions.aug.options.join() },
      { label: '確かめること', value: `${(f.reading || []).filter((r) => r.check).length}件`, changed: (f.reading || []).some((r) => r.check) },
    ],
    checks: (f.reading || []).filter((r) => r.check).map((r) => r.ask || r.value),
  }));

  return {
    title: '内示チェック',
    asOf: md(base), base, baseOptions: BASE_DATES,
    csv: b.csv,
    footNote: '架空データ',
    selectedFolder: selected ? selected.id : 'all',
    defaultTab: 'todo',
    tabs: [
      { id: 'todo', label: 'やること', count: todos.length },
      { id: 'changes', label: '内示の変わった点', count: changes.length },
      { id: 'parts', label: '部品の一覧', count: rows.length },
    ],
    folders: b.folders.map((f) => ({
      id: f.id, customer: f.customer, name: f.name, model: f.model, pending: f.pending || '', fromCsv: Boolean(f.fromCsv),
      status: f.pending ? '今回の内示 未着' : f.changes.length ? f.changes.map((c) => c.kind).join('・') : '変更なし',
      red: f.todos.filter((t) => t.tone === 'red').length, todos: f.todos.length,
    })),
    todos: todos.map((t) => ({ ...t, draft: t.draft })),
    changes,
    readings,
    parts: rows,
    rules: RULES,
    examples: suggestQuestions(selected, rows, changes),
    // 「設定」の窓が使う: 直した後のマスター・既定のマスター・いま効いている上書き（検証済み）
    masters: applyOverrides(mastersDefault, overrides),
    masters_default: mastersDefault,
    overrides: overrides || {},
  };
}

function row(p, f, base) {
  return {
    folderId: f.id, folderName: f.name, code: p.code, name: p.name, maker: p.maker, option: p.option,
    needAug: p.needAug, needSep: p.needSep, stock: p.stock, po: p.po, poDate: md(p.poDate), have: p.have,
    short: p.short, order: p.order, lot: p.lot, eta: md(p.eta), etaKind: p.etaKind, late: p.late, due: md(f.versions.sep.due),
    deadline: md(p.deadline), deadlinePassed: Boolean(p.deadline) && p.deadline < base, urgent: p.urgent, excess: p.excess,
    status: p.status, tone: p.tone, why: p.why,
  };
}

// 質問例は短く、選択中の表にある型番だけ
function suggestQuestions(selected, rows, changes) {
  if (!selected) return ['遅れる部品は？', '余る部品は？', '案件ごとに一言で'];
  if (selected.pending) return ['今できることは？'];
  const q = ['遅れる部品は？'];
  const late = rows.filter((r) => r.late > 0).sort((a, c) => c.late - a.late || (a.needAug === 0 ? -1 : 0) - (c.needAug === 0 ? -1 : 0))[0];
  if (late) q.push(`${late.code} はなぜ遅れる？`);
  if (changes.length) q.push('お客様への確認文');
  if (selected.excess.length) q.push(`${selected.excess[0].code} は余る？`);
  return q.slice(0, 4);
}

// ---------- AI 向け（画面と同じ build() の結果。選択中のフォルダだけを渡す） ----------
export function getAiData({ base = DEFAULT_BASE, folder = 'all', csv = null, overrides = null, folders = null } = {}) {
  base = normalizeBase(base);
  const b = build(base, normalizeCsv(csv), normalizeOverrides(overrides), folders);
  const selected = b.folders.find((f) => f.id === folder) || null;
  const scope = selected ? [selected] : b.folders.filter((f) => !f.pending);
  const partRow = (f, p) => ({
    型番: p.code, 品名: p.name, メーカー: p.maker, ...(p.option ? { オプション: p.option } : {}),
    前回いる数_個: p.needAug, 今回いる数_個: p.needSep, 在庫_個: p.stock, 頼み済み_個: p.po, ...(p.poDate ? { 頼み済み分の入荷日: p.poDate } : {}),
    足りない数_個: p.short, 手配する数_個: p.order, ...(p.eta ? { 届く日: p.eta, 届く日の種類: p.etaKind, 希望日: f.versions.sep.due, 遅れ_日: p.late } : {}),
    ...(p.deadline ? { 発注の締切: p.deadline, 急ぎ: p.urgent } : {}), ...(p.excess ? { 余る数_個: p.excess } : {}),
    状態: p.status, なぜ: p.why,
  });
  return {
    context: `FA機器商社のデモ。お客様（${CUSTOMER}、架空）から届いた内示（前回 → 今回）と、部品の在庫・頼み済み分を突き合わせた結果。今日は ${base}。${selected ? `利用者がいま開いている案件: 「${selected.name}」。質問の「この案件」はこれを指す。ほかの案件のことは聞かれたときだけ答える。` : '利用者は「すべて」を開いている。'}`,
    note: 'すべて架空データ。数字は下の表の値をそのまま使い、新しい数字を計算しない（足し算もしない）。表に無い型番・数字は出さない。「なぜ」を聞かれたら「なぜ」の文をそのまま示す。難しい言葉を使わず、短く答える。',
    計算のしかた: Object.fromEntries(RULES.map((r) => [r.name, r.formula])),
    急ぎの条件: `発注の締切が ${b.urgentUntil} 以前`,
    案件: scope.map((f) => f.pending
      ? { 案件: f.name, お客様: f.customer, 状態: f.pending }
      : {
        案件: f.name, お客様: f.customer, 機種: f.model,
        内示: { 前回: f.versions.aug, 今回: f.versions.sep },
        変わった点: f.changes.map((c) => ({ 種類: c.kind, 内容: c.title, 影響する型番: c.affected, 備考: c.note })),
        部品: f.parts.map((p) => partRow(f, p)),
        余る頼み済み分: f.excess.map((e) => ({ 型番: e.code, 品名: e.name, 余る数_個: e.excess, 入荷日: e.poDate, 金額_円: e.amount, 回せる先: (e.transfer || []).map((t) => `${t.folderName}で${t.short}個足りない`) })),
        内示からの読み取り: f.reading,
        やること: f.todos.map((t) => ({ 種類: t.kind, 相手: t.who, ...(t.contact?.person ? { 担当者: t.contact.person, 連絡先: t.contact.email } : {}), 内容: t.what, 補足: t.sub, ...(t.caution ? { 注意: t.caution } : {}) })),
      }),
  };
}

// テスト用に計算結果をそのまま出す
export function _build(base = DEFAULT_BASE, csv = null, overrides = null, folders = null) { return build(normalizeBase(base), normalizeCsv(csv), normalizeOverrides(overrides), folders); }

// 画面から来る csv は「CSV の文字列」か「parseNaishiCsv の rows」。どちらでも受ける。大きすぎるものは無視
const MAX_CSV_CHARS = 20000;
function normalizeCsv(csv) {
  if (!csv) return null;
  if (typeof csv === 'string') return csv.length > MAX_CSV_CHARS ? null : parseNaishiCsv(csv).rows;
  if (Array.isArray(csv)) return csv.filter((r) => r && typeof r.name === 'string' && Number.isInteger(r.qty) && typeof r.due === 'string').slice(0, 50);
  return null;
}
export { FOLDERS as _FOLDERS, PART as _PART };

// ---------- 小道具 ----------
function normalizeBase(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? String(s) : DEFAULT_BASE; }
function sum(a) { return a.reduce((s, v) => s + v, 0); }
function man(yen) { return (Math.round(yen / 1000) / 10).toLocaleString('ja-JP'); }
function md(s) { return s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : ''; }
function addDays(s, d) { const t = new Date(`${s}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
function daysBetween(from, to) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000); }
