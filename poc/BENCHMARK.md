# POC ベンチマーク記録

各手段を実行した結果を記入する。判定結果は `docs/architecture/poc-result.md` に最終化する。

## 判定基準（合格ライン）

| 項目 | 合格 | 要検討 | 不合格 |
|---|---|---|---|
| シード1件 200件取得所要時間 | 20分以内 | 20〜60分 | 60分超 |
| データ品質（必須カラム取得率） | 100% | 80%以上 | 80%未満 |
| 1時間連続実行時のエラー率 | 0〜2件 | 3〜10件 | 10件超 |
| セッション・トークン安定性 | 途中切れなし | 1回切れ | 2回以上切れ |
| 実装完走見込み | 3日以内 | 3〜7日 | 7日超 |
| 初回フルスキャン予想コスト | $50以下 | $50〜$200 | $200超 |

## テスト条件

- シード: `@parayang_33`（ぱらやん、`_shared/test-seed.json` より）
- 実行日時: `2026-05-08 JST`
- 実行環境: ローカル Mac / Node.js v25.2.1

## 1. Playwright + GraphQL 傍受

| 項目 | 結果 |
|---|---|
| 取得件数 | 200/200 |
| 所要時間 | 20秒 |
| GraphQL hits | 7 |
| 必須カラム取得率 | コア項目 100%（username/display_name/follower_count）。bio 空欄 11件、外部 website 未設定 66件 |
| エラー | 0 |
| セッション状態 | 安定 |
| 認証セットアップ難易度（1〜5） | 3（通常ログインは失敗、ID/PASS 自動入力 + 手動追加認証で成功） |
| 実装工数見込み | 3日以内 |
| 予想フルスキャンコスト | $0 |

**サンプル出力**（5件）:
```json
[
  {
    "username": "muryou_tada",
    "display_name": "むりょ▶新刊通販中",
    "website": "https://www.pixiv.net/users/1642433",
    "follower_count": 290636
  },
  {
    "username": "ddal_kr",
    "display_name": "DDal",
    "website": "http://www.pixiv.net/users/267137",
    "follower_count": 222326
  },
  {
    "username": "shotgunman1207",
    "display_name": "ShotGunMan｜ODIA",
    "website": "http://pixiv.net/users/46392336",
    "follower_count": 103022
  },
  {
    "username": "xkirara39x",
    "display_name": "きらら三九",
    "website": null,
    "follower_count": 176399
  },
  {
    "username": "PoNya_0",
    "display_name": "PoNya",
    "website": "http://pixiv.net/users/17494557",
    "follower_count": 150267
  }
]
```

**備考**: X の GraphQL レスポンス構造変更により `screen_name` / `name` は `legacy` ではなく `core` 配下から抽出する必要があった。スクロール発火だけでは2ページ目以降に進まなかったため、初回 GraphQL リクエストの cursor とヘッダーを再利用してブラウザ内 `fetch` でページングする方式に変更。

---

## 2. rettiwt-api v7.0.1

| 項目 | 結果 |
|---|---|
| 取得件数 | ?/200 |
| 所要時間 | ?秒 |
| 必須カラム取得率 | ?% |
| エラー | ? |
| 認証セットアップ難易度（1〜5） | ? |
| 実装工数見込み | ?日 |
| 予想フルスキャンコスト | $? |

**備考**:

---

## 3. xAI API (Grok)  ❌ 不適

**判定日**: 2026-04-24
**結論**: follow graph 取得用途には**不適**。POC から除外。

**3 パターン試行結果**:

| 試行 | リクエスト形式 | 結果 |
|---|---|---|
| 1 | `search_parameters: { mode: 'on', sources: [{type:'x'}] }` + `model: grok-2-latest` | `HTTP 410: Live search is deprecated. Please switch to the Agent Tools API` |
| 2 | `tools: [{type: 'x_search'}]` + `model: grok-4-latest` | `HTTP 422: unknown variant 'x_search', expected 'function' or 'live_search'` |
| 3 | `tools: [{type: 'live_search', sources: [{type:'x'}]}]` | `HTTP 410: Live search is deprecated` |

**不適と判断した理由**:
1. xAI の Chat Completions API (`/v1/chat/completions`) では live_search / x_search どちらも拒絶される
2. Agent Tools API（docs.x.ai/docs/guides/tools/overview）は `xai_sdk` Python SDK 前提の別呼び出しで、HTTP 直叩きの明文仕様が未整備
3. そもそも Grok の x_search は「投稿・ユーザーの**検索**」用途であり、特定アカウントの follow 関係を**列挙**する設計ではない（LLM 幻覚リスク大）
4. 仮に取れてもページング不可・件数制御困難

**Agent Tools API を SDK 経由で使う道は残るが**、本プロジェクトは Node.js なので Python SDK を使うと保守が分断される。**ROI なしと判断し打ち切り**。

---

## 4. X API pay-per-use

| 項目 | 結果 |
|---|---|
| 取得件数 | ?/200 |
| 所要時間 | ?秒 |
| 実測コスト | $? |
| エラー | ? |
| Developer 登録難易度（1〜5） | ? |
| 最小デポジット額 | $? |
| 予想フルスキャンコスト | $? |

**備考**:

---

## 総合判定

- **勝者**: Playwright + GraphQL 傍受
- **理由**: 200件を20秒で取得、エラー0、コア項目取得率100%、推定コスト$0
- **本実装で採用する手段**: Playwright + GraphQL cursor ページング
- **fallback として残す手段**: rettiwt-api、X API pay-per-use
- **削除する手段**: xAI / Grok は follow graph 列挙用途から除外
