# 引き継ぎ：illustrator-scraper 同期トリガー修正

**作成日**: 2026-05-06
**作成者**: 加藤（Claude Code との対話で原因特定・migration 作成まで完了）
**引き継ぎ先**: Codex
**緊急度**: 高（Notion ↔ Supabase 同期が 2 週間以上停止中）

---

## 1. 何が起きているか（一行サマリ）

illustrators テーブルへの **すべての UPDATE が PL/pgSQL トリガー関数のエラーで失敗** しており、`notion→supabase` 同期、`supabase→notion` 同期、`auto_transition_to_no_reply()` cron、scraper の `last_seen_at` 更新がすべて 2026-04-23 21:58 から止まっている。

エラーメッセージ：
```
record "new" has no field "legacy_status"
```

Notion 上の同期失敗ログページ：
https://www.notion.so/illustrator-scraper-34ac50637a7b8054bf0becb7b4a3f140

---

## 2. 真因（特定済み）

`supabase/migrations/20260423000018_drop_unused_legacy_columns.sql` で illustrators テーブルから以下 10 カラムを `DROP COLUMN` した：

```
legacy_status, legacy_status_1, legacy_mail_alt, legacy_recontact_time,
legacy_start_date, legacy_end_date, legacy_rejection_reason,
legacy_capuri_berryfeel_search, legacy_found_date, legacy_mimura_points
```

しかし、`supabase/migrations/20260423000012_fix_updated_at_trigger_for_sync.sql` で定義されている **「ループ防止トリガー関数」** `update_updated_at()` は、これら 10 カラムへの `NEW.* IS NOT DISTINCT FROM OLD.*` 比較を残したまま。

トリガーは `BEFORE UPDATE ON illustrators` に設定されているため、illustrators への UPDATE が走るたびに削除済みカラムを参照しようとして PL/pgSQL がエラーを吐き、UPDATE 全体が失敗する。INSERT には発火しないので新規スカウト検出（INSERT）は正常動作している。

トリガーの設計意図（Migration 12 のコメントより）：
> 同期ジョブが `last_synced_to_notion_at` だけ更新したときに `updated_at` まで動いてしまうと、次の同期サイクルで再び対象になる無限ループが発生する。それを防ぐため、sync メタデータ系以外のカラムに変更がない UPDATE では `updated_at` を据え置きにする。

---

## 3. 修正内容（migration ファイルは作成済み）

新規 migration ファイルを既に作成してある：

**ファイル**: `supabase/migrations/20260423000020_fix_updated_at_trigger_drop_legacy_refs.sql`

`CREATE OR REPLACE FUNCTION update_updated_at()` で関数を再定義し、Migration 12 の関数定義から削除済み 10 カラムへの参照行を物理削除しただけ。Migration 18 で残った 7 カラム（`legacy_contact_status`, `legacy_found_by`, `legacy_mimura_comment`, `legacy_hojo_comment`, `legacy_hojo_points`, `legacy_capuri_request_id`, `migration_snapshot`）への参照はそのまま維持している。

データ破壊なし、冪等、ロジックは Migration 12 と意味的に同じ。

---

## 4. 適用方法

このプロジェクトは Supabase CLI が link されておらず、`.env.local` に直接 DB URL もない。`supabase db push` / `psql` での適用は不可。

**Supabase Studio の SQL Editor から手動実行する**：

1. Supabase Studio を開く：https://supabase.com/dashboard/project/lwxdbzbwkmamqlbxuscy
2. 左メニュー「SQL Editor」を開く
3. `supabase/migrations/20260423000020_fix_updated_at_trigger_drop_legacy_refs.sql` の全内容をコピーして貼り付け
4. 右下「Run」を押す
5. `Success. No rows returned` が出れば完了（5 秒以内）

---

## 5. 適用後の確認

### 5.1 即時確認（適用直後）

