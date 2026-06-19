/**
 * Notion プロパティ ⇔ Supabase カラムの変換ヘルパー（同期ジョブ共通）。
 *
 * Notion 側プロパティ名（日本語）は固定。合意事項リスト v2.2 のプロパティ名と一致させること。
 * 02_Supabaseスキーマ.md v1.1 のカラム名に準拠。
 */

import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

import {
  extractDateStart,
  extractEmail,
  extractMultiSelectNames,
  extractRichText,
  extractSelectName,
  extractStatusName,
  extractTitle,
  extractUrl,
} from '../../scripts/migration/lib/rich-text.js';
import type { Genre, IllustratorRow, MasterStatus, Owner, Rank, StyleTag } from './types.js';

/** Notion pages.update / pages.create に渡す properties のゆるい型 */
export type NotionProperties = Record<string, unknown>;

// ---------- Supabase → Notion （書き出し） ----------

/**
 * Supabase 主導フィールドのみを Notion プロパティ形式に組み立てる。
 * パターンB の核：Notion 側でオーナーが編集するフィールド（master_status 等）は含めない。
 */
export function buildSupabaseLedProperties(row: IllustratorRow): NotionProperties {
  return {
    作家名: {
      title: [{ text: { content: row.artist_name ?? '' } }],
    },
    Xリンク: { url: row.x_link ?? null },
    確認者: {
      multi_select: (row.owner_confirmed_by ?? []).map((name) => ({ name })),
    },
    // 見つけた日 は日付のみで表示（時刻不要）。Supabase.first_detected_at（TIMESTAMPTZ）
    // から YYYY-MM-DD 部分だけを取り出す。
    見つけた日: row.first_detected_at
      ? { date: { start: row.first_detected_at.slice(0, 10) } }
      : { date: null },
  };
}

/**
 * 新規ページ作成時に送る全プロパティ（Supabase主導 + Notion主導の初期値）。
 * Berryfeel 由来 or スクレイパー新規を Notion にはじめて登録する際に使う。
 */
export function buildAllProperties(row: IllustratorRow): NotionProperties {
  return {
    ...buildSupabaseLedProperties(row),
    マスターステータス: { status: { name: row.master_status } },
    ランク: row.rank ? { select: { name: row.rank } } : { select: null },
    確認者: {
      multi_select: (row.owner_confirmed_by ?? []).map((name) => ({ name })),
    },
    ジャンル: { multi_select: (row.genres ?? []).map((name) => ({ name })) },
    絵柄タグ: { multi_select: (row.style_tags ?? []).map((name) => ({ name })) },
    Pixivリンク: { url: row.pixiv_link ?? null },
    ポートフォリオサイト: { url: row.portfolio_link ?? null },
    その他連絡先: { url: row.other_contact ?? null },
    メール: { email: row.email ?? null },
    クレジット名義: {
      rich_text: [{ text: { content: row.credit_name ?? '' } }],
    },
    連絡した日: row.contacted_at ? { date: { start: row.contacted_at } } : { date: null },
    連絡した人: {
      multi_select: (row.contacted_by ?? []).map((name) => ({ name })),
    },
    再度連絡する日: row.recontact_at ? { date: { start: row.recontact_at } } : { date: null },
    備考: {
      rich_text: [{ text: { content: row.note ?? '' } }],
    },
  };
}

// ---------- Notion → Supabase （読み込み） ----------

/**
 * Notion ページから title プロパティ（作家名）を取り出す。
 */
export function extractArtistName(page: PageObjectResponse): string | null {
  return extractTitle(page.properties['作家名']);
}

/**
 * Notion ページから Xリンク（url）を取り出す。
 */
export function extractXLink(page: PageObjectResponse): string | null {
  return extractUrl(page.properties['Xリンク']);
}

/**
 * Notion 主導フィールドのみを Supabase の UPDATE 用オブジェクトに変換する。
 * Supabase 主導フィールドは絶対に含めない（パターンB の核）。
 *
 * enum に無い値が入っていても Supabase 側の制約でエラーになるだけなので、
 * ここではそのまま渡す（必要なら呼び出し側でバリデーション）。
 */
export function extractNotionLedFields(
  page: PageObjectResponse,
): Partial<
  Pick<
    IllustratorRow,
    | 'master_status'
    | 'rank'
    | 'owner_confirmed_by'
    | 'style_tags'
    | 'genres'
    | 'note'
    | 'contacted_at'
    | 'contacted_by'
    | 'recontact_at'
    | 'email'
    | 'portfolio_link'
    | 'other_contact'
    | 'credit_name'
    | 'pixiv_link'
  >
> {
  const p = page.properties;

  const masterStatusName = extractStatusName(p['マスターステータス']);
  const rankName = extractSelectName(p['ランク']);

  return {
    master_status: (masterStatusName as MasterStatus | null) ?? '候補',
    rank: (rankName as Rank | null) ?? null,
    owner_confirmed_by: extractMultiSelectNames(p['確認者'] ?? p['オーナー確認']) as Owner[],
    style_tags: extractMultiSelectNames(p['絵柄タグ']) as StyleTag[],
    genres: extractMultiSelectNames(p['ジャンル']) as Genre[],
    note: extractRichText(p['備考']),
    contacted_at: extractDateStart(p['連絡した日']),
    contacted_by: extractMultiSelectNames(p['連絡した人']),
    recontact_at: extractDateStart(p['再度連絡する日']),
    email: extractEmail(p['メール']),
    portfolio_link: extractUrl(p['ポートフォリオサイト']),
    other_contact: extractUrl(p['その他連絡先']),
    credit_name: extractRichText(p['クレジット名義']),
    pixiv_link: extractUrl(p['Pixivリンク']),
  };
}
