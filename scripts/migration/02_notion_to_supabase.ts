/**
 * メインマイグレーションスクリプト（Notion → Supabase）。
 *
 * 03_マイグレーション手順.md v1.1 Section 7.2 の擬似コードを実装。
 *
 * 処理フロー:
 *   1. Notion メインDBから全レコードを取得（ページネーション対応）
 *   2. 各レコードを IllustratorRecord に変換
 *      - 変換エラーはレコード単位でスキップし、全体処理は継続
 *   3. 500件ずつ Supabase illustrators にバルクインサート
 *
 * オプション:
 *   --dry-run
 *     Supabase への書き込みを行わない。最初の 10 件だけ変換し、
 *     結果を標準出力に表示する。
 */

import { loadAppEnv } from './lib/env.js';
import { logger } from './lib/logger.js';
import { queryAll } from './lib/notion-client.js';
import { supabase } from './lib/supabase-client.js';
import { transformMainDbPage } from './lib/transform.js';
import type { IllustratorRecord } from './lib/types.js';

const CHUNK_SIZE = 500;
const DRY_RUN_SAMPLE_SIZE = 10;

/** コマンドライン引数 --dry-run の検出 */
function isDryRun(): boolean {
  return process.argv.includes('--dry-run');
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const env = loadAppEnv();

  logger.info({ dryRun }, '=== マイグレーション開始（Notion → Supabase）===');

  // 1. Notion から全レコード取得
  logger.info({ dbId: env.NOTION_MAIN_DB_ID }, 'Notion メインDBから全レコード取得中…');
  const pages = await queryAll(env.NOTION_MAIN_DB_ID);
  logger.info({ count: pages.length }, 'Notion 取得完了');

  // 2. 変換（ドライラン時は先頭 N 件だけ）
  const targetPages = dryRun ? pages.slice(0, DRY_RUN_SAMPLE_SIZE) : pages;

  const records: IllustratorRecord[] = [];
  let skipped = 0;
  const skipReasons: Array<{ pageId: string; error: string }> = [];

  for (const page of targetPages) {
    try {
      const rec = transformMainDbPage(page);
      records.push(rec);
    } catch (e) {
      skipped += 1;
      const msg = e instanceof Error ? e.message : String(e);
      skipReasons.push({ pageId: page.id, error: msg });
      logger.warn({ pageId: page.id, err: msg }, '変換失敗：このレコードはスキップします');
    }
  }

  logger.info(
    { transformed: records.length, skipped },
    '変換完了',
  );

  // 3. ドライランなら標準出力にサンプル表示して終了
  if (dryRun) {
    logger.info('--- dry-run: サンプル出力（先頭 10 件まで）---');
    for (const rec of records) {
      // 情報量が多すぎるので migration_snapshot は概要だけにする
      const { migration_snapshot: _snap, ...displayable } = rec;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(displayable, null, 2));
    }
    logger.info('--- dry-run: 書き込みは行いませんでした ---');
    logger.info({ transformed: records.length, skipped }, 'dry-run サマリー');
    return;
  }

  // 4. Supabase へバルクインサート
  let inserted = 0;
  let failed = 0;
  const failedChunks: Array<{ start: number; end: number; error: string }> = [];

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const start = i;
    const end = i + chunk.length;

    logger.info({ start, end, total: records.length }, `インサート中: ${end}/${records.length}`);

    const { error } = await supabase.from('illustrators').insert(chunk);
    if (error) {
      failed += chunk.length;
      failedChunks.push({ start, end, error: error.message });
      logger.error(
        { start, end, err: error.message },
        'チャンクの INSERT に失敗しました（次のチャンクへ進みます）',
      );
    } else {
      inserted += chunk.length;
    }
  }

  // 5. サマリー
  logger.info('=== マイグレーション サマリー ===');
  logger.info(`取得件数         : ${pages.length}`);
  logger.info(`変換成功         : ${records.length}`);
  logger.info(`変換スキップ     : ${skipped}`);
  logger.info(`INSERT 成功      : ${inserted}`);
  logger.info(`INSERT 失敗      : ${failed}`);

  if (skipReasons.length > 0) {
    logger.warn({ skipReasons }, '変換スキップの詳細');
  }
  if (failedChunks.length > 0) {
    logger.error({ failedChunks }, 'INSERT 失敗したチャンクの詳細');
  }

  if (failed > 0) {
    logger.error('INSERT に失敗したレコードがあります。ログを確認してください。');
    process.exit(1);
  }

  logger.info('=== マイグレーション完了 ===');
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, 'マイグレーションが異常終了しました');
  process.exit(1);
});
