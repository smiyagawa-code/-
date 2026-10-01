import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { _resetForTest } from '../src/db.js';

// D1 の最小限の代役（prepare → bind → all / first / run）。中身は本物の SQLite
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: async () => ({ results: db.prepare(sql).all(...args) }),
        first: async () => db.prepare(sql).get(...args) ?? null,
        run: async () => {
          const r = db.prepare(sql).run(...args);
          return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
      };
      return stmt;
    },
  };
}

const loggedIn = { access: { getIdentity: async () => ({ email: 'sales@thomas-gr.com' }) } };
const ORIGIN = 'https://moc-a.example.workers.dev';

function setup() {
  _resetForTest();
  const DB = fakeD1();
  const base = { ASSETS: { fetch: async () => new Response('x') } };
  return { a: { ...base, DB, MOC_NAME: 'moc-a' }, b: { ...base, DB, MOC_NAME: 'moc-b' } };
}

async function call(env, method, path, body, headers = {}) {
  const init = { method, headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await worker.fetch(new Request(ORIGIN + path, init), env, loggedIn);
  return { status: res.status, body: await res.json() };
}

test('追加・一覧・更新・削除ができ、作成者のメールが残る', async () => {
  const { a } = setup();
  const created = await call(a, 'POST', '/api/records', { kind: 'request', status: 'pending', data: { title: '備品', amount: 120000 } });
  assert.equal(created.status, 201);
  assert.equal(created.body.record.createdBy, 'sales@thomas-gr.com');
  const id = created.body.record.id;

  const list = await call(a, 'GET', '/api/records?kind=request');
  assert.equal(list.body.records.length, 1);
  assert.deepEqual(list.body.records[0].data, { title: '備品', amount: 120000 });

  const upd = await call(a, 'PATCH', `/api/records/${id}`, { status: 'approved' });
  assert.equal(upd.body.record.status, 'approved');

  assert.equal((await call(a, 'DELETE', `/api/records/${id}`, {})).status, 200);
  assert.equal((await call(a, 'GET', '/api/records?kind=request')).body.records.length, 0);
  assert.equal((await call(a, 'DELETE', `/api/records/${id}`, {})).status, 404);
});

test('ほかのモックのデータは見えない・変えられない・消せない', async () => {
  const { a, b } = setup();
  const created = await call(a, 'POST', '/api/records', { kind: 'request', data: { title: 'Aの申請' } });
  const id = created.body.record.id;

  assert.equal((await call(b, 'GET', '/api/records?kind=request')).body.records.length, 0);
  assert.equal((await call(b, 'PATCH', `/api/records/${id}`, { status: 'x' })).status, 404);
  assert.equal((await call(b, 'DELETE', `/api/records/${id}`, {})).status, 404);
  const reset = await call(b, 'POST', '/api/records/reset', { confirm: 'reset' });
  assert.equal(reset.body.deleted, 0);
  assert.equal((await call(a, 'GET', '/api/records?kind=request')).body.records.length, 1);
});

test('全消去は確認の合図が必要で、そのモックの分だけ消える', async () => {
  const { a, b } = setup();
  await call(a, 'POST', '/api/records', { data: { n: 1 } });
  await call(a, 'POST', '/api/records', { data: { n: 2 } });
  await call(b, 'POST', '/api/records', { data: { n: 3 } });
  assert.equal((await call(a, 'POST', '/api/records/reset', {})).status, 400);
  assert.equal((await call(a, 'POST', '/api/records/reset', { confirm: 'reset' })).body.deleted, 2);
  assert.equal((await call(b, 'GET', '/api/records')).body.records.length, 1);
});

test('不正な入力は 400、別サイト・JSON 以外からの書き込みは 403', async () => {
  const { a } = setup();
  const bad = [
    { kind: 'Bad Kind', data: {} },
    { data: [] },
    { data: 'text' },
    { data: { x: 'y'.repeat(4001) } },
    { data: {}, status: 1 },
    { data: {}, status: 'x'.repeat(21) },
  ];
  for (const body of bad) {
    assert.equal((await call(a, 'POST', '/api/records', body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await call(a, 'GET', '/api/records?kind=Bad Kind')).status, 400);
  assert.equal((await call(a, 'POST', '/api/records', { data: {} }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  const res = await worker.fetch(new Request(`${ORIGIN}/api/records`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"data":{}}' }), a, loggedIn);
  assert.equal(res.status, 403);
});

test('1モック500件まで', async () => {
  const { a } = setup();
  for (let i = 0; i < 500; i++) await call(a, 'POST', '/api/records', { data: { i } });
  const over = await call(a, 'POST', '/api/records', { data: { i: 500 } });
  assert.equal(over.status, 400);
  assert.match(over.body.error, /500件/);
});

test('保存の設定が無いモックでは 404、ログインしていなければ 403', async () => {
  const env = { ASSETS: { fetch: async () => new Response('x') }, MOC_NAME: 'moc-x' };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/records`), env, loggedIn);
  assert.equal(res.status, 404);
  const { a } = setup();
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/records`), a, {})).status, 403);
});

test('/api/me は保存の有無を返す', async () => {
  const { a } = setup();
  const me = await worker.fetch(new Request(`${ORIGIN}/api/me`), a, loggedIn);
  assert.equal((await me.json()).db, true);
});
