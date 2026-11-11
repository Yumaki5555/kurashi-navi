# 暮らしの問題解決ナビ（試作版）

暮らしの困りごとを「はい・いいえ・わからない」で整理し、次にすること（どこへ・何を確認し・何を用意し・どう聞くか・答えがなければどうするか）まで案内する静的サイトです。公開中の分野は「民泊・旅館業」と「建築・土地利用・宗教施設」。

- 組み立て作業（ビルド）は不要。GitHub Pages にそのまま置けば動きます
- 入力内容はブラウザの中（localStorage、名前の頭に `kurashi-navi:`）だけに保存し、外部へは送りません
- 外部のフォント・解析・CDN は使っていません

## ファイル
| 場所 | 中身 |
|---|---|
| `index.html` `css/` | 画面の土台と見た目 |
| `js/engine.js` | 診断エンジン（分野に依存しない。画面に触れない） |
| `js/app.js` | 画面（# 以降のURLで切り替え） |
| `js/store.js` / `records.js` / `docs.js` | 端末内保存 / 対応記録と次の一手 / 文書の下書き |
| `data/<分野>/tree.json` | 質問と分岐 |
| `data/<分野>/cards.json` | 結果に出す案内（表示条件つき） |
| `data/<分野>/checklists.json` `docs.json` `ladder.json` `glossary.json` | チェック項目・文書ひな形・段階・用語 |
| `data/<分野>/facts.json` `cases.json`、`data/sources.json` | 根拠の事実・事例・一次資料（確認日つき） |
| `data/regions/` | 自治体一覧・公開されている施設一覧の出典・重点自治体の確認済み情報 |
| `tools/` | 検査と取り込みのプログラム（サイトには不要） |

## 分野を追加するには
1. `data/domains.json` の分野を `"status": "active"` にする
2. `data/<分野>/` に `tree.json` などを置く（形は民泊と同じ）
3. `node tools/check.mjs <分野>` で検査する

## 検査・更新
```
node tools/check.mjs            # 全経路の検査（行き止まり・ループ・問数・空の結果・断定表現・文書ひな形）
node tools/import-regions.mjs   # 自治体一覧と施設一覧の出典を取り込み直す（元サイトは読み取りのみ）
```
結果の詳細は `tools/report.txt` に出ます。

## 手元で見るには
```
python -m http.server 8765
```
を実行し、ブラウザで http://localhost:8765/ を開きます。
