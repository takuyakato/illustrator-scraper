-- ==========================================
-- Apply all migrations in order
-- Generated from supabase/migrations
-- ==========================================

-- SOURCE: 20260423000001_create_extensions.sql
-- ==========================================
-- Migration: create_extensions
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

-- gen_random_uuid() 用
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- SOURCE: 20260423000002_create_enums.sql
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

-- SOURCE: 20260423000003_create_illustrators.sql
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

-- SOURCE: 20260423000004_create_sync_failures.sql
-- ==========================================
-- Migration: create_sync_failures
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

CREATE TABLE sync_failures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL CHECK (source IN ('supabase', 'notion', 'sheets', 'scraper')),
  target          TEXT NOT NULL CHECK (target IN ('supabase', 'notion', 'sheets')),
  record_id       UUID REFERENCES illustrators(id) ON DELETE CASCADE,
  operation       TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete', 'fetch')),
  error_message   TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 10),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

COMMENT ON TABLE sync_failures IS '同期失敗ログ。自動リトライ（最大10回）管理と通知メール生成に使用。';
COMMENT ON COLUMN sync_failures.resolved_at IS 'NULL=未解決（通知対象）、NOT NULL=解決済み（通知対象外）';

-- SOURCE: 20260423000005_create_scraping_logs.sql
-- ==========================================
-- Migration: create_scraping_logs
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

CREATE TABLE scraping_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                    TEXT NOT NULL CHECK (mode IN ('initial', 'differential', 'manual')),
  seed_username           TEXT,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'partial')),
  candidates_checked      INTEGER NOT NULL DEFAULT 0,
  candidates_new          INTEGER NOT NULL DEFAULT 0,
  candidates_duplicated   INTEGER NOT NULL DEFAULT 0,
  errors                  JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE scraping_logs IS 'スクレイピング実行履歴。バッチごとの統計・エラー記録。';
COMMENT ON COLUMN scraping_logs.mode IS 'initial=初回フルスキャン、differential=差分スキャン、manual=手動実行';

-- SOURCE: 20260423000006_create_indexes.sql
-- ==========================================
-- Migration: create_indexes
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

-- 部分インデックス（is_illustrator）
CREATE INDEX idx_illustrators_is_illustrator_true
  ON illustrators (id) WHERE is_illustrator = TRUE;
CREATE INDEX idx_illustrators_is_illustrator_null
  ON illustrators (id) WHERE is_illustrator IS NULL;

-- 通常インデックス
CREATE INDEX idx_illustrators_master_status ON illustrators (master_status);
CREATE INDEX idx_illustrators_rank ON illustrators (rank);

-- 配列カラム用GINインデックス
CREATE INDEX idx_illustrators_genres_gin ON illustrators USING GIN (genres);
CREATE INDEX idx_illustrators_owner_confirmed_by_gin ON illustrators USING GIN (owner_confirmed_by);
CREATE INDEX idx_illustrators_contacted_by_gin ON illustrators USING GIN (contacted_by);

-- 日時系
CREATE INDEX idx_illustrators_first_detected_at ON illustrators (first_detected_at DESC);
CREATE INDEX idx_illustrators_last_seen_at ON illustrators (last_seen_at);
CREATE INDEX idx_illustrators_updated_at ON illustrators (updated_at);

-- 同期用（差分検知）
CREATE INDEX idx_illustrators_last_synced_to_notion_at
  ON illustrators (last_synced_to_notion_at);
CREATE INDEX idx_illustrators_last_synced_from_notion_at
  ON illustrators (last_synced_from_notion_at);
CREATE INDEX idx_illustrators_last_synced_to_sheet_at
  ON illustrators (last_synced_to_sheet_at);
CREATE INDEX idx_illustrators_last_synced_from_sheet_at
  ON illustrators (last_synced_from_sheet_at);

