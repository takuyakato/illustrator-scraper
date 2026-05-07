/**
 * Supabase → Google Sheets 同期ジョブ（10分おき）。
 *
 * 対象:
 *   is_illustrator IS NULL かつ
 *   (last_synced_to_sheet_at IS NULL OR updated_at > last_synced_to_sheet_at)
 *
 * 動作:
 *   - sheet_row_index があれば既存行の A〜I 列のみを更新（J〜L のスカウト入力を保護）
 *   - sheet_row_index が無ければ APPEND で新規行を追加、返ってきた行番号を保存
 *   - 書き込み後、last_synced_to_sheet_at を単独 UPDATE
 *     （update_updated_at トリガーにより updated_at は進まず、ループしない）
 *
 * 注意: Phase 2 時点では is_illustrator IS NULL のレコードはほぼ存在しない
 * （Phase 3 のスクレイパーが稼働してから流入）。本ジョブは空運転が標準。
 */

import { logger } from '../lib/logger.js';
import { getSheetsClient, SHEET_ID, parseRowIndex } from '../lib/sheets.js';
import { rowToSheetA2I, rowToSheetFull } from '../lib/sheet-converter.js';
import { supabase } from '../lib/supabase.js';
import { recordSyncFailure, resolveSyncFailure } from '../lib/sync-failure.js';
import type { IllustratorRow } from '../lib/types.js';

const SHEET_TAB = '候補プール';

export async function syncSupabaseToSheet(): Promise<{
  total: number;
  updated: number;
  appended: number;
  failed: number;
}> {
  const sheets = getSheetsClient();

  // 同期対象の抽出は VIEW illustrators_pending_to_sheet に集約（migration 015）。
  const { data, error } = await supabase
    .from('illustrators_pending_to_sheet')
    .select('*')
    .order('first_detected_at', { ascending: false });

  if (error) {
    logger.error({ err: error }, 'Supabase→Sheet: 対象取得失敗');
    throw error;
  }

  const rows = (data ?? []) as IllustratorRow[];
  logger.info({ count: rows.length }, 'Supabase→Sheet 同期対象');

  let updated = 0;
  let appended = 0;
  let failed = 0;

  for (const row of rows) {
    const operation = row.sheet_row_index ? 'update' : 'insert';
    try {
      if (row.sheet_row_index) {
        // 既存行：A〜I のみ更新（J/K/L のスカウト入力を保護）
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_TAB}!A${row.sheet_row_index}:I${row.sheet_row_index}`,
          valueInputOption: 'RAW',
          requestBody: { values: [rowToSheetA2I(row)] },
        });

        // last_synced_to_sheet_at 単独 UPDATE（トリガーで updated_at 据え置き）
        const { error: stampErr } = await supabase
          .from('illustrators')
          .update({ last_synced_to_sheet_at: new Date().toISOString() })
          .eq('id', row.id);
        if (stampErr) {
          throw new Error(`last_synced_to_sheet_at 更新失敗: ${stampErr.message}`);
        }
        updated += 1;
      } else {
        // 新規行 APPEND
        const res = await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: `${SHEET_TAB}!A2:M`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [rowToSheetFull(row)] },
        });
        const updatedRange = res.data.updates?.updatedRange ?? '';
        const rowIndex = parseRowIndex(updatedRange);
        if (rowIndex === null) {
          throw new Error(`APPEND 後の行番号取得失敗: updatedRange=${updatedRange}`);
        }

        // 1回目: sheet_row_index を保存（トリガーが updated_at を進める）
        const { error: idxErr } = await supabase
          .from('illustrators')
          .update({ sheet_row_index: rowIndex })
          .eq('id', row.id);
        if (idxErr) throw idxErr;

        // 2回目: last_synced_to_sheet_at を保存（sync only → updated_at 据え置き）
        const { error: stampErr } = await supabase
          .from('illustrators')
          .update({ last_synced_to_sheet_at: new Date().toISOString() })
          .eq('id', row.id);
        if (stampErr) {
          throw new Error(`last_synced_to_sheet_at 更新失敗: ${stampErr.message}`);
        }
        appended += 1;
      }
      await resolveSyncFailure({
        source: 'supabase',
        target: 'sheets',
        record_id: row.id,
      });
    } catch (e) {
      failed += 1;
      const msg = (e as Error).message ?? String(e);
      await recordSyncFailure({
        source: 'supabase',
        target: 'sheets',
        record_id: row.id,
        operation,
        error_message: msg,
      });
      logger.error(
        { err: e, id: row.id, x_username: row.x_username },
        'Supabase→Sheet 同期失敗',
      );
    }
  }

  const summary = { total: rows.length, updated, appended, failed };
  logger.info(summary, 'Supabase→Sheet 同期完了');
  return summary;
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  syncSupabaseToSheet()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.fatal({ err: e }, 'Supabase→Sheet 同期ジョブ全体失敗');
      process.exit(1);
    });
}
