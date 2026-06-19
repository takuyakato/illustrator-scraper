# 運用メモ: illustrator-scraper

**作成日**: 2026-05-09  
**目的**: しばらく触らない前提で、今の自動実行と確認ポイントを短く残す

## 1. いま自動で回っているもの

- `sync-all`  
  - 10分おき
  - 実行順: Supabase → Notion → Supabase → Sheets → Supabase
- `notify-failures`
  - 1時間おき
  - `sync_failures` の未解決分を Notion の失敗ログページへ追記
- `scraper batch`
  - 週1
  - `S/A` の未実行 seed を優先して 5件ずつ実行
  - 失敗 seed は `last_scraped_followings_at` を付けないので次回以降に再挑戦される

## 2. 役割分担

- **Notion**
  - オーナー・連絡担当の作業場所
  - Notion主導の項目は Notion を正とする
- **Google Sheets**
  - スカウト判定の作業場所
  - C列は `https://x.com/<username>` の URL
  - J列: `イラストレーターじゃない`
  - K列: 仮ランク `S/A/B/C`
- **Supabase**
  - 真のデータストア
  - 変更のハブ
- **スクレイパー**
  - X フォローグラフから候補を追加

## 3. 変更の流れ

- **Notion の変更**
  - `sync-all` で Supabase に反映
  - 同じサイクル内で Sheets にも流れる
- **Sheets の変更**
  - `sync-all` で Supabase に反映
  - Notion へは次回の `sync-all` で反映
- **スクレイパーの結果**
  - Supabase に入る
  - その後 `sync-all` で Sheets に流れる

## 4. 失敗検知

- 個別失敗は `sync_failures` に残る
- `notify-failures` が 1時間おきに Notion の失敗ログページへ追記する
- スクレイパーは seed 1件でも `failed / timeout / partial` が出るとジョブ全体を失敗扱いにする
- `sync_failures` は「何が・どの向きで・何回失敗したか」を確認する台帳

## 5. 運用ルール

- 取得済み候補は消さない
- S/A が増えたら新しい seed として自動で拾う
- 失敗した seed は success 扱いにせず、再実行対象に残す
- Notion の失敗ログページは中身を消してよいが、ページ自体は消さない

## 6. もし止まったら最初に見るもの

1. GitHub Actions の失敗ジョブ
2. `sync_failures` の未解決レコード
3. Notion の失敗ログページ
4. `tmp/scraper-run-all.json` / `tmp/scraper-followings.json`

