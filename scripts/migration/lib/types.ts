/**
 * Supabase illustrators テーブルに対応する TypeScript 型定義。
 *
 * docs/architecture/02_Supabaseスキーマ.md v1.1 の
 * CREATE TABLE illustrators と 1:1 に対応する。
 *
 * NOTE:
 *  - ENUM 型のカラム（master_status / rank / genres）は、TypeScript 側では
 *    リテラル型のユニオンで表現する。
 *  - Notion multi_select と同期する style_tags / owner_confirmed_by は TEXT[] として扱う。
 *  - 配列カラムは TypeScript の配列型に対応させる。
 *  - マイグレーションスクリプトで INSERT に使う形を想定し、
 *    DB 側のデフォルト値で埋められる列（id / created_at / updated_at 等）は
 *    Optional にしている。
 */

// ============================================================
// ENUM 型（02_Supabaseスキーマ.md Section 2）
// ============================================================

/** マスターステータス */
export type MasterStatus =
  | '候補'
  | '連絡中'
  | '返信なし'
  | '多忙辞退'
  | '条件次第'
  | '依頼成功'
  | '依頼不可'
  | '時間をおいて再度連絡';

/** ランク（S/A/B/C） */
export type Rank = 'S' | 'A' | 'B' | 'C';

/** 絵柄タグ（Notion multi_select） */
export type StyleTag = string;

/** オーナー確認（Notion multi_select） */
export type Owner = string;

/** ジャンル（6値） */
export type Genre =
  | 'BLサンド'
  | 'Capuri'
  | 'Berryfeel'
  | 'Webtoon'
  | 'アシスタント'
  | '広告用';

// ============================================================
// illustrators テーブルのレコード型
// ============================================================

/**
 * illustrators テーブルに INSERT するレコードの型。
 * DB 側で自動埋めされるカラム（id / created_at / updated_at）は任意。
 */
export interface IllustratorRecord {
  // --- ID・基本識別子 ---
  id?: string;
  /**
   * 正規化済みXユーザー名。スキーマ上 NOT NULL + UNIQUE。
   * Xリンクが無いレコードは `(no-x-link-<pageIdShort>)` プレースホルダーを入れる。
   */
  x_username: string;
  display_name?: string | null;
  bio?: string | null;
  follower_count?: number | null;

  // --- スクレイピング情報 ---
  detected_from?: string[];
  first_detected_at?: string | null;
  last_seen_at?: string | null;
  scout_comment?: string | null;

  // --- 判定フラグ ---
  is_illustrator: boolean | null;

  // --- アクティブカラム（Notion同期対象） ---
  artist_name: string | null;
  master_status: MasterStatus;
  rank: Rank | null;
  owner_confirmed_by: Owner[];
  style_tags: StyleTag[];
  genres: Genre[];
  x_link: string | null;
  pixiv_link: string | null;
  portfolio_link: string | null;
  other_contact: string | null;
  email: string | null;
  credit_name: string | null;
  contacted_at: string | null;
  contacted_by: string[];
  note: string | null;

  // --- Legacy カラム ---
  legacy_contact_status: string | null;
  legacy_mimura_comment: string | null;
  legacy_hojo_comment: string | null;
  legacy_hojo_points: number | null;
  legacy_found_by: string | null;
  legacy_capuri_request_id: string | null;
  migration_snapshot: unknown;

  // --- Notion連携 ---
  notion_page_id: string | null;
  last_synced_to_notion_at?: string | null;
  last_synced_from_notion_at?: string | null;

  // --- Google Sheets連携 ---
  sheet_row_index?: number | null;
  last_synced_to_sheet_at?: string | null;
  last_synced_from_sheet_at?: string | null;

  // --- システム自動 ---
  created_at?: string;
  updated_at?: string;
}

/**
 * Berryfeel 別 DB のレコード（突合用の軽量表現）。
 * title は「名前」プロパティ、status/note/recontactTime は固有の運用情報。
 */
export interface BerryfeelRecord {
  /** Notion の page.id */
  pageId: string;
  /** 作家名（title プロパティ「名前」） */
  artistName: string | null;
  /** メールアドレス（あれば） */
  email: string | null;
  /** Berryfeel別DB「ステータス」（status型、「ステータス 1」と同じ値セット） */
  status: string | null;
  /** Berryfeel別DB「備考」（rich_text） */
  note: string | null;
  /** Berryfeel別DB「再連絡時期」（rich_text） */
  recontactTime: string | null;
  /** 元の Notion ページ全体（migration_snapshot 保存用） */
  raw: unknown;
}
