# moc-acs-inventory（ACS株式会社様 在庫・内示モック）

| 項目 | 内容 |
|---|---|
| Worker 名 | `moc-acs-inventory` |
| 公開 URL | https://moc-acs-inventory.thomas-gra.workers.dev/ |
| 担当 | 宮川 |
| 商談日 | 2026-10-06 |
| 共有先 | 社内のみ（Cloudflare Access） |
| 状態 | **公開中。ソースはこのリポジトリに未取り込み** |

## このフォルダの中身

```
moc-acs-inventory/
  README.md                      このファイル
  docs/
    review_2026-10-05.md         Chrome で一通り触ったレビューと、優先度付きの修正計画
  （ソース一式）                  ← 手元 PC（sales-moc 既定の ~/Documents/Claude/モック/moc-acs-inventory）から
                                    src/ public/ test/ wrangler.jsonc package.json MOC.md をここに置く
```

## ソースを置くときの注意

- `node_modules/` と `.wrangler/` は入れない（ルートの `.gitignore` で除外済み）。
- `wrangler.jsonc` の `run_worker_first: true`、`src/auth.js`、`src/index.js` の「最初に認証」はそのまま。
- 置いたら `npm install` → `npm test` が通ることを確認してからコミットする。

## 画面の構成（10/5 のレビューで確認した内容）

- フォルダ 6 件（中身があるのは株式会社大和精密製作所の 3 案件：第2工場 外観検査ライン増設／組立セル導入／クリーン仕様 ほか）
- タブ 5 つ：手配を急ぐ部品／納期の遅れ／内示の変更点／フォルダ／AI の読み取り
- 「根拠を見る」ツールチップ、「計算の決まり」（ルール表 v1。AI は計算しない）
- 内示の変更点カード → 影響部品 → オプション逆引き → 次のアクションの文面下書き
- 右上「AI に聞く」チャット（読み取り・注意書き・文面下書き・表への質問に限定。数字は作らない）
- 基準日 9/25 固定
