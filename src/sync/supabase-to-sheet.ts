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

  const updateRows = rows.filter((row) => row.sheet_row_index);
  const appendRows = rows.filter((row) => !row.sheet_row_index);

  if (updateRows.length > 0) {
    try {
      // 既存行：A〜I のみ一括更新（J〜L のスカウト入力を保護）
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: updateRows.map((row) => ({
            range: `${SHEET_TAB}!A${row.sheet_row_index}:I${row.sheet_row_index}`,
            values: [rowToSheetA2I(row)],
          })),
        },
      });

      for (const row of updateRows) {
        try {
          // last_synced_to_sheet_at 単独 UPDATE（トリガーで updated_at 据え置き）
          const { error: stampErr } = await supabase
            .from('illustrators')
            .update({ last_synced_to_sheet_at: new Date().toISOString() })
            .eq('id', row.id);
          if (stampErr) {
            throw new Error(`last_synced_to_sheet_at 更新失敗: ${stampErr.message}`);
          }
          await resolveSyncFailure({
            source: 'supabase',
            target: 'sheets',
            record_id: row.id,
          });
          updated += 1;
        } catch (e) {
          failed += 1;
          await recordSheetFailure(row, 'update', e);
        }
      }
    } catch (e) {
      failed += updateRows.length;
      for (const row of updateRows) {
        await recordSheetFailure(row, 'update', e);
      }
    }
  }

  if (appendRows.length > 0) {
    try {
      // 新規行はまとめて APPEND し、返却された開始行から sheet_row_index を割り当てる。
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A2:N`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: appendRows.map(rowToSheetFull) },
      });
      const updatedRange = res.data.updates?.updatedRange ?? '';
      const startRowIndex = parseRowIndex(updatedRange);
      if (startRowIndex === null) {
        throw new Error(`APPEND 後の行番号取得失敗: updatedRange=${updatedRange}`);
      }

      for (const [index, row] of appendRows.entries()) {
        try {
          // 1回目: sheet_row_index を保存（トリガーが updated_at を進める）
          const { error: idxErr } = await supabase
            .from('illustrators')
            .update({ sheet_row_index: startRowIndex + index })
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
          await resolveSyncFailure({
            source: 'supabase',
            target: 'sheets',
            record_id: row.id,
          });
          appended += 1;
        } catch (e) {
          failed += 1;
          await recordSheetFailure(row, 'insert', e);
        }
      }
    } catch (e) {
      failed += appendRows.length;
      for (const row of appendRows) {
        await recordSheetFailure(row, 'insert', e);
      }
    }
  }

  const summary = { total: rows.length, updated, appended, failed };
  logger.info(summary, 'Supabase→Sheet 同期完了');
  return summary;
}

async function recordSheetFailure(
  row: IllustratorRow,
  operation: 'insert' | 'update',
  e: unknown,
): Promise<void> {
  const msg = (e as Error).message ?? String(e);
  await recordSyncFailure({
    source: 'supabase',
    target: 'sheets',
    record_id: row.id,
    operation,
    error_message: msg,
  });
  logger.error({ err: e, id: row.id, x_username: row.x_username }, 'Supabase→Sheet 同期失敗');
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
