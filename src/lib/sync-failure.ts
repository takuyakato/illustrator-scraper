/**
 * sync_failures テーブルへの記録ヘルパー。
 *
 * すべての同期ジョブは、個別レコードの失敗をここに記録してから次のレコードに進む。
 * （throw して全体を止めない）
 */

import { logger } from './logger.js';
import { supabase } from './supabase.js';
import type { SyncOperation, SyncSource, SyncTarget } from './types.js';

export interface RecordSyncFailureParams {
  source: SyncSource;
  target: SyncTarget;
  record_id?: string | null;
  operation: SyncOperation;
  error_message: string;
}

/**
 * 同期失敗を 1 件記録する。
 * insert 自体が失敗した場合は logger で警告のみ出し、例外は握り潰す
 * （失敗ログ自体の失敗で同期ジョブ全体を止めない）。
 */
export async function recordSyncFailure(params: RecordSyncFailureParams): Promise<void> {
  try {
    const { error } = await supabase.from('sync_failures').insert({
      source: params.source,
      target: params.target,
      record_id: params.record_id ?? null,
      operation: params.operation,
      error_message: params.error_message.slice(0, 4000),
      retry_count: 0,
    });
    if (error) {
      logger.warn({ err: error, params }, 'sync_failures への記録に失敗');
    }
  } catch (e) {
    logger.warn({ err: e, params }, 'sync_failures への記録で例外');
  }
}
