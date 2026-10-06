import { authorize, deniedResponse } from './auth.js';
import { handleChat, hasApiKey } from './chat.js';
import { getAiData, getDemoData, parseNaishiCsv } from './data.js';
import { forbiddenCrossSite, isSameOriginJson } from './http.js';
import { handleRecords } from './db.js';
import { handleIntake } from './intake.js';

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
    if (url.pathname === '/api/data' && request.method === 'POST') {
      // 画面に置かれた内示 CSV（文字列）を受け取り、今回の内示を差し替えて計算し直す。保存はしない
      if (!isSameOriginJson(request)) return forbiddenCrossSite();
      let body;
      try { body = await request.json(); } catch { return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 }); }
      if (body?.csv != null && (typeof body.csv !== 'string' || body.csv.length > 20000)) return Response.json({ error: 'CSV が大きすぎます（2万文字まで）。' }, { status: 400 });
      const parsed = body?.csv ? parseNaishiCsv(body.csv) : { rows: [], errors: [] };
      if (body?.csv && !parsed.rows.length) return Response.json({ error: `CSV を読めませんでした。${parsed.errors.join('／')}` }, { status: 400 });
      return Response.json({ ...getDemoData({ base: body?.base, folder: body?.folder, csv: body?.csv || null, overrides: body?.overrides }), csvErrors: parsed.errors });
    }
    if (url.pathname === '/api/intake' && request.method === 'POST') {
      // 内示（CSV・Excel・PDF・メール・メモ）を読み取り、CSV と同じ形に書き直して返す（保存はしない。別サイト・JSON 以外は intake.js 側で拒否）
      return handleIntake(request, env);
    }
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      // AI には、画面と同じ計算結果のうち「選択中のフォルダ」の分だけを渡す（画面の表と食い違わないように）。置かれた CSV も同じように反映
      return handleChat(request, env, { data: (body) => getAiData({ base: body?.base, folder: body?.folder, csv: typeof body?.csv === 'string' && body.csv.length <= 20000 ? body.csv : null, overrides: body?.overrides }) });
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
