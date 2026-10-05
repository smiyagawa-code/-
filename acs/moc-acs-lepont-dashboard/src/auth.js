import { createRemoteJWKSet, jwtVerify } from 'jose';

// 認証は Cloudflare Access に任せ、Worker では「Access を通ってきたか」を確かめるだけにする。
// 1. ctx.access があればそれを使う（Worker ごとの Access 保護・wrangler dev の access.dev）
// 2. 無ければ Access が付ける署名付きトークン（Cf-Access-Jwt-Assertion）を検証する
//    （全 Worker まとめての保護では ctx.access が空のまま届くことを 2026-09-25 に確認）
// どちらも無い・検証できない = Access を通っていない。画面も API も返さない（fail closed）。

const jwksCache = new Map();

export async function authorize(request, env, ctx, deps = {}) {
  if (ctx?.access) {
    try {
      const identity = await ctx.access.getIdentity();
      return { ok: true, email: identity?.email ?? '' };
    } catch {
      // Access は通っているが本人情報が取れないだけ。表示に使うだけなので通す
      return { ok: true, email: '' };
    }
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  const team = normalizeTeam(env?.ACCESS_TEAM_DOMAIN);
  const audiences = String(env?.ACCESS_AUD || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!token || !team || audiences.length === 0) return { ok: false };

  try {
    const keys = deps.keys ?? jwks(team);
    const { payload } = await jwtVerify(token, keys, { issuer: team, audience: audiences, algorithms: ['RS256'] });
    return { ok: true, email: typeof payload.email === 'string' ? payload.email : '' };
  } catch {
    return { ok: false };
  }
}

function normalizeTeam(value) {
  const v = String(value || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  return v.startsWith('https://') ? v : `https://${v}`;
}

function jwks(team) {
  if (!jwksCache.has(team)) {
    jwksCache.set(team, createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`)));
  }
  return jwksCache.get(team);
}

export function deniedResponse(request) {
  const url = new URL(request.url);
  const body = { error: 'このモックは Cloudflare Access のログインを確認できないため表示できません。管理者に連絡してください。' };
  if (url.pathname.startsWith('/api/')) {
    return Response.json(body, { status: 403 });
  }
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>表示できません</title>` +
      `<body style="font-family:'Yu Gothic','Noto Sans JP',sans-serif;padding:48px;color:#0B2A59">` +
      `<h1 style="font-size:20px">表示できません</h1><p>${body.error}</p></body>`,
    { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
