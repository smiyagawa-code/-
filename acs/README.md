# ACS株式会社様

FA 機器専門商社。課題は **①内示（フォーキャスト）と在庫の突き合わせの手作業** と **②フォーキャスト読み取りの属人化**。

## 案件・成果物

| フォルダ | 内容 | Worker 名 / URL | 状態 |
|---|---|---|---|
| [`moc-acs-inventory/`](moc-acs-inventory/README.md) | 在庫・内示モック（商談で見せる本命）。「やること」型・3 タブ（やること／内示の変わった点／部品の一覧）＋ なぜ？＋ 文面 ＋ AI | `moc-acs-inventory` / https://moc-acs-inventory.thomas-gr.workers.dev/ | 10/5 夜に全面改修（やること型・文字最小）。テスト 44件＋ブラウザ操作 40件 通過。**手元 PC から `npm run deploy`** で公開 → README の合格条件で AI を再確認 |
| [`moc-acs-lepont-dashboard/`](moc-acs-lepont-dashboard/MOC.md) | 在庫・内示 AI ダッシュボード（sales-moc ひな形の「気づきカード＋グラフ」型）。初期の試作 | `moc-acs-lepont-dashboard` / 未公開 | ソースあり。本命が `moc-acs-inventory` に移ったため、商談後に片付け（削除）候補 |

## 進め方（10/5 時点）

1. 手元 PC で `git pull` → `acs/moc-acs-inventory/README.md`「公開のしかた」のとおり公開（`npm run deploy`）
2. 公開後、ログインして AI の答えを表と照合（README の合格条件）
3. 商談後、`moc-acs-lepont-dashboard` を片付けるか判断
