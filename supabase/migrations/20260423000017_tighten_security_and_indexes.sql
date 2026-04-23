-- ==========================================
-- Migration: tighten_security_and_indexes
-- Created: 2026-04-23
-- Reason:
--   Phase 2 稼働後の構造レビューで見つかった軽微な改善を一括適用：
--   (1) sync_state テーブルに RLS 未設定だったので有効化＋service_role ポリシー追加。
--   (2) pending 同期用 VIEW に security_invoker = on を付与。
--       VIEW 経由で underlying テーブルの RLS がバイパスされるのを防ぐ
--       （Supabase database linter の警告回避）。
--   (3) style_tags カラム用 GIN インデックスを追加。
--       genres / owner_confirmed_by / contacted_by には既にあるが、
--       style_tags だけ漏れていた。
--
-- Safety:
--   RLS 有効化は service_role 以外の読み書きに影響するが、
--   アプリコードは全て service_role 経由なので無影響。
--   VIEW 再定義・インデックス追加はどちらも破壊的変更ではない。
-- ==========================================

-- (1) sync_state テーブルに RLS 設定
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_state_service_role_all
  ON sync_state
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY sync_state_authenticated_select
  ON sync_state
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- (2) VIEW を security_invoker = on で再作成
DROP VIEW IF EXISTS illustrators_pending_to_notion;
CREATE VIEW illustrators_pending_to_notion
  WITH (security_invoker = on) AS
SELECT i.*
  FROM illustrators i
 WHERE i.is_illustrator = TRUE
   AND (
        i.last_synced_to_notion_at IS NULL
     OR i.updated_at > i.last_synced_to_notion_at
   );

COMMENT ON VIEW illustrators_pending_to_notion IS
  'supabase-to-notion 同期ジョブが処理すべきレコード。'
  '「is_illustrator=true かつ (未同期 OR Supabase 側で更新あり)」';

DROP VIEW IF EXISTS illustrators_pending_to_sheet;
CREATE VIEW illustrators_pending_to_sheet
  WITH (security_invoker = on) AS
SELECT i.*
  FROM illustrators i
 WHERE i.is_illustrator IS NULL
   AND (
        i.last_synced_to_sheet_at IS NULL
     OR i.updated_at > i.last_synced_to_sheet_at
   );

COMMENT ON VIEW illustrators_pending_to_sheet IS
  'supabase-to-sheet 同期ジョブが処理すべきレコード。'
  '「is_illustrator IS NULL かつ (未同期 OR Supabase 側で更新あり)」';

-- (3) style_tags 用 GIN インデックス
CREATE INDEX IF NOT EXISTS idx_illustrators_style_tags_gin
  ON illustrators USING GIN (style_tags);
