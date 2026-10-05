import { authorize, deniedResponse } from './auth.js';
import { handleChat, hasApiKey } from './chat.js';
import { getAiData, getDemoData } from './data.js';
import { handleRecords } from './db.js';
import { forbiddenCrossSite, isSameOriginJson } from './http.js';

export default {
  async fetch(request, env, ctx) {
    // 画面・API どちらも、まず Access のログイン確認を通ったかを見る
    const auth = await authorize(request, env, ctx);
    if (!auth.ok) return deniedResponse(request);

    const url = new URL(request.url);
    if (url.pathname === '/api/me' && request.method === 'GET') {
      return Response.json({ email: auth.email, title: env.MOC_TITLE || '', ai: await hasApiKey(env), db: Boolean(env.DB) });
    }
    if (url.pathname === '/api/data' && request.method === 'GET') {
      // 選択中の依頼と拠点は画面から受け取る（不正な値は data.js 側で既定値に戻す）
      return Response.json(getDemoData({ folder: url.searchParams.get('folder') || undefined, site: url.searchParams.get('site') || undefined }));
    }
    if (url.pathname === '/api/data' && request.method === 'POST') {
      // 画面での手直し（掛率・単価の上書き、在庫／直送、行の追加、注記、空白行）は、画面が持たず毎回サーバーに送って計算し直す。
      // 画面は計算しない＝AI に渡す数字と表の数字が必ず同じになる
      if (!isSameOriginJson(request)) return forbiddenCrossSite();
      let body;
      try { body = await request.json(); } catch { return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 }); }
      return Response.json(getDemoData({ folder: body?.folder, site: body?.site, edits: body?.edits }));
    }
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      // AI には、画面と同じ計算結果のうち「選択中の依頼」の分だけを渡す（画面の表と食い違わないように）
      return handleChat(request, env, { data: (body) => getAiData({ folder: body?.folder, site: body?.site, edits: body?.edits }) });
    }
    if (url.pathname === '/api/records' || url.pathname.startsWith('/api/records/')) {
      return handleRecords(request, env, auth);
    }
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};
