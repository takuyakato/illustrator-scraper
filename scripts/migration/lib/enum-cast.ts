/**
 * Notion から取得した文字列を、DB 型に安全に変換するヘルパー。
 *
 * Notion 側で運用中に増える multi_select（StyleTag / Owner）は TEXT[] で保持する。
 * DB 側 ENUM の Genre / Rank は許容値外を弾く。
 */

import type { Genre, Owner, Rank, StyleTag } from './types.js';
import { logger } from './logger.js';

const RANK_VALUES: readonly Rank[] = ['S', 'A', 'B', 'C'] as const;
const GENRE_VALUES: readonly Genre[] = [
  'BLサンド',
  'Capuri',
  'Berryfeel',
  'Webtoon',
  'アシスタント',
  '広告用',
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
 * 文字列配列を StyleTag 配列に変換。
 */
export function asStyleTags(values: string[], context?: string): StyleTag[] {
  void context;
  return values.map((v) => v.trim()).filter((v) => v !== '');
}

/**
 * 文字列配列を Owner 配列に変換。
 */
export function asOwners(values: string[], context?: string): Owner[] {
  void context;
  return values.map((v) => v.trim()).filter((v) => v !== '');
}