SQL Editor で以下を実行し、関数定義に削除済みカラムが残っていないことを確認：

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'update_updated_at';
```

出力に `legacy_status`, `legacy_status_1`, `legacy_mail_alt`, `legacy_recontact_time`, `legacy_start_date`, `legacy_end_date`, `legacy_rejection_reason`, `legacy_capuri_berryfeel_search`, `legacy_found_date`, `legacy_mimura_points` のいずれも**含まれていない**こと。

### 5.2 同期復旧確認（10 分後）

直近 15 分の sync_failures が増えていないことを確認：

```sql
SELECT COUNT(*) AS recent_failures
FROM sync_failures
WHERE occurred_at > NOW() - INTERVAL '15 minutes';
```

→ 0 件であれば復旧成功。

### 5.3 Notion 側の確認

同期失敗ログページ（https://www.notion.so/illustrator-scraper-34ac50637a7b8054bf0becb7b4a3f140）を開いて、適用時刻以降に新しい `[YYYY-MM-DD HH:MM] 同期失敗通知（計 500 件）` エントリが追加されていないことを目視確認。

### 5.4 supabase→notion 方向の確認

ログには `notion→supabase` しか出ていないが、`supabase→notion` 同期も止まっていたはず。最新の cron 実行が成功したか確認：

```sql
SELECT executed_at, status, message
FROM scraping_logs
WHERE message ILIKE '%notion%'
   OR message ILIKE '%sync%'
ORDER BY executed_at DESC
LIMIT 20;
```

---

## 6. 想定される副作用と対応

### 6.1 auto_transition_to_no_reply() の一斉発火

`auto_transition_to_no_reply()` は GitHub Actions で 1 日 1 回呼ばれる。2 週間止まっていたので、修正後の最初の実行で「連絡中で 14 日以上経過」のレコードが**まとめて**「返信なし」に遷移する。

→ 実行前にどの程度の件数が遷移するか事前確認すると安心：

```sql
SELECT COUNT(*)
FROM illustrators
WHERE master_status = '連絡中'::master_status_enum
  AND contacted_at IS NOT NULL
  AND contacted_at <= (CURRENT_DATE - INTERVAL '14 days');
```

`migration 19` で閾値が 30 日 → 14 日に変更されているので注意。件数が常識的な範囲（数件〜数十件程度）であれば自動実行に任せて問題なし。万単位ならいったん手動でレビューしてから流す。

### 6.2 Notion で 2 週間ぶんに行われた編集が一気に反映

`notion→supabase` 同期が止まっていた間も、Notion 側ではメンバー（北條・三村・加藤）が編集していた可能性がある。修正後の最初の同期サイクルで一気に取り込まれるが、これは期待通りの挙動でデータ整合性は保たれる（Supabase 側は UPDATE できなかったので競合はない）。

### 6.3 sync_failures テーブルの肥大化

2 週間 × 1〜2 時間に 1 サイクル × 500 件で、**数万〜10 万件規模**の失敗レコードが残っている可能性。修正後の運用には支障ないが、容量が気になる場合は別途クリーンアップ：

```sql
-- 件数確認
SELECT COUNT(*) FROM sync_failures
WHERE error_message ILIKE '%legacy_status%';

-- 削除（影響範囲を確認してから実行）
DELETE FROM sync_failures
WHERE error_message ILIKE '%legacy_status%'
  AND occurred_at < '2026-05-06';
