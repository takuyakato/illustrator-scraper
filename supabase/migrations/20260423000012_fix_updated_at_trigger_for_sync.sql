-- ==========================================
-- Migration: fix_updated_at_trigger_for_sync
-- Created: 2026-04-23
-- Reason:
--   Phase 2（同期ジョブ実装）の準備。
--   Supabase → Notion/Sheets 同期ジョブは、書き込み成功後に
--   last_synced_to_notion_at / last_synced_to_sheet_at を更新する必要がある。
--
--   現状の update_updated_at() トリガーは全ての UPDATE で
--   updated_at = NOW() を設定してしまうため、同期完了タイムスタンプ更新で
--   updated_at も動いてしまい、「次サイクルで再び同期対象になる」
--   （updated_at > last_synced_to_*_at の条件が常に真になる）無限ループが発生する。
--
--   対策: 実データ系カラム（sync メタデータ以外）に変更がない UPDATE では
--   updated_at を触らないように分岐させる。
--
-- Safety:
--   既存データへの影響なし（トリガー関数の差し替えのみ）。
--   注意: 新しい関数定義は CREATE OR REPLACE FUNCTION なので冪等。
-- ==========================================

-- 関数を差し替え：sync メタデータのみの更新では updated_at を進めない
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
DECLARE
  -- 同期ジョブが単独で書き換える「メタデータ系カラム」のセット
  -- このカラム群のみに変更がある場合は updated_at を触らない
  sync_only_change BOOLEAN;
BEGIN
  sync_only_change := (
    -- sync メタデータ系以外のカラムに「変更がない」ことを確認
    NEW.x_username               IS NOT DISTINCT FROM OLD.x_username               AND
    NEW.display_name             IS NOT DISTINCT FROM OLD.display_name             AND
    NEW.bio                      IS NOT DISTINCT FROM OLD.bio                      AND
    NEW.follower_count           IS NOT DISTINCT FROM OLD.follower_count           AND
    NEW.detected_from            IS NOT DISTINCT FROM OLD.detected_from            AND
    NEW.first_detected_at        IS NOT DISTINCT FROM OLD.first_detected_at        AND
    NEW.last_seen_at             IS NOT DISTINCT FROM OLD.last_seen_at             AND
    NEW.scout_comment            IS NOT DISTINCT FROM OLD.scout_comment            AND
    NEW.is_illustrator           IS NOT DISTINCT FROM OLD.is_illustrator           AND
    NEW.artist_name              IS NOT DISTINCT FROM OLD.artist_name              AND
    NEW.master_status            IS NOT DISTINCT FROM OLD.master_status            AND
    NEW.rank                     IS NOT DISTINCT FROM OLD.rank                     AND
    NEW.owner_confirmed_by       IS NOT DISTINCT FROM OLD.owner_confirmed_by       AND
    NEW.style_tags               IS NOT DISTINCT FROM OLD.style_tags               AND
    NEW.genres                   IS NOT DISTINCT FROM OLD.genres                   AND
    NEW.x_link                   IS NOT DISTINCT FROM OLD.x_link                   AND
    NEW.pixiv_link               IS NOT DISTINCT FROM OLD.pixiv_link               AND
    NEW.portfolio_link           IS NOT DISTINCT FROM OLD.portfolio_link           AND
    NEW.other_contact            IS NOT DISTINCT FROM OLD.other_contact            AND
    NEW.email                    IS NOT DISTINCT FROM OLD.email                    AND
    NEW.credit_name              IS NOT DISTINCT FROM OLD.credit_name              AND
    NEW.contacted_at             IS NOT DISTINCT FROM OLD.contacted_at             AND
    NEW.contacted_by             IS NOT DISTINCT FROM OLD.contacted_by             AND
    NEW.note                     IS NOT DISTINCT FROM OLD.note                     AND
    -- Legacy カラム（通常は変化しないが念のため）
    NEW.legacy_status            IS NOT DISTINCT FROM OLD.legacy_status            AND
    NEW.legacy_status_1          IS NOT DISTINCT FROM OLD.legacy_status_1          AND
    NEW.legacy_contact_status    IS NOT DISTINCT FROM OLD.legacy_contact_status    AND
    NEW.legacy_capuri_berryfeel_search IS NOT DISTINCT FROM OLD.legacy_capuri_berryfeel_search AND
    NEW.legacy_mimura_comment    IS NOT DISTINCT FROM OLD.legacy_mimura_comment    AND
    NEW.legacy_hojo_comment      IS NOT DISTINCT FROM OLD.legacy_hojo_comment      AND
    NEW.legacy_mimura_points     IS NOT DISTINCT FROM OLD.legacy_mimura_points     AND
    NEW.legacy_hojo_points       IS NOT DISTINCT FROM OLD.legacy_hojo_points       AND
    NEW.legacy_found_date        IS NOT DISTINCT FROM OLD.legacy_found_date        AND
    NEW.legacy_found_by          IS NOT DISTINCT FROM OLD.legacy_found_by          AND
    NEW.legacy_start_date        IS NOT DISTINCT FROM OLD.legacy_start_date        AND
    NEW.legacy_end_date          IS NOT DISTINCT FROM OLD.legacy_end_date          AND
    NEW.legacy_capuri_request_id IS NOT DISTINCT FROM OLD.legacy_capuri_request_id AND
    NEW.legacy_mail_alt          IS NOT DISTINCT FROM OLD.legacy_mail_alt          AND
    NEW.legacy_recontact_time    IS NOT DISTINCT FROM OLD.legacy_recontact_time    AND
    NEW.legacy_rejection_reason  IS NOT DISTINCT FROM OLD.legacy_rejection_reason  AND
    NEW.migration_snapshot       IS NOT DISTINCT FROM OLD.migration_snapshot       AND
    NEW.notion_page_id           IS NOT DISTINCT FROM OLD.notion_page_id           AND
    NEW.sheet_row_index          IS NOT DISTINCT FROM OLD.sheet_row_index
    -- last_synced_*_at は意図的にチェックしない（これらだけの変更は sync 完了記録）
  );

  IF sync_only_change THEN
    -- 同期メタデータだけの更新なら updated_at を据え置き
    NEW.updated_at = OLD.updated_at;
  ELSE
    -- 実データ変更あり → 従来通り更新
    NEW.updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at IS
  '更新時に updated_at を自動設定するトリガー関数。'
  'last_synced_to_notion_at / last_synced_from_notion_at / last_synced_to_sheet_at / '
  'last_synced_from_sheet_at だけの変更（sync ジョブによる書き込み）では '
  'updated_at を進めない。これによりループ同期を防ぐ。';
