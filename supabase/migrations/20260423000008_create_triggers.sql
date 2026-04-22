-- ==========================================
-- Migration: create_triggers
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================
--
-- 前提: 関数は 007 で作成済みであること
--   - update_updated_at()
--   - normalize_x_username_trigger()

-- illustrators の updated_at 自動更新トリガー
CREATE TRIGGER trg_illustrators_update_updated_at
  BEFORE UPDATE ON illustrators
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- illustrators の x_username 自動正規化トリガー
CREATE TRIGGER trg_illustrators_normalize_x_username
  BEFORE INSERT OR UPDATE OF x_username ON illustrators
  FOR EACH ROW
  EXECUTE FUNCTION normalize_x_username_trigger();
