# Phase 3-0 POC: スクレイピング手段 4 候補の並行検証

Phase 3 本実装前に 3 日で 4 手段を検証し勝者を確定する。Playwright を本命（bisque-sales-analytics で実績）とし、rettiwt-api を保険、xAI を好奇心、X API pay-per-use を fallback として比較する。

## 判定基準（定量化）

| 項目 | 合格 | 要検討 | 不合格 |
|---|---|---|---|
| シード1件 200件取得所要時間 | 20分以内 | 20〜60分 | 60分超 |
| データ品質（必須カラム取得率） | 100% | 80%以上 | 80%未満 |
| 1時間連続実行時のエラー率 | 0〜2件 | 3〜10件 | 10件超 |
| セッション・トークン安定性 | 途中切れなし | 1回切れ | 2回以上切れ |
| 実装完走見込み | 3日以内 | 3〜7日 | 7日超 |
| 初回フルスキャン予想コスト | $50以下 | $50〜$200 | $200超 |

**必須カラム**: `x_username` / `display_name` / `bio_preview`（または full bio）/ `website`（profile URL）/ `follower_count`

## 4 手段の概要

| # | 手段 | ユーザー事前準備 | 想定コスト |
|---|---|---|---|
| 1 | **Playwright + GraphQL 傍受** | 初回 headed login を 1 回実施（手動） | $0（GHA 時間のみ） |
| 2 | **rettiwt-api v7.0.1** | Chrome/Firefox 拡張で API key 取得 | $0 |
| 3 | **xAI API (Grok)** | `XAI_API_KEY` が `.env.local` にあるか確認 | 〜$5 |
| 4 | **X API pay-per-use** | Developer Portal 登録 + デポジット | 〜$50（検証分） |

## セットアップ

```bash
cd poc/
npm install
npx playwright install chromium
```

## 共通: テストシード取得

```bash
npm run seed
```

Supabase から rank=S のシード1件を `_shared/test-seed.json` に保存。全 POC で同一シードを使って公平比較する。

## 手段ごとの手順

### 1. Playwright + GraphQL 傍受

**事前準備**（ユーザー）:
1. `poc/.env.local` に X ログイン補助用の値を設定：
   ```env
   X_LOGIN_ID=
   X_LOGIN_PASSWORD=
   X_LOGIN_USERNAME=
   ```
2. 初回のみ Chrome ログイン状態を保存：
   ```bash
   npm run pw:login:creds
   ```
   → Chrome が開くので、2FA / CAPTCHA / 追加確認が出た場合だけ手動対応する。成功すると storageState が `playwright-graphql/storage-state.json` に保存される（gitignore 済み）

**POC 実行**:
```bash
npm run pw:fetch
```

→ シードのフォロー中ページにアクセス、GraphQL レスポンスを傍受して構造化 JSON を抽出。`playwright-graphql/output-followings.json` に保存。

### 2. rettiwt-api v7.0.1

**事前準備**（ユーザー）:
1. Chrome 拡張「X Auth Helper」または Firefox 拡張「Rettiwt Auth Helper」をインストール
   - Chrome: https://chromewebstore.google.com/ で "X Auth Helper" を検索
   - Firefox: https://addons.mozilla.org/ で "Rettiwt Auth Helper" を検索
2. X にログイン済みの状態で拡張アイコンをクリック → API key をコピー
3. `poc/.env.local` に `RETTIWT_API_KEY=<取得した key>` を追加

**POC 実行**:
```bash
npm run rw:fetch
```

### 3. xAI API (Grok)

**事前準備**（ユーザー）:
1. プロジェクトルートの `.env.local` に `XAI_API_KEY` があることを確認（CLAUDE.md で環境変数済みとある）
2. なければ https://console.x.ai/ で取得

**POC 実行**:
```bash
npm run xai:fetch
```

### 4. X API pay-per-use

**事前準備**（ユーザー）:
1. https://developer.x.com/ で Developer アカウント作成
2. Pay-per-use プランを有効化、Bearer Token を取得
3. 最小デポジット（金額要確認、$30〜$50 想定）を支払い
4. `poc/.env.local` に `X_API_BEARER_TOKEN=<取得したトークン>` を追加

**POC 実行**:
```bash
npm run xapi:fetch
```

**コスト警告**: 1 profile = $0.010。200件取得で約 $2。

## 結果記入

各手段の検証後、`BENCHMARK.md` に以下を記入：

- 所要時間（秒）
- 取得件数
- データ品質（欠損カラム数）
- 発生したエラー
- 認証セットアップの難易度（1〜5）
- サンプル出力（5件分 JSON）

## 結果判定

- **1が合格**: Playwright で本実装 → Phase 3-3 着手
- **1不合格・2合格**: rettiwt-api で本実装
- **1・2不合格・3合格**: xAI でさらに検証継続
- **1・2・3不合格**: X API pay-per-use に $300 上限ルール付きで突入
- **全滅**: 設計再考（xAI Grok-2 の live search の使い方を深掘り、or 待機）

判定結果は `../docs/architecture/poc-result.md` に記録する。
