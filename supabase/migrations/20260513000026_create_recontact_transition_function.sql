-- ==========================================
-- Migration: create_recontact_transition_function
-- Created: 2026-05-13
-- Reason:
--   migration 25 で追加した master_status_enum の「再連絡」を使い、
--   再度連絡する日が到来した多忙辞退レコードを自動遷移する。
-- ==========================================

CREATE OR REPLACE FUNCTION auto_transition_to_recontact()
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE illustrators
     SET master_status = '再連絡'::master_status_enum,
         note = COALESCE(note || E'\n', '') ||
                TO_CHAR((NOW() AT TIME ZONE 'Asia/Tokyo')::DATE, 'YYYY-MM-DD') ||
                ' [自動遷移: 多忙辞退→再連絡] 再度連絡する日到達'
   WHERE master_status = '多忙辞退'::master_status_enum
     AND recontact_at IS NOT NULL
     AND recontact_at <= (NOW() AT TIME ZONE 'Asia/Tokyo')::DATE;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_transition_to_recontact IS
  '多忙辞退ステータスで再度連絡する日が到来したレコードを「再連絡」に自動遷移。'
  'note に JST 日付で [自動遷移: 多忙辞退→再連絡] を追記する。戻り値は更新件数。';
