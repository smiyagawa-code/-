# 営業モック `moc-acs-inventory`

thomas 株式会社の営業が商談で見せるためのモック。案件情報は `MOC.md`。作り方・公開の手順は `sales-moc` スキル。

## 守ること
- **データは架空のみ。** 顧客から受け取った本物のデータ・個人名・金額を入れない。架空データは `src/data.js` だけに置き、画面と AI は必ずそこから読む。
- **認証を外さない。** `src/auth.js` の fail closed、`wrangler.jsonc` の `run_worker_first: true` は消さない・弱めない。パスワードや API キーをファイルに書かない。
- **公開・削除・共有先の追加は、毎回ユーザーに確認してから。**
- 画面は thomas オレンジ（`#EB6311`）と紺（`#0B2A59`）が基本。文章はですます調。
- 変更したら `npm test` を通してから公開する（`npm run deploy` は自動でテストを先に走らせる）。

## 構成
| パス | 内容 |
|---|---|
| `src/index.js` | 入口。認証 → `/api/me` `/api/data`（GET、または CSV つき POST） `/api/chat` → 画面ファイル |
| `src/auth.js` | Cloudflare Access のログイン確認（`ctx.access`、無ければ Access の署名付きトークンを検証） |
| `src/chat.js` | AI チャット（Anthropic API。キーは会社共通の Secrets Store） |
| `src/data.js` | 架空データと計算（唯一の置き場）。`parseNaishiCsv()` が内示 CSV を読み、`build(base, csvRows)` が計算し、`getDemoData({base, folder, csv})` = 画面、`getAiData({base, folder, csv})` = AI。**両方が同じ build() の結果を使う**（AI の答えと表を食い違わせない） |
| `src/db.js` | 保存 API `/api/records`（保存ありのモックのみ有効。SQL は必ず `moc = ?` で絞る） |
| `src/http.js` | 書き込み系 API の共通チェック（別サイト・JSON 以外を拒否） |
| `public/app.js` | 画面の組み立て（内示を置く／案件／3 タブ／なぜ？／文面／計算のしかた）。計算はしない。**画面の文字は最小限、用語は現場の言葉**（test/spec が専門用語を検査） |
| `public/chat.js` `public/util.js` | AI（右下から開く。選択中の案件・基準日を毎回送る）・共通の小道具 |
| `public/` その他 | HTML/CSS。外部ライブラリなし（足す場合は cdn.jsdelivr.net / cdnjs.cloudflare.com の固定バージョンのみ）。フォントは Google Fonts |
| `test/` | `npm test` で実行。`spec` = AI と表の一致、`insights` = 仕込んだ気づき、`render` = 全フォルダ×全タブの描画 |
| `scripts/verify-deploy.mjs` | 公開後、未ログインで画面と API を開き、Access に飛ばされるかを確認 |
| `scripts/e2e-browser.mjs` | ブラウザ操作テスト（Playwright。`npm run dev` を起動して実行。AI は疑似応答） |
| `scripts/rehearsal.mjs` | デモのリハーサル（見本 CSV を本当に落として表が変わるか） |
| `public/sample/` | 見本の内示 CSV 3 本（架空） |
