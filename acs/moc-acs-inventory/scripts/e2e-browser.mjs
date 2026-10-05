// ブラウザ操作テスト（手元で任意に実行。npm test には含めない）
// 使い方: 別ターミナルで `npm run dev` を起動し、`npx playwright install chromium` 済みの状態で
//   node scripts/e2e-browser.mjs
// AI チャットは疑似応答に差し替え、「選択中フォルダ・基準日がチャットに渡る」「根拠の式」「文面コピー」「画面幅」を確かめる。
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const results = [];
const ok = (name, cond, detail = '') => { results.push([cond ? 'OK' : 'NG', name, detail]); if (!cond) console.error('NG', name, detail); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT/.test(m.text())) errors.push(m.text()); });
// AI を疑似応答にする: 受け取った folder/base/messages をそのまま返す
const chatCalls = [];
await page.route('**/api/me', (r) => r.fulfill({ json: { email: 'dev@thomas-gr.com', title: 't', ai: true, db: false } }));
await page.route('**/api/chat', async (r) => { const b = r.request().postDataJSON(); chatCalls.push(b); await r.fulfill({ json: { reply: `【疑似AI】folder=${b.folder} base=${b.base} q=${b.messages.at(-1).content}` } }); });

await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
// 1. 初期表示: 内示の変更点タブ・全案件
ok('最初のタブは内示の変更点', (await page.locator('.tab.on').textContent()).includes('内示の変更点'));
ok('チャットが表示', await page.locator('#chat').isVisible());
ok('全案件のおすすめ質問が3つ', (await page.locator('#chips button').count()) === 3);
// 2. フォルダ連動: 組立セルを開くと、おすすめ質問にその案件の型番
await page.click('[data-folder="f02"]'); await page.waitForTimeout(400);
const chips = await page.locator('#chips button').allTextContents();
ok('組立セルのおすすめ質問に AS-06-148 が入る', chips.some((c) => /AS-06-148/.test(c)), chips.join(' | '));
ok('組立セルのおすすめ質問に他案件の型番が無い', !chips.some((c) => /ISE1176|KS-300|PC-IPC/.test(c)), chips.join(' | '));
ok('範囲表示が組立セル', (await page.locator('#chatScope').textContent()).includes('組立セル'));
// 3. チャット送信に folder/base が付く
await page.click('#chips button >> nth=0'); await page.waitForSelector('.msg.assistant:not(.intro)');
ok('チャットに folder=f02 が送られる', chatCalls.at(-1)?.folder === 'f02', JSON.stringify(chatCalls.at(-1)));
ok('チャットに base=2026-09-25 が送られる', chatCalls.at(-1)?.base === '2026-09-25');
// 4. フォルダを変えると会話が区切られる
await page.click('[data-folder="f01"]'); await page.waitForTimeout(400);
ok('フォルダ変更で区切りメッセージ', (await page.locator('.msg.intro').last().textContent()).includes('第2工場'));
await page.fill('#input', 'この案件で遅れの恐れがある部品は？'); await page.press('#input', 'Enter'); await page.waitForTimeout(300);
ok('手入力でも folder=f01', chatCalls.at(-1)?.folder === 'f01' && chatCalls.at(-1)?.messages.length === 1, JSON.stringify(chatCalls.at(-1)?.messages));
// 5. 根拠ツールチップ（クリックで固定）
await page.click('[data-tab="urgent"]'); await page.waitForTimeout(200);
await page.click('.basis >> nth=0'); await page.waitForTimeout(100);
const tip = await page.locator('#tooltip').textContent();
ok('根拠に基準日＋リードタイム＋案内の遅れ＝入手見込み', /基準日 9\/25 ＋ リードタイム \d+日.*＝ 入手見込み/.test(tip), tip);
ok('根拠に不足とロット切り上げ', /不足 \d+ → ロット \d+ の倍数に切り上げ/.test(tip));
ok('根拠に発注期限', /発注期限/.test(tip));
await page.mouse.click(5, 5); await page.waitForTimeout(100);
ok('外をクリックで根拠が閉じる', await page.locator('#tooltip').isHidden());
// 6. 文面の下書き → コピー
await page.click('[data-tab="changes"]'); await page.waitForTimeout(200);
await page.click('.action summary >> nth=0'); await page.click('[data-copy] >> nth=0'); await page.waitForTimeout(200);
const clip = await page.evaluate(() => navigator.clipboard.readText());
ok('文面をコピーできる（差出人が架空の実名）', /ACS株式会社 購買部 高橋/.test(clip), clip.slice(0, 80));
ok('文面にプレースホルダーが無い', !/〇〇|○○/.test(clip));
// 7. 基準日切り替え
await page.selectOption('#basePick', '2026-10-06'); await page.waitForTimeout(500);
ok('基準日の説明文が変わる', (await page.locator('#baseNote').textContent()).includes('10/6'));
ok('URL に base が残る', (await page.evaluate(() => location.hash)).includes('base=2026-10-06'));
await page.click('#chips button >> nth=0'); await page.waitForTimeout(300);
ok('チャットに base=2026-10-06 が送られる', chatCalls.at(-1)?.base === '2026-10-06');
// 8. 再読み込みで状態が戻る
await page.reload({ waitUntil: 'networkidle' });
ok('再読み込み後も第2工場・10/6', (await page.locator('.folder.on').textContent()).includes('第2工場') && (await page.inputValue('#basePick')) === '2026-10-06');
// 9. 未受領フォルダ
await page.click('[data-folder="f05"]'); await page.waitForTimeout(400);
ok('未受領フォルダは変更点が空メッセージ', (await page.locator('#panel').textContent()).includes('変更点がありません'));
ok('未受領フォルダでもおすすめ質問が1つ', (await page.locator('#chips button').count()) === 1);
// 10. 全タブで undefined/NaN なし
for (const f of ['all', 'f01', 'f02', 'f03']) {
  await page.click(`[data-folder="${f}"]`); await page.waitForTimeout(300);
  for (const t of ['changes', 'urgent', 'late', 'folders', 'rules', 'reading']) {
    await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(80);
    const html = await page.locator('#panel').innerHTML();
    ok(`${f}/${t} に undefined/NaN/null が無い`, !/undefined|NaN|\bnull\b|\[object/.test(html));
  }
}
// 11. 画面幅: タブが1段、横スクロールなし
for (const w of [1440, 1280, 1100, 860, 390]) {
  await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(200);
  const tabsH = await page.evaluate(() => document.getElementById('tabs').getBoundingClientRect().height);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(`幅${w}: タブが1段（高さ ${Math.round(tabsH)}px）`, tabsH < 60);
  ok(`幅${w}: 横スクロールが出ない`, !overflow);
  await page.screenshot({ path: `.wrangler/e2e-w${w}.png` });
}
ok('コンソール・ページエラーなし', errors.length === 0, errors.join(' / '));
console.table(results.map(([s, n, d]) => ({ 結果: s, 項目: n, 補足: d.slice(0, 80) })));
console.log(`OK ${results.filter((r) => r[0] === 'OK').length} / NG ${results.filter((r) => r[0] === 'NG').length}`);
await browser.close();
