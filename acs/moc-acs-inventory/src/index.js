import { authorize, deniedResponse } from './auth.js';
import { handleChat, hasApiKey } from './chat.js';
import { getAiData, getDemoData } from './data.js';
import { handleRecords } from './db.js';

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
      // 基準日と選択中のフォルダは画面から受け取る（不正な値は data.js 側で既定値に戻す）
      return Response.json(getDemoData({ base: url.searchParams.get('base') || undefined, folder: url.searchParams.get('folder') || undefined }));
    }
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      // AI には、画面と同じ計算結果のうち「選択中のフォルダ」の分だけを渡す（画面の表と食い違わないように）
      return handleChat(request, env, { data: (body) => getAiData({ base: body?.base, folder: body?.folder }) });
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
