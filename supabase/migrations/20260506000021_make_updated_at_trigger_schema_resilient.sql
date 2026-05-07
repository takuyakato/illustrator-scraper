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
