# Phase 3-0 POC 結果

**実施日**: 2026-05-08
**目的**: Phase 3 スクレイパー本実装前に、X の followings 取得手段を比較し、採用方式を決める。

## 結論

**Playwright + GraphQL 傍受方式を採用する。**

理由:

- ログイン済み Chrome セッションを使って X の followings GraphQL を取得できた
- 1シードから 200件を 20秒で取得でき、POC 合格ラインの20分以内を大幅に満たした
- 取得時エラーは 0件
- username / display_name / follower_count は 200件すべて取得できた
- API利用料が発生しない

## 検証結果

| 項目 | 結果 |
|---|---|
| 採用方式 | Playwright + GraphQL |
| シード | `@parayang_33`（ぱらやん） |
| 取得件数 | 200/200 |
| 所要時間 | 20秒 |
| GraphQL hits | 7 |
| エラー | 0 |
| コア項目取得率 | 100%（username / display_name / follower_count） |
| bio 空欄 | 11件 |
| website 未設定 | 66件 |
| 推定コスト | $0 |

`bio` と `website` の欠損は、取得失敗ではなくプロフィール上の未設定・空欄を含む。

## 実装上の発見

- X の現在の GraphQL レスポンスでは、`screen_name` / `name` は `legacy` ではなく `core` 配下にある。
- スクロール操作だけでは2ページ目以降の GraphQL が安定して発火しなかった。
- 初回 GraphQL リクエストの cursor と認証系ヘッダーを再利用し、ブラウザ内 `fetch` でページングすると 200件まで取得できた。
- 通常の Playwright ログイン画面ではログインが通りにくかったため、`poc/.env.local` の `X_LOGIN_ID` / `X_LOGIN_PASSWORD` を使って入力補助する方式を追加した。
- 2FA / CAPTCHA / 追加確認が出た場合はブラウザ上で手動対応する。

## 他方式の扱い

| 方式 | 判定 | 理由 |
|---|---|---|
| Playwright + GraphQL | 採用 | 200件取得成功、速度・品質・コストが条件を満たす |
| rettiwt-api | 保険 | API key 準備が必要。Playwright が不安定化した場合の fallback |
| xAI / Grok | 不採用 | follow graph 列挙用途に不向き。Chat Completions の live search も利用不可 |
| X API pay-per-use | 最終 fallback | 公式APIだが課金が必要。大量取得時のコスト制約がある |

## 次の実装方針

1. `poc/playwright-graphql/login-with-credentials.ts` を参考に、スクレイパー用ログイン状態管理を `src/scraper/` に移植する。
2. `poc/playwright-graphql/fetch-followings.ts` を参考に、1シードの followings 取得処理を本実装化する。
3. 取得結果を `illustrators` へ upsert する前に、重複判定・Pixivリンク抽出・非イラストレーター判定を挟む。
4. まずは「1シードから最大200件取得して JSON 出力」までを本実装の最初の単位にする。
