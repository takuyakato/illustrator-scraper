-- ==========================================
-- Migration: dedupe_sync_failures
-- Created: 2026-05-06
-- Purpose:
--   sync_failures の同一未解決失敗を 1 行に畳み、発生回数と最終発生時刻で追跡する。
-- ==========================================

ALTER TABLE sync_failures
  ADD COLUMN IF NOT EXISTS failure_key TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

UPDATE sync_failures
SET
  failure_key = source || ':' || target || ':' || operation || ':' ||
    COALESCE(record_id::TEXT, 'no-record:' || md5(error_message)),
  last_seen_at = created_at,
  occurrence_count = GREATEST(occurrence_count, 1)
WHERE failure_key IS NULL
   OR last_seen_at IS NULL;

ALTER TABLE sync_failures
  ALTER COLUMN failure_key SET NOT NULL,
  ALTER COLUMN last_seen_at SET DEFAULT NOW(),
  ALTER COLUMN last_seen_at SET NOT NULL;

-- 既存の未解決重複がある場合、最新行を代表にして発生回数を集約し、
-- 残りは resolved_at を入れてユニークインデックス作成前に解決済み扱いへ移す。
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

COMMENT ON COLUMN sync_failures.failure_key IS
  '未解決失敗の重複判定キー。同一キーの未解決失敗は1行に畳む。';
COMMENT ON COLUMN sync_failures.occurrence_count IS
  '同一 failure_key の未解決期間中の発生回数。';
COMMENT ON COLUMN sync_failures.last_seen_at IS
  '同一 failure_key の最終発生時刻。通知や監視では created_at よりこちらを優先する。';
