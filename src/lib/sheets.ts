/**
 * Google Sheets API クライアント（同期ジョブ用）。
 *
 * - GOOGLE_SERVICE_ACCOUNT_JSON は JSON 文字列そのもの（GitHub Secrets 想定）
 * - サービスアカウントに対象スプレッドシートの編集権限を付与しておくこと
 * - スコープは spreadsheets のみ（Drive は不要）
 */

import { google, type sheets_v4 } from 'googleapis';

import { loadSyncEnv, requireGoogleEnv } from './env.js';

const env = loadSyncEnv();

/**
 * Sheets クライアントを初期化。
 * Sheets 関連ジョブから呼ぶ。環境変数未設定ならエラー終了。
 */
export function getSheetsClient(): sheets_v4.Sheets {
  requireGoogleEnv(env);
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** 対象スプレッドシート ID */
export const SHEET_ID = env.GOOGLE_SHEET_ID;

/**
 * 「候補プール!A15:N15」のような range 文字列から行番号を抽出。
 * append API の `updatedRange` レスポンスから Supabase に保存する sheet_row_index を得るための補助。
 */
export function parseRowIndex(updatedRange: string): number | null {
  // 例: "候補プール!A15:N15" → 15
  const m = updatedRange.match(/[!:]?[A-Z]+(\d+)(?::[A-Z]+\d+)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}
