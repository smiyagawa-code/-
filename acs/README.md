# ACS株式会社様

FA 機器専門商社。課題は **①内示（フォーキャスト）と在庫の突き合わせの手作業** と **②フォーキャスト読み取りの属人化**。

## 案件・成果物

| フォルダ | 内容 | Worker 名 / URL | 状態 |
|---|---|---|---|
| [`moc-acs-inventory/`](moc-acs-inventory/README.md) | 在庫・内示モック（商談で見せる本命）。5 タブ構成（手配を急ぐ部品／納期の遅れ／内示の変更点／フォルダ／AI の読み取り）＋ AI チャット | `moc-acs-inventory` / https://moc-acs-inventory.thomas-gra.workers.dev/ | **公開中。ソース未取り込み**（手元 PC から push 待ち）。10/5 レビューと修正計画は `docs/` |
| [`moc-acs-lepont-dashboard/`](moc-acs-lepont-dashboard/MOC.md) | 在庫・内示 AI ダッシュボード（sales-moc ひな形の「気づきカード＋グラフ」型）。初期の試作 | `moc-acs-lepont-dashboard` / 未公開 | ソースあり。本命が `moc-acs-inventory` に移ったため、商談後に片付け（削除）候補 |

## 進め方（10/5 時点）

1. `moc-acs-inventory` のソースをこのフォルダに置く
2. [`moc-acs-inventory/docs/review_2026-10-05.md`](moc-acs-inventory/docs/review_2026-10-05.md) の **A（デモの信頼性に直結）** を直す → `npm test` → 公開し直し → AI の答えを表と照合
3. デモ導線（C）を決めてから B に着手
