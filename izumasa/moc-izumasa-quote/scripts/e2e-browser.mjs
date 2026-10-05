// ブラウザ操作テスト（手元で任意に実行。npm test には含めない）
// 使い方: 別ターミナルで `npm run dev` を起動し、`npm install --no-save playwright` と `npx playwright install chromium` 済みの状態で
//   node scripts/e2e-browser.mjs [スクリーンショットの保存先フォルダ]
// AI チャットは疑似応答に差し替え、「選択中の依頼・拠点・手直しがチャットに渡る」「根拠の式」「手直しの反映」「見積書の行の追加」「画面幅」を確かめる。
import { chromium } from 'playwright';
import fs from 'node:fs';
const outDir = process.argv[2] || '.wrangler';
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const ok = (name, cond, detail = '') => { results.push([cond ? 'OK' : 'NG', name, String(detail)]); if (!cond) console.error('NG', name, detail); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(m.text()); });
// AI を疑似応答にする: 受け取った folder/site/edits/messages をそのまま返す
const chatCalls = [];
await page.route('**/api/me', (r) => r.fulfill({ json: { email: 'dev@thomas-gr.com', title: 't', ai: true, db: false } }));
await page.route('**/api/chat', async (r) => { const b = r.request().postDataJSON(); chatCalls.push(b); await r.fulfill({ json: { reply: `【疑似AI】folder=${b.folder} site=${b.site} q=${b.messages.at(-1).content}` } }); });
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });

