-- ==========================================
-- Migration: add_scraper_seed_state
-- Created: 2026-05-08
-- Reason:
--   S/Aランクseedが継続的に増える運用に備え、X followings取得の最終実行状態を
--   illustrators に保持する。取得済み候補はrank変更後も残す前提のため、
--   管理対象はseed側の「最後に回したか・成功したか・失敗理由」のみ。
--
-- Safety:
--   nullableカラム追加のみ。既存データは変更しない。
-- ==========================================

ALTER TABLE illustrators
  ADD COLUMN IF NOT EXISTS last_scraped_followings_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_scrape_status TEXT,
  ADD COLUMN IF NOT EXISTS last_scrape_error TEXT;

CREATE INDEX IF NOT EXISTS idx_illustrators_scraper_seed_state
  ON illustrators (rank, last_scraped_followings_at, x_username)
  WHERE is_illustrator IS TRUE
    AND x_username IS NOT NULL;

COMMENT ON COLUMN illustrators.last_scraped_followings_at IS
  'X followingsスクレイパーでこのアカウントをseedとして最後に処理した日時。';
COMMENT ON COLUMN illustrators.last_scrape_status IS
  'X followingsスクレイパーの最終実行状態。success / failed / partial / timeout など。';
COMMENT ON COLUMN illustrators.last_scrape_error IS
  'X followingsスクレイパー最終実行時のエラー要約。成功時はNULL。';
