-- ==========================================
-- Migration: fix_updated_at_trigger_drop_legacy_refs
-- Created: 2026-05-06
-- Reason:
--   Migration 18 (drop_unused_legacy_columns) で illustrators テーブルから
--   10 カラムを DROP したが、Migration 12 (fix_updated_at_trigger_for_sync) で
--   定義した update_updated_at() トリガー関数の中にそれらのカラムへの
--   NEW.* / OLD.* 参照が残ったままになっていた。
--
--   結果、illustrators への BEFORE UPDATE トリガーが発火するたびに
--     ERROR: record "new" has no field "legacy_status"
--   が発生し、2026-04-23 21:58 以降、すべての UPDATE が失敗していた。
--   特に notion→supabase 同期ジョブが全件失敗（500件/サイクル）、
--   supabase→notion 同期 / scraper の last_seen_at 更新 /
--   auto_transition_to_no_reply() cron もすべて停止していた。
--
--   本 migration では、Migration 12 の関数定義から、
--   Migration 18 で削除済みの以下 10 カラムへの参照行を取り除く:
--     legacy_status, legacy_status_1, legacy_mail_alt,
--     legacy_recontact_time, legacy_start_date, legacy_end_date,
--     legacy_rejection_reason, legacy_capuri_berryfeel_search,
--     legacy_found_date, legacy_mimura_points
--
--   Migration 18 で残した 7 カラム（legacy_contact_status, legacy_found_by,
--   legacy_mimura_comment, legacy_hojo_comment, legacy_hojo_points,
--   legacy_capuri_request_id, migration_snapshot）への参照はそのまま維持する。
--
-- Safety:
--   CREATE OR REPLACE FUNCTION なので冪等。データ破壊なし。
--   関数の意味的振る舞いは Migration 12 と同じ
--   （sync メタデータのみの更新で updated_at を据え置く挙動）。
--
-- Future work:
--   このバグの再発を防ぐため、関数を to_jsonb(NEW.*) ベースの動的比較に
--   書き換える方が望ましい（カラム追加削除に自動追従する形）。
--   ただし jsonb 比較セマンティクスの検証が要るため、本 migration では
--   最小修正にとどめ、根本対策は別 migration で行う。
-- ==========================================

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
    -- Migration 18 で残した legacy カラム（通常は変化しないが念のため）
    NEW.legacy_contact_status    IS NOT DISTINCT FROM OLD.legacy_contact_status    AND
    NEW.legacy_mimura_comment    IS NOT DISTINCT FROM OLD.legacy_mimura_comment    AND
    NEW.legacy_hojo_comment      IS NOT DISTINCT FROM OLD.legacy_hojo_comment      AND
    NEW.legacy_hojo_points       IS NOT DISTINCT FROM OLD.legacy_hojo_points       AND
    NEW.legacy_found_by          IS NOT DISTINCT FROM OLD.legacy_found_by          AND
    NEW.legacy_capuri_request_id IS NOT DISTINCT FROM OLD.legacy_capuri_request_id AND
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
  'updated_at を進めない。これによりループ同期を防ぐ。'
  '（Migration 20: Migration 18 で削除した legacy カラム10個への参照を除去。）';
