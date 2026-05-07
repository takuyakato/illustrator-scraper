-- ==========================================
-- Migration: relax_notion_multiselect_enums
-- Created: 2026-05-06
-- Purpose:
--   Notion の multi_select で運用中に追加される値を同期失敗にしない。
--   owner_confirmed_by / style_tags は TEXT[] に広げる。
--   master_status は Notion 側に実在するステータスを追加する。
-- ==========================================

DROP VIEW IF EXISTS illustrators_pending_to_notion;
DROP VIEW IF EXISTS illustrators_pending_to_sheet;

ALTER TABLE illustrators
  ALTER COLUMN owner_confirmed_by DROP DEFAULT,
  ALTER COLUMN owner_confirmed_by TYPE TEXT[] USING owner_confirmed_by::TEXT[],
  ALTER COLUMN owner_confirmed_by SET DEFAULT '{}'::TEXT[],
  ALTER COLUMN style_tags DROP DEFAULT,
  ALTER COLUMN style_tags TYPE TEXT[] USING style_tags::TEXT[],
  ALTER COLUMN style_tags SET DEFAULT '{}'::TEXT[];

ALTER TYPE master_status_enum ADD VALUE IF NOT EXISTS '時間をおいて再度連絡';

COMMENT ON COLUMN illustrators.owner_confirmed_by IS
  'オーナー確認済み担当者配列。Notion multi_select と同期するため TEXT[] で保持。空=未確認。';
COMMENT ON COLUMN illustrators.style_tags IS
  '絵柄タグ配列。Notion multi_select と同期するため TEXT[] で保持。';

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

-- この migration を単独で再実行しても動くよう、migration 22 の前提カラムを補完する。
-- 既存行の last_seen_at は、追加時刻ではなく実際の作成時刻で backfill する。
ALTER TABLE sync_failures
  ADD COLUMN IF NOT EXISTS failure_key TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

UPDATE sync_failures
SET
  failure_key = COALESCE(
    failure_key,
    source || ':' || target || ':' || operation || ':' ||
      COALESCE(record_id::TEXT, 'no-record:' || md5(error_message))
  ),
  last_seen_at = COALESCE(last_seen_at, created_at),
  occurrence_count = GREATEST(occurrence_count, 1);

ALTER TABLE sync_failures
  ALTER COLUMN failure_key SET NOT NULL,
  ALTER COLUMN last_seen_at SET DEFAULT NOW(),
  ALTER COLUMN last_seen_at SET NOT NULL;

WITH grouped AS (
  SELECT
    failure_key,
    ARRAY_AGG(id ORDER BY last_seen_at DESC, created_at DESC) AS ids,
    SUM(occurrence_count) AS total_occurrence_count,
    MAX(retry_count) AS max_retry_count,
    MAX(last_seen_at) AS max_last_seen_at
  FROM sync_failures
  WHERE resolved_at IS NULL
  GROUP BY failure_key
  HAVING COUNT(*) > 1
),
kept AS (
  UPDATE sync_failures sf
  SET
    occurrence_count = g.total_occurrence_count,
    retry_count = g.max_retry_count,
    last_seen_at = g.max_last_seen_at
  FROM grouped g
  WHERE sf.id = g.ids[1]
  RETURNING sf.id
)
UPDATE sync_failures sf
SET resolved_at = NOW()
FROM grouped g
WHERE sf.id = ANY(g.ids[2:array_length(g.ids, 1)]);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_failures_unresolved_failure_key
  ON sync_failures (failure_key)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sync_failures_unresolved_last_seen
  ON sync_failures (last_seen_at DESC)
  WHERE resolved_at IS NULL;

-- migration 22 適用時点の古い notion→supabase 失敗は、record_id が無いため
-- error_message の md5 ベース failure_key になっている。
-- 今後の成功時に resolveSyncFailure(failure_key=page_idベース) で解決できるよう補正する。
WITH extracted AS (
  SELECT
    id,
    created_at,
    last_seen_at,
    occurrence_count,
    retry_count,
    (REGEXP_MATCH(error_message, 'page_id=([0-9a-fA-F-]{36})'))[1] AS page_id
  FROM sync_failures
  WHERE resolved_at IS NULL
    AND source = 'notion'
    AND target = 'supabase'
    AND operation = 'update'
    AND error_message LIKE 'page_id=%'
),
grouped AS (
  SELECT
    page_id,
    ARRAY_AGG(id ORDER BY last_seen_at DESC, created_at DESC) AS ids,
    SUM(occurrence_count) AS total_occurrence_count,
    MAX(retry_count) AS max_retry_count,
    MAX(last_seen_at) AS max_last_seen_at
  FROM extracted
  WHERE page_id IS NOT NULL
  GROUP BY page_id
  HAVING COUNT(*) > 1
),
kept AS (
  UPDATE sync_failures sf
  SET
    occurrence_count = g.total_occurrence_count,
    retry_count = g.max_retry_count,
    last_seen_at = g.max_last_seen_at
  FROM grouped g
  WHERE sf.id = g.ids[1]
  RETURNING sf.id
)
UPDATE sync_failures sf
SET resolved_at = NOW()
FROM grouped g
WHERE sf.id = ANY(g.ids[2:array_length(g.ids, 1)]);

WITH extracted AS (
  SELECT
    id,
    (REGEXP_MATCH(error_message, 'page_id=([0-9a-fA-F-]{36})'))[1] AS page_id
  FROM sync_failures
  WHERE resolved_at IS NULL
    AND source = 'notion'
    AND target = 'supabase'
    AND operation = 'update'
    AND error_message LIKE 'page_id=%'
)
UPDATE sync_failures sf
SET failure_key = 'notion:supabase:update:page:' || LOWER(e.page_id)
FROM extracted e
WHERE sf.id = e.id
  AND e.page_id IS NOT NULL
  AND sf.failure_key IS DISTINCT FROM 'notion:supabase:update:page:' || LOWER(e.page_id);
