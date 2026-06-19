-- ==========================================
-- Migration: add_recontact_date_transition
-- Created: 2026-05-13
-- Reason:
--   多忙辞退後に再アプローチする日付を Notion/Supabase で同期し、
--   期日到来時にマスターステータスを再連絡へ自動遷移する。
-- ==========================================

ALTER TYPE master_status_enum ADD VALUE IF NOT EXISTS '再連絡';

ALTER TABLE illustrators
  ADD COLUMN IF NOT EXISTS recontact_at DATE;

UPDATE illustrators
   SET master_status = '多忙辞退'::master_status_enum
 WHERE master_status = '時間をおいて再度連絡'::master_status_enum;

CREATE INDEX IF NOT EXISTS idx_illustrators_recontact_due
  ON illustrators (recontact_at)
  WHERE master_status = '多忙辞退'
    AND recontact_at IS NOT NULL;

COMMENT ON COLUMN illustrators.recontact_at IS
  '多忙辞退などで時間を空けて再度連絡する予定日。Notion の「再度連絡する日」と同期する。';
