/**
 * Notion ページ → Supabase illustrators レコードへの変換ロジック。
 *
 * 03_マイグレーション手順.md Section 7.2 の擬似コードを忠実に実装。
 * 各行の変換はここに集約し、スクリプト側（02_notion_to_supabase.ts）は
 * 「取得 → transform → INSERT」のフローだけを書く。
 */

import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints.js';

import type { BerryfeelRecord, IllustratorRecord } from './types.js';
import {
  extractDateStart,
  extractEmail,
  extractFirstRelationId,
  extractMultiSelectNames,
  extractNumber,
  extractRichText,
  extractSelectName,
  extractStatusName,
  extractTitle,
  extractUrl,
} from './rich-text.js';
import { convertCreditName, resolveMasterStatus } from './status-mapper.js';
import { normalizeXUrl } from './x-url-normalizer.js';
import { splitPortfolioAndOther } from './portfolio-splitter.js';
import { asGenres, asRank } from './enum-cast.js';

/**
 * メインDB（イラストレーター情報）の Notion ページから
 * Supabase illustrators 1レコード分の INSERT 値を作る。
 *
 * エラー時は例外を投げる（呼び出し側でキャッチしてスキップ扱いに）。
 */
export function transformMainDbPage(page: PageObjectResponse): IllustratorRecord {
  const props = page.properties;

  // --- プレースホルダー用の page.id 短縮版（16文字） ---
  const pageIdShort = page.id.replace(/-/g, '').slice(0, 16);

  // --- 作家名 ---
  // スキーマの CHECK (is_illustrator IS NOT TRUE OR artist_name IS NOT NULL) を通すため、
  // 空なら「(名無し-XXXXXXXXXXXXXXXX)」プレースホルダーを入れる（XX…は page.id のハイフン除去先頭16文字）
  const rawArtistName = extractTitle(props['作家名']);
  const artistName =
    rawArtistName && rawArtistName.trim() !== ''
      ? rawArtistName
      : `(名無し-${pageIdShort})`;

  // --- Xリンク / ユーザー名 ---
  // x_username はスキーマ上 NOT NULL + UNIQUE。
  // Notion の「Xリンク」が空欄のレコードでは null になるため、
  // 「(no-x-link-XXXXXXXXXXXXXXXX)」プレースホルダーを入れる（XX…は page.id のハイフン除去先頭16文字、UUIDなので一意性担保）。
  // normalize_x_username トリガー（DB側）を通してもこの値は影響を受けない（URL/@/スラッシュ無しのテキスト）。
  const xUrlRaw = extractUrl(props['Xリンク']);
  const xUsernameNormalized = normalizeXUrl(xUrlRaw);
  const xUsername =
    xUsernameNormalized ?? `(no-x-link-${page.id.replace(/-/g, '').slice(0, 16)})`;

  // --- メール（メイン/メアドの統合） ---
  const emailMain = extractEmail(props['メール']);
  const emailAlt = extractEmail(props['メアド']);
  const mergedEmail = emailMain ?? emailAlt ?? null;

  // --- クレジット希望 → クレジット名義 ---
  const creditChoice = extractSelectName(props['クレジット希望']);
  const creditName = creditChoice ? convertCreditName(creditChoice, artistName) : null;

  // --- その他連絡先のポートフォリオ振り分け ---
  const otherContactRaw = extractUrl(props['その他連絡先']);
  const { portfolio, other } = splitPortfolioAndOther(otherContactRaw);

  // --- ランク ---
  const rankRaw = extractSelectName(props['ランク']);
  const rank = asRank(rankRaw, `page=${page.id} artist=${artistName}`);

  // --- ジャンル ---
  const genresRaw = extractMultiSelectNames(props['ジャンル']);
  const genres = asGenres(genresRaw, `page=${page.id} artist=${artistName}`);

  // --- 連絡した人（select → 配列化） ---
  const contactedByRaw = extractSelectName(props['連絡した人']);
  const contactedBy = contactedByRaw ? [contactedByRaw] : [];

  // --- Legacy ---
  const legacyCapuriRequestId = extractFirstRelationId(props['Capuri依頼']);

  const record: IllustratorRecord = {
    // --- Notion 連携 ---
    notion_page_id: page.id,

    // --- アクティブカラム ---
    artist_name: artistName,
    master_status: resolveMasterStatus(props),
    rank,
    owner_confirmed_by: [],
    style_tags: [], // 新規プロパティ。マイグレーション時点では空
    genres,
    x_link: xUrlRaw ?? null,
    x_username: xUsername,
    pixiv_link: extractUrl(props['Pixivリンク']),
    portfolio_link: portfolio,
    other_contact: other,
    email: mergedEmail,
    credit_name: creditName,
    contacted_at: extractDateStart(props['連絡した日']),
    contacted_by: contactedBy,
    note: extractRichText(props['備考']) ?? '',

    // --- 判定フラグ：既存レコードは全員イラストレーター扱い ---
    is_illustrator: true,

    // --- Legacy カラム ---
    legacy_contact_status: extractStatusName(props['連絡状況']),
    legacy_mimura_comment: extractRichText(props['三村コメント']),
    legacy_hojo_comment: extractRichText(props['北條コメント']),
    legacy_hojo_points: extractNumber(props['北條点数']),
    legacy_found_by: extractSelectName(props['見つけた人']),
    legacy_capuri_request_id: legacyCapuriRequestId,

    // --- migration_snapshot ---
    migration_snapshot: {
      source: 'main_db',
      notion_page: page,
    },
  };

  return record;
}

/**
 * Berryfeel 別DBの Notion ページから突合用の軽量レコードを作る。
 *
 * Berryfeel別DBのプロパティ構成：
 *   名前 (title) / メール (email) / 備考 (rich_text) /
 *   再連絡時期 (rich_text) / ステータス (status)
 *
 * メール・ステータス・備考・再連絡時期も取り込み、統合時に活用する。
 */
export function toBerryfeelRecord(page: PageObjectResponse): BerryfeelRecord {
  const props = page.properties;

  // ※ Berryfeel別DBの title プロパティ名は「名前」（メインDBの「作家名」ではない）
  const artistName = extractTitle(props['名前']);
  // ※ Berryfeel別DBに「メアド」プロパティは存在しない。「メール」のみ
  const email = extractEmail(props['メール']);

  const status = extractStatusName(props['ステータス']);
  const note = extractRichText(props['備考']);
  const recontactTime = extractRichText(props['再連絡時期']);

  return {
    pageId: page.id,
    artistName,
    email,
    status,
    note,
    recontactTime,
    raw: page,
  };
}
