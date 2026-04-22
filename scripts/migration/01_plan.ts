/**
 * マイグレーション事前チェックスクリプト。
 *
 * 実行内容:
 *   1. 環境変数の読み込み確認（欠損があれば loadAppEnv() で exit(1)）
 *   2. Notion の両 DB（メイン/Berryfeel）への疎通・件数確認
 *   3. Supabase illustrators テーブルの現状件数確認
 *   4. サマリーを表示して終了
 *
 * このスクリプトは書き込みを一切行わない（read-only）。
 */

import { logger } from './lib/logger.js';
import { loadAppEnv } from './lib/env.js';
import { notion, sleep, NOTION_RATE_LIMIT_SLEEP_MS } from './lib/notion-client.js';
import { supabase } from './lib/supabase-client.js';

async function main(): Promise<void> {
  logger.info('=== マイグレーション事前チェック開始 ===');

  // 1. 環境変数
  const env = loadAppEnv();
  logger.info(
    {
      SUPABASE_URL: env.SUPABASE_URL,
      NOTION_MAIN_DB_ID: env.NOTION_MAIN_DB_ID,
      NOTION_BERRYFEEL_DB_ID: env.NOTION_BERRYFEEL_DB_ID,
    },
    '環境変数: OK',
  );

  // 2. Notion 疎通 & 件数確認
  //    件数だけ知りたいので、最初のページを取得して has_more を見ながら簡易カウントする
  //    （正確な件数は 02 スクリプトで全件取得時に数える）
  let mainCount = 0;
  let mainCursor: string | undefined = undefined;
  do {
    const res = await notion.databases.query({
      database_id: env.NOTION_MAIN_DB_ID,
      start_cursor: mainCursor,
      page_size: 100,
    });
    mainCount += res.results.length;
    mainCursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    await sleep(NOTION_RATE_LIMIT_SLEEP_MS);
  } while (mainCursor);
  logger.info({ mainCount }, 'Notion メインDB 件数確認: OK');

  let bfCount = 0;
  let bfCursor: string | undefined = undefined;
  do {
    const res = await notion.databases.query({
      database_id: env.NOTION_BERRYFEEL_DB_ID,
      start_cursor: bfCursor,
      page_size: 100,
    });
    bfCount += res.results.length;
    bfCursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    await sleep(NOTION_RATE_LIMIT_SLEEP_MS);
  } while (bfCursor);
  logger.info({ bfCount }, 'Notion Berryfeel別DB 件数確認: OK');

  // 3. Supabase illustrators テーブル
  const { count: supabaseCount, error } = await supabase
    .from('illustrators')
    .select('*', { count: 'exact', head: true });

  if (error) {
    logger.error({ err: error.message }, 'Supabase 疎通に失敗しました');
    process.exit(1);
  }
  logger.info({ supabaseCount }, 'Supabase illustrators 件数: OK');

  // 4. サマリー
  logger.info('=== 事前チェック サマリー ===');
  logger.info(`Notion メインDB         : ${mainCount} 件`);
  logger.info(`Notion Berryfeel別DB    : ${bfCount} 件`);
  logger.info(`Supabase illustrators   : ${supabaseCount ?? 0} 件（現状）`);
  logger.info('=== 事前チェック完了 ===');
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, '事前チェックに失敗しました');
  process.exit(1);
});