-- sync_failures
CREATE INDEX idx_sync_failures_unresolved
  ON sync_failures (created_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_sync_failures_record_id ON sync_failures (record_id);

-- scraping_logs
CREATE INDEX idx_scraping_logs_started_at ON scraping_logs (started_at DESC);
CREATE INDEX idx_scraping_logs_mode_status ON scraping_logs (mode, status);

-- SOURCE: 20260423000007_create_functions.sql
-- ==========================================
-- Migration: create_functions
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

-- 7.1 update_updated_at()：更新時刻自動更新
-- 更新時にupdated_atを自動でNOW()に更新するトリガー関数
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7.2 normalize_x_username(url TEXT)：Xリンク正規化
-- Xリンク/ユーザー名を正規化（小文字・@/URL除去・クエリ除去）
-- 入力例: 'https://x.com/Example'、'@example'、'Example' → すべて 'example'
CREATE OR REPLACE FUNCTION normalize_x_username(input TEXT)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  IF input IS NULL OR LENGTH(TRIM(input)) = 0 THEN
    RETURN NULL;
  END IF;

  result := TRIM(input);

  -- プロトコルとドメインの除去（x.com / twitter.com / www. バリエーション対応）
  result := REGEXP_REPLACE(result, '^https?://(www\.)?(x|twitter)\.com/', '', 'i');

  -- 先頭の @ を除去
  result := REGEXP_REPLACE(result, '^@', '');

  -- クエリパラメータ (?...) を除去
  result := REGEXP_REPLACE(result, '\?.*$', '');

  -- 末尾スラッシュ・パス以降を除去
  result := REGEXP_REPLACE(result, '/.*$', '');

  -- 小文字化
  result := LOWER(result);

  -- 空になったらNULL
  IF LENGTH(result) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION normalize_x_username IS 'Xリンク/ユーザー名を正規化。小文字・@/URL除去・クエリ除去。';

-- 7.3 extract_pixiv_url(bio TEXT)：bioからPixivリンク抽出
-- bioテキスト内からpixivリンクを抽出
CREATE OR REPLACE FUNCTION extract_pixiv_url(bio TEXT)
RETURNS TEXT AS $$
DECLARE
  url_match TEXT;
BEGIN
  IF bio IS NULL THEN
    RETURN NULL;
  END IF;

  -- pixiv.net/users/数字 形式を優先抽出
  url_match := SUBSTRING(bio FROM 'https?://(?:www\.)?pixiv\.net/(?:en/)?users?/[0-9]+');
  IF url_match IS NOT NULL THEN
    RETURN url_match;
  END IF;

  -- www.pixiv.net/member.php?id=数字 形式
  url_match := SUBSTRING(bio FROM 'https?://(?:www\.)?pixiv\.net/member\.php\?id=[0-9]+');
  IF url_match IS NOT NULL THEN
    RETURN url_match;
  END IF;

  -- その他 pixiv.net で始まるURL全般
  url_match := SUBSTRING(bio FROM 'https?://(?:www\.)?pixiv\.net/[^\s]+');
  RETURN url_match;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION extract_pixiv_url IS 'bioテキストからPixivリンクを抽出（pixiv.net/users/xxx優先）';

-- 7.4 is_ai_illustrator(bio TEXT)：AI絵師キーワード判定
-- bioテキスト内にAI絵師キーワードが含まれるか判定
CREATE OR REPLACE FUNCTION is_ai_illustrator(bio TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF bio IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 大文字小文字を無視して判定
  RETURN bio ~* '(生成AI|AI絵師|AIイラスト|AIアート|stable ?diffusion|midjourney|nijijourney|dall-?e|novelai|ai generated|ai-generated|ai art)';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_ai_illustrator IS 'bioにAI絵師キーワード（生成AI/Stable Diffusion/Midjourney等）が含まれるか判定';

-- 7.5 convert_legacy_to_master_status(...)：旧ステータス→新マスターステータス変換
-- 優先順位：連絡状況 > ステータス 1 > ステータス > デフォルト（候補）
-- 「連絡状況=未連絡」は下位（ステータス 1 → ステータス）を参照する特殊ケース
CREATE OR REPLACE FUNCTION convert_legacy_to_master_status(
  legacy_contact_status TEXT,
  legacy_status_1       TEXT,
  legacy_status         TEXT
)
RETURNS master_status_enum AS $$
DECLARE
  cs  TEXT;
  s1  TEXT;
  s   TEXT;
BEGIN
  cs := NULLIF(TRIM(COALESCE(legacy_contact_status, '')), '');
  s1 := NULLIF(TRIM(COALESCE(legacy_status_1, '')), '');
  s  := NULLIF(TRIM(COALESCE(legacy_status, '')), '');

  -- 1. 連絡状況が「未連絡」以外の有効値なら、それで変換
  IF cs IS NOT NULL AND cs <> '未連絡' THEN
    RETURN CASE cs
      WHEN '連絡しない'            THEN '依頼不可'::master_status_enum
      WHEN '連絡中'                THEN '連絡中'::master_status_enum
      WHEN '時間を空けて再連絡'    THEN '多忙辞退'::master_status_enum
      WHEN '依頼失敗'              THEN '依頼不可'::master_status_enum
      WHEN '依頼成功'              THEN '依頼成功'::master_status_enum
      ELSE '候補'::master_status_enum  -- 未知の値は候補扱い
    END;
  END IF;

  -- 2. 連絡状況が空 or 未連絡 → ステータス 1 を参照
  IF s1 IS NOT NULL THEN
    RETURN CASE s1
      WHEN '完了'                      THEN '依頼成功'::master_status_enum
      WHEN '依頼中'                    THEN '連絡中'::master_status_enum
      WHEN '返信あり・依頼できそう'    THEN '連絡中'::master_status_enum
      WHEN '未返信'                    THEN '返信なし'::master_status_enum
      WHEN '連絡したい'                THEN '候補'::master_status_enum
      WHEN 'スケジュール確保済み'      THEN '連絡中'::master_status_enum
      WHEN '依頼前'                    THEN '連絡中'::master_status_enum
      WHEN '再連絡'                    THEN '多忙辞退'::master_status_enum
      WHEN '依頼不可'                  THEN '依頼不可'::master_status_enum
      WHEN '多忙のため辞退'            THEN '多忙辞退'::master_status_enum
      ELSE '候補'::master_status_enum
    END;
  END IF;

  -- 3. ステータス 1 も空 → ステータス（旧ネーム/線画）を参照
  IF s IS NOT NULL THEN
    RETURN CASE s
      WHEN 'ネーム:依頼中'       THEN '連絡中'::master_status_enum
      WHEN '線画:依頼中'         THEN '連絡中'::master_status_enum
      WHEN 'ネーム:頼まない'     THEN '依頼不可'::master_status_enum
      WHEN '線画:頼まない'       THEN '依頼不可'::master_status_enum
      WHEN '未依頼'              THEN '候補'::master_status_enum
      WHEN 'ネーム:継続希望'     THEN '依頼成功'::master_status_enum
      WHEN '線画:継続希望'       THEN '依頼成功'::master_status_enum
      ELSE '候補'::master_status_enum
    END;
  END IF;

  -- 4. すべて空 → デフォルト（候補）
  RETURN '候補'::master_status_enum;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION convert_legacy_to_master_status IS '旧ステータス3値から新マスターステータスへ変換。優先順位：連絡状況 > ステータス 1 > ステータス。連絡状況=未連絡は下位フィールドを参照する特殊ケース。';

-- 7.6 auto_transition_to_no_reply()：自動遷移関数（連絡中 → 返信なし / 30日経過）
-- 「連絡中」かつ「連絡した日から30日経過」のレコードを「返信なし」に自動遷移
-- GitHub Actions から1日1回呼び出す想定
CREATE OR REPLACE FUNCTION auto_transition_to_no_reply()
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE illustrators
     SET master_status = '返信なし'::master_status_enum,
         note = COALESCE(note || E'\n', '') ||
                TO_CHAR(NOW(), 'YYYY-MM-DD') ||
                ' [自動遷移: 連絡中→返信なし] 30日経過'
   WHERE master_status = '連絡中'::master_status_enum
     AND contacted_at IS NOT NULL
     AND contacted_at <= (CURRENT_DATE - INTERVAL '30 days');

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_transition_to_no_reply IS '連絡中ステータスから30日経過したレコードを返信なしに自動遷移。戻り値は更新件数。';

-- 7.7 normalize_x_username_trigger()：トリガー用関数（トリガー本体は008で作成）
-- x_username の書き込み時に自動で正規化するトリガー関数
CREATE OR REPLACE FUNCTION normalize_x_username_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.x_username IS NOT NULL THEN
    NEW.x_username := normalize_x_username(NEW.x_username);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- SOURCE: 20260423000008_create_triggers.sql
-- ==========================================
-- Migration: create_triggers
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================
--
-- 前提: 関数は 007 で作成済みであること
--   - update_updated_at()
--   - normalize_x_username_trigger()

-- illustrators の updated_at 自動更新トリガー
CREATE TRIGGER trg_illustrators_update_updated_at
  BEFORE UPDATE ON illustrators
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- illustrators の x_username 自動正規化トリガー
CREATE TRIGGER trg_illustrators_normalize_x_username
  BEFORE INSERT OR UPDATE OF x_username ON illustrators
  FOR EACH ROW
  EXECUTE FUNCTION normalize_x_username_trigger();

-- SOURCE: 20260423000009_enable_rls.sql
-- ==========================================
-- Migration: enable_rls
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================
--
-- 方針（合意事項リスト v2.1「書き込みは3経路のみ」を実装）：
--   service_role  : 全操作可
--   authenticated : 読み取りのみ
--   anon          : アクセス不可（ポリシー未定義により実質拒否）

-- RLS有効化
ALTER TABLE illustrators      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_failures     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_logs     ENABLE ROW LEVEL SECURITY;

-- ===== illustrators =====
-- service_role は全操作可
CREATE POLICY illustrators_service_role_all
  ON illustrators
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- authenticated は SELECT のみ
CREATE POLICY illustrators_authenticated_select
  ON illustrators
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- anon は明示的に拒否（ポリシー未定義で実質拒否になるが、可読性のため明示）
-- ※ RLSは「ポリシーに合致したものだけ許可」なので、anonに対するポリシーを作らなければ拒否される

-- ===== sync_failures =====
CREATE POLICY sync_failures_service_role_all
  ON sync_failures
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY sync_failures_authenticated_select
  ON sync_failures
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- ===== scraping_logs =====
CREATE POLICY scraping_logs_service_role_all
  ON scraping_logs
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY scraping_logs_authenticated_select
  ON scraping_logs
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- SOURCE: 20260423000010_fix_points_to_numeric.sql
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

-- SOURCE: 20260423000011_add_genre_koukoku.sql
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

-- SOURCE: 20260423000012_fix_updated_at_trigger_for_sync.sql
-- ==========================================
-- Migration: fix_updated_at_trigger_for_sync
-- Created: 2026-04-23
-- Reason:
--   Phase 2（同期ジョブ実装）の準備。
--   Supabase → Notion/Sheets 同期ジョブは、書き込み成功後に
--   last_synced_to_notion_at / last_synced_to_sheet_at を更新する必要がある。
--
--   現状の update_updated_at() トリガーは全ての UPDATE で
--   updated_at = NOW() を設定してしまうため、同期完了タイムスタンプ更新で
--   updated_at も動いてしまい、「次サイクルで再び同期対象になる」
--   （updated_at > last_synced_to_*_at の条件が常に真になる）無限ループが発生する。
--
--   対策: 実データ系カラム（sync メタデータ以外）に変更がない UPDATE では
--   updated_at を触らないように分岐させる。
--
-- Safety:
--   既存データへの影響なし（トリガー関数の差し替えのみ）。
--   注意: 新しい関数定義は CREATE OR REPLACE FUNCTION なので冪等。
-- ==========================================

-- 関数を差し替え：sync メタデータのみの更新では updated_at を進めない
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
    -- Legacy カラム（通常は変化しないが念のため）
    NEW.legacy_status            IS NOT DISTINCT FROM OLD.legacy_status            AND
    NEW.legacy_status_1          IS NOT DISTINCT FROM OLD.legacy_status_1          AND
    NEW.legacy_contact_status    IS NOT DISTINCT FROM OLD.legacy_contact_status    AND
    NEW.legacy_capuri_berryfeel_search IS NOT DISTINCT FROM OLD.legacy_capuri_berryfeel_search AND
    NEW.legacy_mimura_comment    IS NOT DISTINCT FROM OLD.legacy_mimura_comment    AND
    NEW.legacy_hojo_comment      IS NOT DISTINCT FROM OLD.legacy_hojo_comment      AND
    NEW.legacy_mimura_points     IS NOT DISTINCT FROM OLD.legacy_mimura_points     AND
    NEW.legacy_hojo_points       IS NOT DISTINCT FROM OLD.legacy_hojo_points       AND
    NEW.legacy_found_date        IS NOT DISTINCT FROM OLD.legacy_found_date        AND
    NEW.legacy_found_by          IS NOT DISTINCT FROM OLD.legacy_found_by          AND
    NEW.legacy_start_date        IS NOT DISTINCT FROM OLD.legacy_start_date        AND
    NEW.legacy_end_date          IS NOT DISTINCT FROM OLD.legacy_end_date          AND
    NEW.legacy_capuri_request_id IS NOT DISTINCT FROM OLD.legacy_capuri_request_id AND
    NEW.legacy_mail_alt          IS NOT DISTINCT FROM OLD.legacy_mail_alt          AND
    NEW.legacy_recontact_time    IS NOT DISTINCT FROM OLD.legacy_recontact_time    AND
    NEW.legacy_rejection_reason  IS NOT DISTINCT FROM OLD.legacy_rejection_reason  AND
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
  'updated_at を進めない。これによりループ同期を防ぐ。';

-- SOURCE: 20260423000013_create_sync_state.sql
-- ==========================================
-- Migration: create_sync_state
-- Created: 2026-04-23
-- Reason:
--   Phase 2（同期ジョブ）でジョブ単位の「最終成功時刻」を保存するテーブル。
--   Notion→Supabase のポーリングで、「どこから last_edited_time で拾うか」の
--   起点を記録する。illustrators.last_synced_from_notion_at はレコード単位だが、
--   ジョブ側のグローバル値として別管理する。
--
-- Safety:
--   新規テーブルのみ。既存テーブル・データへの影響なし。
-- ==========================================

CREATE TABLE sync_state (
  job_name     TEXT PRIMARY KEY,
  last_run_at  TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sync_state IS
  '同期ジョブ単位の最終成功時刻を保存する。Notion→Supabase のポーリング起点等に使用。';
COMMENT ON COLUMN sync_state.job_name IS
  'ジョブ識別子（例: notion_to_supabase, supabase_to_notion, sheet_to_supabase 等）';
COMMENT ON COLUMN sync_state.last_run_at IS
  'そのジョブが最後に成功した時刻（ジョブ開始時刻を記録するのが推奨）';

-- SOURCE: 20260423000014_add_sync_failure_notified_at.sql
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

-- SOURCE: 20260423000015_create_pending_sync_views.sql
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

-- SOURCE: 20260423000016_fix_auto_transition_jst_date.sql
-- ==========================================
-- Migration: fix_auto_transition_jst_date
-- Created: 2026-04-23
-- Reason:
--   auto_transition_to_no_reply() は note の先頭に日付を付与する際、
--   TO_CHAR(NOW(), 'YYYY-MM-DD') を使っていたため UTC 日付が入っていた。
--   JST 03:00 cron で稼働すると UTC では 18:00（前日）のため、note に
--   付く日付が JST 的には常に「前日」扱いになり運用上紛らわしい。
--
--   対策: NOW() を `Asia/Tokyo` タイムゾーンに変換してから日付を得るように修正。
--   既存の51件の note は `2026-04-22` のまま残るが、historical record として
--   許容する（retroactive UPDATE は Notion 側との再同期が必要になり副作用大）。
--
-- Safety:
--   関数の差し替えのみ、既存データ・トリガー・他関数への影響なし。
-- ==========================================

CREATE OR REPLACE FUNCTION auto_transition_to_no_reply()
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE illustrators
     SET master_status = '返信なし'::master_status_enum,
         note = COALESCE(note || E'\n', '') ||
                TO_CHAR(NOW() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') ||
                ' [自動遷移: 連絡中→返信なし] 30日経過'
   WHERE master_status = '連絡中'::master_status_enum
     AND contacted_at IS NOT NULL
     AND contacted_at <= (CURRENT_DATE - INTERVAL '30 days');

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_transition_to_no_reply IS
  '連絡中ステータスから30日経過したレコードを返信なしに自動遷移。note に JST 日付で '
  '[自動遷移: 連絡中→返信なし] を追記する。戻り値は更新件数。';

-- SOURCE: 20260423000017_tighten_security_and_indexes.sql
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

-- SOURCE: 20260423000018_drop_unused_legacy_columns.sql
-- ==========================================
-- Migration: drop_unused_legacy_columns
-- Created: 2026-04-24
-- Reason:
--   Phase 2 のクリーンアップで、使用頻度・情報密度・代替手段を総合評価し、
--   復旧不能なデータロスが起きない範囲で 10 カラムを削除する。
--
--   削除対象（10 カラム）:
--     1. legacy_mimura_points          — 0件、完全に空
--     2. legacy_status_1                — 1243件、99%がデフォルト値「未返信」で情報ゼロ
--     3. legacy_mail_alt                — 647件、`email` カラムと重複
--     4. legacy_recontact_time          — 3件、備考に退避済み
--     5. legacy_start_date              — 4件、備考に退避済み
--     6. legacy_end_date                — 4件、備考に退避済み
--     7. legacy_rejection_reason        — 7件、備考+マスター退避済み
--     8. legacy_capuri_berryfeel_search — 203件、ジャンル（Capuri/Berryfeel）に統合済み
--     9. legacy_found_date              — 550件、`first_detected_at` に反映済み
--    10. legacy_status                   — 79件、`master_status` に吸収済み
--
--   削除しないカラム（7つ、価値あり）:
--     - legacy_contact_status    : 履歴分析で価値
--     - legacy_found_by           : スカウト別集計
--     - legacy_mimura_comment     : 三村評価原文
--     - legacy_hojo_comment       : 北條評価原文
--     - legacy_hojo_points        : 点数集計
--     - legacy_capuri_request_id  : Phase 2.5 projects_history 移行で使用
--     - migration_snapshot        : 保険として JSONB 完全スナップショット
--
--   注意: illustrators_pending_to_notion / _sheet は SELECT i.* で
--   全カラムに依存しているため、VIEW を一旦 DROP → DROP COLUMN →
--   VIEW を migration 017 と同じ定義で再作成する、という順序で実行する。
--
-- Safety:
--   復旧は migration_snapshot (JSONB) から可能。
--   VIEW 再作成中はトランザクション内でアトミックに処理されるので、
--   同期ジョブがクエリしても一貫した結果が返る。
-- ==========================================

BEGIN;

-- ====== 1. 依存 VIEW を一旦 DROP ======
DROP VIEW IF EXISTS illustrators_pending_to_notion;
DROP VIEW IF EXISTS illustrators_pending_to_sheet;

-- ====== 2. 不要カラムを削除 ======
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_mimura_points;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_status_1;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_mail_alt;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_recontact_time;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_start_date;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_end_date;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_rejection_reason;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_capuri_berryfeel_search;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_found_date;
ALTER TABLE illustrators DROP COLUMN IF EXISTS legacy_status;

-- ====== 3. VIEW を migration 017 と同じ定義で再作成 ======
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

COMMIT;

-- SOURCE: 20260423000019_change_auto_transition_threshold_to_14days.sql
-- ==========================================
-- Migration: change_auto_transition_threshold_to_14days
-- Created: 2026-04-24
-- Reason:
--   運用判断により、連絡中→返信なしの自動遷移しきい値を 30日 から 14日 に短縮。
--   より早くフォローアップ/再判断のタイミングが来るようにする。
--
-- Safety:
--   関数の差し替えのみ、既存データ・トリガー・他関数への影響なし。
--   現時点で contacted_at が 14日以上前の連絡中レコードは 0 件であることを
--   実行前に確認済み。次回 JST 03:00 cron で新たに対象になるレコードから
--   14日しきい値が適用される。
-- ==========================================

CREATE OR REPLACE FUNCTION auto_transition_to_no_reply()
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE illustrators
     SET master_status = '返信なし'::master_status_enum,
         note = COALESCE(note || E'\n', '') ||
                TO_CHAR(NOW() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') ||
                ' [自動遷移: 連絡中→返信なし] 14日経過'
   WHERE master_status = '連絡中'::master_status_enum
     AND contacted_at IS NOT NULL
     AND contacted_at <= (CURRENT_DATE - INTERVAL '14 days');

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_transition_to_no_reply IS
  '連絡中ステータスから 14 日経過したレコードを 返信なし に自動遷移。'
  'note に JST 日付で [自動遷移: 連絡中→返信なし] を追記する。戻り値は更新件数。';

-- SOURCE: 20260423000020_fix_updated_at_trigger_drop_legacy_refs.sql
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

-- SOURCE: 20260506000021_make_updated_at_trigger_schema_resilient.sql
-- ==========================================
-- Migration: make_updated_at_trigger_schema_resilient
-- Created: 2026-05-06
-- Reason:
--   Migration 20 で削除済み legacy カラム参照を取り除いて UPDATE 失敗は止血した。
--   ただし update_updated_at() が実データ系カラムを手書き列挙する設計のままだと、
--   今後のカラム追加・削除時に同じ種類の参照漏れが再発し得る。
--
--   本 migration では、NEW/OLD レコードを JSONB 化し、同期メタデータ系カラムだけを
--   差し引いて比較する方式へ変更する。これにより illustrators の通常カラム追加・削除に
--   トリガー関数が自動追従し、カラム名の更新漏れで UPDATE 全体が落ちる事故を防ぐ。
--
-- Excluded keys:
--   last_synced_to_notion_at / last_synced_from_notion_at /
--   last_synced_to_sheet_at / last_synced_from_sheet_at / updated_at
--
-- Safety:
--   CREATE OR REPLACE FUNCTION なので冪等。データ破壊なし。
--   sync メタデータのみの UPDATE では updated_at を据え置き、
--   それ以外の実データ変更では updated_at を NOW() に進める。
--   JSONB 比較は NULL・配列順序・ENUM文字列表現を含め、今回の用途では
--   列単位の IS NOT DISTINCT FROM と同等に扱える。
-- ==========================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
DECLARE
  sync_metadata_keys TEXT[] := ARRAY[
    'last_synced_to_notion_at',
    'last_synced_from_notion_at',
    'last_synced_to_sheet_at',
    'last_synced_from_sheet_at',
    'updated_at'
  ];
  new_data JSONB;
  old_data JSONB;
  key TEXT;
BEGIN
  new_data := to_jsonb(NEW);
  old_data := to_jsonb(OLD);

  FOREACH key IN ARRAY sync_metadata_keys LOOP
    new_data := new_data - key;
    old_data := old_data - key;
  END LOOP;

  IF new_data = old_data THEN
    -- 同期メタデータだけの更新なら updated_at を据え置き
    NEW.updated_at := OLD.updated_at;
  ELSE
    -- 実データ変更あり
    NEW.updated_at := NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at IS
  '更新時に updated_at を自動設定するトリガー関数。'
  'last_synced_to_notion_at / last_synced_from_notion_at / last_synced_to_sheet_at / '
  'last_synced_from_sheet_at / updated_at だけの変更では updated_at を進めない。'
  'NEW/OLD を JSONB 化して比較するため、illustrators のカラム追加・削除に自動追従する。';

-- SOURCE: 20260506000022_dedupe_sync_failures.sql
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

-- SOURCE: 20260506000023_relax_notion_multiselect_enums.sql
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
