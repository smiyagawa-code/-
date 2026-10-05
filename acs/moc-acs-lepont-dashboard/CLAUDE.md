# 営業モック `moc-acs-lepont-dashboard`

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
| `src/index.js` | 入口。認証 → `/api/me` `/api/data` `/api/chat` → 画面ファイル |
| `src/auth.js` | Cloudflare Access のログイン確認（`ctx.access`、無ければ Access の署名付きトークンを検証） |
| `src/chat.js` | AI チャット（Anthropic API。キーは会社共通の Secrets Store） |
| `src/data.js` | 架空データ（唯一の置き場）。`getAiData()` = AI に渡す元データ、`getDemoData()` = 画面の宣言 |
| `src/db.js` | 保存 API `/api/records`（保存ありのモックのみ有効。SQL は必ず `moc = ?` で絞る） |
| `src/http.js` | 書き込み系 API の共通チェック（別サイト・JSON 以外を拒否） |
| `public/app.js` | 画面の組み立て（data.js の宣言から自動）。ふつうは触らない |
| `public/charts.js` `public/chat.js` | グラフ部品・チャット部品（使い回し用） |
| `public/` その他 | HTML/CSS。外部ライブラリなし（足す場合は cdn.jsdelivr.net / cdnjs.cloudflare.com の固定バージョンのみ）。フォントは Google Fonts |
| `test/` | `npm test` で実行 |
| `scripts/verify-deploy.mjs` | 公開後、未ログインで画面と API を開き、Access に飛ばされるかを確認 |
