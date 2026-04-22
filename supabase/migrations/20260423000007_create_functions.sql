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
