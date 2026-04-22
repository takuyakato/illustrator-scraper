-- ==========================================
-- Migration: create_scraping_logs
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

CREATE TABLE scraping_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                    TEXT NOT NULL CHECK (mode IN ('initial', 'differential', 'manual')),
  seed_username           TEXT,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'partial')),
  candidates_checked      INTEGER NOT NULL DEFAULT 0,
  candidates_new          INTEGER NOT NULL DEFAULT 0,
  candidates_duplicated   INTEGER NOT NULL DEFAULT 0,
  errors                  JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE scraping_logs IS 'スクレイピング実行履歴。バッチごとの統計・エラー記録。';
COMMENT ON COLUMN scraping_logs.mode IS 'initial=初回フルスキャン、differential=差分スキャン、manual=手動実行';
