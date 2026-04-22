-- ==========================================
-- SOURCE: 20260423000001_create_extensions.sql
-- ==========================================
-- ==========================================
-- Migration: create_extensions
-- Created: 2026-04-23
-- Source: docs/architecture/02_Supabaseスキーマ.md v1.1
-- ==========================================

-- gen_random_uuid() 用
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ==========================================
-- SOURCE: 20260423000002_create_enums.sql
-- ==========================================
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


-- ==========================================
-- SOURCE: 20260423000003_create_illustrators.sql
-- ==========================================
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


-- ==========================================
-- SOURCE: 20260423000004_create_sync_failures.sql
-- ==========================================
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


-- ==========================================
-- SOURCE: 20260423000005_create_scraping_logs.sql
-- ==========================================
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


-- ==========================================
-- SOURCE: 20260423000006_create_indexes.sql
-- ==========================================
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


-- ==========================================
-- SOURCE: 20260423000007_create_functions.sql
-- ==========================================
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


-- ==========================================
-- SOURCE: 20260423000008_create_triggers.sql
-- ==========================================
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


-- ==========================================
-- SOURCE: 20260423000009_enable_rls.sql
-- ==========================================
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


