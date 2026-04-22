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

  // --- 作家名 ---
  // スキーマの CHECK (is_illustrator IS NOT TRUE OR artist_name IS NOT NULL) を通すため、
  // 空なら「(名無し-XXXXXXXX)」プレースホルダーを入れる（XXXXXXXX は page.id の先頭8文字）
  const rawArtistName = extractTitle(props['作家名']);
  const artistName =
    rawArtistName && rawArtistName.trim() !== ''
      ? rawArtistName
      : `(名無し-${page.id.replace(/-/g, '').slice(0, 8)})`;

  // --- Xリンク / ユーザー名 ---
  const xUrlRaw = extractUrl(props['Xリンク']);
  const xUsername = normalizeXUrl(xUrlRaw);

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
  const legacyRejectionReason = extractMultiSelectNames(props['断られた理由']);
  const legacyCapuriBerryfeelSearch = extractMultiSelectNames(props['Capuri/BerryFeel探し']);
  const legacyRecontactTime = extractRichText(props['再連絡時期']);
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
    legacy_status: extractSelectName(props['ステータス']),
    legacy_status_1: extractStatusName(props['ステータス 1']),
    legacy_contact_status: extractStatusName(props['連絡状況']),
    legacy_capuri_berryfeel_search: legacyCapuriBerryfeelSearch,
    legacy_mimura_comment: extractRichText(props['三村コメント']),
    legacy_hojo_comment: extractRichText(props['北條コメント']),
    legacy_mimura_points: extractNumber(props['三村点数']),
    legacy_hojo_points: extractNumber(props['北條点数']),
    legacy_found_date: extractDateStart(props['見つけた日']),
    legacy_found_by: extractSelectName(props['見つけた人']),
    legacy_start_date: extractDateStart(props['開始日']),
    legacy_end_date: extractDateStart(props['終了予定日']),
    legacy_capuri_request_id: legacyCapuriRequestId,
    legacy_mail_alt: emailAlt,
    legacy_recontact_time: legacyRecontactTime,
    legacy_rejection_reason: legacyRejectionReason,

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
 * メールアドレスは「メール」→「メアド」の順に参照する。
 */
export function toBerryfeelRecord(page: PageObjectResponse): BerryfeelRecord {
  const props = page.properties;
  const artistName = extractTitle(props['作家名']);
  const email = extractEmail(props['メール']) ?? extractEmail(props['メアド']);

  return {
    pageId: page.id,
    artistName,
    email,
    raw: page,
  };
}
