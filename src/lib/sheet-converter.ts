/**
 * Supabase illustrators 行 ⇔ Google Sheets 候補プール行 の変換ヘルパー。
 *
 * 列構成（ヘッダー行 A1:M1 は setup 時に設置済み）:
 *   A: 検出日      B: 検出元      C: XアカウントURL  D: 表示名
 *   E: プロフィール F: フォロワー数 G: Pixivリンク  H: ポートフォリオ
 *   I: 既存DB重複  J: 判定        K: 仮ランク     L: コメント     M: 同期状態
 *
 * A〜I は自動入力（supabase-to-sheet が書く）
 * J〜L はスカウト入力（人が書く）
 * M は同期状態（双方が更新）
 */

import type { IllustratorRow } from './types.js';
import { normalizeXUrl } from './x-url-normalizer.js';

/** M 列の値の区別用定数 */
export const SYNC_STATUS_UNSYNCED = '未同期';
export const SYNC_STATUS_SYNCED = '同期済み';
export const SYNC_STATUS_FAILED = '同期失敗';

/** Sheets API に渡す値の型（null は文字列にしないと Sheets が「null」表記になる） */
type SheetCell = string | number;

/**
 * Supabase 行 → A〜I 列（自動入力分）の配列に変換。
 * 既存行の再同期（range A:I）で使う。
 */
export function rowToSheetA2I(row: IllustratorRow): SheetCell[] {
  return [
    row.first_detected_at?.slice(0, 10) ?? '',
    (row.detected_from ?? []).join(', '),
    row.x_link ?? (row.x_username ? `https://x.com/${row.x_username}` : ''),
    row.display_name ?? '',
    (row.bio ?? '').slice(0, 500),
    row.follower_count ?? '',
    row.pixiv_link ?? '',
    row.portfolio_link ?? '',
    'NO', // 既存DB重複：Supabase 側で dedup 済みなので常に NO
  ];
}

/**
 * Supabase 行 → A〜M 列（新規 APPEND 用、J/K/L は空、M は未同期）に変換。
 */
export function rowToSheetFull(row: IllustratorRow): SheetCell[] {
  return [...rowToSheetA2I(row), '', '', '', SYNC_STATUS_UNSYNCED];
}

/** スカウト入力の抽出結果 */
export interface ScoutRowInput {
  /** シートの絶対行番号（1-indexed、ヘッダー行は1なので最小2） */
  rowIndex: number;
  xUsername: string;
  judgment: string; // J列：'イラストレーターじゃない' or 空
  tentativeRank: string; // K列：S/A/B/C or 空
  scoutComment: string; // L列
  syncStatus: string; // M列
}

/**
 * Sheets から取得した行列（A2:M 以降）を1行ずつ解釈。
 *
 * @param rows Sheets の values（1行目がヘッダーを除いた実データの先頭＝rowIndex=2 の行）
 */
export function parseSheetRows(rows: string[][]): ScoutRowInput[] {
  const results: ScoutRowInput[] = [];
  rows.forEach((r, i) => {
    const rowIndex = i + 2;
    const rawXAccount = (r[2] ?? '').trim();
    const xUsername = normalizeXUrl(rawXAccount) ?? rawXAccount.toLowerCase();
    // C列（XアカウントURL）が空の行はスキップ（空行 or 手動編集中）
    if (!xUsername) return;
    results.push({
      rowIndex,
      xUsername,
      judgment: (r[9] ?? '').trim(),
      tentativeRank: (r[10] ?? '').trim(),
      scoutComment: (r[11] ?? '').trim(),
      syncStatus: (r[12] ?? '').trim(),
    });
  });
  return results;
}
