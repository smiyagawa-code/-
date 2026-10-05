// デモのリハーサル（見本 CSV を本当に落として、画面が変わるかを確かめる）。npm test には含めない
// 使い方: 別ターミナルで `npm run dev` を起動し、`npx playwright install chromium` 済みの状態で
//   node scripts/rehearsal.mjs
// 明日のデモのリハーサル: 見本 CSV を本当に落として、画面が変わるかを確かめる
import { chromium } from 'playwright';
import fs from 'node:fs';
const SAMPLE = new URL('../public/sample/', import.meta.url).pathname;
// Playwright は日本語のパスを渡せないので、中身を読んで名前つきで渡す（実機のドラッグ＆ドロップと同じ）
const file = (name) => ({ name, mimeType: 'text/csv', buffer: fs.readFileSync(SAMPLE + name) });
const results = [];
const ok = (name, cond, detail = '') => { results.push([cond ? 'OK' : 'NG', name, detail]); if (!cond) console.error('NG', name, detail); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|status of 400/.test(m.text())) errors.push(m.text()); });
const chatCalls = [];
await page.route('**/api/me', (r) => r.fulfill({ json: { email: 'dev@thomas-gr.com', title: 't', ai: true, db: false } }));
await page.route('**/api/chat', async (r) => { const b = r.request().postDataJSON(); chatCalls.push(b); await r.fulfill({ json: { reply: '【疑似AI】' } }); });
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
const shot = (n) => page.screenshot({ path: `.wrangler/${n}.png` });

// 場面 1: 開いた直後（やること 18）
ok('開いた直後: やること 18 件', (await page.locator('.tab.on b').textContent()) === '18');
await shot('r1-start');

// 場面 2: 見本 CSV の案内
await page.click('#sampleBtn'); await page.waitForTimeout(150);
ok('見本の CSV が 3 本', (await page.locator('.files a').count()) === 3);
const dl = await page.evaluate(async () => { const r = await fetch('/sample/内示_今回_修正版.csv'); return r.ok && (await r.text()).includes('案件'); });
ok('見本 CSV はサイトからダウンロードできる', dl);
await shot('r2-samples'); await page.click('.pop-close');

// 場面 3: 今回の内示 CSV を落とす → 3 件読み取り → 変わった点が開く
await page.setInputFiles('#dropInput', file('内示_今回_2026-09-25.csv'));
await page.waitForSelector('#pop h3'); await page.waitForTimeout(700);
const t3 = await page.locator('#pop').textContent();
ok('「3 件の案件を読み取りました」', /3 件の案件を読み取りました/.test(t3), t3);
await shot('r3-imported');
await page.waitForTimeout(1800);
ok('読み取り後は 変わった点 タブ', (await page.locator('.tab.on').textContent()).includes('変わった点'));
ok('左上に CSV 名が出る', (await page.locator('#csvName').textContent()).includes('内示_今回_2026-09-25.csv'));
await page.click('[data-folder="all"]'); await page.waitForTimeout(300);
ok('やること 18 のまま（同じ内示）', (await page.locator('[data-tab="todo"] b').textContent()) === '18');
await shot('r4-after-import');

// 場面 4: 修正版 CSV を落とす → 数字が変わる
await page.click('[data-folder="f02"]'); await page.waitForTimeout(300);
const before = await page.locator('#panel').textContent();
await page.setInputFiles('#dropInput', file('内示_今回_修正版.csv'));
await page.waitForSelector('#pop h3'); await page.waitForTimeout(2600);
await page.click('[data-folder="f02"]'); await page.waitForTimeout(300);
await page.click('[data-tab="changes"]'); await page.waitForTimeout(150);
const after = await page.locator('#panel').textContent();
ok('修正版で 組立セル が 2台 → 3台 に変わる', /2台 → 3台/.test(after) && !/2台 → 3台/.test(before));
ok('AS-06-148 のいる数が 0 → 6', /AS-06-148[\s\S]*?0 → 6/.test(after), after.slice(0, 200));
await shot('r5-edited-changes');
await page.click('[data-tab="todo"]'); await page.waitForTimeout(150);
await shot('r6-edited-todo');
// AI にも CSV が渡る
await page.click('#chatFab'); await page.click('#chips button >> nth=0'); await page.waitForSelector('.msg.assistant:not(.intro)');
ok('チャットに CSV の中身が付く', typeof chatCalls.at(-1)?.csv === 'string' && chatCalls.at(-1).csv.includes('修正版') === false && chatCalls.at(-1).csv.includes('3台目を追加'));
await page.click('#chatClose');

// 場面 5: 前回の CSV → 変わった点なし
await page.setInputFiles('#dropInput', file('内示_前回_2026-08-28.csv'));
await page.waitForSelector('#pop h3'); await page.waitForTimeout(2600);
await page.click('[data-tab="changes"]'); await page.waitForTimeout(150);
ok('前回の CSV では 変わった点なし', (await page.locator('#panel').textContent()).includes('変わった点はありません'));
await shot('r7-prev');

// 場面 6: 読めないファイル
await page.setInputFiles('#dropInput', { name: 'memo.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') });
await page.waitForTimeout(2200);
ok('読めない CSV は理由を出して既定に戻る', (await page.locator('#pop').textContent()).includes('読めませんでした') && await page.locator('#csvName').isHidden());
await page.click('.pop-close');

// 場面 7: × で外すと元に戻る
await page.setInputFiles('#dropInput', file('内示_今回_修正版.csv'));
await page.waitForSelector('#pop h3'); await page.waitForTimeout(3600);
await page.click('#csvClear'); await page.waitForTimeout(400);
ok('× で CSV を外すと既定に戻る', await page.locator('#csvName').isHidden());

ok('エラーなし', errors.length === 0, errors.join(' / '));
console.log(results.filter((r) => r[0] === 'NG').map((r) => r.join(' ')).join('\n'));
console.log(`OK ${results.filter((r) => r[0] === 'OK').length} / NG ${results.filter((r) => r[0] === 'NG').length}`);
await browser.close();
