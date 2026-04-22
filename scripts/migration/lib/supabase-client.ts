/**
 * Supabase クライアント（service_role キー使用）。
 *
 * - マイグレーション・同期ジョブでのみ使用する
 * - service_role はセキュリティ上、サーバーサイド・CLIスクリプト専用
 * - 普段の運用（Webアプリ等）では anon / authenticated キーを使うこと
 */

import { createClient } from '@supabase/supabase-js';

import { loadAppEnv } from './env.js';

const env = loadAppEnv();

/**
 * service_role キーで認証された Supabase クライアント。
 * RLS はバイパスされるため、マイグレーション時の一括書き込みに使う。
 */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    // service_role キー使用時はセッション管理不要
    persistSession: false,
    autoRefreshToken: false,
  },
});