```

---

## 7. 検討して却下した代替案

### 7.1 jsonb 方式での根本対策（Option B）

`update_updated_at()` を `to_jsonb(NEW.*) - sync_keys = to_jsonb(OLD.*) - sync_keys` の動的比較に書き換える案。カラムの追加削除に自動追従するので**同種バグが構造的に再発しない**メリットがある。

却下理由：
- 止血が最優先（同期が 2 週間止まっている）
- jsonb 比較と `IS NOT DISTINCT FROM` のセマンティクス完全一致を検証する必要があり、レビューに時間がかかる
- Option A（最小修正）は 10 行削除だけでレビューが瞬殺

→ Option B 化は別タスクとして 8.2 に残してある。

### 7.2 supabase CLI で `db push` 適用

`supabase link` してから `db push` する案。

却下理由：
- このプロジェクトは元々 Supabase Studio SQL Editor 中心の運用（`_apply_all.sql` は初期構築用、`supabase/.temp/` も config.toml もない）
- 今回のタスクで運用方法を変えるのは止血の範囲外
- link → push のセットアップにも時間がかかる

---

## 8. 後続タスク（急がない）

### 8.1 `_apply_all.sql` への追記

`supabase/_apply_all.sql` は migration を連結した初期構築用ファイル。今後の新規環境構築時に整合性が取れるよう、migration 20 の内容を末尾に追記しておく。

### 8.2 `update_updated_at()` の jsonb 方式への書き換え（対応済み）

7.1 で却下した Option B を別 migration として実装する。新規カラムの追加削除のたびに本トリガー関数を更新し忘れる事故を構造的に防ぐ。

2026-05-06 追記: `supabase/migrations/20260506000021_make_updated_at_trigger_schema_resilient.sql` として実装済み。まだ本番 DB には未適用。

書き換え案（要検証）：

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
DECLARE
  sync_keys TEXT[] := ARRAY[
    'last_synced_to_notion_at',
    'last_synced_from_notion_at',
    'last_synced_to_sheet_at',
    'last_synced_from_sheet_at',
    'updated_at'
  ];
  new_data JSONB;
  old_data JSONB;
  k TEXT;
BEGIN
  new_data := to_jsonb(NEW);
  old_data := to_jsonb(OLD);
  FOREACH k IN ARRAY sync_keys LOOP
    new_data := new_data - k;
    old_data := old_data - k;
  END LOOP;
  IF new_data = old_data THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

検証ポイント：
- jsonb の値比較セマンティクス（NULL の扱い、型の保持、配列の順序）が `IS NOT DISTINCT FROM` の列単位比較と完全等価か
- 大規模テーブルでの性能影響（illustrators は数千行規模なので実質影響なしと予想）

### 8.3 sync_failures のクリーンアップ

6.3 のクエリで件数を確認し、必要なら古いログを物理削除。

### 8.4 同種バグの再発防止プロセス

CLAUDE.md または `docs/architecture/03_マイグレーション手順.md` に「カラム追加削除時はトリガー関数の参照も確認する」というチェックリスト項目を追加するか検討。8.2（jsonb 方式）が入ればこの手順は不要になるので、8.2 を優先する方針。

---

## 9. 参考情報

### 9.1 関連ファイル

- 修正 migration: `supabase/migrations/20260423000020_fix_updated_at_trigger_drop_legacy_refs.sql`
- 元のトリガー定義: `supabase/migrations/20260423000012_fix_updated_at_trigger_for_sync.sql`
- カラム削除 migration: `supabase/migrations/20260423000018_drop_unused_legacy_columns.sql`
- トリガー登録: `supabase/migrations/20260423000008_create_triggers.sql`
- 関数群: `supabase/migrations/20260423000007_create_functions.sql`

### 9.2 環境変数

- Supabase project ref: `lwxdbzbwkmamqlbxuscy`
- Supabase URL: `https://lwxdbzbwkmamqlbxuscy.supabase.co`
- service role key: `.env.local` の `SUPABASE_SERVICE_ROLE_KEY`

### 9.3 Notion DB

- イラストレーター情報メイン DB: `e72fd069-f428-4a4a-946e-d8c61f115345`
- Berryfeel 別 DB（archived）: `2cac5063-7a7b-808e-889c-fef08afa0f73`
- 同期失敗ログページ: `34ac5063-7a7b-8054-bf0b-ecb7b4a3f140`

### 9.4 関連ドキュメント

- 合意事項リスト: `docs/00_合意事項リスト.md`
- Supabase スキーマ: `docs/architecture/02_Supabaseスキーマ.md`
- マイグレーション手順（初期）: `docs/architecture/03_マイグレーション手順.md`

