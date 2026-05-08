/**
 * Google Sheets「候補プール」のC列を XアカウントURL に統一するバックフィル。
 *
 * 既存の手入力・旧データでは C 列に username が入っていることがあるため、
 * それらを `https://x.com/<username>` へ揃える。
 *
 * このスクリプトは一回だけの移行用途。
 */

import { logger } from '../lib/logger.js';
import { normalizeXUrl } from '../lib/x-url-normalizer.js';
import { getSheetsClient, SHEET_ID } from '../lib/sheets.js';

const SHEET_TAB = '候補プール';
const BATCH_SIZE = 200;

export async function backfillSheetXLinks(): Promise<{
  totalRows: number;
  updated: number;
  skipped: number;
}> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!C2:C`,
  });

  const rows = res.data.values ?? [];
  const updates: Array<{ range: string; values: [[string]] }> = [];
  let updated = 0;
  let skipped = 0;

  rows.forEach((row, index) => {
    const rowIndex = index + 2;
    const current = (row?.[0] ?? '').trim();
    if (!current) {
      skipped += 1;
      return;
    }

    const normalized = normalizeXUrl(current) ?? current.toLowerCase();
    if (!normalized) {
      skipped += 1;
      return;
    }

    const nextUrl = `https://x.com/${normalized}`;
    if (current === nextUrl) {
      skipped += 1;
      return;
    }

    updates.push({
      range: `${SHEET_TAB}!C${rowIndex}`,
      values: [[nextUrl]],
    });
    updated += 1;
  });

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: chunk,
      },
    });
    logger.info({ chunk: Math.floor(i / BATCH_SIZE) + 1, count: chunk.length }, 'Sheets C列バックフィル完了');
  }

  const summary = { totalRows: rows.length, updated, skipped };
  logger.info(summary, 'Sheets Xリンクバックフィル完了');
  return summary;
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  backfillSheetXLinks()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.fatal({ err: e }, 'Sheets Xリンクバックフィル失敗');
      process.exit(1);
    });
}
