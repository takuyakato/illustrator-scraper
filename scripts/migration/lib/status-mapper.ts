/**
 * 旧ステータス → 新マスターステータス（7値）への変換。
 *
 * 優先順位（03_マイグレーション手順.md Section 4）:
 *   連絡状況 > ステータス 1 > ステータス > デフォルト（候補）
 *
 * - 連絡状況が「未連絡」 or 空の場合は下位（ステータス 1 → ステータス）を参照する
 * - 未知の値は安全側の「候補」にフォールバック
 */

import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

import type { MasterStatus } from './types.js';
import { extractSelectName, extractStatusName } from './rich-text.js';

/**
 * 「連絡状況」→ マスターステータス
 */
function mapContactStatus(value: string): MasterStatus {
  switch (value) {
    case '連絡しない':
      return '依頼不可';
    case '連絡中':
      return '連絡中';
    case '時間を空けて再連絡':
      return '多忙辞退';
    case '依頼失敗':
      return '依頼不可';
    case '依頼成功':
      return '依頼成功';
    default:
      return '候補';
  }
}

/**
 * 「ステータス 1」→ マスターステータス
 *
 * Berryfeel別DBの「ステータス」も同じ値セット（連絡したい/依頼前/...完了）
 * なので、mapBerryfeelStatus としてもエクスポートして流用する。
 */
export function mapStatus1(value: string): MasterStatus {
  switch (value) {
    case '完了':
      return '依頼成功';
    case '依頼中':
      return '連絡中';
    case '返信あり・依頼できそう':
      return '連絡中';
    case '未返信':
      return '返信なし';
    case '連絡したい':
      return '候補';
    case 'スケジュール確保済み':
      return '連絡中';
    case '依頼前':
      return '連絡中';
    case '再連絡':
      return '多忙辞退';
    case '依頼不可':
      return '依頼不可';
    case '多忙のため辞退':
      return '多忙辞退';
    default:
      return '候補';
  }
}

/**
 * 「ステータス」（旧ネーム/線画）→ マスターステータス
 */
function mapOldStatus(value: string): MasterStatus {
  switch (value) {
    case 'ネーム:依頼中':
      return '連絡中';
    case '線画:依頼中':
      return '連絡中';
    case 'ネーム:頼まない':
      return '依頼不可';
    case '線画:頼まない':
      return '依頼不可';
    case '未依頼':
      return '候補';
    case 'ネーム:継続希望':
      return '依頼成功';
    case '線画:継続希望':
      return '依頼成功';
    default:
      return '候補';
  }
}

/**
 * Notion ページのプロパティから新マスターステータスを解決する。
 *
 * @param properties - row.properties（Notion pages.properties）
 */
export function resolveMasterStatus(
  properties: PageObjectResponse['properties'],
): MasterStatus {
  const contactStatus = extractStatusName(properties['連絡状況']);
  const status1 = extractStatusName(properties['ステータス 1']);
  const oldStatus = extractSelectName(properties['ステータス']);

  // 1. 連絡状況が「未連絡」以外の有効値なら優先
  if (contactStatus !== null && contactStatus !== '未連絡') {
    return mapContactStatus(contactStatus);
  }

  // 2. ステータス 1 を参照
  if (status1 !== null) {
    return mapStatus1(status1);
  }

  // 3. 旧ステータス（ネーム/線画）を参照
  if (oldStatus !== null) {
    return mapOldStatus(oldStatus);
  }

  // 4. デフォルト
  return '候補';
}

/**
 * Berryfeel別DB の「ステータス」→ マスターステータス。
 * （Berryfeel別DBのstatus型プロパティはメインDB「ステータス 1」と同じ値セット）
 */
export { mapStatus1 as mapBerryfeelStatus };

/**
 * クレジット希望（select）→ クレジット名義（rich_text）への変換。
 *
 * - 'しない' / '別名希望' → 空文字
 * - 'する' / '希望' を含む → artist_name と同じ文字列
 * - その他は空文字
 */
export function convertCreditName(creditChoice: string, artistName: string): string {
  if (creditChoice === 'しない') return '';
  if (creditChoice === '別名希望') return ''; // 要手入力
  if (creditChoice === 'する' || creditChoice.includes('希望')) return artistName;
  return '';
}
