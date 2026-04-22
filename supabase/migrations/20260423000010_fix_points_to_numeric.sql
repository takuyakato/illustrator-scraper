-- ==========================================
-- Migration: fix_points_to_numeric
-- Created: 2026-04-23
-- Source: マイグレーション本番実行時に発見（ドライランでは書き込みなしのため検出不可）
-- Reason:
--   legacy_mimura_points / legacy_hojo_points は INTEGER で作成したが、
--   実データに小数点付きの値（例: 7.5）が含まれていた。
--   INTEGER だと変換失敗でINSERT不可のため、NUMERIC に変更する。
--
-- Safety:
--   既に 746 件の INSERT が完了している状態（本番実行が途中で失敗した）。
--   型変更前に TRUNCATE で空にしてから、改めて全件マイグレーションを再実行する。
-- ==========================================

-- 1. 既存データをクリア（マイグレーション途中失敗の復旧用）
TRUNCATE TABLE illustrators RESTART IDENTITY CASCADE;

-- 2. 点数カラムの型を NUMERIC に変更（小数点許容）
ALTER TABLE illustrators
  ALTER COLUMN legacy_mimura_points TYPE NUMERIC USING legacy_mimura_points::NUMERIC;

ALTER TABLE illustrators
  ALTER COLUMN legacy_hojo_points TYPE NUMERIC USING legacy_hojo_points::NUMERIC;

-- 3. コメント更新
COMMENT ON COLUMN illustrators.legacy_mimura_points IS
  '旧「三村点数」。NUMERIC（小数点許容、実データに 7.5 等あり）';
COMMENT ON COLUMN illustrators.legacy_hojo_points IS
  '旧「北條点数」。NUMERIC（小数点許容、実データに 7.5 等あり）';
