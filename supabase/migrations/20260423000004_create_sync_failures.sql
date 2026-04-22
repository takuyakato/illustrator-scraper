-- ==========================================
-- Migration: create_sync_failures
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

CREATE TABLE sync_failures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL CHECK (source IN ('supabase', 'notion', 'sheets', 'scraper')),
  target          TEXT NOT NULL CHECK (target IN ('supabase', 'notion', 'sheets')),
  record_id       UUID REFERENCES illustrators(id) ON DELETE CASCADE,
  operation       TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete', 'fetch')),
  error_message   TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 10),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

COMMENT ON TABLE sync_failures IS '同期失敗ログ。自動リトライ（最大10回）管理と通知メール生成に使用。';
COMMENT ON COLUMN sync_failures.resolved_at IS 'NULL=未解決（通知対象）、NOT NULL=解決済み（通知対象外）';
