// AI の返答の表示（renderReply）。Markdown の表が「|」のまま出ないことを見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReply } from '../public/chat.js';

test('Markdown の表は表として出す（行の間に空行があっても 1 つの表）', () => {
  const reply = [
    '間に合わない部品は次の3点です。', '',
    '| 型番 | 品名 | 届く日 | 遅れ |', '', '|---|---|---|---|', '',
    '| D-1178 | 直動ガイド 15幅 | 2026-10-23 | 8日 |', '',
    '| SV-2030 | サーボモータ 200W | 2026-10-20 | **5日** |', '',
    '- D-1178 は急ぎです。',
  ].join('\n');
  const html = renderReply(reply);
  assert.equal((html.match(/<div class="tbl"><table>/g) || []).length, 1);
  assert.ok(html.includes('<th>型番</th><th>品名</th><th>届く日</th><th>遅れ</th>'));
  assert.ok(html.includes('<td>D-1178</td><td>直動ガイド 15幅</td><td>2026-10-23</td><td>8日</td>'));
  assert.ok(html.includes('<td><strong>5日</strong></td>'));
  assert.ok(!html.includes('|'));
  assert.ok(!html.includes('---'));
  assert.ok(html.includes('<ul><li>D-1178 は急ぎです。</li></ul>'));
});

test('表のセルもエスケープする', () => {
  const html = renderReply('| a | b |\n|---|---|\n| <img src=x> | 1 |');
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(!html.includes('<img'));
});

test('表のない返答は今までどおり（段落・箇条書き・小見出し）', () => {
  const html = renderReply('まとめ\n- 一つ目\n- 二つ目\n\n- 別の箇条\n本文です。');
  assert.equal(html, '<p class="h">まとめ</p><ul><li>一つ目</li><li>二つ目</li></ul><ul><li>別の箇条</li></ul><p>本文です。</p>');
});
