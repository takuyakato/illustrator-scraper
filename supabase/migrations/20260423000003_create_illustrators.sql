-- ==========================================
-- Migration: create_illustrators
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

CREATE TABLE illustrators (
  -- ID・基本識別子
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  x_username                      TEXT NOT NULL UNIQUE,
  display_name                    TEXT,
  bio                             TEXT,
  follower_count                  INTEGER CHECK (follower_count >= 0),

  -- スクレイピング情報
  detected_from                   TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  first_detected_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scout_comment                   TEXT,

  -- 判定フラグ（null=未判定、true=確定、false=除外）
  is_illustrator                  BOOLEAN DEFAULT NULL,

  -- アクティブカラム（Notion同期対象）
  artist_name                     TEXT,
  master_status                   master_status_enum DEFAULT '候補',
  rank                            rank_enum,
  owner_confirmed_by              owner_enum[] NOT NULL DEFAULT '{}'::owner_enum[],
  style_tags                      style_tag_enum[] NOT NULL DEFAULT '{}'::style_tag_enum[],
  genres                          genre_enum[] NOT NULL DEFAULT '{}'::genre_enum[],
  x_link                          TEXT,
  pixiv_link                      TEXT,
  portfolio_link                  TEXT,
  other_contact                   TEXT,
  email                           TEXT,
  credit_name                     TEXT,
  contacted_at                    DATE,
  contacted_by                    TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  note                            TEXT,

  -- Legacy カラム（非表示・Supabase個別保持）
  legacy_status                   TEXT,
  legacy_status_1                 TEXT,
  legacy_contact_status           TEXT,
  legacy_capuri_berryfeel_search  TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  legacy_mimura_comment           TEXT,
  legacy_hojo_comment             TEXT,
  legacy_mimura_points            INTEGER,
  legacy_hojo_points              INTEGER,
  legacy_found_date               DATE,
  legacy_found_by                 TEXT,
  legacy_start_date               DATE,
  legacy_end_date                 DATE,
  legacy_capuri_request_id        TEXT,
  legacy_mail_alt                 TEXT,
  legacy_recontact_time           TEXT,
  legacy_rejection_reason         TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  migration_snapshot              JSONB,

  -- Notion連携
  notion_page_id                  TEXT UNIQUE,
  last_synced_to_notion_at        TIMESTAMPTZ,
  last_synced_from_notion_at      TIMESTAMPTZ,

  -- Google Sheets連携
  sheet_row_index                 INTEGER,
  last_synced_to_sheet_at         TIMESTAMPTZ,
  last_synced_from_sheet_at       TIMESTAMPTZ,

  -- システム自動
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 整合性制約
  -- is_illustrator=true の場合は artist_name 必須
  CONSTRAINT chk_illustrator_has_artist_name
    CHECK (is_illustrator IS NOT TRUE OR artist_name IS NOT NULL)

  -- ※ contacted_at / contacted_by のペア制約はv1.1で削除。
  --   既存データで片方だけ入っているレコードが存在する可能性があり、
  --   マイグレーション失敗を避けるため。
);

COMMENT ON TABLE illustrators IS 'BL/TL系イラストレーター候補メインテーブル。スクレイパー・Sheets・Notionの3経路で書き込まれる。';
COMMENT ON COLUMN illustrators.x_username IS '正規化済みX username（小文字・@/URL除去）。一意キー。';
COMMENT ON COLUMN illustrators.is_illustrator IS 'null=未判定（Sheets表示）、true=確定（Notion表示）、false=除外（どちらも非表示）';
COMMENT ON COLUMN illustrators.owner_confirmed_by IS 'オーナー確認済み担当者配列。空=未確認（ビュー1の主フィルタ）';
COMMENT ON COLUMN illustrators.contacted_by IS '連絡担当者の配列（multi_select、拡張可）。オーナー3名に限らず、李・吉澤・長野・木村などスタッフ全般の名前が入る。';
COMMENT ON COLUMN illustrators.migration_snapshot IS '念のためマイグレーション時の完全スナップショット（JSONB）';
