// 読み取りルールのマスター（架空）。画面の「設定」で見て直せるようにするための既定値と、直した内容（overrides）の検証。
// 部品カタログ（PARTS）・案件ごとの部品表（bom）・計算の決まり（RULES）は src/data.js が持ち、ここはそれを「まとめて返す」だけ。
// メーカーの担当者・連絡先はここに置く（すべて架空）。
//
// overrides の形（画面が localStorage の 'overrides' に保存し、POST /api/data と /api/chat の body に入れて送る）
//   {
//     parts:     { [型番]: { lt?: 日数, lot?: 単位, maker?: メーカー名, delay?: 日数 } },   // 部品カタログの上書き
//     bom:       { [案件id または 機種]: [{ code: 型番, qty: 1台に使う数, option?: オプション名 }] }, // 案件の部品表を丸ごと差し替え
//     suppliers: { [メーカー名]: { person?: 担当者, email?: 連絡先, note?: 注意 } },      // メーカー窓口の上書き
//   }
// 型が違う・範囲外・知らない型番や案件は無視する（normalizeOverrides）。

import { RULES, _FOLDERS, _PART } from './data.js';

// メーカーの窓口（架空の氏名・メール）
export const SUPPLIERS = [
  { maker: '東和光学', person: '佐々木 恵', email: 'sasaki.m@towa-optics.example.jp', note: 'カメラは受注生産。見積番号を必ず書く' },
  { maker: '中央精密機器', person: '西村 拓也', email: 'nishimura@chuo-seiki.example.jp', note: '発注は専用フォームから。メールだけでは受け付けない' },
  { maker: '東和空圧工業', person: '小林 由紀', email: 'y-kobayashi@towa-air.example.jp', note: '15時までの発注は当日受付' },
  { maker: '相模搬送', person: '長谷川 誠', email: 'hasegawa@sagami-conv.example.jp', note: '長尺品は配送日を先に相談する' },
  { maker: '北都クリーン', person: '田村 さくら', email: 'tamura@hokuto-clean.example.jp', note: '月末は締めで返事が遅い' },
];

// 得意先の窓口（架空。やることの「お客様に連絡・確認」の行で使う）
export const CUSTOMER_CONTACT = { maker: '株式会社大和精密製作所', person: '生産管理部 中村 由紀', email: 'nakamura.y@yamato-seimitsu.example.jp', note: '' };

// メーカー名 → 窓口（overrides 適用後）。やることの contact に使う
export function supplierLookup(overrides) {
  const list = applyOverrides(getDefaultMasters(), overrides).suppliers;
  return Object.fromEntries(list.map((s) => [s.maker, { maker: s.maker, person: s.person, email: s.email, note: s.note }]));
}

const LIMITS = { lt: [0, 365], lot: [1, 1000], delay: [0, 365], qty: [0, 999] };
const MAX_TEXT = 40;
const MAX_BOM_ROWS = 60;

// 既定値をまとめて返す（画面の「既定に戻す」と、変更前の値の表示に使う）
export function getDefaultMasters() {
  return {
    parts: Object.values(_PART).map((p) => ({ ...p })),
    bom: Object.fromEntries(_FOLDERS.filter((f) => f.bom).map((f) => [f.id, f.bom.map(([code, qty, option]) => ({ code, qty, option: option || '' }))])),
    folders: _FOLDERS.filter((f) => f.bom).map((f) => ({ id: f.id, name: f.name, model: f.model })),
    suppliers: SUPPLIERS.map((s) => ({ ...s })),
    rules: RULES.map((r) => ({ ...r })),
  };
}

// 画面から来た overrides を検証して、安全な形だけ残す。おかしいものは null（＝上書きなし）
export function normalizeOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};

  if (raw.parts && typeof raw.parts === 'object' && !Array.isArray(raw.parts)) {
    const parts = {};
    for (const [code, v] of Object.entries(raw.parts)) {
      if (!_PART[code] || !v || typeof v !== 'object') continue;
      const p = {};
      for (const k of ['lt', 'lot', 'delay']) if (isIntIn(v[k], LIMITS[k])) p[k] = v[k];
      if (isText(v.maker)) p.maker = v.maker.trim();
      if (Object.keys(p).length) parts[code] = p;
    }
    if (Object.keys(parts).length) out.parts = parts;
  }

  if (raw.bom && typeof raw.bom === 'object' && !Array.isArray(raw.bom)) {
    const bom = {};
    for (const [key, rows] of Object.entries(raw.bom)) {
      const f = _FOLDERS.find((x) => x.bom && (x.id === key || x.model === key));
      if (!f || !Array.isArray(rows)) continue;
      const clean = rows.slice(0, MAX_BOM_ROWS)
        .filter((r) => r && typeof r === 'object' && _PART[r.code] && isIntIn(r.qty, LIMITS.qty) && (r.option == null || isText(r.option, MAX_TEXT, true)))
        .map((r) => ({ code: r.code, qty: r.qty, option: r.option ? String(r.option).trim() : '' }));
      if (clean.length) bom[f.id] = clean;
    }
    if (Object.keys(bom).length) out.bom = bom;
  }

  if (raw.suppliers && typeof raw.suppliers === 'object' && !Array.isArray(raw.suppliers)) {
    const suppliers = {};
    const makers = new Set([...SUPPLIERS.map((s) => s.maker), ...Object.values(_PART).map((p) => p.maker)]);
    for (const [maker, v] of Object.entries(raw.suppliers)) {
      if (!makers.has(maker) || !v || typeof v !== 'object') continue;
      const s = {};
      for (const k of ['person', 'email', 'note']) if (isText(v[k], k === 'note' ? 80 : MAX_TEXT, true)) s[k] = v[k].trim();
      if (Object.keys(s).length) suppliers[maker] = s;
    }
    if (Object.keys(suppliers).length) out.suppliers = suppliers;
  }

  return Object.keys(out).length ? out : null;
}

// 既定値に overrides を当てたマスター（画面の表に出す値）
export function applyOverrides(defaults, overrides) {
  const o = overrides || {};
  return {
    ...defaults,
    parts: defaults.parts.map((p) => ({ ...p, ...(o.parts?.[p.code] || {}) })),
    bom: Object.fromEntries(Object.entries(defaults.bom).map(([id, rows]) => [id, (o.bom?.[id] || rows).map((r) => ({ ...r }))])),
    suppliers: defaults.suppliers.map((s) => ({ ...s, ...(o.suppliers?.[s.maker] || {}) })),
  };
}

function isIntIn(v, [min, max]) { return Number.isInteger(v) && v >= min && v <= max; }
function isText(v, max = MAX_TEXT, allowEmpty = false) { return typeof v === 'string' && v.length <= max && (allowEmpty || v.trim().length > 0) && !/[<>]/.test(v); }
