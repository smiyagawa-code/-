import { forbiddenCrossSite, isSameOriginJson } from './http.js';

// 入力したデータを保存する API（/api/records）。
// 会社共通の D1 データベース 1 つを全モックで使い、行ごとに moc（Worker 名）で分ける。
// どの SQL も必ず moc = env.MOC_NAME で絞る（他のモックのデータには触らない）。
//
//   GET    /api/records?kind=request      一覧（新しい順・最大200件）
//   POST   /api/records                   追加 { kind, data: {...}, status? }
//   PATCH  /api/records/<id>              更新 { status?, data? }
//   DELETE /api/records/<id>              1件削除
//   POST   /api/records/reset             このモックの保存内容を全部消す { confirm: "reset" }

const MAX_ROWS_PER_MOC = 500;
const MAX_DATA_CHARS = 4000;
const MAX_STATUS_CHARS = 20;
const KIND_RE = /^[a-z][a-z0-9_-]{0,30}$/;

let tableReady = false;

export async function handleRecords(request, env, auth) {
  if (!env.DB || !env.MOC_NAME) {
    return Response.json({ error: 'このモックには保存の設定がありません。' }, { status: 404 });
  }
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/records\/?/, '');
  const method = request.method;

  if (method !== 'GET' && !isSameOriginJson(request)) return forbiddenCrossSite();

  try {
    await ensureTable(env.DB);
    // await を付けて、入力エラー（BadRequest）をこの try で 400 にする
    if (rest === '' && method === 'GET') return await list(env, url.searchParams.get('kind'));
    if (rest === '' && method === 'POST') return await create(env, auth, await readJson(request));
    if (rest === 'reset' && method === 'POST') return await reset(env, await readJson(request));
    if (/^\d+$/.test(rest) && method === 'PATCH') return await update(env, Number(rest), await readJson(request));
    if (/^\d+$/.test(rest) && method === 'DELETE') return await remove(env, Number(rest));
    return Response.json({ error: 'not found' }, { status: 404 });
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
    console.error('db error', err?.message ?? '');
    return Response.json({ error: '保存に失敗しました。もう一度お試しください。' }, { status: 500 });
  }
}

async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS moc_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moc TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS moc_records_moc_kind ON moc_records (moc, kind, id)').run();
  tableReady = true;
}

async function list(env, kind) {
  const k = kind ?? 'default';
  if (!KIND_RE.test(k)) throw new BadRequest('kind の形式が正しくありません。');
  const { results } = await env.DB.prepare(
    'SELECT id, kind, status, data, created_by, created_at, updated_at FROM moc_records WHERE moc = ? AND kind = ? ORDER BY id DESC LIMIT 200',
  ).bind(env.MOC_NAME, k).all();
  return Response.json({ records: results.map(toRecord) });
}

async function create(env, auth, body) {
  const kind = body.kind ?? 'default';
  if (!KIND_RE.test(kind)) throw new BadRequest('kind の形式が正しくありません。');
  const data = checkData(body.data);
  const status = checkStatus(body.status ?? '');

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM moc_records WHERE moc = ?').bind(env.MOC_NAME).first();
  if ((count?.n ?? 0) >= MAX_ROWS_PER_MOC) {
    throw new BadRequest(`保存できるのは1モックあたり${MAX_ROWS_PER_MOC}件までです。不要な行を消してください。`);
  }
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    'INSERT INTO moc_records (moc, kind, status, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(env.MOC_NAME, kind, status, data, auth?.email ?? '', now, now).run();
  const row = await env.DB.prepare(
    'SELECT id, kind, status, data, created_by, created_at, updated_at FROM moc_records WHERE moc = ? AND id = ?',
  ).bind(env.MOC_NAME, res.meta.last_row_id).first();
  return Response.json({ record: toRecord(row) }, { status: 201 });
}

async function update(env, id, body) {
  const sets = [];
  const args = [];
  if (body.status !== undefined) { sets.push('status = ?'); args.push(checkStatus(body.status)); }
  if (body.data !== undefined) { sets.push('data = ?'); args.push(checkData(body.data)); }
  if (sets.length === 0) throw new BadRequest('変更する内容がありません。');
  sets.push('updated_at = ?');
  args.push(new Date().toISOString());
  const res = await env.DB.prepare(`UPDATE moc_records SET ${sets.join(', ')} WHERE moc = ? AND id = ?`)
    .bind(...args, env.MOC_NAME, id).run();
  if (!res.meta.changes) return Response.json({ error: '見つかりません。' }, { status: 404 });
  const row = await env.DB.prepare(
    'SELECT id, kind, status, data, created_by, created_at, updated_at FROM moc_records WHERE moc = ? AND id = ?',
  ).bind(env.MOC_NAME, id).first();
  return Response.json({ record: toRecord(row) });
}

async function remove(env, id) {
  const res = await env.DB.prepare('DELETE FROM moc_records WHERE moc = ? AND id = ?').bind(env.MOC_NAME, id).run();
  if (!res.meta.changes) return Response.json({ error: '見つかりません。' }, { status: 404 });
  return Response.json({ ok: true });
}

async function reset(env, body) {
  if (body.confirm !== 'reset') throw new BadRequest('確認のため confirm: "reset" を付けてください。');
  const res = await env.DB.prepare('DELETE FROM moc_records WHERE moc = ?').bind(env.MOC_NAME).run();
  return Response.json({ ok: true, deleted: res.meta.changes ?? 0 });
}

function checkData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequest('data は項目名と値の組にしてください。');
  const text = JSON.stringify(value);
  if (text.length > MAX_DATA_CHARS) throw new BadRequest(`1件の内容は${MAX_DATA_CHARS}文字までです。`);
  return text;
}

function checkStatus(value) {
  if (typeof value !== 'string' || value.length > MAX_STATUS_CHARS) throw new BadRequest(`status は${MAX_STATUS_CHARS}文字までの文字列にしてください。`);
  return value;
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new BadRequest('リクエストの形式が正しくありません。');
  }
}

function toRecord(row) {
  let data = {};
  try { data = JSON.parse(row.data); } catch { /* 壊れた行は空で返す */ }
  return {
    id: row.id, kind: row.kind, status: row.status, data,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

class BadRequest extends Error {}

// テスト用: テーブル作成済みの記憶を消す
export function _resetForTest() { tableReady = false; }
