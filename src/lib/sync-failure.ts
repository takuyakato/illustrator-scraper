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
  failure_key?: string;
}

export interface ResolveSyncFailureParams {
  source: SyncSource;
  target: SyncTarget;
  record_id?: string | null;
  operation?: SyncOperation;
  failure_key?: string;
}

function buildFailureKey(params: {
  source: SyncSource;
  target: SyncTarget;
  operation?: SyncOperation;
  record_id?: string | null;
  failure_key?: string;
}): string {
  if (params.failure_key) return params.failure_key;
  const operation = params.operation ?? 'any';
  const record = params.record_id ?? 'no-record';
  return `${params.source}:${params.target}:${operation}:${record}`;
}

/**
 * 同期失敗を記録する。
 *
 * 未解決の同一 failure_key があれば新規行を増やさず、既存行の発生回数と最終発生時刻を更新する。
 * insert 自体が失敗した場合は logger で警告のみ出し、例外は握り潰す
 * （失敗ログ自体の失敗で同期ジョブ全体を止めない）。
 */
export async function recordSyncFailure(params: RecordSyncFailureParams): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const errorMessage = params.error_message.slice(0, 4000);
    const failureKey = buildFailureKey(params);

    const { data: existing, error: findErr } = await supabase
      .from('sync_failures')
      .select('id, retry_count, occurrence_count')
      .eq('failure_key', failureKey)
      .is('resolved_at', null)
      .maybeSingle();
    if (findErr) {
      logger.warn({ err: findErr, params, failureKey }, 'sync_failures の既存失敗取得に失敗');
    }

    if (existing) {
      const { error } = await supabase
        .from('sync_failures')
        .update({
          error_message: errorMessage,
          retry_count: Math.min((existing.retry_count ?? 0) + 1, 10),
          occurrence_count: (existing.occurrence_count ?? 1) + 1,
          last_seen_at: nowIso,
        })
        .eq('id', existing.id);
      if (error) {
        logger.warn({ err: error, params, failureKey }, 'sync_failures の既存失敗更新に失敗');
      }
      return;
    }

    const { error } = await supabase.from('sync_failures').insert({
      source: params.source,
      target: params.target,
      record_id: params.record_id ?? null,
      operation: params.operation,
      error_message: errorMessage,
      retry_count: 0,
      failure_key: failureKey,
      occurrence_count: 1,
      last_seen_at: nowIso,
    });
    if (error) {
      logger.warn({ err: error, params, failureKey }, 'sync_failures への記録に失敗');
    }
  } catch (e) {
    logger.warn({ err: e, params }, 'sync_failures への記録で例外');
  }
}

/**
 * 成功した同期に対応する未解決失敗を解決済みにする。
 *
 * 失敗解決の記録に失敗しても、本来の同期成功は取り消さない。
 */
export async function resolveSyncFailure(params: ResolveSyncFailureParams): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    let query = supabase
      .from('sync_failures')
      .update({ resolved_at: nowIso })
      .eq('source', params.source)
      .eq('target', params.target)
      .is('resolved_at', null);

    if (params.failure_key) {
      query = query.eq('failure_key', params.failure_key);
    } else {
      query = params.record_id ? query.eq('record_id', params.record_id) : query.is('record_id', null);
      if (params.operation) query = query.eq('operation', params.operation);
    }

    const { error } = await query;
    if (error) {
      logger.warn({ err: error, params }, 'sync_failures の解決済み更新に失敗');
    }
  } catch (e) {
    logger.warn({ err: e, params }, 'sync_failures の解決済み更新で例外');
  }
}
