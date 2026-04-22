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
import { mapBerryfeelStatus } from './lib/status-mapper.js';
import { supabase } from './lib/supabase-client.js';
import { toBerryfeelRecord } from './lib/transform.js';
import type {
  Genre,
  IllustratorRecord,
  MasterStatus,
  Owner,
} from './lib/types.js';

/** Supabase から取得した既存レコードの（必要項目だけの）表現 */
interface ExistingRec {
  id: string;
  artist_name: string | null;
  email: string | null;
  genres: Genre[] | null;
  owner_confirmed_by: Owner[] | null;
  note: string | null;
  legacy_recontact_time: string | null;
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
      .select('id, artist_name, email, genres, owner_confirmed_by, note, legacy_recontact_time')
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

/**
 * Berryfeel の備考を既存 note に追記する（空行で区切る）。
 * 既存 note が空なら Berryfeel 備考だけを入れる。
 */
function mergeNote(existingNote: string | null, berryfeelNote: string | null): string {
  if (!berryfeelNote || berryfeelNote.trim() === '') {
    return existingNote ?? '';
  }
  const tagged = `[Berryfeel統合] ${berryfeelNote.trim()}`;
  if (!existingNote || existingNote.trim() === '') {
    return tagged;
  }
  return `${existingNote}\n${tagged}`;
}

/**
 * Berryfeel の再連絡時期を既存 legacy_recontact_time にマージする。
 * 既存があれば維持、空なら Berryfeel の値を入れる。
 */
function mergeRecontactTime(
  existing: string | null,
  bfRecontact: string | null,
): string | null {
  if (existing && existing.trim() !== '') return existing;
  if (bfRecontact && bfRecontact.trim() !== '') return bfRecontact.trim();
  return null;
}

/**
 * 名前マッチ用の正規化。
 * 「様」「先生」末尾除去、括弧内（別名）除去、空白除去。
 * 例: 「よしざわ未菜子様（Gabu様）」→「よしざわ未菜子」
 *     「香月作様」→「香月作」、「MATOBA様」→「MATOBA」
 */
function normalizeArtistName(name: string | null): string | null {
  if (!name) return null;
  const n = name
    .replace(/[（(][^）)]*[）)]/g, '') // 括弧内除去（全角・半角両対応）
    .replace(/(様|先生|さん|氏)\s*$/, '') // 敬称末尾除去
    .replace(/\s+/g, '') // 内部空白除去
    .trim();
  return n === '' ? null : n;
}

/**
 * 括弧内の別名を取り出す（「よしざわ未菜子様（Gabu様）」→「Gabu」）。
 * 括弧がなければ null。
 */
