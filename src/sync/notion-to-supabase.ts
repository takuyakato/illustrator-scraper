/**
 * Notion → Supabase 同期ジョブ（10分おき・last_edited_time ポーリング）。
 *
 * 対象:
 *   - sync_state.notion_to_supabase.last_run_at 以降に Notion 側で編集されたページ
 *   - 未登録なら 2000-01-01 からフルスキャン（初回実行時の初期同期）
 *
 * 動作:
 *   - ページごとに Notion主導フィールドのみ Supabase に反映
 *   - Supabase 側に無いページ（Notion 新規作成）は INSERT
 *     （artist_name / x_username が空ならプレースホルダーで UNIQUE/NOT NULL を担保）
 *   - 全件処理後に sync_state の last_run_at を「ジョブ開始時刻」で更新
 *     （処理中に新しい編集があっても次回拾うために、完了時刻ではなく開始時刻を記録）
 *
 * 実行: `tsx src/sync/notion-to-supabase.ts`
 */

import { loadSyncEnv } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { queryAll } from '../lib/notion.js';
import {
  extractArtistName,
  extractNotionLedFields,
  extractXLink,
} from '../lib/notion-properties.js';
import { supabase } from '../lib/supabase.js';
import { isTransientApiError } from '../lib/retry.js';
import { recordSyncFailure, resolveSyncFailure } from '../lib/sync-failure.js';
import { getSyncStateLastRunAt, setSyncStateLastRunAt } from '../lib/sync-state.js';
import { normalizeXUrl } from '../lib/x-url-normalizer.js';

const env = loadSyncEnv();

/** Notion ページID からプレースホルダーの短いIDを生成（x_username, artist_name 補填用） */
function pageIdShort(pageId: string): string {
  return pageId.replace(/-/g, '').slice(0, 16);
}

export async function syncNotionPageToSupabase(page: Parameters<typeof extractNotionLedFields>[0]): Promise<
  'updated' | 'inserted'
> {
  const failureKey = `notion:supabase:update:page:${page.id}`;

  // 既存レコードを探す（notion_page_id で紐付け）
  const { data: existing, error: findErr } = await supabase
    .from('illustrators')
    .select('id')
    .eq('notion_page_id', page.id)
    .maybeSingle();
  if (findErr) throw findErr;

  const nowIso = new Date().toISOString();

  if (existing) {
    // 既存：Notion主導フィールドのみ更新
    const { error: updErr } = await supabase
      .from('illustrators')
      .update({
        ...extractNotionLedFields(page),
        last_synced_from_notion_at: nowIso,
      })
      .eq('id', existing.id);
    if (updErr) throw updErr;
    await resolveSyncFailure({
      source: 'notion',
      target: 'supabase',
      record_id: existing.id,
    });
    await resolveSyncFailure({
      source: 'notion',
      target: 'supabase',
      failure_key: failureKey,
    });
    return 'updated';
  }

  // Notion 側で新規作成されたページ → Supabase に INSERT
  const rawArtistName = extractArtistName(page);
  const xLink = extractXLink(page);
  const xUsername = normalizeXUrl(xLink);
  const short = pageIdShort(page.id);

  if (xUsername) {
    const { data: existingByUsername, error: usernameFindErr } = await supabase
      .from('illustrators')
      .select('id')
      .eq('x_username', xUsername)
      .maybeSingle();
    if (usernameFindErr) throw usernameFindErr;

    if (existingByUsername) {
      // notion_page_id 未紐付けだが x_username が一致する既存レコードがある場合は、
      // 重複 INSERT せず既存レコードへ Notion ページを紐付ける。
      const { error: linkErr } = await supabase
        .from('illustrators')
        .update({
          notion_page_id: page.id,
          ...extractNotionLedFields(page),
          last_synced_from_notion_at: nowIso,
        })
        .eq('id', existingByUsername.id);
      if (linkErr) throw linkErr;
      await resolveSyncFailure({
        source: 'notion',
        target: 'supabase',
        record_id: existingByUsername.id,
      });
      await resolveSyncFailure({
        source: 'notion',
        target: 'supabase',
        failure_key: failureKey,
      });
      return 'updated';
    }
  }

  const { data: insertedRow, error: insErr } = await supabase
    .from('illustrators')
    .insert({
      notion_page_id: page.id,
      artist_name: rawArtistName && rawArtistName.trim() !== ''
        ? rawArtistName
        : `(名無し-${short})`,
      x_link: xLink,
      x_username: xUsername ?? `(no-x-link-${short})`,
      is_illustrator: true,
      ...extractNotionLedFields(page),
      last_synced_from_notion_at: nowIso,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  await resolveSyncFailure({
    source: 'notion',
    target: 'supabase',
    record_id: insertedRow.id,
  });
  await resolveSyncFailure({
    source: 'notion',
    target: 'supabase',
    failure_key: failureKey,
  });
  return 'inserted';
}

export async function syncNotionToSupabase(): Promise<{
  total: number;
  updated: number;
  inserted: number;
  failed: number;
}> {
  const jobStartedAt = new Date().toISOString();
  const lastRunAt = await getSyncStateLastRunAt('notion_to_supabase');
  logger.info({ lastRunAt }, 'Notion→Supabase 開始');

  const pages = await queryAll({
    database_id: env.NOTION_MAIN_DB_ID,
    filter: {
      timestamp: 'last_edited_time',
      last_edited_time: { after: lastRunAt },
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
  });

  logger.info({ count: pages.length }, 'Notion→Supabase 同期対象');

  let updated = 0;
  let inserted = 0;
  let failed = 0;

  for (const page of pages) {
    const failureKey = `notion:supabase:update:page:${page.id}`;
    try {
      const result = await syncNotionPageToSupabase(page);
      if (result === 'updated') {
        updated += 1;
      } else {
        inserted += 1;
      }
    } catch (e) {
      failed += 1;
      const msg = (e as Error).message ?? String(e);
      await recordSyncFailure({
        source: 'notion',
        target: 'supabase',
        operation: 'update',
        error_message: `page_id=${page.id}: ${msg}`,
        failure_key: failureKey,
      });
      logger.error({ err: e, page_id: page.id }, 'Notion→Supabase 個別失敗');
    }
  }

  // 成功分を先へ進めるため、個別失敗があっても sync_state はジョブ開始時刻へ進める。
  // 失敗ページは sync_failures に残し、次回の全範囲再処理で全同期を詰まらせない。
  await setSyncStateLastRunAt('notion_to_supabase', jobStartedAt);
  if (failed > 0) {
    logger.warn({ failed }, 'Notion→Supabase: 個別失敗あり。sync_failures を確認してください');
  }

  const summary = { total: pages.length, updated, inserted, failed };
  logger.info(summary, 'Notion→Supabase 同期完了');
  return summary;
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  syncNotionToSupabase()
    .then(() => process.exit(0))
    .catch((e) => {
      if (isTransientApiError(e)) {
        logger.warn({ err: e }, 'Notion→Supabase は一過性APIエラーのため今回の実行をスキップします');
        process.exit(0);
      }
      logger.fatal({ err: e }, 'Notion→Supabase 同期ジョブ全体失敗');
      process.exit(1);
    });
}
