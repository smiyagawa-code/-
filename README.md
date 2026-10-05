# 営業成果物リポジトリ（thomas株式会社）

商談で使う資料・モックを、**お客様ごと → 案件・成果物ごと** のフォルダで保管します。

## フォルダの決まり

```
<お客様の短い名前>/              例: acs, tak-evac
  README.md                      そのお客様の案件一覧と現在の状態
  moc-<短い名前>/                sales-moc で作ったモック（Worker 名と同じフォルダ名）
    MOC.md                       公開URL・担当・終了予定・共有先
    docs/                        レビュー結果・修正計画・商談メモ
  <資料名>/                      提案資料（sales-deck / pptx）
    outline.md                   骨子と根拠
    STATUS.md                    作業状態と確認記録
    src/                         生成スクリプト
    outputs/                     完成した pptx など
```

- **本物の顧客データ・個人情報・API キーは入れない。** モックの数字はすべて架空にする。
- モックのフォルダ名は Cloudflare の Worker 名（`moc-〇〇`）と必ず一致させる。公開中のモックは、ソースを必ずこのリポジトリに置く（手元の PC だけに残さない）。
- `node_modules/`、`.wrangler/`、`package-lock.json` はコミットしない（`.gitignore` 済み）。

## お客様一覧

| フォルダ | お客様 | 内容 | 状態 |
|---|---|---|---|
| [`acs/`](acs/README.md) | ACS株式会社様 | 在庫・内示（フォーキャスト）のモック 2 本（本命は `moc-acs-inventory`） | 改修版＋CSV 読み込み 完成・公開待ち。台本あり（商談 10/6） |
| [`tak-evac/`](tak-evac/STATUS.md) | TAKイーヴァック様 | 初回お打ち合わせ資料（pptx） | 資料完成・画像は未生成 |
