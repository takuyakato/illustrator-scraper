-- ==========================================
-- Migration: create_indexes
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

-- 部分インデックス（is_illustrator）
CREATE INDEX idx_illustrators_is_illustrator_true
  ON illustrators (id) WHERE is_illustrator = TRUE;
CREATE INDEX idx_illustrators_is_illustrator_null
  ON illustrators (id) WHERE is_illustrator IS NULL;

-- 通常インデックス
CREATE INDEX idx_illustrators_master_status ON illustrators (master_status);
CREATE INDEX idx_illustrators_rank ON illustrators (rank);

-- 配列カラム用GINインデックス
CREATE INDEX idx_illustrators_genres_gin ON illustrators USING GIN (genres);
CREATE INDEX idx_illustrators_owner_confirmed_by_gin ON illustrators USING GIN (owner_confirmed_by);
CREATE INDEX idx_illustrators_contacted_by_gin ON illustrators USING GIN (contacted_by);

-- 日時系
CREATE INDEX idx_illustrators_first_detected_at ON illustrators (first_detected_at DESC);
CREATE INDEX idx_illustrators_last_seen_at ON illustrators (last_seen_at);
CREATE INDEX idx_illustrators_updated_at ON illustrators (updated_at);

-- 同期用（差分検知）
CREATE INDEX idx_illustrators_last_synced_to_notion_at
  ON illustrators (last_synced_to_notion_at);
CREATE INDEX idx_illustrators_last_synced_from_notion_at
  ON illustrators (last_synced_from_notion_at);
CREATE INDEX idx_illustrators_last_synced_to_sheet_at
  ON illustrators (last_synced_to_sheet_at);
CREATE INDEX idx_illustrators_last_synced_from_sheet_at
  ON illustrators (last_synced_from_sheet_at);

-- sync_failures
CREATE INDEX idx_sync_failures_unresolved
  ON sync_failures (created_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_sync_failures_record_id ON sync_failures (record_id);

-- scraping_logs
CREATE INDEX idx_scraping_logs_started_at ON scraping_logs (started_at DESC);
CREATE INDEX idx_scraping_logs_mode_status ON scraping_logs (mode, status);
