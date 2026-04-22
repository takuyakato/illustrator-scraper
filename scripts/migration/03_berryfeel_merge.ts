/**
 * Berryfeel 別DBをメインDBに統合するスクリプト。
 *
 * 03_マイグレーション手順.md Section 6.3 の擬似コードを実装。
 *
 * 処理フロー:
 *   1. Berryfeel 別DBから全レコード取得
 *   2. Supabase illustrators から全レコード取得
 *   3. 各 Berryfeel レコードについて、メール優先で突合
 *   4. 既存あり（ケースB）:
 *      - genres に 'Berryfeel' を追加（重複排除）
 *      - rank = 'S' で上書き
 *      - owner_confirmed_by に '北條' を追加（重複排除）
 *   5. 既存なし（ケースA）:
 *      - 新規レコードとして INSERT
 *      - rank='S', owner_confirmed_by=['北條'], genres=['Berryfeel']
 *      - is_illustrator=true
 *      - migration_snapshot に { source: 'berryfeel_db', original: ... }
 */

import { loadAppEnv } from './lib/env.js';
import { logger } from './lib/logger.js';
import { queryAll } from './lib/notion-client.js';
import { supabase } from './lib/supabase-client.js';
import { toBerryfeelRecord } from './lib/transform.js';
import type { Genre, IllustratorRecord, Owner } from './lib/types.js';

/** Supabase から取得した既存レコードの（必要項目だけの）表現 */
interface ExistingRec {
  id: string;
  artist_name: string | null;
  email: string | null;
  genres: Genre[] | null;
  owner_confirmed_by: Owner[] | null;
}

async function fetchExistingRecords(): Promise<ExistingRec[]> {
  // 件数が多い可能性があるのでページング（Supabase のデフォルト 1000件/ページ）
  const pageSize = 1000;
  const all: ExistingRec[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('illustrators')
      .select('id, artist_name, email, genres, owner_confirmed_by')
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`既存レコード取得に失敗: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    all.push(...(data as ExistingRec[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function main(): Promise<void> {
  const env = loadAppEnv();
  logger.info('=== Berryfeel 別DB 統合開始 ===');

  // 1. Berryfeel 別DB 取得
  const bfPages = await queryAll(env.NOTION_BERRYFEEL_DB_ID);
  const bfRecords = bfPages.map(toBerryfeelRecord);
  logger.info({ count: bfRecords.length }, 'Berryfeel 別DB 取得完了');

  // 2. Supabase 既存レコード取得
  const existing = await fetchExistingRecords();
  logger.info({ count: existing.length }, 'Supabase 既存レコード取得完了');

  let updatedCount = 0; // ケースB
  let insertedCount = 0; // ケースA
  let errorCount = 0;
  const errorDetails: Array<{ pageId: string; error: string }> = [];

  // 3. 各 Berryfeel レコードを処理
  for (const bf of bfRecords) {
    try {
      // メール優先、次に名前一致
      const byEmail = bf.email
        ? existing.find((r) => r.email !== null && r.email === bf.email)
        : undefined;
      const byName = bf.artistName
        ? existing.find((r) => r.artist_name === bf.artistName)
        : undefined;
      const matched = byEmail ?? byName;

      if (matched) {
        // --- ケースB: 既存レコードに対して上書き/追加 ---
        const genresSet = new Set<Genre>(matched.genres ?? []);
        genresSet.add('Berryfeel');
        const ownersSet = new Set<Owner>(matched.owner_confirmed_by ?? []);
        ownersSet.add('北條');

        const { error } = await supabase
          .from('illustrators')
          .update({
            genres: Array.from(genresSet),
            rank: 'S',
            owner_confirmed_by: Array.from(ownersSet),
          })
          .eq('id', matched.id);

        if (error) {
          errorCount += 1;
          errorDetails.push({ pageId: bf.pageId, error: error.message });
          logger.error(
            { pageId: bf.pageId, recordId: matched.id, err: error.message },
            'ケースB UPDATE 失敗',
          );
        } else {
          updatedCount += 1;
          logger.debug({ pageId: bf.pageId, recordId: matched.id }, 'ケースB 更新完了');
        }
      } else {
        // --- ケースA: 新規 INSERT ---
        // artist_name の CHECK 制約を守るため、名前が空なら
        // 「(名無し-XXXXXXXX)」プレースホルダーを使う（main DB と同じ方針）
        const artistName =
          bf.artistName && bf.artistName.trim() !== ''
            ? bf.artistName
            : `(名無し-${bf.pageId.replace(/-/g, '').slice(0, 8)})`;

        const record: IllustratorRecord = {
          notion_page_id: bf.pageId,
          artist_name: artistName,
          master_status: '候補',
          rank: 'S',
          owner_confirmed_by: ['北條'],
          style_tags: [],
          genres: ['Berryfeel'],
          x_link: null,
          x_username: null,
          pixiv_link: null,
          portfolio_link: null,
          other_contact: null,
          email: bf.email,
          credit_name: null,
          contacted_at: null,
          contacted_by: [],
          note: '',
          is_illustrator: true,

          // Legacy は全て空
          legacy_status: null,
          legacy_status_1: null,
          legacy_contact_status: null,
          legacy_capuri_berryfeel_search: [],
          legacy_mimura_comment: null,
          legacy_hojo_comment: null,
          legacy_mimura_points: null,
          legacy_hojo_points: null,
          legacy_found_date: null,
          legacy_found_by: null,
          legacy_start_date: null,
          legacy_end_date: null,
          legacy_capuri_request_id: null,
          legacy_mail_alt: null,
          legacy_recontact_time: null,
          legacy_rejection_reason: [],

          migration_snapshot: {
            source: 'berryfeel_db',
            original: bf.raw,
          },
        };

        const { error } = await supabase.from('illustrators').insert(record);
        if (error) {
          errorCount += 1;
          errorDetails.push({ pageId: bf.pageId, error: error.message });
          logger.error(
            { pageId: bf.pageId, err: error.message },
            'ケースA INSERT 失敗',
          );
        } else {
          insertedCount += 1;
          logger.debug({ pageId: bf.pageId }, 'ケースA 新規登録完了');
        }
      }
    } catch (e) {
      errorCount += 1;
      const msg = e instanceof Error ? e.message : String(e);
      errorDetails.push({ pageId: bf.pageId, error: msg });
      logger.error({ pageId: bf.pageId, err: msg }, 'Berryfeel レコード処理で例外');
    }
  }

  // 4. サマリー
  logger.info('=== Berryfeel 統合 サマリー ===');
  logger.info(`取得件数（Berryfeel）   : ${bfRecords.length}`);
  logger.info(`ケースB（既存に統合）  : ${updatedCount}`);
  logger.info(`ケースA（新規登録）    : ${insertedCount}`);
  logger.info(`エラー                 : ${errorCount}`);

  if (errorDetails.length > 0) {
    logger.error({ errorDetails }, 'エラー詳細');
  }

  if (errorCount > 0) {
    process.exit(1);
  }

  logger.info('=== Berryfeel 統合 完了 ===');
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, 'Berryfeel 統合が異常終了しました');
  process.exit(1);
});
