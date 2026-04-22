-- ==========================================
-- Migration: create_enums
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================
--
-- 注意: ENUMに値を追加する場合、`ALTER TYPE ... ADD VALUE` は
-- トランザクション内で実行できない。マイグレーションは単独の
-- SQLファイルとして切り出して実行すること。

-- マスターステータス（7値）
CREATE TYPE master_status_enum AS ENUM (
  '候補',
  '連絡中',
  '返信なし',
  '多忙辞退',
  '条件次第',
  '依頼成功',
  '依頼不可'
);

-- ランク（S/A/B/C）
CREATE TYPE rank_enum AS ENUM (
  'S',
  'A',
  'B',
  'C'
);

-- 絵柄タグ（4値）
CREATE TYPE style_tag_enum AS ENUM (
  'イケメン',
  'リアル',
  'デフォルメ',
  'クセ強'
);

-- オーナー（3名）
CREATE TYPE owner_enum AS ENUM (
  '北條',
  '三村',
  '加藤'
);

-- ジャンル（5値）
CREATE TYPE genre_enum AS ENUM (
  'BLサンド',
  'Capuri',
  'Berryfeel',
  'Webtoon',
  'アシスタント'
);
