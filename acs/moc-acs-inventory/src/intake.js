// 内示の読み取り API `/api/intake`（担当 A）。
// CSV / Excel(.xlsx) / PDF / メール / メモ を受け取り、案件ごとの「台数・希望日・仕様・備考」に読み取る。
//
// 入力 JSON: { kind: 'csv'|'xlsx'|'pdf'|'mail'|'memo', name, text?（csv/mail/memo）, base64?（xlsx/pdf） }
// 出力 JSON: {
//   kind, name,
//   versions: [ { line, date, customer, name, model, qty, due, options, note, folderId } ],  // parseNaishiCsv の rows と同じ形 ＋ 当てはまった案件 id（無ければ null）
//   reading:  [ [ { field, value, from, check, ask? } ], ... ],                              // versions と同じ並び（案件ごと）
//   csvText:  '内示日,得意先,案件,機種,数量,納入希望日,仕様,備考\n...',                        // 見本 CSV と同じ列。画面は今までどおり POST /api/data { csv } に渡せる
//   errors:   [ '...' ],
// }
// csv / xlsx は AI を使わず機械的に読む（xlsx は先頭シートを CSV にしてから同じ経路）。
// pdf / mail / memo は Anthropic API に「決めた JSON だけ」を返させ、型・範囲を検証してから使う。
// 読み取れない項目は null にし、reading に check:true・ask を出す（AI が返した数字はそのまま。計算はしない）。
// AI キーが無いときは 503。別サイト・JSON 以外は 403（src/http.js）。
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { _FOLDERS, _build, parseNaishiCsv, folderList, findFolder as findFolderIn } from './data.js';
import { forbiddenCrossSite, isSameOriginJson } from './http.js';

export const KINDS = ['csv', 'xlsx', 'pdf', 'mail', 'memo'];
const TEXT_KINDS = new Set(['csv', 'mail', 'memo']);
const AI_KINDS = new Set(['pdf', 'mail', 'memo']);
export const MAX_TEXT_CHARS = 20000; // csv / mail / memo
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // pdf / xlsx（元のファイルの大きさ）
const MAX_NAME_CHARS = 200;
const MAX_ITEMS = 20;
const MAX_OUTPUT_TOKENS = 4000;
// 拒否時に Anthropic 側で別モデルへ自動で回す（src/chat.js と同じ）
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);
export const CSV_HEADER = ['内示日', '得意先', '案件', '機種', '数量', '納入希望日', '仕様', '備考'];

export async function handleIntake(request, env, deps = {}) {
  if (!isSameOriginJson(request)) return forbiddenCrossSite();
  let body;
  try { body = await request.json(); } catch { return bad('リクエストの形式が正しくありません。'); }

  const kind = body?.kind;
  USER_FOLDERS = Array.isArray(body?.folders) ? body.folders : null;
  KNOWN = folderList(USER_FOLDERS);
  if (!KINDS.includes(kind)) return bad('読める形式は CSV・Excel・PDF・メール・メモです。');
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, MAX_NAME_CHARS) : kind;

  let text = '';
  let bytes = null;
  if (TEXT_KINDS.has(kind)) {
    if (typeof body?.text !== 'string' || !body.text.trim()) return bad('中身が空です。');
    if (body.text.length > MAX_TEXT_CHARS) return bad('文字が多すぎます（2万文字まで）。');
    text = body.text;
  } else {
    if (typeof body?.base64 !== 'string' || !body.base64) return bad('ファイルの中身がありません。');
    // base64 は元の 4/3 倍。先に文字数で粗く止めてから、復号して正確に見る
    if (body.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) return bad('ファイルが大きすぎます（2MB まで）。');
    bytes = decodeBase64(body.base64);
    if (!bytes) return bad('ファイルの中身を読めません。');
    if (bytes.length > MAX_FILE_BYTES) return bad('ファイルが大きすぎます（2MB まで）。');
  }

  if (kind === 'csv') return fromCsvText(text, kind, name);
  if (kind === 'xlsx') {
    let csv;
    try { csv = xlsxToCsv(bytes); } catch { return bad('Excel を読めませんでした。.xlsx 形式か確認してください。'); }
    if (!csv) return bad('Excel の先頭シートが空です。');
    return fromCsvText(csv, kind, name);
  }

  // ---- pdf / mail / memo: AI に読ませる ----
  const apiKey = await readApiKey(env);
  if (!apiKey) return Response.json({ error: 'AI の設定がないため PDF・メール・メモは読めません。CSV か Excel をお使いください。' }, { status: 503 });
  const model = env.AI_MODEL || 'claude-opus-5';
  const client = new Anthropic({ apiKey, fetch: deps.fetch, maxRetries: 1, timeout: 90_000 });
  const content = kind === 'pdf'
    ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.base64.replace(/\s+/g, '') }, title: name }, { type: 'text', text: '上の PDF（内示）を読み取ってください。' }]
    : [{ type: 'text', text: `次の${kind === 'mail' ? 'メール' : 'メモ'}（内示の連絡）を読み取ってください。\n\n----\n${text}\n----` }];
  const params = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: env.AI_EFFORT || 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content }],
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let response;
  try {
    response = await client.beta.messages.create(params);
  } catch (err) {
    console.error('anthropic error (intake)', err?.status ?? '', err?.name ?? '');
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    return Response.json({ error: 'AI の読み取りに失敗しました。少し待ってからもう一度お試しください。' }, { status });
  }
  if (response.stop_reason === 'refusal') return Response.json({ error: 'この内容は AI が読み取れませんでした。CSV か Excel をお使いください。' }, { status: 502 });
  const raw = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const items = validateAiOutput(raw);
  if (!items) return Response.json({ error: 'AI の返答の形が合いませんでした。もう一度お試しください。' }, { status: 502 });
  if (!items.length) return bad('内示として読める案件が見つかりませんでした。');
  return Response.json(fromAiItems(items, kind, name));
}

