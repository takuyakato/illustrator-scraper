/**
 * Notion の property オブジェクトから値を抽出するユーティリティ。
 *
 * Notion の property は型ごとに形が異なるため、TypeScript 的には
 * union 型となっている。各種抽出関数を用意して、スクリプト側の
 * 呼び出し箇所を簡潔に保つ。
 */

import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

// Notion の property の union 型
type PropertyValue = PageObjectResponse['properties'][string];

/**
 * rich_text 型プロパティから plain_text を連結して返す。
 * 空配列・他の型なら null を返す。
 */
export function extractRichText(prop: PropertyValue | undefined): string | null {
  if (!prop || prop.type !== 'rich_text') return null;
  if (prop.rich_text.length === 0) return null;
  const text = prop.rich_text.map((r) => r.plain_text).join('');
  return text === '' ? null : text;
}

/**
 * title 型プロパティから plain_text を連結して返す。
 */
export function extractTitle(prop: PropertyValue | undefined): string | null {
  if (!prop || prop.type !== 'title') return null;
  if (prop.title.length === 0) return null;
  const text = prop.title.map((r) => r.plain_text).join('');
  return text === '' ? null : text;
}

/**
 * select 型プロパティから選択値の name を返す。
 */
export function extractSelectName(prop: PropertyValue | undefined): string | null {
  if (!prop || prop.type !== 'select') return null;
  return prop.select?.name ?? null;
}

/**
 * status 型プロパティから選択値の name を返す。
 */
export function extractStatusName(prop: PropertyValue | undefined): string | null {
  if (!prop || prop.type !== 'status') return null;
  return prop.status?.name ?? null;
}

/**
 * multi_select 型プロパティから name の配列を返す。
 */
export function extractMultiSelectNames(prop: PropertyValue | undefined): string[] {
  if (!prop || prop.type !== 'multi_select') return [];
  return prop.multi_select.map((s) => s.name);
}

/**
 * url 型プロパティから URL 文字列を返す。
 */
export function extractUrl(prop: PropertyValue | undefined): string | null {
  if (!prop || prop.type !== 'url') return null;
  return prop.url ?? null;
}

/**
 * email 型プロパティから email 文字列を返す。
 */
export function extractEmail(prop: PropertyValue | undefined): string | null {
  if (!prop || prop.type !== 'email') return null;
  return prop.email ?? null;
}

/**
 * date 型プロパティから開始日（YYYY-MM-DD もしくは ISO8601）を返す。
 */
export function extractDateStart(prop: PropertyValue | undefined): string | null {
  if (!prop || prop.type !== 'date') return null;
  return prop.date?.start ?? null;
}

/**
 * number 型プロパティから数値を返す。
 */
export function extractNumber(prop: PropertyValue | undefined): number | null {
  if (!prop || prop.type !== 'number') return null;
  return prop.number;
}

/**
 * relation 型プロパティの先頭 ID を返す。
 */
export function extractFirstRelationId(prop: PropertyValue | undefined): string | null {
  if (!prop || prop.type !== 'relation') return null;
  return prop.relation[0]?.id ?? null;
}
