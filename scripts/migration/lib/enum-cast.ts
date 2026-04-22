/**
 * Notion から取得した文字列を、ENUM 型（Genre / Rank / StyleTag / Owner）
 * に安全にキャストするヘルパー。
 *
 * Notion 側の select/multi_select の選択肢が DB 側 ENUM の許容値と
 * ズレていた場合に、実行時に弾いてログを出せるようにする。
 */

import type { Genre, Owner, Rank, StyleTag } from './types.js';
import { logger } from './logger.js';

const RANK_VALUES: readonly Rank[] = ['S', 'A', 'B', 'C'] as const;
const STYLE_TAG_VALUES: readonly StyleTag[] = ['イケメン', 'リアル', 'デフォルメ', 'クセ強'] as const;
const OWNER_VALUES: readonly Owner[] = ['北條', '三村', '加藤'] as const;
const GENRE_VALUES: readonly Genre[] = [
  'BLサンド',
  'Capuri',
  'Berryfeel',
  'Webtoon',
  'アシスタント',
] as const;

/**
 * 文字列を Rank にキャスト。許容値外なら null を返し、警告ログを出力する。
 */
export function asRank(value: string | null | undefined, context?: string): Rank | null {
  if (value === null || value === undefined) return null;
  if ((RANK_VALUES as readonly string[]).includes(value)) return value as Rank;
  logger.warn({ value, context }, 'asRank: ランク値が不正（null として扱う）');
  return null;
}

/**
 * 文字列配列を Genre 配列にフィルタ。許容値外は除外し、警告ログを出力する。
 */
export function asGenres(values: string[], context?: string): Genre[] {
  const result: Genre[] = [];
  for (const v of values) {
    if ((GENRE_VALUES as readonly string[]).includes(v)) {
      result.push(v as Genre);
    } else {
      logger.warn({ value: v, context }, 'asGenres: 不正なジャンル値を除外');
    }
  }
  return result;
}

/**
 * 文字列配列を StyleTag 配列にフィルタ。
 */
export function asStyleTags(values: string[], context?: string): StyleTag[] {
  const result: StyleTag[] = [];
  for (const v of values) {
    if ((STYLE_TAG_VALUES as readonly string[]).includes(v)) {
      result.push(v as StyleTag);
    } else {
      logger.warn({ value: v, context }, 'asStyleTags: 不正な絵柄タグ値を除外');
    }
  }
  return result;
}

/**
 * 文字列配列を Owner 配列にフィルタ。
 */
export function asOwners(values: string[], context?: string): Owner[] {
  const result: Owner[] = [];
  for (const v of values) {
    if ((OWNER_VALUES as readonly string[]).includes(v)) {
      result.push(v as Owner);
    } else {
      logger.warn({ value: v, context }, 'asOwners: 不正なオーナー値を除外');
    }
  }
  return result;
}
