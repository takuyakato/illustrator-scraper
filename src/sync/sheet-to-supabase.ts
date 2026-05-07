/**
 * Google Sheets → Supabase 同期ジョブ（10分おき）。
 *
 * 処理フロー:
 *   1. 候補プール!A2:M 全行を取得（Sheets 側に変更検知機能がないため）
 *   2. M列が「未同期」かつ J/K/L のいずれかに入力がある行だけを処理
 *      - K列に仮ランク S/A/B/C → is_illustrator=true + rank を設定
 *      - J列に「イラストレーターじゃない」→ is_illustrator=false
 *      - L列のコメント → scout_comment
 *   3. Supabase UPDATE 後、M列を「同期済み」（失敗時は「同期失敗」）に一括書き戻し
 *
 * 運用ルール:
 *   スカウトが再判定する際は M 列を手動で「未同期」に戻す。
 *   （Google Sheets 側に変更検知がないため、この運用で代替する）
 */

import { logger } from '../lib/logger.js';
import {
  parseSheetRows,
  SYNC_STATUS_FAILED,
  SYNC_STATUS_SYNCED,
  SYNC_STATUS_UNSYNCED,
} from '../lib/sheet-converter.js';
import { getSheetsClient, SHEET_ID } from '../lib/sheets.js';
import { supabase } from '../lib/supabase.js';
import { recordSyncFailure, resolveSyncFailure } from '../lib/sync-failure.js';

const SHEET_TAB = '候補プール';
const VALID_RANKS = new Set(['S', 'A', 'B', 'C']);
const JUDGMENT_NOT_ILLUSTRATOR = 'イラストレーターじゃない';

export async function syncSheetToSupabase(): Promise<{
  totalRows: number;
  processed: number;
  skipped: number;
  failed: number;
}> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A2:M`,
  });
  const rawRows = res.data.values ?? [];
  const parsed = parseSheetRows(rawRows as string[][]);
  logger.info({ rawCount: rawRows.length, usable: parsed.length }, 'Sheet→Supabase 取得');

  const mColumnUpdates: Array<{ range: string; values: [[string]] }> = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of parsed) {
    const failureKey = `sheets:supabase:update:${p.xUsername}`;
    // 既に同期済みはスキップ（再判定時はユーザーが手動で「未同期」に戻す運用）
    if (p.syncStatus === SYNC_STATUS_SYNCED) {
      skipped += 1;
      continue;
    }
    // J/K/L すべて空ならスキップ（スカウト未入力）
    if (!p.judgment && !p.tentativeRank && !p.scoutComment) {
      skipped += 1;
      continue;
    }

    try {
      const { data: target, error: findErr } = await supabase
        .from('illustrators')
        .select('id')
        .eq('x_username', p.xUsername)
        .maybeSingle();
      if (findErr) throw findErr;

      if (!target) {
        await recordSyncFailure({
          source: 'sheets',
          target: 'supabase',
          operation: 'update',
          error_message: `x_username='${p.xUsername}' が Supabase に見つかりません（行 ${p.rowIndex}）`,
          failure_key: failureKey,
        });
        mColumnUpdates.push({
          range: `${SHEET_TAB}!M${p.rowIndex}`,
          values: [[SYNC_STATUS_FAILED]],
        });
        failed += 1;
        continue;
      }

      // 判定ロジック
      const patch: Record<string, unknown> = {
        scout_comment: p.scoutComment || null,
        last_synced_from_sheet_at: new Date().toISOString(),
      };
      if (p.judgment === JUDGMENT_NOT_ILLUSTRATOR) {
        patch.is_illustrator = false;
      } else if (VALID_RANKS.has(p.tentativeRank)) {
        patch.is_illustrator = true;
        patch.rank = p.tentativeRank;
      }
      // 両方空でコメントのみ → is_illustrator は NULL 維持、コメントだけ更新

      const { error: updErr } = await supabase
        .from('illustrators')
        .update(patch)
        .eq('id', target.id);
      if (updErr) throw updErr;
      await resolveSyncFailure({
        source: 'sheets',
        target: 'supabase',
        record_id: target.id,
      });
      await resolveSyncFailure({
        source: 'sheets',
        target: 'supabase',
        failure_key: failureKey,
      });

      mColumnUpdates.push({
        range: `${SHEET_TAB}!M${p.rowIndex}`,
        values: [[SYNC_STATUS_SYNCED]],
      });
      processed += 1;
    } catch (e) {
      failed += 1;
      const msg = (e as Error).message ?? String(e);
      await recordSyncFailure({
        source: 'sheets',
        target: 'supabase',
        operation: 'update',
        error_message: `行 ${p.rowIndex} (${p.xUsername}): ${msg}`,
        failure_key: failureKey,
      });
      mColumnUpdates.push({
        range: `${SHEET_TAB}!M${p.rowIndex}`,
        values: [[SYNC_STATUS_FAILED]],
      });
      logger.error({ err: e, rowIndex: p.rowIndex, x_username: p.xUsername }, 'Sheet→Supabase 個別失敗');
    }
  }

  // M列を一括書き戻し
  if (mColumnUpdates.length > 0) {
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: mColumnUpdates,
        },
      });
      logger.info({ count: mColumnUpdates.length }, 'Sheet M列 一括書き戻し完了');
    } catch (e) {
      logger.error({ err: e, count: mColumnUpdates.length }, 'Sheet M列 書き戻し失敗');
      await recordSyncFailure({
        source: 'sheets',
        target: 'supabase',
        operation: 'update',
        error_message: `M列一括更新失敗: ${(e as Error).message}`,
        failure_key: 'sheets:supabase:update:m-column-batch',
      });
    }
  }

  // 未同期の件数参照用にカウント
  const unsynced = parsed.filter((p) => p.syncStatus === SYNC_STATUS_UNSYNCED).length;
  const summary = {
    totalRows: rawRows.length,
    processed,
    skipped,
    failed,
  };
  logger.info({ ...summary, unsynced }, 'Sheet→Supabase 同期完了');
  return summary;
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  syncSheetToSupabase()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.fatal({ err: e }, 'Sheet→Supabase 同期ジョブ全体失敗');
      process.exit(1);
    });
}
