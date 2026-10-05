import { chromium } from 'playwright';
import fs from 'node:fs';
const results = [];
const ok = (name, cond, detail = '') => { results.push([cond ? 'OK' : 'NG', name, detail]); if (!cond) console.error('NG', name, detail); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT/.test(m.text())) errors.push(m.text()); });
const chatCalls = [];
await page.route('**/api/me', (r) => r.fulfill({ json: { email: 'dev@thomas-gr.com', title: 't', ai: true, db: false } }));
await page.route('**/api/chat', async (r) => { const b = r.request().postDataJSON(); chatCalls.push(b); await r.fulfill({ json: { reply: `【疑似AI】folder=${b.folder}` } }); });
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
// 1. 初期表示
ok('最初のタブは「やること」', (await page.locator('.tab.on').textContent()).includes('やること'));
ok('タブは 3 つ', (await page.locator('.tab').count()) === 3);
ok('AI は閉じていて、右下のボタンだけ', await page.locator('#chat').isHidden() && await page.locator('#chatFab').isVisible());
ok('やることの 1 行目は赤（遅れ）', (await page.locator('.todo').first().getAttribute('class')).includes('red'));
// 2. フォルダ連動
await page.click('[data-folder="f02"]'); await page.waitForTimeout(400);
ok('組立セルのやることは 6 件', (await page.locator('.todo').count()) === 6);
await page.click('#chatFab'); await page.waitForTimeout(100);
const chips = await page.locator('#chips button').allTextContents();
ok('質問例に AS-06-148、他案件の型番なし', chips.some((c) => /AS-06-148/.test(c)) && !chips.some((c) => /ISE1176|KS-300|PC-IPC/.test(c)), chips.join(' | '));
ok('質問例はどれも 24 文字以内', chips.every((c) => c.length <= 24));
await page.click('#chips button >> nth=0'); await page.waitForSelector('.msg.assistant:not(.intro)');
ok('チャットに folder=f02・base=2026-09-25', chatCalls.at(-1)?.folder === 'f02' && chatCalls.at(-1)?.base === '2026-09-25');
await page.click('#chatClose');
ok('× で AI が閉じる', await page.locator('#chat').isHidden());
// 3. なぜ？
await page.click('[data-why] >> nth=1'); await page.waitForTimeout(100);
const why = await page.locator('#pop').textContent();
ok('「なぜ？」に 今日＋納期＋遅れ連絡＝届く日', /9\/25 ＋ 納期 \d+日 ＋ 遅れ連絡 \d+日 ＝ 10\/23 に届く/.test(why), why);
ok('「なぜ？」に 届く日 − 希望日 ＝ 遅れ', /10\/23 − 希望日 10\/15 ＝ 8日遅れ/.test(why));
ok('「なぜ？」に専門用語なし', !/リードタイム|発注残|引当|基準日/.test(why));
await page.click('.pop-close');
ok('× で閉じる', await page.locator('#pop').isHidden());
// 4. 文面 → コピー
await page.click('[data-draft] >> nth=0'); await page.waitForTimeout(100);
await page.click('[data-copy]'); await page.waitForTimeout(200);
const clip = await page.evaluate(() => navigator.clipboard.readText());
ok('文面をコピー（差出人は架空の実名・数字入り）', /ACS株式会社 購買部 高橋/.test(clip) && /\d+個/.test(clip));
await page.click('.pop-close');
// 5. 変わった点
await page.click('[data-tab="changes"]'); await page.waitForTimeout(100);
const ch = await page.locator('#panel').textContent();
ok('読み取り札（台数・希望日・仕様・確かめること）', /台数.*希望日.*仕様.*確かめること/.test(ch));
ok('変更カードに 前倒し と 仕様変更', /前倒し/.test(ch) && /仕様変更/.test(ch));
ok('余る: 安全柵 2個', /余る.*安全柵 1.8m\s*2\s*個/.test(ch));
await page.click('tr[data-why-row] >> nth=0'); await page.waitForTimeout(100);
ok('表の行を押すと なぜ？', (await page.locator('#pop').textContent()).includes('なぜ？'));
await page.click('.pop-close');
// 6. 計算のしかた
await page.click('#rulesBtn'); await page.waitForTimeout(100);
const rules = await page.locator('#pop').textContent();
ok('計算のしかたは現場の言葉', /いる数.*台数 × 1台に使う数/.test(rules) && !/リードタイム|BOM|ロット/.test(rules));
await page.click('.pop-close');
// 7. 取消
await page.click('[data-folder="f03"]'); await page.waitForTimeout(400);
await page.click('[data-tab="changes"]'); await page.waitForTimeout(100);
const c3 = await page.locator('#panel').textContent();
ok('取消カードに 余る 3 点と「回せる」', /取消/.test(c3) && /回せる/.test(c3) && /クリーン用ベアリング\s*30/.test(c3));
// 8. 内示を置く（本当に CSV を読む）
await page.setInputFiles('#dropInput', { name: '内示_今回_2026-09-25.csv', mimeType: 'text/csv', buffer: fs.readFileSync('public/sample/内示_今回_2026-09-25.csv') });
await page.waitForTimeout(300);
ok('置くと「読み取り中…」', (await page.locator('#pop').textContent()).includes('読み取り中'));
await page.waitForTimeout(3000);
ok('置いたあとは 読み取った案件の 変わった点 が開く', (await page.locator('.folder.on').textContent()).includes('第2工場') && (await page.locator('.tab.on').textContent()).includes('変わった点'));
await page.click('#csvClear'); await page.waitForTimeout(400);
// 9. 未着フォルダ
await page.click('[data-folder="f05"]'); await page.waitForTimeout(400);
await page.click('[data-tab="todo"]');
ok('未着フォルダは「まだ届いていません」', (await page.locator('#panel').textContent()).includes('まだ届いていません'));
// 10. 全フォルダ×全タブで変な文字なし
for (const f of ['all', 'f01', 'f02', 'f03']) {
  await page.click(`[data-folder="${f}"]`); await page.waitForTimeout(300);
  for (const t of ['todo', 'changes', 'parts']) {
    await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(60);
    const html = await page.locator('#panel').innerHTML();
    ok(`${f}/${t}: undefined/NaN/専門用語なし`, !/undefined|NaN|\bnull\b|\[object|リードタイム|発注残|基準日/.test(html));
  }
}
// 11. 幅
for (const w of [1440, 1100, 860, 390]) {
  await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(`幅${w}: 横スクロールなし`, !overflow);
}
ok('コンソール・ページエラーなし', errors.length === 0, errors.join(' / '));
console.log(results.filter((r) => r[0] === 'NG').map((r) => r.join(' ')).join('\n'));
console.log(`OK ${results.filter((r) => r[0] === 'OK').length} / NG ${results.filter((r) => r[0] === 'NG').length}`);
await browser.close();
