/**
 * Notion クリーンアップスクリプト（マイグレーション後の書き戻し）。
 *
 * 03_マイグレーション手順.md Step 10-1 に対応。
 *
 * 処理内容:
 *   1. Supabase から (notion_page_id, master_status, contacted_by) を全件取得
 *   2. 各 Notion ページに対して以下を更新:
 *      - 「マスターステータス」（status 型）: 新値に書き戻し
 *      - 「連絡した人_new」（multi_select）: contacted_by の値を配列で書き戻し
 *      - 「オーナー確認」（multi_select）: 空配列で初期化
 *   3. レコード単位のエラーはスキップして全体は継続
 *
 * 注意:
 *   - 「連絡した人_new」「オーナー確認」「マスターステータス」は、
 *     Step 1-A / 1-B で Notion 側に事前追加されている前提。
 *   - status 型の選択肢が事前に Notion に登録されていないと 400 エラーになる。
 */

import { logger } from './lib/logger.js';
import { updatePageProperties } from './lib/notion-client.js';
import { supabase } from './lib/supabase-client.js';
import type { MasterStatus } from './lib/types.js';

/** Supabase から取得したクリーンアップ対象レコード */
interface CleanupTarget {
  id: string;
  notion_page_id: string;
  master_status: MasterStatus;
  contacted_by: string[] | null;
  owner_confirmed_by: string[] | null;
}

async function fetchCleanupTargets(): Promise<CleanupTarget[]> {
  const pageSize = 1000;
  const all: CleanupTarget[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('illustrators')
      .select('id, notion_page_id, master_status, contacted_by, owner_confirmed_by')
      .not('notion_page_id', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`クリーンアップ対象取得に失敗: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as CleanupTarget[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function main(): Promise<void> {
  logger.info('=== Notion クリーンアップ開始 ===');

  const targets = await fetchCleanupTargets();
  logger.info({ count: targets.length }, 'クリーンアップ対象取得完了');

  let successCount = 0;
  let errorCount = 0;
  const errorDetails: Array<{ recordId: string; pageId: string; error: string }> = [];

  for (const t of targets) {
    try {
      // 「連絡した人_new」は multi_select 型。Supabase の配列をそのまま name 配列に変換。
      const contactedByOptions = (t.contacted_by ?? []).map((name) => ({ name }));

      // 「オーナー確認」は運用で空配列初期化（全員要確認扱い）
      const ownerConfirmedOptions: Array<{ name: string }> = [];

      await updatePageProperties(t.notion_page_id, {
        マスターステータス: {
          status: { name: t.master_status },
        },
        連絡した人_new: {
          multi_select: contactedByOptions,
        },
        オーナー確認: {
          multi_select: ownerConfirmedOptions,
        },
      });
      successCount += 1;

      if (successCount % 50 === 0) {
        logger.info({ processed: successCount, total: targets.length }, '進捗');
      }
    } catch (e) {
      errorCount += 1;
      const msg = e instanceof Error ? e.message : String(e);
      errorDetails.push({ recordId: t.id, pageId: t.notion_page_id, error: msg });
      logger.warn(
        { recordId: t.id, pageId: t.notion_page_id, err: msg },
        'Notion 書き戻し失敗：このレコードはスキップします',
      );
    }
  }

  // サマリー
  logger.info('=== Notion クリーンアップ サマリー ===');
  logger.info(`対象件数    : ${targets.length}`);
  logger.info(`成功        : ${successCount}`);
  logger.info(`失敗        : ${errorCount}`);

  if (errorDetails.length > 0) {
    logger.warn({ errorDetails }, 'エラー詳細');
  }

  if (errorCount > 0) {
    // エラーあり。exit(1) で知らせるが、処理自体は完了している
    process.exit(1);
  }

  logger.info('=== Notion クリーンアップ 完了 ===');
}

main().catch((e) => {
  logger.error(
    { err: e instanceof Error ? e.message : String(e) },
    'Notion クリーンアップが異常終了しました',
  );
  process.exit(1);
});
