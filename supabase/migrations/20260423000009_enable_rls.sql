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
