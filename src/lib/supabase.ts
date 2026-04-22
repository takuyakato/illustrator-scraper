/**
 * Supabase クライアント（同期ジョブ用・service_role 認証）。
 *
 * service_role は RLS をバイパスする強い権限なので、
 * サーバーサイド／CLI スクリプト専用。クライアントに渡さない。
 */

import { createClient } from '@supabase/supabase-js';

import { loadSyncEnv } from './env.js';

const env = loadSyncEnv();

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
