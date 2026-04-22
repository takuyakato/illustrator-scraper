/**
 * 失敗通知ジョブ（1時間おき）。
 *
 * 未解決の sync_failures（resolved_at IS NULL）のうち、
 * 前回通知から24時間経過したものだけを Notion ログページに追記する。
 *
 * MVP では retry-failed.ts を実装しないため、retry_count 閾値での絞り込みはしない。
 * 代わりに last_notified_at（migration 014）で24時間重複を防ぐ。
 *
 * 0件なら Notion には何も書き込まない（追記レートを抑える）。
 */

import { logger } from '../lib/logger.js';
import { appendFailureLogToNotion } from '../lib/notion-sync-log.js';
import { supabase } from '../lib/supabase.js';

export async function notifyFailures(): Promise<{
  notified: number;
  skipped: number;
}> {
  const now = Date.now();
  const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // 未解決 かつ (未通知 OR 24時間以上前に通知) を対象にする
  const { data, error } = await supabase
    .from('sync_failures')
    .select('id, source, target, error_message, created_at, last_notified_at')
    .is('resolved_at', null)
    .or(`last_notified_at.is.null,last_notified_at.lt.${cutoff}`)
    .order('created_at', { ascending: false })
    .limit(500); // 安全上限：1回の通知で500件まで

  if (error) {
    logger.error({ err: error }, 'notify: sync_failures 取得失敗');
    throw error;
  }

  const failures = data ?? [];
  if (failures.length === 0) {
    logger.info('通知対象0件。スキップ');
    return { notified: 0, skipped: 0 };
  }

  logger.info({ count: failures.length }, 'Notion ログページに通知予定');

  // Notion に追記
  await appendFailureLogToNotion(
    failures.map((f) => ({
      source: f.source,
      target: f.target,
      error_message: f.error_message,
      created_at: f.created_at,
    })),
  );

  // 通知したレコードの last_notified_at を更新
  const ids = failures.map((f) => f.id);
  const { error: updErr } = await supabase
    .from('sync_failures')
    .update({ last_notified_at: new Date().toISOString() })
    .in('id', ids);
  if (updErr) {
    // 通知は成功しているので warn のみ（次回同じ失敗が再通知される可能性あり）
    logger.warn({ err: updErr, count: ids.length }, 'last_notified_at 更新失敗');
  }

  return { notified: failures.length, skipped: 0 };
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  notifyFailures()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.fatal({ err: e }, 'notify ジョブ全体失敗');
      process.exit(1);
    });
}
