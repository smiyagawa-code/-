// AI チャット（/api/chat）。選択中のフォルダと基準日を毎回いっしょに送る（AI は画面と同じ表だけを見る）。
// 返答は先にエスケープしてから、箇条書き・太字・小見出しだけ整える。
import { esc } from './util.js';

const MAX_MESSAGES = 20; // サーバーの上限と同じ（10往復）
let history = [];
let context = { folder: 'all', base: '', examples: [], scopeName: '全案件' };

export function setupChat() {
  const form = document.getElementById('form');
  const input = document.getElementById('input');
  document.getElementById('chatFab').addEventListener('click', openChat);
  document.getElementById('chatClose').addEventListener('click', closeChat);
  document.getElementById('chips').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') ask(e.target.textContent);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await ask(text);
  });
}

// フォルダ・基準日が変わったら、おすすめ質問を差し替え、会話をいったん区切る（前の案件の話と混ざらないように）
export function setChatContext(next) {
  const changed = next.folder !== context.folder || next.base !== context.base;
  context = { ...context, ...next };
  document.getElementById('chips').innerHTML = (context.examples || []).map((q) => `<button type="button">${esc(q)}</button>`).join('');
  const scope = document.getElementById('chatScope');
  if (scope) scope.textContent = context.scopeName;
  if (changed && history.length) {
    history = [];
    addMsg('assistant intro', `ここからは「${esc(context.scopeName)}」について答えます。`);
  }
}

export function openChat() {
  document.getElementById('chat').hidden = false;
  document.getElementById('chatFab').hidden = true;
  document.getElementById('input')?.focus?.();
}
export function closeChat() {
  document.getElementById('chat').hidden = true;
  document.getElementById('chatFab').hidden = false;
}

export async function ask(text) {
  const send = document.getElementById('send');
  if (send.disabled) return;
  history.push({ role: 'user', content: text });
  while (history.length > MAX_MESSAGES || history[0].role !== 'user') history.shift();
  addMsg('user', esc(text));
  const pending = addMsg('assistant pending', '<span class="typing"><i></i><i></i><i></i></span>');
  send.disabled = true;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history, folder: context.folder, base: context.base }),
    });
    const body = await res.json().catch(() => ({}));
    pending.remove();
    if (!res.ok || !body.reply) {
      history.pop();
      addMsg('error', esc(body.error || 'AI の呼び出しに失敗しました。'));
      return;
    }
    history.push({ role: 'assistant', content: body.reply });
    addMsg('assistant', renderReply(body.reply));
  } catch {
    pending.remove();
    history.pop();
    addMsg('error', '通信に失敗しました。');
  } finally {
    send.disabled = false;
  }
}

function renderReply(text) {
  const blocks = [];
  let list = null;
  for (const raw of esc(text).split('\n')) {
    const line = raw.trim();
    const bold = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (/^[-・•]\s*/.test(line) && line.length > 1) {
      if (!list) { list = []; blocks.push(list); }
      list.push(bold(line.replace(/^[-・•]\s*/, '')));
      continue;
    }
    list = null;
    if (!line) continue;
    if (/^(#+\s*)?(データから言えること|確かめるべきこと|確認すべきこと|担当の方に確かめること|まとめ|件名|本文)[:：]?$/.test(line)) blocks.push(`<p class="h">${line.replace(/^#+\s*/, '')}</p>`);
    else blocks.push(`<p>${bold(line.replace(/^#+\s*/, ''))}</p>`);
  }
  return blocks.map((b) => (Array.isArray(b) ? `<ul>${b.map((li) => `<li>${li}</li>`).join('')}</ul>` : b)).join('');
}

function addMsg(kind, html) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.innerHTML = html;
  const log = document.getElementById('log');
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
