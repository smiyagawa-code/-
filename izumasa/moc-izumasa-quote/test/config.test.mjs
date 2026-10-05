// 公開の設定（wrangler.jsonc）が安全なままかを確かめる。どのモックでもそのまま使える。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const cfg = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));

test('公開先が会社の Cloudflare アカウントに固定されている', () => {
  assert.match(cfg.account_id ?? '', /^[0-9a-f]{32}$/, 'account_id がない（自分のアカウントに公開されるおそれ）');
});

test('画面も必ず Worker（認証）を通る', () => {
  assert.equal(cfg.assets?.run_worker_first, true, 'run_worker_first: true を消さない（画面が認証なしで配信される）');
});

test('Access の検証用の設定がある', () => {
  assert.ok(cfg.vars?.ACCESS_TEAM_DOMAIN && cfg.vars?.ACCESS_AUD, 'ACCESS_TEAM_DOMAIN / ACCESS_AUD がない');
  assert.match(cfg.name, /^moc-[a-z0-9-]+$/, 'Worker 名は moc- で始める');
});

test('パスワードや API キーを書いていない', () => {
  assert.doesNotMatch(text, /sk-ant-|PASSWORD|_KEY"\s*:\s*"[A-Za-z0-9]{12,}/, '秘密の値らしきものが wrangler.jsonc にある');
});