function extractParentheticalName(name: string | null): string | null {
  if (!name) return null;
  const m = name.match(/[（(]([^）)]*)[）)]/);
  if (!m) return null;
  return normalizeArtistName(m[1]);
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
  const matchStats = {
    byEmail: 0,
    byExactName: 0,
    byNormalizedName: 0,
    byParentheticalName: 0,
    noMatch: 0,
  };

  // 3. 各 Berryfeel レコードを処理
  for (const bf of bfRecords) {
    try {
      // 突合戦略（優先度順）:
      //   1. メール完全一致
      //   2. 名前完全一致
      //   3. 名前正規化一致（「様」除去・括弧内除去）
      //   4. 括弧内の別名一致（「よしざわ未菜子様（Gabu様）」→「Gabu」で探す）
      const byEmail = bf.email
        ? existing.find((r) => r.email !== null && r.email === bf.email)
        : undefined;

      const bfNameOrig = bf.artistName;
      const bfNameNorm = normalizeArtistName(bfNameOrig);
      const bfNameParen = extractParentheticalName(bfNameOrig);

      const byExactName = bfNameOrig
        ? existing.find((r) => r.artist_name === bfNameOrig)
        : undefined;

      const byNormalizedName = bfNameNorm
        ? existing.find((r) => normalizeArtistName(r.artist_name) === bfNameNorm)
        : undefined;

      const byParentheticalName = bfNameParen
        ? existing.find((r) => normalizeArtistName(r.artist_name) === bfNameParen)
        : undefined;

      const matched = byEmail ?? byExactName ?? byNormalizedName ?? byParentheticalName;

      // 統計
      if (byEmail) matchStats.byEmail += 1;
      else if (byExactName) matchStats.byExactName += 1;
      else if (byNormalizedName) matchStats.byNormalizedName += 1;
      else if (byParentheticalName) matchStats.byParentheticalName += 1;
      else matchStats.noMatch += 1;

      if (matched) {
        // --- ケースB: 既存レコードに対して上書き/追加 ---
        const genresSet = new Set<Genre>(matched.genres ?? []);
        genresSet.add('Berryfeel');
        const ownersSet = new Set<Owner>(matched.owner_confirmed_by ?? []);
        ownersSet.add('北條');

        // Berryfeel の運用情報をマージ
        const mergedNote = mergeNote(matched.note, bf.note);
        const mergedRecontact = mergeRecontactTime(matched.legacy_recontact_time, bf.recontactTime);

        // Berryfeel のステータスを master_status に反映
        // （合意事項 v2.1：BerryFeel統合レコードは依頼可能プールに直接乗せる想定）
        // ただし Berryfeel 側が「依頼不可」等の明確な終了状態なら、それを尊重する
        const bfMasterStatus: MasterStatus | null = bf.status ? mapBerryfeelStatus(bf.status) : null;

        const updatePayload: {
          genres: Genre[];
          rank: 'S';
          owner_confirmed_by: Owner[];
          note: string;
          legacy_recontact_time: string | null;
          master_status?: MasterStatus;
        } = {
          genres: Array.from(genresSet),
          rank: 'S',
          owner_confirmed_by: Array.from(ownersSet),
          note: mergedNote,
          legacy_recontact_time: mergedRecontact,
        };

        // 依頼不可・多忙辞退・返信なし等の明確なネガティブステータスのみ反映
        // （候補・連絡中 等はメインDB側の判定を優先）
        if (
          bfMasterStatus === '依頼不可' ||
          bfMasterStatus === '多忙辞退' ||
          bfMasterStatus === '返信なし'
        ) {
          updatePayload.master_status = bfMasterStatus;
        }

        const { error } = await supabase
          .from('illustrators')
          .update(updatePayload)
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
        // 「(名無し-XXXXXXXXXXXXXXXX)」プレースホルダーを使う（main DB と同じ方針）
        const pageIdShort = bf.pageId.replace(/-/g, '').slice(0, 16);
        const artistName =
          bf.artistName && bf.artistName.trim() !== ''
            ? bf.artistName
            : `(名無し-${pageIdShort})`;

        // Berryfeel 別DB には Xリンクプロパティがないので x_username は必ずダミー値
        // NOT NULL + UNIQUE 制約を満たすため「(no-x-link-XXXXXXXXXXXXXXXX)」を入れる
        const xUsernamePlaceholder = `(no-x-link-${pageIdShort})`;

        // Berryfeelステータスを master_status に変換（なければ候補）
        const masterStatus: MasterStatus = bf.status ? mapBerryfeelStatus(bf.status) : '候補';

        // Berryfeel備考を note に設定（空なら空文字）
        const noteValue = bf.note && bf.note.trim() !== '' ? `[Berryfeel統合] ${bf.note.trim()}` : '';

        const record: IllustratorRecord = {
          notion_page_id: bf.pageId,
          artist_name: artistName,
          master_status: masterStatus,
          rank: 'S',
          owner_confirmed_by: ['北條'],
          style_tags: [],
          genres: ['Berryfeel'],
          x_link: null,
          x_username: xUsernamePlaceholder,
          pixiv_link: null,
          portfolio_link: null,
          other_contact: null,
          email: bf.email,
          credit_name: null,
          contacted_at: null,
          contacted_by: [],
          note: noteValue,
          is_illustrator: true,

          // Legacy：Berryfeel 固有情報を反映
          legacy_status: null,
          legacy_status_1: null,
          legacy_contact_status: bf.status, // Berryfeel 側の原値を退避
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
          legacy_recontact_time: bf.recontactTime,
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
  logger.info(`取得件数（Berryfeel）        : ${bfRecords.length}`);
  logger.info(`ケースB（既存に統合）        : ${updatedCount}`);
  logger.info(`ケースA（新規登録）          : ${insertedCount}`);
  logger.info(`エラー                       : ${errorCount}`);
  logger.info('--- マッチ内訳 ---');
  logger.info(`  メール一致                  : ${matchStats.byEmail}`);
  logger.info(`  名前完全一致                : ${matchStats.byExactName}`);
  logger.info(`  名前正規化一致              : ${matchStats.byNormalizedName}`);
  logger.info(`  括弧内別名一致              : ${matchStats.byParentheticalName}`);
  logger.info(`  マッチなし（ケースA扱い）   : ${matchStats.noMatch}`);

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