---

## 10. Codex への依頼事項（順序）

1. **本ドキュメント全体を読んで内容を把握**
2. **migration 20 ファイル（`supabase/migrations/20260423000020_*.sql`）を実際に開いて中身を確認**
3. **加藤に Supabase Studio での実行手順を案内し、実行してもらう**（4 章の通り）
4. **適用後、5 章のクエリを順に実行して復旧を確認**
5. **6.1 の auto_transition 件数を確認、常識的な範囲かレポート**
6. **後続タスク（8 章）の優先順位とスケジュールを加藤と相談**

加藤の作業スタンス：

- このプロジェクトは「ユーザーに極力聞かず自己判断で進める」方針（`CLAUDE.md`）。ただし**本番 DB 変更は事前確認**。
- 進行上の判断は Codex 側で考えて進めて OK。
- 重要な設計判断・破壊的操作・確定事項の変更は事前確認。

---

## 11. Codex 作業ログ（2026-05-06）

### 11.1 実施済み

- `supabase/migrations/20260423000020_fix_updated_at_trigger_drop_legacy_refs.sql` の中身を確認。
- `update_updated_at()` 関数本体に、Migration 18 で削除済みの 10 カラムへの `NEW.*` / `OLD.*` 参照が残っていないことを確認。
- `supabase/_apply_all.sql` の末尾に migration 20 を追記。

### 11.2 ローカル確認結果

- `npm run typecheck`: 成功。
- `npm test`: テストファイル未配置のため `No test files found` で終了。今回の SQL 変更を検証する既存テストはなし。

### 11.3 未実施（本番 DB 操作）

以下は Supabase Studio の SQL Editor で手動実行が必要。

1. `supabase/migrations/20260423000020_fix_updated_at_trigger_drop_legacy_refs.sql` を実行。
2. 5.1〜5.4 の確認 SQL を実行。
3. 6.1 の auto_transition 対象件数を確認。

### 11.4 追記（migration 20 適用後）

- 加藤が Supabase Studio SQL Editor で migration 20 を実行済み。
- Codex 側から Supabase API 経由で読み取り確認を試みたが、実行環境のネットワーク制限で DNS 解決できず未確認。
- SQL Editor で `update_updated_at()` の関数定義を確認し、削除済み legacy カラム参照が消えていることを確認済み。
- SQL Editor で直近15分の `sync_failures` が 0 件であることを確認済み。
- SQL Editor で `auto_transition_to_no_reply()` 対象件数が 1 件であることを確認済み。常識的な範囲のため自動実行に任せて問題なし。

### 11.5 設計見直し（恒久対策）

- `update_updated_at()` を JSONB 動的比較方式へ変更する migration 21 を作成。
- `docs/architecture/06_同期障害の再発防止設計.md` を追加。
- 関連ドキュメントの `updated_at` 説明と auto-transition の 14日運用を更新。
- 加藤が Supabase Studio SQL Editor で migration 21 を実行済み。
- SQL Editor で `update_updated_at()` が `to_jsonb(NEW)` / `to_jsonb(OLD)` 方式になっていることを確認済み。
- SQL Editor で migration 21 適用後の直近15分の `sync_failures` が 0 件であることを確認済み。
- 判定: 恒久対策まで適用完了。削除済みカラム参照による UPDATE 全体停止の同種事故は構造的に防止済み。

### 11.6 追加見直し（同期失敗ログ運用）

