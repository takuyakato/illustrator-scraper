-- ==========================================
-- Migration: change_auto_transition_threshold_to_14days
-- Created: 2026-04-24
-- Reason:
--   運用判断により、連絡中→返信なしの自動遷移しきい値を 30日 から 14日 に短縮。
--   より早くフォローアップ/再判断のタイミングが来るようにする。
--
-- Safety:
--   関数の差し替えのみ、既存データ・トリガー・他関数への影響なし。
--   現時点で contacted_at が 14日以上前の連絡中レコードは 0 件であることを
--   実行前に確認済み。次回 JST 03:00 cron で新たに対象になるレコードから
--   14日しきい値が適用される。
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
                ' [自動遷移: 連絡中→返信なし] 14日経過'
   WHERE master_status = '連絡中'::master_status_enum
     AND contacted_at IS NOT NULL
     AND contacted_at <= (CURRENT_DATE - INTERVAL '14 days');

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_transition_to_no_reply IS
  '連絡中ステータスから 14 日経過したレコードを 返信なし に自動遷移。'
  'note に JST 日付で [自動遷移: 連絡中→返信なし] を追記する。戻り値は更新件数。';
