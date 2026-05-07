/**
 * 同期ジョブ共通の型定義。
 *
 * Supabase の illustrators テーブル 1 行を TypeScript 側で扱うための型。
 * enum 値は Supabase スキーマ v1.1 に準拠。
 */

/**
 * master_status_enum
 * migration 002 create_enums.sql の ENUM 定義に一致させること。
 */
export type MasterStatus =
  | '候補'
  | '連絡中'
  | '返信なし'
  | '多忙辞退'
  | '条件次第'
  | '依頼成功'
  | '依頼不可'
  | '時間をおいて再度連絡';

/** rank_enum */
export type Rank = 'S' | 'A' | 'B' | 'C';

/** Notion の「オーナー確認」multi_select。運用中に担当者が増えるため TEXT[] で保持する。 */
export type Owner = string;

/** Notion の「絵柄タグ」multi_select。運用中にタグが増えるため TEXT[] で保持する。 */
export type StyleTag = string;

/** genre_enum（6値、migration 011 で 広告用 追加） */
export type Genre =
  | 'BLサンド'
  | 'Capuri'
  | 'Berryfeel'
  | 'Webtoon'
  | 'アシスタント'
  | '広告用';

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

  // Legacy（同期ジョブでは基本触らない。migration 018 で10カラム削除済み）
  legacy_contact_status: string | null;
  legacy_mimura_comment: string | null;
  legacy_hojo_comment: string | null;
  legacy_hojo_points: number | null;
  legacy_found_by: string | null;
  legacy_capuri_request_id: string | null;
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

/** sync_state テーブル 1 行 */
export interface SyncStateRow {
  job_name: SyncJobName;
  last_run_at: string;
  updated_at: string;
}

/** sync_failures テーブル 1 行（migration 014 の last_notified_at 追加済み） */
export interface SyncFailureRow {
  id: string;
  source: SyncSource;
  target: SyncTarget;
  record_id: string | null;
  operation: SyncOperation;
  error_message: string;
  retry_count: number;
  failure_key: string;
  occurrence_count: number;
  created_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  last_notified_at: string | null;
}

/** scraping_logs テーブル 1 行（Phase 3 スクレイパー用） */
export interface ScrapingLogRow {
  id: string;
  mode: 'initial' | 'differential' | 'manual';
  seed_username: string | null;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'success' | 'failed' | 'partial';
  candidates_checked: number;
  candidates_new: number;
  candidates_duplicated: number;
  errors: unknown;
  created_at: string;
}