- `supabase/migrations/20260506000022_dedupe_sync_failures.sql` を追加。
- `sync_failures` に `failure_key` / `occurrence_count` / `last_seen_at` を追加し、未解決の同一失敗を1行に畳む設計へ変更。
- 同期成功時に対応する未解決失敗へ `resolved_at` を入れる処理を追加。
- 失敗通知は `created_at` ではなく `last_seen_at` 順にし、通知文に発生回数を含めるよう変更。
- 加藤が Supabase Studio SQL Editor で migration 22 を実行済み。
- 適用後は `sync_failures` の未解決重複が増え続けないことを確認する。
- 適用後確認:
  - `unresolved_count = 1336`
  - `unresolved_occurrences = 243739`
  - `latest_failure_seen_at = 2026-05-06 13:29:34.164242+00`
  - 未解決失敗の種類・発生回数が多く、直近にも再発があるため、上位 failure_key の原因特定が次の作業。
- 上位20件はすべて `source=notion`, `target=supabase`, `operation=update`。
- エラーは `record "new" has no field "legacy_status"` で共通。
- これは migration 21 適用前の古い `update_updated_at()` が削除済み `legacy_status` を参照していた時期の Notion→Supabase 失敗ログと判断。
- 次は「migration 21 適用後にも再発しているか」を `last_seen_at` と現在の関数定義で確認する。
- 直近15分確認でも `recent_unresolved_keys = 1336`, `recent_occurrences = 243739`, `latest_seen_at = 2026-05-06 13:29:34.164242+00`。
- SQL 実行時点では全未解決失敗が直近15分内に再発扱い。現在の `update_updated_at()` 定義確認が必要。
- `pg_get_functiondef` 確認結果: `update_updated_at()` は `to_jsonb(NEW)` / `to_jsonb(OLD)` 方式で、`legacy_status` 参照なし。trigger 定義は正常。
- 直近扱いになっている原因は、migration 22 で `last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` を追加したため、既存行に適用時刻が入ったことと判断。
- ローカル migration 22 は、既存行の `last_seen_at` を `created_at` で backfill してから default/not null を付ける形に修正済み。
- すでに適用済みの本番 DB は、既存 legacy_status 失敗ログの `last_seen_at` を `created_at` ベースに補正する必要あり。
- legacy_status 由来の未解決ログ確認:
  - `legacy_status_unresolved = 1244`
  - `first_created_at = 2026-04-23 21:44:00.383763+00`
  - `latest_created_at = 2026-05-06 11:42:48.327247+00`
  - `current_latest_seen_at = 2026-05-06 13:29:34.164242+00`
  - `created_at` と `last_seen_at` の差から、現在の再発ではなく migration 22 適用時の backfill 影響と判断。
- 本番 DB で `legacy_status` 由来ログの `last_seen_at` を `created_at` ベースに補正済み。
- 補正後の直近15分確認:
  - `recent_unresolved_keys = 0`
  - `recent_occurrences = 0`
  - `latest_seen_at = null`
- 判定: `legacy_status` 由来の同期失敗は現在再発していない。
- 本番 DB で `legacy_status` 由来の未解決ログを `resolved_at = NOW()` で解決済みに更新済み。
- 確認結果: `legacy_status_unresolved = 0`。
- 全体未解決確認:
  - `unresolved_count = 92`
  - `unresolved_occurrences = 9592`
  - `latest_failure_seen_at = 2026-05-06 13:29:34.164242+00`
- まだ別原因の未解決ログが残っているため、上位 error_sample の確認が必要。
- 残り上位エラーは Notion→Supabase の enum 不一致:
  - `style_tag_enum`: `男性向け`, `成人向け`
  - `owner_enum`: `及川`
  - `master_status_enum`: `時間をおいて再度連絡`
- 設計判断:
  - Notion multi_select は運用中に値が増えるため、`owner_confirmed_by` / `style_tags` は `TEXT[]` に広げる。
  - `master_status` は status として制御したいため、実在する `時間をおいて再度連絡` を enum に追加する。
