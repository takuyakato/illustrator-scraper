/**
 * sync_state テーブルへの読み書きヘルパー。
 *
 * ジョブ単位の「最終成功時刻」を保存する用途。
 * Notion→Supabase のポーリングで「どこから取り込むか」の起点に使う。
 *
 * テーブル定義（migration 013 で追加予定）:
 *   CREATE TABLE sync_state (
 *     job_name    TEXT PRIMARY KEY,
 *     last_run_at TIMESTAMPTZ NOT NULL,
 *     updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 */

import { logger } from './logger.js';
import { supabase } from './supabase.js';
import type { SyncJobName } from './types.js';

/** Notion→Supabase の初回実行時の起点（あまり古すぎない、かつ確実に全件を拾える時刻） */
const DEFAULT_LAST_RUN_AT = '2000-01-01T00:00:00Z';

/**
 * ジョブの最終成功時刻を取得。未登録なら `2000-01-01T00:00:00Z` を返す。
 */
export async function getSyncStateLastRunAt(jobName: SyncJobName): Promise<string> {
  const { data, error } = await supabase
    .from('sync_state')
    .select('last_run_at')
    .eq('job_name', jobName)
    .maybeSingle();

  if (error) {
    logger.warn({ err: error, jobName }, 'sync_state 取得失敗 → デフォルト値を返す');
    return DEFAULT_LAST_RUN_AT;
  }
  return data?.last_run_at ?? DEFAULT_LAST_RUN_AT;
}

/**
 * ジョブの最終成功時刻を UPSERT する。
 * `last_run_at` はジョブ開始時刻を渡すのが一般的（取り込み漏れを防ぐため）。
 */
export async function setSyncStateLastRunAt(
  jobName: SyncJobName,
  lastRunAt: string,
): Promise<void> {
  const { error } = await supabase
    .from('sync_state')
    .upsert(
      { job_name: jobName, last_run_at: lastRunAt, updated_at: new Date().toISOString() },
      { onConflict: 'job_name' },
    );
  if (error) {
    logger.warn({ err: error, jobName, lastRunAt }, 'sync_state 更新失敗');
    throw error;
  }
}
