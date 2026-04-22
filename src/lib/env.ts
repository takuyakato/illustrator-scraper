/**
 * 同期ジョブ用の環境変数ロード。
 *
 * - ローカル実行時は `.env.local` を dotenv で読む
 * - GitHub Actions 実行時は secrets がそのまま process.env に入っているので dotenv は no-op
 * - 必須キーが欠けていれば即エラー終了（CI で静かに壊れないように）
 */

import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/lib/env.ts → プロジェクトルートは 2階層上
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ENV_LOCAL_PATH = path.join(PROJECT_ROOT, '.env.local');

loadDotenv({ path: ENV_LOCAL_PATH });

export interface SyncEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  NOTION_API_KEY: string;
  NOTION_MAIN_DB_ID: string;
  NOTION_SYNC_LOG_PAGE_ID: string;
  GOOGLE_SHEET_ID: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    // eslint-disable-next-line no-console
    console.error(`[env] 必須環境変数 ${key} が未設定です。`);
    process.exit(1);
  }
  return v;
}

function optionalEnv(key: string): string {
  return process.env[key] ?? '';
}

/**
 * 同期ジョブで使う全環境変数を一括取得。
 * ジョブによっては Google 系を使わないので optional として扱う。
 */
export function loadSyncEnv(): SyncEnv {
  return {
    SUPABASE_URL: requireEnv('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    NOTION_API_KEY: requireEnv('NOTION_API_KEY'),
    NOTION_MAIN_DB_ID: requireEnv('NOTION_MAIN_DB_ID'),
    NOTION_SYNC_LOG_PAGE_ID: requireEnv('NOTION_SYNC_LOG_PAGE_ID'),
    GOOGLE_SHEET_ID: optionalEnv('GOOGLE_SHEET_ID'),
    GOOGLE_SERVICE_ACCOUNT_JSON: optionalEnv('GOOGLE_SERVICE_ACCOUNT_JSON'),
  };
}

/**
 * Google 系の環境変数が揃っているかチェック。
 * Sheets 関連ジョブの先頭で呼ぶ。
 */
export function requireGoogleEnv(env: SyncEnv): void {
  if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    // eslint-disable-next-line no-console
    console.error('[env] GOOGLE_SHEET_ID と GOOGLE_SERVICE_ACCOUNT_JSON が必須です。');
    process.exit(1);
  }
}
