-- ==========================================
-- Migration: drop_unused_legacy_columns
-- Created: 2026-04-24
-- Reason:
--   Phase 2 のクリーンアップで、使用頻度・情報密度・代替手段を総合評価し、
--   復旧不能なデータロスが起きない範囲で 10 カラムを削除する。
--
--   削除対象（10 カラム）:
--     1. legacy_mimura_points          — 0件、完全に空
--     2. legacy_status_1                — 1243件、99%がデフォルト値「未返信」で情報ゼロ
--     3. legacy_mail_alt                — 647件、`email` カラムと重複
--     4. legacy_recontact_time          — 3件、備考に退避済み
--     5. legacy_start_date              — 4件、備考に退避済み
--     6. legacy_end_date                — 4件、備考に退避済み
--     7. legacy_rejection_reason        — 7件、備考+マスター退避済み
--     8. legacy_capuri_berryfeel_search — 203件、ジャンル（Capuri/Berryfeel）に統合済み
--     9. legacy_found_date              — 550件、`first_detected_at` に反映済み
--    10. legacy_status                   — 79件、`master_status` に吸収済み
--
--   削除しないカラム（7つ、価値あり）:
--     - legacy_contact_status    : 履歴分析で価値
--     - legacy_found_by           : スカウト別集計
--     - legacy_mimura_comment     : 三村評価原文
--     - legacy_hojo_comment       : 北條評価原文
--     - legacy_hojo_points        : 点数集計
--     - legacy_capuri_request_id  : Phase 2.5 projects_history 移行で使用
--     - migration_snapshot        : 保険として JSONB 完全スナップショット
--
-- Safety:
--   復旧は migration_snapshot (JSONB) から可能。
--   削除前の値は 2026-04-22 のマイグレーション時点で記録されており、
--   その後書き換わった legacy_* カラムはない（設計上 write-once）。
-- ==========================================

ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_mimura_points;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_status_1;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_mail_alt;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_recontact_time;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_start_date;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_end_date;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_rejection_reason;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_capuri_berryfeel_search;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_found_date;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_status;

-- VIEW（illustrators_pending_to_notion / _sheet）は SELECT i.* なので
-- 自動的に新しいカラム構成を反映する。再作成不要。
