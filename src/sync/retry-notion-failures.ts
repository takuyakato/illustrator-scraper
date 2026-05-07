/**
 * Notion → Supabase の未解決失敗を page_id 単位で再処理する復旧ジョブ。
 *
 * 通常の notion-to-supabase は Notion last_edited_time のカーソル方式なので、
 * 古いページに残った失敗ログはカーソルを少し戻すだけでは再処理されないことがある。
 * このジョブは sync_failures.failure_key から page_id を拾い、該当ページだけを直接再同期する。
 */

import { isFullPage, notion, NOTION_RATE_LIMIT_SLEEP_MS, sleep } from '../lib/notion.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { recordSyncFailure } from '../lib/sync-failure.js';
import { syncNotionPageToSupabase } from './notion-to-supabase.js';

const PAGE_FAILURE_PREFIX = 'notion:supabase:update:page:';

interface FailureRow {
  id: string;
  failure_key: string;
}

function pageIdFromFailureKey(failureKey: string): string | null {
  if (!failureKey.startsWith(PAGE_FAILURE_PREFIX)) return null;
  const pageId = failureKey.slice(PAGE_FAILURE_PREFIX.length);
  return pageId.length > 0 ? pageId : null;
}

export async function retryNotionFailures(): Promise<{
  total: number;
  updated: number;
  inserted: number;
  skipped: number;
  failed: number;
}> {
  const { data, error } = await supabase
    .from('sync_failures')
    .select('id, failure_key')
    .eq('source', 'notion')
    .eq('target', 'supabase')
    .eq('operation', 'update')
    .is('resolved_at', null)
    .like('failure_key', `${PAGE_FAILURE_PREFIX}%`)
    .order('last_seen_at', { ascending: false })
    .limit(200);

  if (error) {
    logger.error({ err: error }, 'Notion失敗リトライ: 対象取得失敗');
    throw error;
  }

  const failures = (data ?? []) as FailureRow[];
  const pageIds = Array.from(
    new Set(failures.map((f) => pageIdFromFailureKey(f.failure_key)).filter((id): id is string => Boolean(id))),
  );
  logger.info({ count: pageIds.length }, 'Notion失敗リトライ対象');

  let updated = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const pageId of pageIds) {
    const failureKey = `${PAGE_FAILURE_PREFIX}${pageId}`;
    try {
      const page = await notion.pages.retrieve({ page_id: pageId });
      if (!isFullPage(page)) {
        skipped += 1;
        logger.warn({ pageId }, 'Notion失敗リトライ: full page ではないためスキップ');
        continue;
      }

      const result = await syncNotionPageToSupabase(page);
      if (result === 'updated') updated += 1;
      else inserted += 1;

      await sleep(NOTION_RATE_LIMIT_SLEEP_MS);
    } catch (e) {
      failed += 1;
      const msg = (e as Error).message ?? String(e);
      await recordSyncFailure({
        source: 'notion',
        target: 'supabase',
        operation: 'update',
        error_message: `page_id=${pageId}: ${msg}`,
        failure_key: failureKey,
      });
      logger.error({ err: e, pageId }, 'Notion失敗リトライ: 個別失敗');
    }
  }

  const summary = { total: pageIds.length, updated, inserted, skipped, failed };
  logger.info(summary, 'Notion失敗リトライ完了');
  return summary;
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  retryNotionFailures()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.fatal({ err: e }, 'Notion失敗リトライジョブ全体失敗');
      process.exit(1);
    });
}
