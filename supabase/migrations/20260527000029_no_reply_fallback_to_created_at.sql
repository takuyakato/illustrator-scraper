-- ==========================================
-- Migration: no_reply_fallback_to_created_at
-- Created: 2026-05-27
-- Reason:
--   連絡中だが「連絡した日」が未入力の既存レコードについても、
--   DB作成日時（created_at）の JST 日付から14日経過したら返信なしへ遷移する。
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
     AND COALESCE(contacted_at, (created_at AT TIME ZONE 'Asia/Tokyo')::DATE)
         <= ((NOW() AT TIME ZONE 'Asia/Tokyo')::DATE - 14)
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
  '連絡した日が空の場合は created_at の JST 日付を基準にする。'
  'ただし再度連絡する日が到来している場合は再連絡遷移を優先する。戻り値は更新件数。';
