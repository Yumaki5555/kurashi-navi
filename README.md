# 困りごと、次どうする？（試作版）

困ったときも、行き詰まったときも。次にできることがわかる行動ガイド。
暮らしの困りごとを「はい・いいえ・わからない」で整理し、次にすること（どこへ・何を確認し・何を用意し・どう聞くか）まで案内する静的サイトです。
一度行動してうまくいかなかったとき（回答がない・断られた・不開示・不採択など）は「次の一手を探す」で、理由の見立てと次の手段を案内します。

- 分野（5つ）：民泊・宿泊施設／建物・土地・施設／学校・子どもの教育／役所の対応／税金・予算の使い道
- 手段（問い合わせ・情報公開請求・請願など）は分野にせず、「自分で行動する」（`#/act`、`data/actions.json`）と各案内の中で使う

- 組み立て作業（ビルド）は不要。GitHub Pages にそのまま置けば動きます
- 入力内容はブラウザの中（localStorage、名前の頭に `kurashi-navi:`）だけに保存し、外部へは送りません
- 外部のフォント・解析・CDN は使っていません

## ファイル
| 場所 | 中身 |
|---|---|
| `index.html` `css/` | 画面の土台と見た目 |
| `js/engine.js` | 診断エンジン（分野に依存しない。画面に触れない） |
| `js/app.js` | 画面（# 以降のURLで切り替え） |
| `js/store.js` / `records.js` / `docs.js` | 端末内保存 / 対応記録と段階 / 文書の下書き |
| `js/rounds.js` | 「次の一手」：記録・前の診断の答えの引き継ぎ、同じ提案をしないための判定（画面に触れない） |
| `data/gyosei/` | 「役所の対応」分野。入口 `next` から始めると、どの分野からでも使う「次の一手」の診断になる |
| `data/actions.json` | 「自分で行動する」の手段一覧 |
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
node tools/check.mjs <分野>     # 全経路の検査（行き止まり・ループ・問数・空の結果・断定表現・聞き直し・文書ひな形）
node tools/scenarios.mjs        # 利用者を想定したテスト（ケースA〜K）。詳細は tools/scenarios-report.txt
node tools/acceptance.mjs       # 受け入れテスト（保存・複数タブ・復元・再開など。実際のブラウザの保存領域は使わない）
node tools/preopen-cases.mjs    # 民泊の開業前（近所に民泊ができるらしい）の利用場面テスト。詳細は tools/preopen-report.txt
node tools/screens.mjs <保存先> <幅>  # スマホ幅の画面写真（テスト用サーバー 8791 を起動してから。使い捨ての保存領域で撮る）
python tools/make-icons.py      # サイトのアイコン（icons/favicon.svg が原本）から 16・32・180・192・512px の PNG を書き出す
node tools/verify-laws.mjs      # e-Gov の条文と、事実データの言い回しの照合
node tools/import-regions.mjs   # 自治体一覧と施設一覧の出典を取り込み直す（元サイトは読み取りのみ）
```
結果の詳細は `tools/report.txt` に出ます。

## 手元で見るには
```
python -m http.server 8765
```
を実行し、ブラウザで http://localhost:8765/ を開きます。
