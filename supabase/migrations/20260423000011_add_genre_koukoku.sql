-- ==========================================
-- Migration: add_genre_koukoku
-- Created: 2026-04-23
-- Reason:
--   A/Bランク43件が全員「CW・Lancers・ココナラ広告用」でBL/TL系ではないため、
--   ジャンル「広告用」を新設してシード候補から除外できるようにする。
--
-- Safety:
--   ALTER TYPE ... ADD VALUE はトランザクション外で実行する必要あり。
--   Supabase SQL Editor で単独実行すること。
-- ==========================================

ALTER TYPE genre_enum ADD VALUE IF NOT EXISTS '広告用';
