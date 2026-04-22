-- ==========================================
-- Migration: create_pending_sync_views
-- Created: 2026-04-23
-- Reason:
--   supabase-to-notion / supabase-to-sheet の同期対象抽出で、PostgREST の
--   .or() 構文ではカラム同士の比較（updated_at > last_synced_*_at）が
--   サポートされず、文字列リテラルとして解釈されてエラーになる。
--
--   対策: Supabase 側に2本の VIEW を作り、「同期待ち」の条件を DB 側に畳み込む。
--   クライアントからは単純な SELECT * FROM VIEW で済むようになる。
--
-- Safety:
--   VIEW 追加のみ。既存テーブル・データに影響なし。
-- ==========================================

-- Supabase → Notion 同期の対象：
--   is_illustrator = TRUE（確定済みのイラストレーター）かつ
--   (一度も同期していない OR Supabase 側でそれ以降に更新がある)
CREATE OR REPLACE VIEW illustrators_pending_to_notion AS
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

-- Supabase → Sheets 同期の対象：
--   is_illustrator IS NULL（判定待ち候補）かつ
--   (一度も同期していない OR Supabase 側でそれ以降に更新がある)
CREATE OR REPLACE VIEW illustrators_pending_to_sheet AS
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
