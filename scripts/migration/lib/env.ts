/**
 * 環境変数の読み込みヘルパー。
 *
 * - `.env.local` を dotenv で読み込む
 * - 必須の環境変数が欠けていればエラー終了する
 * - 読み込み結果を型付きのオブジェクトで返す
 */

import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM 環境で __dirname を使うための定番パターン
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/migration/lib/env.ts → プロジェクトルートは 3階層上
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const ENV_LOCAL_PATH = path.join(PROJECT_ROOT, '.env.local');

// .env.local があれば読み込む（無ければシェル環境変数をそのまま使う）
loadDotenv({ path: ENV_LOCAL_PATH });

/**
 * 必須環境変数の読み込みとバリデーション。
 * 1つでも欠けていればエラー終了する。
 */
export interface AppEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  NOTION_API_KEY: string;
  NOTION_MAIN_DB_ID: string;
  NOTION_BERRYFEEL_DB_ID: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    // eslint-disable-next-line no-console
    console.error(`[env] 必須環境変数 ${key} が設定されていません。.env.local を確認してください。`);
    process.exit(1);
  }
  return value;
}

/**
 * マイグレーションスクリプトで必要な環境変数を返す。
 * 欠損時はプロセスを終了するため、戻り値は常に完全な AppEnv。
 */
export function loadAppEnv(): AppEnv {
  return {
    SUPABASE_URL: requireEnv('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    NOTION_API_KEY: requireEnv('NOTION_API_KEY'),
    NOTION_MAIN_DB_ID: requireEnv('NOTION_MAIN_DB_ID'),
    NOTION_BERRYFEEL_DB_ID: requireEnv('NOTION_BERRYFEEL_DB_ID'),
  };
}
