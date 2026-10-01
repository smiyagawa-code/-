import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { authorize } from '../src/auth.js';

const TEAM = 'https://team-test.cloudflareaccess.com';
const AUD = 'aud-all-workers';
const env = { ACCESS_TEAM_DOMAIN: 'team-test.cloudflareaccess.com', ACCESS_AUD: AUD };

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
const keys = createLocalJWKSet({ keys: [jwk] });
const other = await generateKeyPair('RS256');

async function token({ iss = TEAM, aud = AUD, exp = '5m', key = privateKey, email = 'sales@thomas-gr.com' } = {}) {
  return new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key);
}
const req = (jwt) => new Request('https://moc-x.example.workers.dev/', { headers: jwt ? { 'cf-access-jwt-assertion': jwt } : {} });

test('ctx.access が無くても、正しい Access トークンなら通す', async () => {
  const r = await authorize(req(await token()), env, {}, { keys });
  assert.deepEqual(r, { ok: true, email: 'sales@thomas-gr.com' });
});

test('ACCESS_AUD はカンマ区切りで複数指定できる', async () => {
  const r = await authorize(req(await token({ aud: 'aud-worker' })), { ...env, ACCESS_AUD: `${AUD}, aud-worker` }, {}, { keys });
  assert.equal(r.ok, true);
});

test('トークンが無い・設定が無い・検証に失敗したら拒否（fail closed）', async () => {
  const good = await token();
  const cases = [
    ['トークンなし', req(null), env],
    ['チーム未設定', req(good), { ACCESS_AUD: AUD }],
    ['AUD 未設定', req(good), { ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN }],
    ['宛先違い', req(await token({ aud: 'other-app' })), env],
    ['発行元違い', req(await token({ iss: 'https://evil.cloudflareaccess.com' })), env],
    ['期限切れ', req(await token({ exp: Math.floor(Date.now() / 1000) - 60 })), env],
    ['署名違い', req(await token({ key: other.privateKey })), env],
    ['形式違い', req('not-a-jwt'), env],
  ];
  for (const [name, request, e] of cases) {
    const r = await authorize(request, e, {}, { keys });
    assert.equal(r.ok, false, name);
  }
});

test('ctx.access があればそちらを優先する', async () => {
  const ctx = { access: { getIdentity: async () => ({ email: 'a@thomas-gr.com' }) } };
  assert.deepEqual(await authorize(req(null), {}, ctx), { ok: true, email: 'a@thomas-gr.com' });
});
