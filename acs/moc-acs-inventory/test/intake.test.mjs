// 内示の読み取り API（/api/intake）。csv / xlsx の経路、AI（pdf / mail / memo）の JSON 検証（AI は偽物の fetch）、不正入力の拒否。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import worker from '../src/index.js';
import { handleIntake, toCsv, validateAiOutput, xlsxToCsv, CSV_HEADER } from '../src/intake.js';
import { parseNaishiCsv, getDemoData } from '../src/data.js';
import { buildCsv, kindOf, looksLikeMail, isoDate } from '../public/intake.js';

const ORIGIN = 'https://moc-test.example.workers.dev';
const sampleCsv = fs.readFileSync(new URL('../public/sample/内示_今回_2026-09-25.csv', import.meta.url), 'utf8');
const env = { MOC_TITLE: 'テスト', AI_MODEL: 'claude-opus-5', AI_EFFORT: 'low', ASSETS: { fetch: async () => new Response('x') } };
const withKey = { ...env, ANTHROPIC_API_KEY: { get: async () => 'sk-from-store' } };
const loggedIn = { access: { getIdentity: async () => ({ email: 'sales@thomas-gr.com' }) } };

const req = (body, headers = {}) => new Request(`${ORIGIN}/api/intake`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

function sampleXlsx() {
  // 見本 CSV と同じ内容を Excel に。希望日は日付セル（Excel で入れたときの形）
  const rows = parseNaishiCsv(sampleCsv).rows;
  const aoa = [CSV_HEADER, ...rows.map((r) => [r.date, r.customer, r.name, r.model, r.qty, new Date(`${r.due}T00:00:00`), r.options.join('・'), r.note])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '内示');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

function fakeAnthropic(responseBody, status = 200) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  };
  return { fetch, calls };
}
const aiMessage = (obj, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 }, ...extra,
});

