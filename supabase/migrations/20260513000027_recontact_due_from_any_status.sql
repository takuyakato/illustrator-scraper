-- ==========================================
-- Migration: recontact_due_from_any_status
-- Created: 2026-05-13
-- Reason:
--   再度連絡する日が到来したら、元ステータスが多忙辞退でなくても再連絡へ遷移する。
--   連絡中の14日経過と再連絡日到来が同時に成立する場合は、再連絡を優先する。
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
  '連絡中ステータスから14日経過したレコードを返信なしに自動遷移。'
  'ただし再度連絡する日が到来している場合は再連絡遷移を優先する。戻り値は更新件数。';

CREATE OR REPLACE FUNCTION auto_transition_to_recontact()
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE illustrators
     SET master_status = '再連絡'::master_status_enum,
         note = COALESCE(note || E'\n', '') ||
                TO_CHAR((NOW() AT TIME ZONE 'Asia/Tokyo')::DATE, 'YYYY-MM-DD') ||
                ' [自動遷移: 再連絡] 再度連絡する日到達'
   WHERE master_status <> '再連絡'::master_status_enum
     AND recontact_at IS NOT NULL
     AND recontact_at <= (NOW() AT TIME ZONE 'Asia/Tokyo')::DATE;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_transition_to_recontact IS
  '再度連絡する日が到来したレコードを、元ステータスに関係なく「再連絡」に自動遷移。'
  'note に JST 日付で [自動遷移: 再連絡] を追記する。戻り値は更新件数。';
