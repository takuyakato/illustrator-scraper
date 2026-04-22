/**
 * 同期ジョブ共通の型定義。
 *
 * Supabase の illustrators テーブル 1 行を TypeScript 側で扱うための型。
 * enum 値は Supabase スキーマ v1.1 に準拠。
 */

/** master_status_enum（7値） */
export type MasterStatus =
  | '候補'
  | '連絡する'
  | '連絡中'
  | '返信なし'
  | '連絡先不明'
  | '依頼成功'
  | '対象外';

/** rank_enum */
export type Rank = 'S' | 'A' | 'B' | 'C';

/** owner_enum */
export type Owner = '三村' | '北條' | '加藤';

/** style_tag_enum */
export type StyleTag = '美麗' | 'クセ強' | 'カジュアル' | 'イケメン';

/** genre_enum（6値、広告用を含む） */
export type Genre = 'BL' | 'TL' | '少女' | '女性' | '一般' | '広告用';

/** Supabase illustrators 1 行分 */
export interface IllustratorRow {
  id: string;

  // 基本識別子
  x_username: string;
  display_name: string | null;
  bio: string | null;
  follower_count: number | null;

  // スクレイピング情報
  detected_from: string[];
  first_detected_at: string;
  last_seen_at: string;
  scout_comment: string | null;

  // 判定フラグ
  is_illustrator: boolean | null;

  // アクティブカラム
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

  // Legacy（同期ジョブでは基本触らない）
  legacy_status: string | null;
  legacy_status_1: string | null;
  legacy_contact_status: string | null;
  legacy_capuri_berryfeel_search: string[];
  legacy_mimura_comment: string | null;
  legacy_hojo_comment: string | null;
  legacy_mimura_points: number | null;
  legacy_hojo_points: number | null;
  legacy_found_date: string | null;
  legacy_found_by: string | null;
  legacy_start_date: string | null;
  legacy_end_date: string | null;
  legacy_capuri_request_id: string | null;
  legacy_mail_alt: string | null;
  legacy_recontact_time: string | null;
  legacy_rejection_reason: string[];
  migration_snapshot: unknown;

  // Notion 連携
  notion_page_id: string | null;
  last_synced_to_notion_at: string | null;
  last_synced_from_notion_at: string | null;

  // Sheets 連携
  sheet_row_index: number | null;
  last_synced_to_sheet_at: string | null;
  last_synced_from_sheet_at: string | null;

  // システム
  created_at: string;
  updated_at: string;
}

export type SyncSource = 'supabase' | 'notion' | 'sheets' | 'scraper';
export type SyncTarget = 'supabase' | 'notion' | 'sheets';
export type SyncOperation = 'insert' | 'update' | 'delete' | 'fetch';

/** sync_state テーブルのジョブ名 */
export type SyncJobName =
  | 'notion_to_supabase'
  | 'supabase_to_notion'
  | 'sheet_to_supabase'
  | 'supabase_to_sheet'
  | 'auto_transition'
  | 'notify_failures';
