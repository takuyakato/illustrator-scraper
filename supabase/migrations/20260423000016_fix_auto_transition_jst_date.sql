-- ==========================================
-- Migration: fix_auto_transition_jst_date
-- Created: 2026-04-23
-- Reason:
--   auto_transition_to_no_reply() は note の先頭に日付を付与する際、
--   TO_CHAR(NOW(), 'YYYY-MM-DD') を使っていたため UTC 日付が入っていた。
--   JST 03:00 cron で稼働すると UTC では 18:00（前日）のため、note に
--   付く日付が JST 的には常に「前日」扱いになり運用上紛らわしい。
--
--   対策: NOW() を `Asia/Tokyo` タイムゾーンに変換してから日付を得るように修正。
--   既存の51件の note は `2026-04-22` のまま残るが、historical record として
--   許容する（retroactive UPDATE は Notion 側との再同期が必要になり副作用大）。
--
-- Safety:
--   関数の差し替えのみ、既存データ・トリガー・他関数への影響なし。
-- ==========================================

CREATE OR REPLACE FUNCTION auto_transition_to_no_reply()
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE illustrators
     SET master_status = '返信なし'::master_status_enum,
         note = COALESCE(note || E'\n', '') ||
                TO_CHAR(NOW() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') ||
                ' [自動遷移: 連絡中→返信なし] 30日経過'
   WHERE master_status = '連絡中'::master_status_enum
     AND contacted_at IS NOT NULL
     AND contacted_at <= (CURRENT_DATE - INTERVAL '30 days');

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_transition_to_no_reply IS
  '連絡中ステータスから30日経過したレコードを返信なしに自動遷移。note に JST 日付で '
  '[自動遷移: 連絡中→返信なし] を追記する。戻り値は更新件数。';