// ---------- csv / xlsx ----------
function fromCsvText(csvText, kind, name) {
  const parsed = parseNaishiCsv(csvText);
  if (!parsed.rows.length) return bad(`${kind === 'xlsx' ? 'Excel' : 'CSV'} を読めませんでした。${parsed.errors.join('／')}`);
  const built = _build(undefined, parsed.rows, null, USER_FOLDERS);
  const label = kind === 'xlsx' ? 'Excel' : 'CSV';
  const versions = parsed.rows.map((r) => ({ ...r, folderId: findFolder(r)?.id ?? null }));
  const reading = versions.map((v) => {
    const f = v.folderId ? built.folders.find((x) => x.id === v.folderId) : null;
    if (f?.reading) return f.reading.map((it) => ({ ...it, from: it.from.replace(/^CSV /, `${label} `) }));
    return [...basicReading(v, (col) => `${label} ${v.line}行目「${col}」`), noFolderItem(v, `${label} ${v.line}行目「案件」`)];
  });
  return Response.json({ kind, name, versions, reading, csvText: toCsv(versions), errors: parsed.errors });
}

// Excel の先頭シートを CSV 文字列に。日付セルは yyyy-mm-dd、それ以外は表示文字列のまま
export function xlsxToCsv(bytes) {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet || !sheet['!ref']) return '';
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const lines = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? cellText(cell) : '');
    }
    if (row.every((v) => !v)) continue;
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\n');
}
function cellText(cell) {
  if (cell.t === 'd' && cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
    const d = cell.v;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (cell.t === 'n') return String(cell.v);
  return String(cell.w ?? cell.v ?? '').trim();
}

// ---------- AI の出力 ----------
// AI に返させる形（これ以外は受け取らない）。数字は AI が読んだままで、計算はしない
const nullable = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });
const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'model', 'qty', 'due', 'date', 'customer', 'options', 'note', 'from', 'unsure'],
        properties: {
          name: { ...nullable('string'), description: '案件名（書いてあるとおり）' },
          model: { ...nullable('string'), description: '機種（型式）' },
          qty: { ...nullable('integer'), description: '台数。読み取れなければ null' },
          due: { ...nullable('string'), description: '納入希望日 YYYY-MM-DD。読み取れなければ null' },
          date: { ...nullable('string'), description: '内示日（発行日） YYYY-MM-DD。無ければ null' },
          customer: { ...nullable('string'), description: '得意先（お客様の会社名）。無ければ null' },
          options: { type: 'array', items: { type: 'string' }, description: '仕様・オプション（標準なら空）' },
          note: { ...nullable('string'), description: '備考（原文を短く）' },
          from: { type: 'string', description: 'どこから読み取ったか（例: PDF 1ページ目「数量 3」、メール本文 3行目）' },
          unsure: { type: 'array', items: { type: 'string' }, description: '人に確かめたいこと（食い違い・あいまいな点）。無ければ空' },
        },
      },
    },
  },
};
function buildSystemPrompt() {
  const known = KNOWN.map((f) => `- 機種 ${f.model}: ${f.name}（${f.customer}）`).join('\n');
  return [
    'あなたは、お客様から届いた内示（装置の台数・納入希望日の連絡）を読み取る係です。',
    '渡された文書から、案件ごとに 案件名・機種・台数・納入希望日・内示日・得意先・仕様（オプション）・備考 を抜き出し、決められた JSON だけを返してください。',
    '書いてある値をそのまま使い、足し算・日数計算・推測はしないでください。読み取れない項目は null にします。',
    '値が食い違う（本文と手書き、表と備考など）、あいまい（段数・取消の意味など）なときは、そのまま片方を入れずに unsure に「確かめたいこと」を短く書いてください。',
    'from には、どこから読んだか（ページ・行・欄）を短く書いてください。',
    '日付は YYYY-MM-DD で、年が書いていなければ内示日の年、それも無ければ 2026 年とします。',
    '台数が「取消」「0」なら qty は 0 にし、unsure に「取消は内示の取消か注文の取消か」を入れてください。',
    '',
    '# この画面にある案件（機種で当てはめます。文書に別の書き方があっても、同じ機種ならこの機種名を使ってください）',
    known,
  ].join('\n');
}
// AI の JSON を検証（型・範囲）。全体の形が違えば null。項目の値がおかしいものは null にして要確認に回す
export function validateAiOutput(raw) {
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.items)) return null;
  const items = [];
  for (const it of obj.items.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object') return null;
    const unsure = strList(it.unsure, 5, 200);
    const qty = Number.isInteger(it.qty) && it.qty >= 0 && it.qty <= 9999 ? it.qty : null;
    if (it.qty != null && qty == null) unsure.push(`台数「${String(it.qty).slice(0, 20)}」が読み取れません`);
    const due = isoDate(it.due);
    if (it.due != null && !due) unsure.push(`希望日「${String(it.due).slice(0, 20)}」が読み取れません`);
    items.push({
      name: str(it.name, 100), model: str(it.model, 40), qty, due: due || null,
      date: isoDate(it.date) || '', customer: str(it.customer, 100) || '',
      options: strList(it.options, 10, 40).filter((o) => o !== '標準' && o !== 'なし'),
      note: str(it.note, 500) || '', from: str(it.from, 300) || '', unsure,
    });
  }
  return items;
}
function fromAiItems(items, kind, name) {
  const label = { pdf: 'PDF', mail: 'メール', memo: 'メモ' }[kind];
  const versions = items.map((it, i) => {
    const f = findFolder(it);
    return { line: i + 1, date: it.date, customer: it.customer, name: it.name || f?.name || '', model: it.model || f?.model || '', qty: it.qty, due: it.due, options: it.options, note: it.note, folderId: f?.id ?? null };
  });
  const reading = items.map((it, i) => {
    const v = versions[i];
    const from = it.from ? `${label}: ${it.from}` : label;
    const out = basicReading(v, () => from);
    for (const u of it.unsure) out.push({ field: '要確認', ask: u, value: '', from, check: true });
    if (!v.folderId) out.push(noFolderItem(v, from));
    return out;
  });
  return { kind, name, versions, reading, csvText: toCsv(versions), errors: [] };
}

