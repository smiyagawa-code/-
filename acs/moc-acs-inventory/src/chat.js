import Anthropic from '@anthropic-ai/sdk';
import { forbiddenCrossSite, isSameOriginJson } from './http.js';

// 1回の質問で使える量の上限（費用の暴走を防ぐ）。画面側も同じ往復数で古い会話を捨てる
const MAX_MESSAGES = 20;
const MAX_CHARS = 2000;
const MAX_TOTAL_CHARS = 12000;
const MAX_OUTPUT_TOKENS = 4000;
// 拒否時に Anthropic 側で別モデルへ自動で回す（server-side fallbacks）。対応モデルだけに付ける
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);

export async function handleChat(request, env, deps = {}) {
  if (!isSameOriginJson(request)) return forbiddenCrossSite();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'リクエストの形式が正しくありません。' }, { status: 400 });
  }

  const messages = validateMessages(body?.messages);
  if (!messages) {
    return Response.json({ error: '質問の形式が正しくありません（最大10往復・1件2000文字まで）。' }, { status: 400 });
  }

  const apiKey = await readApiKey(env);
  if (!apiKey) {
    return Response.json({ error: 'AI の設定がまだです（API キー未設定）。管理者に連絡してください。' }, { status: 503 });
  }

  // 画面のデータは、リクエスト（選択中のフォルダ・基準日）に応じて作る
  const data = typeof deps.data === 'function' ? deps.data(body) : deps.data;
  const model = env.AI_MODEL || 'claude-opus-5';
  const client = new Anthropic({ apiKey, fetch: deps.fetch, maxRetries: 1, timeout: 60_000 });
  const params = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: env.AI_EFFORT || 'low' },
    system: buildSystemPrompt(env.MOC_TITLE, data),
    messages,
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let response;
  try {
    response = await client.beta.messages.create(params);
  } catch (err) {
    // 詳細（キーや内部情報）は画面に出さない。原因の切り分け用にログにだけ残す
    console.error('anthropic error', err?.status ?? '', err?.name ?? '');
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    return Response.json({ error: 'AI の呼び出しに失敗しました。少し待ってからもう一度お試しください。' }, { status });
  }

  if (response.stop_reason === 'refusal') {
    return Response.json({ reply: 'この質問にはお答えできません。聞き方を変えてお試しください。', model: response.model });
  }
  const reply = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!reply) {
    return Response.json({ error: 'AI から回答が返りませんでした。もう一度お試しください。' }, { status: 502 });
  }
  return Response.json({ reply, model: response.model });
}

function validateMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) return null;
  const out = [];
  let total = 0;
  for (const m of input) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    if (typeof m.content !== 'string') return null;
    const content = m.content.trim();
    if (!content || content.length > MAX_CHARS) return null;
    total += content.length;
    if (total > MAX_TOTAL_CHARS) return null;
    out.push({ role: m.role, content });
  }
  if (out[0].role !== 'user' || out.at(-1).role !== 'user') return null;
  return out;
}

export async function hasApiKey(env) {
  return Boolean(await readApiKey(env));
}

async function readApiKey(env) {
  const binding = env.ANTHROPIC_API_KEY;
  if (!binding) return '';
  try {
    // Secrets Store のバインディングは .get() で読む。通常の Secret なら文字列のまま
    return typeof binding.get === 'function' ? (await binding.get()) || '' : String(binding);
  } catch {
    return '';
  }
}

function buildSystemPrompt(title, data) {
  return [
    `あなたは「${title || '営業モック'}」というデモ画面に組み込まれたアシスタントです。`,
    '画面を見ているのは商談中のお客様と thomas 株式会社の営業担当です。',
    '回答は下の「画面のデータ」だけを根拠にしてください。データに無いことは「このデモのデータには含まれていません」と答えてください。',
    'あなたの役割は「読み取り・注意書き・文面の下書き・表への質問に答える」ことです。数字は計算しません。不足・追加手配・入手見込み・遅れは、データにある値（計算の決まり v1 で機械的に出した値）をそのまま使い、足し算・引き算・日数計算を自分で行わないでください。',
    '型番・数字は、データにあるものだけを使います。データに無い型番は絶対に出さないでください。',
    '「この案件」と言われたら、context にある「いま開いている案件」のことです。ほかの案件は、聞かれたときだけ触れてください。',
    '根拠を聞かれたら、データの「根拠」の文（式に数字が入ったもの）をそのまま示してください。',
    '項目名の末尾（_個、_日、_円 など）が単位です。金額を万円で言うときは 10,000 で割り、「約」を付けてください。',
    '文面の下書きを頼まれたら、件名と本文を書き、差出人は「ACS株式会社 購買部 高橋」（架空）にしてください。',
    '原因は断定せず、データから言えることと、担当の方に確かめることを分けて答えてください。',
    '日本語のですます調で、300字程度までに簡潔にまとめてください。',
    '',
    '# 画面のデータ（JSON）',
    JSON.stringify(data),
  ].join('\n');
}