- `supabase/migrations/20260506000023_relax_notion_multiselect_enums.sql` を追加。
- migration 23 には、既存の Notion→Supabase 失敗ログの `failure_key` を `error_message` 内の `page_id` ベースへ正規化する処理も含めた。
- migration 23 適用後、`sync_state.notion_to_supabase.last_run_at` を少し戻して Notion→Supabase を再実行すると、成功したページの未解決ログが自動で `resolved_at` になる。
- 初回実行時に `illustrators_pending_to_notion` view 依存で `cannot alter type of a column used by a view or rule` が発生。
- migration 23 を、型変更前に pending VIEW 2本を drop し、型変更後に再作成する形へ修正済み。
- 再実行時に `sync_failures.last_seen_at` が存在せず、ログ補正部分で停止。
- migration 23 を、migration 22 の前提カラム（`failure_key` / `occurrence_count` / `last_seen_at`）作成・backfill・index 作成も補完する形へ修正済み。
- さらに後半の `extracted` CTE で `last_seen_at` 等を SELECT していないまま `ORDER BY last_seen_at` していたため停止。
- migration 23 の `extracted` CTE に `created_at` / `last_seen_at` / `occurrence_count` / `retry_count` を含めるよう修正済み。
- 加藤が Supabase Studio SQL Editor で修正版 migration 23 を実行済み。
- 適用確認:
  - `owner_confirmed_by` / `style_tags` は `TEXT[]` (`udt_name = _text`) へ変更済み。
  - `master_status_enum` に `時間をおいて再度連絡` 追加済み。
  - 未解決ログは `unresolved_count = 92`, `unresolved_occurrences = 9592` のまま。スキーマ修正後に Notion→Supabase を再実行して成功させる必要あり。
- 2026-05-07 再開時点:
  - 未解決ログはまだ `unresolved_count = 92`, `unresolved_occurrences = 9592`。
  - GitHub Actions で解決処理を効かせるには、ローカルの `resolveSyncFailure` 実装修正を commit/push してから `Sync Single (manual)` の `notion-to-supabase` を実行する必要がある。
  - commit/push 前に GitHub Actions を実行すると、古いコードでは同期成功しても既存 `sync_failures.resolved_at` は自動更新されない。
- 2026-05-08:
  - commit `5079c07` を `origin/main` へ push 済み。
  - GitHub Actions `Sync Single (manual)` で `notion-to-supabase` を実行し、run `25506259036` が success。
  - 実行後、未解決ログは `unresolved_count = 59`, `unresolved_occurrences = 5911` まで減少。
  - schema drift / enum 不一致修正は一部効いている。残り59件の error_sample 確認が次作業。
- 残り59件の上位 error_sample は引き続き `style_tag_enum` / `owner_enum` / `master_status_enum` の古いエラー文。
- `last_seen_at` は更新されていないため、新規再発ではなく再処理対象に入らなかった過去ログと判断。
- 通常の Notion→Supabase は `last_edited_time` カーソル方式なので、古いページの失敗ログだけを拾う専用復旧ジョブ `src/sync/retry-notion-failures.ts` を追加。
- `.github/workflows/sync-single.yml` に `retry-notion-failures` を追加。次はこのジョブを commit/push して GitHub Actions から実行する。
- commit `82ac439` を push 後、GitHub Actions `Sync Single (manual)` で `retry-notion-failures` を実行。run `25506638943` が success。
- 実行後、未解決ログは `unresolved_count = 9`, `unresolved_occurrences = 195`, `latest_failure_seen_at = 2026-05-07 15:51:08.954+00` まで減少。
- 残り9件は復旧ジョブで再試行後も失敗している可能性があるため、上位 error_sample 確認が必要。
- 残り9件の内訳:
  - 1件: Notion→Supabase で `duplicate key value violates unique constraint "illustrators_x_username_key"`。`notion_page_id` 未紐付けだが同一 `x_username` の既存レコードがあるケース。
  - 8件: Supabase→Notion の 502 / 504 / timeout。古い一時障害ログ。
- `src/sync/notion-to-supabase.ts` を修正し、Notion新規ページ扱いでも `x_username` が既存レコードに一致する場合は INSERT せず既存レコードへ `notion_page_id` を紐付けるようにした。
