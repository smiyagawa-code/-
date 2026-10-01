import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { handleChat } from '../src/chat.js';
import { getAiData, getDemoData } from '../src/data.js';

const loggedIn = { access: { getIdentity: async () => ({ email: 'sales@thomas-gr.com' }) } };
const env = {
  MOC_TITLE: 'テスト様 デモ',
  AI_MODEL: 'claude-opus-5',
  AI_EFFORT: 'low',
  ASSETS: { fetch: async () => new Response('<html>画面</html>', { headers: { 'content-type': 'text/html' } }) },
};

const req = (path, init) => new Request(`https://moc-test.example.workers.dev${path}`, init);
const chatReq = (messages) => req('/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://moc-test.example.workers.dev', 'sec-fetch-site': 'same-origin' },
  body: JSON.stringify({ messages }),
});

test('Access を通っていないと画面も API も 403（fail closed）', async () => {
  for (const path of ['/', '/index.html', '/app.js', '/api/data', '/api/me']) {
    const res = await worker.fetch(req(path), env, {});
    assert.equal(res.status, 403, path);
  }
  const res = await worker.fetch(req('/'), env, undefined);
  assert.equal(res.status, 403);
});

test('Access を通っていれば画面と API を返す', async () => {
  const page = await worker.fetch(req('/'), env, loggedIn);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /画面/);

  const me = await (await worker.fetch(req('/api/me'), env, loggedIn)).json();
  assert.equal(me.email, 'sales@thomas-gr.com');

  const data = await (await worker.fetch(req('/api/data'), env, loggedIn)).json();
  assert.ok(Array.isArray(data.sections) && data.sections.length > 0);
  assert.equal((await worker.fetch(req('/api/nothing'), env, loggedIn)).status, 404);
});

test('本人情報が取れなくても Access を通っていれば表示する', async () => {
  const ctx = { access: { getIdentity: async () => { throw new Error('x'); } } };
  assert.equal((await worker.fetch(req('/'), env, ctx)).status, 200);
});

test('架空データは毎回同じ値（乱数を使わない）', () => {
  assert.deepEqual(getDemoData(), getDemoData());
  assert.deepEqual(getAiData(), getAiData());
});

test('API キーが無いと 503（AI 未設定を伝える）', async () => {
  const res = await worker.fetch(chatReq([{ role: 'user', content: 'こんにちは' }]), env, loggedIn);
  assert.equal(res.status, 503);
});

test('不正な質問は 400', async () => {
  const withKey = { ...env, ANTHROPIC_API_KEY: 'sk-test' };
  const bad = [
    [],
    [{ role: 'system', content: 'x' }],
    [{ role: 'assistant', content: 'x' }],
    [{ role: 'user', content: 'x'.repeat(2001) }],
    [{ role: 'user', content: 1 }],
  ];
  for (const messages of bad) {
    const res = await handleChat(chatReq(messages), withKey, { data: {} });
    assert.equal(res.status, 400, JSON.stringify(messages).slice(0, 40));
  }
  const brokenJson = req('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal((await handleChat(brokenJson, withKey, { data: {} })).status, 400);

  const tooMany = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
  assert.equal((await handleChat(chatReq(tooMany), withKey, { data: {} })).status, 400);
  const tooLong = Array.from({ length: 7 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(1900) }));
  assert.equal((await handleChat(chatReq(tooLong), withKey, { data: {} })).status, 400, '合計12000文字を超える');
});

test('別サイトからの呼び出し・JSON 以外は 403（ログイン中のブラウザを悪用させない）', async () => {
  const withKey = { ...env, ANTHROPIC_API_KEY: 'sk-test' };
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'x' }] });
  const cases = [
    { 'content-type': 'text/plain' },
    {},
    { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    { 'content-type': 'application/json', origin: 'https://evil.example' },
  ];
  for (const headers of cases) {
    const res = await handleChat(req('/api/chat', { method: 'POST', headers, body }), withKey, { data: {} });
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
});

test('/api/me は AI が使えるかを返す（画面は AI なしならチャットを出さない）', async () => {
  const off = await (await worker.fetch(req('/api/me'), env, loggedIn)).json();
  assert.equal(off.ai, false);
  const on = await (await worker.fetch(req('/api/me'), { ...env, ANTHROPIC_API_KEY: { get: async () => 'k' } }, loggedIn)).json();
  assert.equal(on.ai, true);
});

function fakeAnthropic(responseBody, status = 200) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  };
  return { fetch, calls };
}

const okMessage = (text, extra = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
  content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 }, ...extra,
});

test('Secrets Store のキーで Anthropic を呼び、画面データを渡す', async () => {
  const fake = fakeAnthropic(okMessage('製品Cは前年から伸びています。'));
  const secretEnv = { ...env, ANTHROPIC_API_KEY: { get: async () => 'sk-from-store' } };
  const res = await handleChat(chatReq([{ role: 'user', content: '製品Cは？' }]), secretEnv, { data: getAiData(), fetch: fake.fetch });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reply, '製品Cは前年から伸びています。');

  const call = fake.calls[0];
  assert.match(call.url, /\/v1\/messages/);
  assert.equal(call.headers.get('x-api-key'), 'sk-from-store');
  assert.match(call.headers.get('anthropic-beta') || '', /server-side-fallback-2026-07-01/);
  assert.equal(call.body.model, 'claude-opus-5');
  assert.equal(call.body.fallbacks, 'default');
  assert.deepEqual(call.body.output_config, { effort: 'low' });
  assert.equal(call.body.max_tokens, 4000);
  assert.ok(call.body.system.includes(JSON.stringify(getAiData())), 'AI に元データを渡す');
  assert.equal(call.body.betas, undefined, 'betas はヘッダーで送り、本文に入れない');
});

test('fallbacks 非対応モデルに変えたら fallbacks を付けない', async () => {
  const fake = fakeAnthropic(okMessage('はい'));
  const e = { ...env, AI_MODEL: 'claude-sonnet-5', ANTHROPIC_API_KEY: 'sk-test' };
  await handleChat(chatReq([{ role: 'user', content: 'x' }]), e, { data: {}, fetch: fake.fetch });
  assert.equal(fake.calls[0].body.fallbacks, undefined);
  assert.equal(fake.calls[0].headers.get('anthropic-beta'), null);
});

test('拒否（refusal）は定型の案内に置き換える', async () => {
  const fake = fakeAnthropic(okMessage('', { content: [], stop_reason: 'refusal' }));
  const res = await handleChat(chatReq([{ role: 'user', content: 'x' }]), { ...env, ANTHROPIC_API_KEY: 'k' }, { data: {}, fetch: fake.fetch });
  assert.equal(res.status, 200);
  assert.match((await res.json()).reply, /お答えできません/);
});

test('Anthropic のエラー内容は画面に出さない', async () => {
  const fake = fakeAnthropic({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key sk-secret' } }, 401);
  const res = await handleChat(chatReq([{ role: 'user', content: 'x' }]), { ...env, ANTHROPIC_API_KEY: 'k' }, { data: {}, fetch: fake.fetch });
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /sk-secret|invalid/);
});