// ---------- 共通 ----------
function basicReading(v, src) {
  const items = [];
  if (v.qty == null) items.push({ field: '台数', value: '読み取れず', from: src('数量'), check: true, ask: '台数はいくつですか' });
  else items.push({ field: '台数', value: v.qty ? `${v.qty}台` : '0台 → 取消', from: src('数量'), check: false });
  if (!v.due) items.push({ field: '希望日', value: '読み取れず', from: src('納入希望日'), check: true, ask: '納入希望日はいつですか' });
  else items.push({ field: '希望日', value: v.due, from: src('納入希望日'), check: false });
  items.push({ field: '仕様', value: v.options.join('・') || '標準', from: src('仕様'), check: false });
  if (v.note) items.push({ field: '備考', value: `「${v.note}」`, from: src('備考'), check: false });
  return items;
}
function noFolderItem(v, from) {
  return { field: '要確認', ask: 'この画面のどの案件ですか', value: `「${v.model || v.name || '(案件名なし)'}」に当てはまる案件がありません（機種か案件名で照合）`, from, check: true };
}
let KNOWN = _FOLDERS; // 画面で作った案件も含めた一覧（リクエストごとに body.folders で差し替える）
let USER_FOLDERS = null;
function findFolder(r) {
  return findFolderIn(r, KNOWN);
}
// 見本 CSV と同じ列に書き直す（数量・希望日が null なら空欄。画面で直してから確定する）
export function toCsv(rows) {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push([r.date || '', r.customer || '', r.name || '', r.model || '', r.qty == null ? '' : String(r.qty), r.due || '', (r.options || []).join('・'), r.note || ''].map(csvCell).join(','));
  }
  return lines.join('\n');
}
function csvCell(v) {
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function str(v, max) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null; }
function strList(v, maxLen, maxChars) { return Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).slice(0, maxLen).map((s) => s.trim().slice(0, maxChars)) : []; }
function isoDate(s) {
  const m = String(s ?? '').trim().match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/);
  if (!m) return '';
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? '' : d;
}
function decodeBase64(s) {
  try {
    const bin = atob(s.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
function bad(message) { return Response.json({ error: message }, { status: 400 }); }
async function readApiKey(env) {
  const binding = env.ANTHROPIC_API_KEY;
  if (!binding) return '';
  try {
    // Secrets Store のバインディングは .get() で読む。通常の Secret なら文字列のまま（src/chat.js と同じ）
    return typeof binding.get === 'function' ? (await binding.get()) || '' : String(binding);
  } catch { return ''; }
}