// ---------- csv ----------
test('CSV: parseNaishiCsv と同じ行になり、csvText を再び読むと同じ内示になる', async () => {
  const res = await handleIntake(req({ kind: 'csv', name: '内示.csv', text: sampleCsv }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.kind, 'csv');
  assert.equal(body.versions.length, 3);
  assert.deepEqual(body.versions.map((v) => v.folderId), ['f01', 'f02', 'f03']);
  const expected = parseNaishiCsv(sampleCsv).rows;
  for (const [i, r] of expected.entries()) {
    for (const k of ['date', 'customer', 'name', 'model', 'qty', 'due', 'options', 'note']) assert.deepEqual(body.versions[i][k], r[k], `${i}:${k}`);
  }
  assert.equal(body.reading.length, 3);
  // 根拠と要確認は data.js の読み取りと同じ（ライトカーテンの段数、11/7 の食い違い、取消の意味）
  assert.ok(body.reading[0].some((it) => it.check && /11\/7/.test(it.ask)));
  assert.ok(body.reading[1].some((it) => it.check && /段/.test(it.ask)));
  assert.ok(body.reading[2].some((it) => it.check && /取消/.test(it.ask)));
  assert.ok(body.reading[1].every((it) => typeof it.from === 'string' && it.from));
  // csvText は見本と同じ列で、読み直すと同じ行。画面の既存の csv 経路（/api/data）にそのまま乗る
  assert.equal(body.csvText.split('\n')[0], CSV_HEADER.join(','));
  const again = parseNaishiCsv(body.csvText).rows.map(({ line, ...r }) => r);
  assert.deepEqual(again, expected.map(({ line, ...r }) => r));
  const demo = getDemoData({ csv: body.csvText });
  assert.equal(demo.csv.matched.length, 3);
});

test('CSV: 列が足りない・空は 400', async () => {
  assert.equal((await handleIntake(req({ kind: 'csv', name: 'a.csv', text: '案件,機種\nx,y' }), env)).status, 400);
  assert.equal((await handleIntake(req({ kind: 'csv', name: 'a.csv', text: '   ' }), env)).status, 400);
});

// ---------- xlsx ----------
test('Excel: 先頭シートを CSV にして同じ経路で読む（日付セルは yyyy-mm-dd）', async () => {
  const bytes = sampleXlsx();
  const csv = xlsxToCsv(bytes);
  assert.equal(csv.split('\n')[0], CSV_HEADER.join(','));
  assert.match(csv, /2026-11-14/);
  const res = await handleIntake(req({ kind: 'xlsx', name: '内示.xlsx', base64: b64(bytes) }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  const expected = parseNaishiCsv(sampleCsv).rows.map(({ line, ...r }) => r);
  assert.deepEqual(body.versions.map(({ line, folderId, ...r }) => r), expected);
  assert.deepEqual(body.versions.map((v) => v.folderId), ['f01', 'f02', 'f03']);
  assert.match(body.reading[0][0].from, /^Excel /);
  assert.deepEqual(parseNaishiCsv(body.csvText).rows.map(({ line, ...r }) => r), expected);
});

test('Excel: 壊れたファイル・空のシートは 400', async () => {
  assert.equal((await handleIntake(req({ kind: 'xlsx', name: 'a.xlsx', base64: b64(Buffer.from('これは Excel ではない')) }), env)).status, 400);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'empty');
  const empty = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  assert.equal((await handleIntake(req({ kind: 'xlsx', name: 'a.xlsx', base64: b64(empty) }), env)).status, 400);
});

// ---------- AI（pdf / mail / memo） ----------
test('API キーが無いと pdf / mail / memo は 503（csv / xlsx は読める）', async () => {
  for (const payload of [{ kind: 'pdf', base64: b64(Buffer.from('%PDF-1.4')) }, { kind: 'mail', text: '件名: 内示' }, { kind: 'memo', text: 'VIS-200 3台' }]) {
    const res = await handleIntake(req({ name: 'x', ...payload }), env);
    assert.equal(res.status, 503, payload.kind);
    assert.match((await res.json()).error, /AI の設定がない/);
  }
  assert.equal((await handleIntake(req({ kind: 'csv', name: 'a.csv', text: sampleCsv }), env)).status, 200);
});

const aiItems = {
  items: [
    { name: '第2工場 外観検査ライン増設', model: 'VIS-200', qty: 3, due: '2026-11-14', date: '2026-09-25', customer: '株式会社大和精密製作所', options: ['NG排出シュート'], note: '3号機は増産対応のため追加', from: 'PDF 1ページ目「数量 3」', unsure: ['希望日は 11/14？ 手書きの 11/7？'] },
    { name: null, model: 'AS-500', qty: null, due: null, date: null, customer: null, options: [], note: '前倒し', from: 'メール本文 5行目', unsure: [] },
    { name: '新しい装置', model: 'ZZ-9', qty: 1, due: '2026/12/1', date: null, customer: null, options: ['防塵'], note: null, from: 'メール本文 8行目', unsure: [] },
  ],
};

test('メール: Secrets Store のキーで Anthropic を呼び、決めた JSON だけを返させる', async () => {
  const fake = fakeAnthropic(aiMessage(aiItems));
  const res = await handleIntake(req({ kind: 'mail', name: '内示のご連絡.txt', text: '件名: 内示\n\nVIS-200 を 3台 ...' }), withKey, { fetch: fake.fetch });
  assert.equal(res.status, 200, await res.clone().text());
  const call = fake.calls[0];
  assert.match(call.url, /\/v1\/messages/);
  assert.equal(call.headers.get('x-api-key'), 'sk-from-store');
  assert.equal(call.body.model, 'claude-opus-5');
  assert.equal(call.body.output_config.format.type, 'json_schema');
  assert.equal(call.body.output_config.format.schema.properties.items.items.additionalProperties, false);
  assert.equal(call.body.fallbacks, 'default');
  assert.equal(call.body.messages.length, 1);
  assert.equal(call.body.messages[0].content[0].type, 'text');
  assert.match(call.body.messages[0].content[0].text, /VIS-200 を 3台/);
  assert.match(call.body.system, /計算.*しない/);
  assert.match(call.body.system, /VIS-200/, '画面にある機種を AI に教える');

  const body = await res.json();
  assert.equal(body.versions.length, 3);
  // 1 件目: 読めた値はそのまま。unsure は要確認に
  assert.equal(body.versions[0].folderId, 'f01');
  assert.equal(body.versions[0].qty, 3);
  assert.equal(body.versions[0].due, '2026-11-14');
  assert.ok(body.reading[0].some((it) => it.check && /11\/7/.test(it.ask)));
  assert.ok(body.reading[0].every((it) => /^メール: /.test(it.from)));
  // 2 件目: 機種から案件名を補い、台数・希望日は null → 要確認
  assert.equal(body.versions[1].folderId, 'f02');
  assert.equal(body.versions[1].name, '組立セル AS-500 導入');
  assert.equal(body.versions[1].qty, null);
  assert.equal(body.versions[1].due, null);
  assert.ok(body.reading[1].some((it) => it.field === '台数' && it.check && it.ask));
  assert.ok(body.reading[1].some((it) => it.field === '希望日' && it.check && it.ask));
  // 3 件目: 画面にない機種 → 要確認。日付のゆれ（2026/12/1）は yyyy-mm-dd に
  assert.equal(body.versions[2].folderId, null);
  assert.equal(body.versions[2].due, '2026-12-01');
  assert.ok(body.reading[2].some((it) => it.check && /どの案件/.test(it.ask)));
  // csvText: 読めない項目は空欄のまま（画面で直してから確定する）
  const lines = body.csvText.split('\n');
  assert.equal(lines[0], CSV_HEADER.join(','));
  assert.equal(lines[2], ',,組立セル AS-500 導入,AS-500,,,,前倒し');
  assert.equal(parseNaishiCsv(body.csvText).rows.length, 2, '空欄の行は読み飛ばされ、残りは読める');
});

test('PDF: document ブロック（base64）で渡す', async () => {
  const fake = fakeAnthropic(aiMessage({ items: [aiItems.items[0]] }));
  const pdf = Buffer.from('%PDF-1.4 fake');
  const res = await handleIntake(req({ kind: 'pdf', name: '内示.pdf', base64: b64(pdf) }), withKey, { fetch: fake.fetch });
  assert.equal(res.status, 200);
  const content = fake.calls[0].body.messages[0].content;
  assert.equal(content[0].type, 'document');
  assert.deepEqual(content[0].source, { type: 'base64', media_type: 'application/pdf', data: b64(pdf) });
  assert.equal(content[1].type, 'text');
  assert.match((await res.json()).reading[0][0].from, /^PDF: /);
});

test('AI の出力は型・範囲を検証してから使う', async () => {
  // 全体の形が違う → 502
  for (const text of ['これは JSON ではない', '{"foo":1}', '{"items":"x"}', '{"items":[1]}']) {
    const fake = fakeAnthropic(aiMessage(text));
    const res = await handleIntake(req({ kind: 'memo', name: 'm', text: 'x' }), withKey, { fetch: fake.fetch });
    assert.equal(res.status, 502, text);
  }
  // 項目の値がおかしい → null にして要確認（AI の数字はそのまま使い、直さない）
  const items = validateAiOutput(JSON.stringify({ items: [{ name: 'x'.repeat(500), model: 'VIS-200', qty: -1, due: '来月', date: 'x', customer: 5, options: ['a', 3, '  ', '標準'], note: 7, from: 9, unsure: 'no' }] }));
  assert.equal(items.length, 1);
  assert.equal(items[0].name.length, 100);
  assert.equal(items[0].qty, null);
  assert.equal(items[0].due, null);
  assert.equal(items[0].date, '');
  assert.equal(items[0].customer, '');
  assert.deepEqual(items[0].options, ['a']);
  assert.equal(items[0].note, '');
  assert.equal(items[0].from, '');
  assert.ok(items[0].unsure.some((u) => /台数/.test(u)) && items[0].unsure.some((u) => /希望日/.test(u)));
  const big = validateAiOutput(JSON.stringify({ items: [{ name: 'a', model: 'b', qty: 10000, due: '2026-13-40', date: null, customer: null, options: [], note: null, from: '', unsure: [] }] }));
  assert.equal(big[0].qty, null);
  assert.equal(big[0].due, null);
  assert.equal(validateAiOutput(JSON.stringify({ items: [{ qty: 1.5, name: null, model: null, due: null, date: null, customer: null, options: [], note: null, from: '', unsure: [] }] }))[0].qty, null);
  // 案件が 0 件 → 400
  const none = fakeAnthropic(aiMessage({ items: [] }));
  assert.equal((await handleIntake(req({ kind: 'memo', name: 'm', text: 'x' }), withKey, { fetch: none.fetch })).status, 400);
});

test('AI の拒否・エラーは定型の文で返し、中身は画面に出さない', async () => {
  const refusal = fakeAnthropic(aiMessage('', { content: [], stop_reason: 'refusal' }));
  const r1 = await handleIntake(req({ kind: 'memo', name: 'm', text: 'x' }), withKey, { fetch: refusal.fetch });
  assert.equal(r1.status, 502);
  const broken = fakeAnthropic({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key sk-secret' } }, 401);
  const r2 = await handleIntake(req({ kind: 'memo', name: 'm', text: 'x' }), withKey, { fetch: broken.fetch });
  assert.equal(r2.status, 502);
  assert.doesNotMatch(await r2.text(), /sk-secret|invalid/);
});

// ---------- 不正入力 ----------
test('不正な入力は 400（形式・大きさ）', async () => {
  const cases = [
    '{',
    { kind: 'docx', name: 'a.docx', base64: 'AAAA' },
    { name: 'a.csv', text: sampleCsv },
    { kind: 'csv', name: 'a.csv' },
    { kind: 'csv', name: 'a.csv', text: 'x'.repeat(20001) },
    { kind: 'memo', name: 'm', text: 'x'.repeat(20001) },
    { kind: 'xlsx', name: 'a.xlsx' },
    { kind: 'xlsx', name: 'a.xlsx', base64: '***' },
    { kind: 'pdf', name: 'a.pdf', base64: 'A'.repeat(Math.ceil((2 * 1024 * 1024 + 3) / 3) * 4 + 8) },
    { kind: 'pdf', name: 'a.pdf', base64: b64(Buffer.alloc(2 * 1024 * 1024 + 1)) },
  ];
  for (const c of cases) {
    const res = await handleIntake(req(c), withKey, { fetch: async () => { throw new Error('AI を呼んではいけない'); } });
    assert.equal(res.status, 400, typeof c === 'string' ? c : JSON.stringify(c).slice(0, 60));
  }
});

test('別サイトからの呼び出し・JSON 以外は 403', async () => {
  const body = JSON.stringify({ kind: 'csv', name: 'a.csv', text: sampleCsv });
  const cases = [
    { 'content-type': 'text/plain' },
    {},
    { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    { 'content-type': 'application/json', origin: 'https://evil.example' },
  ];
  for (const headers of cases) {
    const res = await handleIntake(new Request(`${ORIGIN}/api/intake`, { method: 'POST', headers, body }), env);
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
});

test('worker 経由: 認証の後に /api/intake が動く（未ログインは 403）', async () => {
  assert.equal((await worker.fetch(req({ kind: 'csv', name: 'a.csv', text: sampleCsv }), env, {})).status, 403);
  const res = await worker.fetch(req({ kind: 'csv', name: 'a.csv', text: sampleCsv }), env, loggedIn);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).versions.length, 3);
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/intake`), env, loggedIn)).status, 404, 'GET は無い');
});

// ---------- 画面側の小道具（DOM を使わない部分） ----------
test('画面側: 拡張子で形式を決め、確定した値から見本 CSV と同じ列を作る', () => {
  assert.equal(kindOf('内示.CSV'), 'csv');
  assert.equal(kindOf('内示.xlsx'), 'xlsx');
  assert.equal(kindOf('内示.pdf'), 'pdf');
  assert.equal(kindOf('mail.eml'), 'mail');
  assert.equal(kindOf('memo.txt'), 'txt');
  assert.equal(kindOf('a.docx'), '');
  assert.equal(looksLikeMail('件名: 内示のご連絡\n\n本文'), true);
  assert.equal(looksLikeMail('Subject: forecast\nFrom: a@b'), true);
  assert.equal(looksLikeMail('田中さんより電話。VIS-200 3台'), false);
  assert.equal(isoDate('2026/11/7'), '2026-11-07');
  assert.equal(isoDate('11/7'), '');
  const rows = parseNaishiCsv(sampleCsv).rows;
  const csv = buildCsv(rows.map((r) => ({ ...r, note: r.note + ', カンマ "引用" 付き' })));
  assert.equal(csv, toCsv(rows.map((r) => ({ ...r, note: r.note + ', カンマ "引用" 付き' }))), 'サーバーと画面で同じ CSV');
  const back = parseNaishiCsv(csv);
  assert.equal(back.errors.length, 0);
  assert.equal(back.rows[0].note, rows[0].note + ', カンマ "引用" 付き');
  assert.deepEqual(back.rows.map((r) => r.qty), rows.map((r) => r.qty));
});
