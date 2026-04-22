-- ==========================================
-- Migration: create_sync_state
-- Created: 2026-04-23
-- Reason:
--   Phase 2（同期ジョブ）でジョブ単位の「最終成功時刻」を保存するテーブル。
--   Notion→Supabase のポーリングで、「どこから last_edited_time で拾うか」の
--   起点を記録する。illustrators.last_synced_from_notion_at はレコード単位だが、
--   ジョブ側のグローバル値として別管理する。
--
-- Safety:
--   新規テーブルのみ。既存テーブル・データへの影響なし。
-- ==========================================

CREATE TABLE sync_state (
  job_name     TEXT PRIMARY KEY,
  last_run_at  TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sync_state IS
  '同期ジョブ単位の最終成功時刻を保存する。Notion→Supabase のポーリング起点等に使用。';
COMMENT ON COLUMN sync_state.job_name IS
  'ジョブ識別子（例: notion_to_supabase, supabase_to_notion, sheet_to_supabase 等）';
COMMENT ON COLUMN sync_state.last_run_at IS
  'そのジョブが最後に成功した時刻（ジョブ開始時刻を記録するのが推奨）';