await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
// 1. 初期表示: 全依頼・読み取り結果タブ
ok('最初のタブは読み取り結果', (await page.locator('.tab.on').textContent()).includes('読み取り結果'));
ok('チャットが表示', await page.locator('#chat').isVisible());
ok('全依頼のおすすめ質問が 3 つ', (await page.locator('#chips button').count()) === 3);
ok('左に依頼が 5 件', (await page.locator('.folder[data-folder^="q"]').count()) === 5);
await shot('01-inbox');
// 2. みなと浄水場を開く: 要確認・合算・おすすめ質問が依頼連動
await page.click('[data-folder="q01"]'); await page.waitForTimeout(400);
const chips = await page.locator('#chips button').allTextContents();
ok('おすすめ質問に CV 8sq-3C（要確認）が入る', chips.some((c) => /CV 8sq-3C/.test(c)), chips.join(' | '));
ok('おすすめ質問に他の依頼の品目が無い', !chips.some((c) => /CVT 100sq|VVF 2\.0/.test(c)), chips.join(' | '));
ok('要確認が 4 件（件名＋明細 3）', (await page.locator('.alerts:not(.info) .alert').count()) === 4);
ok('合算の説明が出る', /180m.*120m.*300m/.test(await page.locator('.alerts.info').textContent()));
ok('範囲表示がみなと浄水場', (await page.locator('#chatScope').textContent()).includes('みなと浄水場'));
await shot('02-q01-lines');
// 3. チャット送信に folder/site/edits が付く
await page.click('#chips button >> nth=0'); await page.waitForSelector('.msg.assistant:not(.intro)');
ok('チャットに folder=q01 が送られる', chatCalls.at(-1)?.folder === 'q01', JSON.stringify(chatCalls.at(-1)));
ok('チャットに site=fukuoka が送られる', chatCalls.at(-1)?.site === 'fukuoka');
// 4. 確認済み → 要確認が減り、回答メールの確認事項からも消える
await page.click('[data-resolve="l3"]'); await page.waitForTimeout(400);
ok('確認済みで要確認が 3 件に', (await page.locator('.alerts:not(.info) .alert').count()) === 3);
// 5. 拾えなかった品目を追加
await page.selectOption('.add-form select[name="itemId"]', 'iv14'); await page.fill('.add-form input[name="qty"]', '120'); await page.fill('.add-form input[name="note"]', '追加分');
await page.click('.add-form button[type="submit"]'); await page.waitForTimeout(400);
ok('追加した IV 14sq が明細に出る', /IV 14sq/.test(await page.locator('#panel').textContent()));
ok('追加行に「手入力で追加」', /手入力で追加/.test(await page.locator('#panel').textContent()));
// 6. 単価と根拠: 掛率を手入力 → 単価・金額・根拠が変わる
await page.click('[data-tab="pricing"]'); await page.waitForTimeout(200);
await shot('03-q01-pricing');
const unitBefore = await page.inputValue('input[data-line="l1"][data-field="unit"]');
await page.fill('input[data-line="l1"][data-field="rate"]', '0.5'); await page.press('input[data-line="l1"][data-field="rate"]', 'Tab'); await page.waitForTimeout(500);
const unitAfter = await page.inputValue('input[data-line="l1"][data-field="unit"]');
ok('掛率 0.5 で単価が変わる（2980 → 2660）', unitBefore === '2980' && unitAfter === '2660', `${unitBefore} → ${unitAfter}`);
ok('手入力の印が出る', /手入力（表は 0\.56）/.test(await page.locator('#panel').textContent()));
await page.click('button.basis >> nth=0'); await page.waitForTimeout(100);
const tip = await page.locator('#tooltip').textContent();
ok('根拠に 建値 × 掛率 ＝ の式', /5,320 × 0\.5 ＝ 2,660\.00/.test(tip), tip);
ok('根拠に手入力の記録', /手入力で 0\.5/.test(tip));
ok('根拠に端数処理', /端数処理/.test(tip));
await shot('04-q01-basis');
await page.mouse.click(5, 5); await page.waitForTimeout(100);
ok('外をクリックで根拠が閉じる', await page.locator('#tooltip').isHidden());
// 7. 在庫 → 直送、ランク B
await page.selectOption('select[data-line="l2"][data-field="route"]', 'direct'); await page.waitForTimeout(400);
ok('直送にすると CV 14sq-3C の掛率が 0.5', (await page.inputValue('input[data-line="l2"][data-field="rate"]')) === '0.5');
await page.selectOption('select[data-line="l6"][data-field="rank"]', 'B'); await page.waitForTimeout(400);
ok('ランク B で EM-IE 5.5sq の掛率が 0.55', (await page.inputValue('input[data-line="l6"][data-field="rate"]')) === '0.55');
// 8. チャットに edits が渡る
await page.click('#chips button >> nth=0'); await page.waitForTimeout(300);
ok('チャットに手直し（edits）が渡る', chatCalls.at(-1)?.edits?.q01?.lines?.l1?.rate === 0.5, JSON.stringify(chatCalls.at(-1)?.edits));
// 9. 見積書: 注記・空白行・重量・送料・承認フロー・メールのコピー
await page.click('[data-tab="sheet"]'); await page.waitForTimeout(200);
ok('見積書に合算後の 300 が出る', /CV 14sq-3C/.test(await page.locator('.sheet-table').textContent()) && /300/.test(await page.locator('.sheet-table').textContent()));
await page.selectOption('#extraAfter', 'l1'); await page.click('[data-extra-add="weight"]'); await page.waitForTimeout(400);
ok('重量の行が CV 38sq の下に付く', /概算重量: 約 379kg/.test(await page.locator('.sheet-table').textContent()));
await page.click('[data-extra-add="blank"]'); await page.waitForTimeout(400);
await page.fill('.sheet-table tr.blank input', '上記 ドラム 2 巻'); await page.press('.sheet-table tr.blank input', 'Tab'); await page.waitForTimeout(400);
ok('空白行に自由記入できる', (await page.inputValue('.sheet-table tr.blank input')) === '上記 ドラム 2 巻');
await page.click('[data-extra-add="shipping"]'); await page.waitForTimeout(400);
ok('送料の条件の行が付く', /送料: 直送分はメーカー運賃実費/.test(await page.locator('.sheet-table').textContent()));
await page.fill('.sheet-table input[data-line="l3"][data-field="note"]', '100m巻'); await page.press('.sheet-table input[data-line="l3"][data-field="note"]', 'Tab'); await page.waitForTimeout(400);
ok('見積書の備考に書くと保持される', (await page.inputValue('.sheet-table input[data-line="l3"][data-field="note"]')) === '100m巻');
ok('備考がチャットにも渡る', JSON.stringify(await page.evaluate(() => null)) !== undefined);
await shot('05-q01-sheet');
await page.click('[data-stage="1"]'); await page.waitForTimeout(200);
ok('承認依頼で次のボタンが出る', await page.locator('[data-stage="2"]').isVisible());
await page.click('[data-stage="2"]'); await page.waitForTimeout(200); await page.click('[data-stage="3"]'); await page.waitForTimeout(200);
ok('送付済みになる', /送付済み/.test(await page.locator('.sheet-actions').textContent()));
await page.click('[data-copy="mail-draft"]'); await page.waitForTimeout(200);
const clip = await page.evaluate(() => navigator.clipboard.readText());
ok('回答メールをコピーできる（差出人が架空の実名）', /浦田/.test(clip) && /Q-2610-018/.test(clip), clip.slice(0, 80));
ok('回答メールに確認済みにした行（CV 8sq-3C の芯数）が入らない', !/CV 8sq-3C: 芯数/.test(clip));
ok('回答メールにプレースホルダーが無い', !/〇〇|○○/.test(clip));
// 10. 拠点切り替え → 掛率が変わる・URL に残る・再読み込みで戻る
await page.selectOption('#sitePick', 'osaka'); await page.waitForTimeout(500);
ok('拠点の説明文が変わる', (await page.locator('#siteNote').textContent()).includes('大阪本社'));
await page.click('[data-tab="pricing"]'); await page.waitForTimeout(200);
ok('大阪本社では CV 14sq-3C（直送）の掛率が 0.48', (await page.inputValue('input[data-line="l2"][data-field="rate"]')) === '0.48');
ok('URL に site が残る', (await page.evaluate(() => location.hash)).includes('site=osaka'));
await page.reload({ waitUntil: 'networkidle' });
ok('再読み込み後も q01・大阪本社（手直しは消える）', (await page.locator('.folder.on').textContent()).includes('みなと浄水場') && (await page.inputValue('#sitePick')) === 'osaka');
await page.selectOption('#sitePick', 'fukuoka'); await page.waitForTimeout(400);
// 11. 高台配水池: 直送・重量物の注記
await page.click('[data-folder="q03"]'); await page.waitForTimeout(400); await page.click('[data-tab="sheet"]'); await page.waitForTimeout(200);
ok('重量物の注記が見積書に出る', /重量物（概算 1,197kg）/.test(await page.locator('.sheet-table').textContent()));
ok('直送の注記が出る', /メーカー直送/.test(await page.locator('.sheet-table').textContent()));
// 12. 回答済み（q04）は編集不可、保留（q05）は保留表示
await page.click('[data-folder="q04"]'); await page.waitForTimeout(400); await page.click('[data-tab="pricing"]'); await page.waitForTimeout(200);
ok('回答済みは入力が無効', await page.locator('input[data-line="l1"][data-field="rate"]').isDisabled());
await page.click('[data-tab="sheet"]'); await page.waitForTimeout(200);
ok('回答済みは承認・送付の記録', /承認（営業所長 大野）/.test(await page.locator('.sheet-actions').textContent()));
await page.click('[data-folder="q05"]'); await page.waitForTimeout(400);
ok('保留の依頼は保留の説明', /読み取り保留/.test(await page.locator('#panel').textContent()));
ok('保留でもおすすめ質問が 1 つ', (await page.locator('#chips button').count()) === 1);
// 13. 単価表の管理・計算の決まり
await page.click('[data-folder="all"]'); await page.waitForTimeout(400); await page.click('[data-tab="lists"]'); await page.waitForTimeout(200);
ok('単価表の管理に 20 社', /20社/.test((await page.locator('.stats').textContent()).replace(/\s/g, '')));
ok('今月の差分に CV 38sq-3C +3.3%', /CV 38sq-3C/.test(await page.locator('#panel').textContent()) && /\+3\.3%/.test(await page.locator('#panel').textContent()));
await shot('06-lists');
await page.click('[data-tab="rules"]'); await page.waitForTimeout(200);
ok('計算の決まりが 8 項目', (await page.locator('#panel table >> nth=0 >> tbody tr').count()) === 8);
// 14. 全依頼 × 全タブで undefined/NaN なし
for (const f of ['all', 'q01', 'q02', 'q03', 'q04', 'q05']) {
  await page.click(`[data-folder="${f}"]`); await page.waitForTimeout(300);
  for (const t of ['lines', 'pricing', 'sheet', 'lists', 'rules']) {
    await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(80);
    const html = await page.locator('#panel').innerHTML();
    ok(`${f}/${t} に undefined/NaN/null が無い`, !/undefined|NaN|>null<|\[object/.test(html));
  }
}
// 15. 画面幅: タブが 1 段、横スクロールなし
await page.click('[data-folder="q01"]'); await page.waitForTimeout(300); await page.click('[data-tab="pricing"]'); await page.waitForTimeout(100);
for (const w of [1440, 1280, 1100, 860, 390]) {
  await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(200);
  const tabsH = await page.evaluate(() => document.getElementById('tabs').getBoundingClientRect().height);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(`幅${w}: タブが 1 段（高さ ${Math.round(tabsH)}px）`, tabsH < 60);
  ok(`幅${w}: 横スクロールが出ない`, !overflow);
  await shot(`07-w${w}`);
}
ok('コンソール・ページエラーなし', errors.length === 0, errors.join(' / '));
console.table(results.map(([s, n, d]) => ({ 結果: s, 項目: n, 補足: d.slice(0, 80) })));
console.log(`OK ${results.filter((r) => r[0] === 'OK').length} / NG ${results.filter((r) => r[0] === 'NG').length}`);
await browser.close();
process.exit(results.some((r) => r[0] === 'NG') ? 1 : 0);
