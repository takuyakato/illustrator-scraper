/**
 * Supabase → Notion 同期ジョブ（10分おき）。
 *
 * 対象:
 *   is_illustrator = TRUE で (last_synced_to_notion_at IS NULL OR updated_at > last_synced_to_notion_at)
 *
 * 動作:
 *   - notion_page_id があれば既存ページを Supabase主導フィールドのみで update
 *   - notion_page_id が無ければ新規ページを作成し、作成後に Supabase に page_id を保存
 *   - 書き込み後、個別レコードの last_synced_to_notion_at = NOW() を更新
 *     （update_updated_at トリガーにより updated_at は進まず、ループしない）
 *
 * 実行: `tsx src/sync/supabase-to-notion.ts`
 */

import { loadSyncEnv } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { notion, sleep, NOTION_RATE_LIMIT_SLEEP_MS } from '../lib/notion.js';
import {
  buildAllProperties,
  buildSupabaseLedProperties,
  type NotionProperties,
} from '../lib/notion-properties.js';
import { withTransientRetry } from '../lib/retry.js';
import { supabase } from '../lib/supabase.js';
import { recordSyncFailure, resolveSyncFailure } from '../lib/sync-failure.js';
import type { IllustratorRow } from '../lib/types.js';

const env = loadSyncEnv();

export async function syncSupabaseToNotion(): Promise<{
  total: number;
  updated: number;
  created: number;
  failed: number;
}> {
  // 同期対象の抽出は VIEW illustrators_pending_to_notion に集約（migration 015）。
  // PostgREST の .or() はカラム同士の比較をサポートしないため、DB 側で畳み込む。
  const { data, error } = await supabase
    .from('illustrators_pending_to_notion')
    .select('*');

  if (error) {
    logger.error({ err: error }, 'Supabase→Notion: 対象取得失敗');
    throw error;
  }

  const rows = (data ?? []) as IllustratorRow[];
  logger.info({ count: rows.length }, 'Supabase→Notion 同期対象');

  let updated = 0;
  let created = 0;
  let failed = 0;

  for (const row of rows) {
    const operation = row.notion_page_id ? 'update' : 'insert';
    try {
      if (row.notion_page_id) {
        // 既存ページ：Supabase主導フィールドのみ送る
        await withTransientRetry(
          () => notion.pages.update({
            page_id: row.notion_page_id!,
            properties: buildSupabaseLedProperties(row) as NotionProperties as Parameters<
              typeof notion.pages.update
            >[0]['properties'],
          }),
          { label: `notion.pages.update id=${row.id}` },
        );
        updated += 1;
      } else {
        // 新規ページ：全プロパティを送る
        const page = await notion.pages.create({
          parent: { database_id: env.NOTION_MAIN_DB_ID },
          properties: buildAllProperties(row) as NotionProperties as Parameters<
            typeof notion.pages.create
          >[0]['properties'],
        });
        const { error: pageIdErr } = await supabase
          .from('illustrators')
          .update({ notion_page_id: page.id })
          .eq('id', row.id);
        if (pageIdErr) {
          throw new Error(`notion_page_id 保存失敗: ${pageIdErr.message}`);
        }
        created += 1;
      }

      // 同期完了タイムスタンプ（sync メタデータ単独 UPDATE なので updated_at は進まない）
      const { error: stampErr } = await supabase
        .from('illustrators')
        .update({ last_synced_to_notion_at: new Date().toISOString() })
        .eq('id', row.id);
      if (stampErr) {
        throw new Error(`last_synced_to_notion_at 更新失敗: ${stampErr.message}`);
      }

      await resolveSyncFailure({
        source: 'supabase',
        target: 'notion',
        record_id: row.id,
      });

      await sleep(NOTION_RATE_LIMIT_SLEEP_MS);
    } catch (e) {
      failed += 1;
      const msg = (e as Error).message ?? String(e);
      await recordSyncFailure({
        source: 'supabase',
        target: 'notion',
        record_id: row.id,
        operation,
        error_message: msg,
      });
      logger.error({ err: e, id: row.id, x_username: row.x_username }, 'Supabase→Notion 同期失敗');
    }
  }

  const summary = { total: rows.length, updated, created, failed };
  logger.info(summary, 'Supabase→Notion 同期完了');
  return summary;
}

// エントリポイント（tsx で直接実行された場合）
const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  syncSupabaseToNotion()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.fatal({ err: e }, 'Supabase→Notion 同期ジョブ全体失敗');
      process.exit(1);
    });
}
