-- ==========================================
-- Migration: add_sync_failure_notified_at
-- Created: 2026-04-23
-- Reason:
--   Phase 2 MVP 運用では retry-failed.ts を実装しないため、retry_count は常に 0 で
--   推移する。そのため notify.ts の閾値を「retry_count >= 10」ではなく
--   「未解決の全失敗」に変更する必要があり、それだと1時間おきに同じ失敗が
--   繰り返し通知される（最大168件/週）。
--
--   対策: last_notified_at カラムを追加し、「前回通知から24時間経過したもののみ通知」
--   のロジックで間引く。通知疲れを防ぎつつ、未解決失敗の可視性は保つ。
--
-- Safety:
--   カラム追加のみ、既存データへの影響なし。
-- ==========================================

ALTER TABLE sync_failures
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN sync_failures.last_notified_at IS
  '最後に Notion ログページに通知した時刻。NULL=未通知。24時間以内に通知済みのものはスキップ。';
