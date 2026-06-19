-- ==========================================
-- Migration: fix_no_reply_transition_jst_threshold
-- Created: 2026-05-13
-- Reason:
--   auto-transition は JST 03:00（UTC 18:00）に動くため、CURRENT_DATE を使うと
--   UTC 前日基準になり、連絡中→返信なしの14日判定が実質1日遅れる。
--   判定日も note 日付と同じ JST date に揃える。
-- ==========================================

CREATE OR REPLACE FUNCTION auto_transition_to_no_reply()
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE illustrators
     SET master_status = '返信なし'::master_status_enum,
         note = COALESCE(note || E'\n', '') ||
                TO_CHAR((NOW() AT TIME ZONE 'Asia/Tokyo')::DATE, 'YYYY-MM-DD') ||
                ' [自動遷移: 連絡中→返信なし] 14日経過'
   WHERE master_status = '連絡中'::master_status_enum
     AND contacted_at IS NOT NULL
     AND contacted_at <= ((NOW() AT TIME ZONE 'Asia/Tokyo')::DATE - 14)
     AND (
       recontact_at IS NULL
       OR recontact_at > (NOW() AT TIME ZONE 'Asia/Tokyo')::DATE
     );

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_transition_to_no_reply IS
  '連絡中ステータスからJST基準で14日経過したレコードを返信なしに自動遷移。'
  'ただし再度連絡する日が到来している場合は再連絡遷移を優先する。戻り値は更新件数。';
