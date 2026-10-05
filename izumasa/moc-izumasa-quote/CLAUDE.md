# 営業モック `moc-izumasa-quote`

thomas 株式会社の営業が商談で見せるためのモック。案件情報は `MOC.md`。作り方・公開の手順は `sales-moc` スキル。

## 守ること
- **データは架空のみ。** 顧客から受け取った本物のデータ・個人名・金額・単価表を入れない。架空データは `src/data.js` だけに置き、画面と AI は必ずそこから読む。商品の区分（CV／CVT／IV／EM-IE／CVV／VVF／弱電線）だけは公開情報と商談の内容に合わせてよい。
- **認証を外さない。** `src/auth.js` の fail closed、`wrangler.jsonc` の `run_worker_first: true` は消さない・弱めない。パスワードや API キーをファイルに書かない。
- **公開・削除・共有先の追加は、毎回ユーザーに確認してから。**
- 画面は thomas オレンジ（`#EB6311`）と紺（`#0B2A59`）が基本。文章はですます調。
- 変更したら `npm test` を通してから公開する（`npm run deploy` は自動でテストを先に走らせる）。

## 構成
| パス | 内容 |
|---|---|
| `src/index.js` | 入口。認証 → `/api/me`、`GET /api/data?folder&site`、`POST /api/data`（画面の手直し edits を受けて計算し直す）、`/api/chat` → 画面ファイル |
| `src/auth.js` | Cloudflare Access のログイン確認（`ctx.access`、無ければ Access の署名付きトークンを検証） |
| `src/chat.js` | AI チャット（Anthropic API。キーは会社共通の Secrets Store）。system で「単価は計算しない」「表にない品目を出さない」を指示 |
| `src/data.js` | 架空データと計算（唯一の置き場）。`build({site, edits})` が計算し、`getDemoData({folder, site, edits})` = 画面、`getAiData({folder, site, edits})` = AI。**両方が同じ build() の結果を使う**（AI の答えと表を食い違わせない）。画面から来る edits は `normalizeEdits` で必ず正規化する |
| `src/db.js` | 保存 API `/api/records`（保存ありのモックのみ有効。SQL は必ず `moc = ?` で絞る） |
| `src/http.js` | 書き込み系 API の共通チェック（別サイト・JSON 以外を拒否） |
| `public/app.js` | 画面の組み立て（受信箱／5 タブ／根拠ツールチップ／見積書／回答メール）。計算はしない。手直しは `state.edits` に持ち、毎回 `POST /api/data` で計算し直す |
| `public/chat.js` `public/util.js` | チャット部品（選択中の依頼・拠点・edits を毎回送る）・共通の小道具 |
| `public/` その他 | HTML/CSS。外部ライブラリなし（足す場合は cdn.jsdelivr.net / cdnjs.cloudflare.com の固定バージョンのみ）。フォントは Google Fonts |
| `test/` | `npm test` で実行。`spec` = AI と表の一致・手直しの反映・不正入力、`insights` = 仕込んだ気づき、`render` = 全依頼×全タブ×拠点の描画と操作 |
| `scripts/verify-deploy.mjs` | 公開後、未ログインで画面と API を開き、Access に飛ばされるかを確認 |
| `scripts/e2e-browser.mjs` | ブラウザ操作テスト（Playwright。`npm run dev` を起動して実行。AI は疑似応答） |

## 直すときの目安
- 依頼や明細を足す・変える: `src/data.js` の `REQUESTS`（行の `alert` が要確認、`merge` が合算）、`ITEMS`（建値・前版・在庫品か・細物か）、`RATES`（掛率）。直したら `test/insights.test.mjs` の期待値も見直す
- 画面の文言・列: `public/app.js`。計算や数字の加工は入れない（必要なら `data.js` 側で用意して渡す）
