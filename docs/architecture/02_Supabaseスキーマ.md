# 02. Supabase スキーマ詳細設計

**バージョン**: 1.1
**作成日**: 2026-04-22
**最終更新**: 2026-04-22
**対応プロジェクト**: illustrator-scraper（BL/TL系イラストレーター候補管理）
**対応合意事項**: `docs/00_合意事項リスト.md` v2.1

このドキュメントは、Supabaseプロジェクトのスキーマ詳細仕様書です。
実装時にそのままマイグレーションSQLを書けるレベルの詳細度で記述します。

---

## 1. 概要

### 1.1 スキーマの目的

- BL/TL系イラストレーター候補の**真のデータストア**として、全情報を一元管理する
- スクレイパー・Google Sheets・Notionの3経路の書き込みを集約し、同期の基盤とする
- Notion DBからマイグレーションした全プロパティを**個別カラムで保持**し、後から任意のカラムを同期対象に追加できる設計にする
- 集計・検索・分析のバックエンドとして、インデックス・関数を整備する

### 1.2 テーブル構成

| テーブル名 | 役割 | 主なレコード数想定 |
|---|---|---|
| `illustrators` | メインテーブル。イラストレーター候補と非イラストレーター（除外済み）を混在で保持 | 数万〜10万件 |
| `sync_failures` | 同期失敗ログ。自動リトライ管理と通知メール生成用 | 低頻度 |
| `scraping_logs` | スクレイピング実行履歴。バッチ結果・統計 | 月数十件 |

### 1.3 設計原則

1. **1テーブル + `is_illustrator` フラグ方式**
   - 非イラストレーターもSupabaseに保持（二度取り防止）、ただしNotionには同期しない
   - `is_illustrator` の3状態（`null` / `true` / `false`）で表示先を制御
2. **旧プロパティは個別カラムで保持**（JSONB統合はしない）
   - 後から「このカラムもNotionに同期したい」と決めたときに、スキーマ変更で即対応可能
   - 念のため `migration_snapshot` にマイグレーション時の完全スナップショットも保存
3. **正規化関数をDBレベルに持つ**
   - `x_username` の正規化はスクレイパーとマイグレーションで共用
   - DB側の関数として定義し、トリガー/プリプロセスから呼べる
4. **書き込みは3経路のみ**（スクレイパー・Sheets同期・Notion同期）
   - Supabase Studioでの直接編集は通常運用では禁止（管理者例外：加藤さん）
5. **全変更に自動タイムスタンプ**
   - `updated_at` トリガー・同期タイムスタンプ群で、同期ジョブが差分を検知できる

---

## 2. ENUM型定義

PostgreSQL の `ENUM` 型を使って、型レベルで値を制限します。
（Notion側のselect / multi_selectと値を完全一致させる）

```sql
-- マスターステータス（7値）
CREATE TYPE master_status_enum AS ENUM (
  '候補',
  '連絡中',
  '返信なし',
  '多忙辞退',
  '条件次第',
  '依頼成功',
  '依頼不可'
);

-- ランク（S/A/B/C）
CREATE TYPE rank_enum AS ENUM (
  'S',
  'A',
  'B',
  'C'
);

-- 絵柄タグ（4値）
CREATE TYPE style_tag_enum AS ENUM (
  'イケメン',
  'リアル',
  'デフォルメ',
  'クセ強'
);

-- オーナー（3名）
CREATE TYPE owner_enum AS ENUM (
  '北條',
  '三村',
  '加藤'
);

-- ジャンル（6値）
-- v1.2（2026-04-23）で「広告用」を追加（A/Bランク43件のCW/Lancers/ココナラ広告用作家を分類するため）
CREATE TYPE genre_enum AS ENUM (
  'BLサンド',
  'Capuri',
  'Berryfeel',
  'Webtoon',
  'アシスタント',
  '広告用'
);
```

### 補足：ENUM vs TEXT + CHECK制約の選択

- 本スキーマでは原則 **ENUM** を採用（型安全性とインデックス効率を優先）
- 値追加時は `ALTER TYPE ... ADD VALUE` で対応可能
- 複数選択が必要なカラムは `ENUM[]`（配列）として保持し、配列要素レベルでENUM制約がかかる
- ただし **`contacted_by`（連絡した人）は `TEXT[]` で保持**する。実DBには李・吉澤・長野・木村・野末・赤坂・北條・荻野・加藤・本人からの応募・及川・伊藤など、オーナー3名以外の値が多数含まれており、拡張可能なmulti_selectとして運用するため

---

## 3. テーブル：illustrators（メインテーブル）

### 3.1 カラム一覧（全52カラム）

#### ID・基本識別子（5カラム）

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `id` | `UUID` | YES | `gen_random_uuid()` | PRIMARY KEY | 内部ID |
| `x_username` | `TEXT` | YES | ー | UNIQUE、正規化済み（小文字・@/URL除去） | Xのユーザー名。一意キー |
| `display_name` | `TEXT` | NO | ー | ー | X表示名（スクレイプ時点） |
| `bio` | `TEXT` | NO | ー | ー | Xプロフィール文（最大500文字目安） |
| `follower_count` | `INTEGER` | NO | ー | `CHECK (follower_count >= 0)` | フォロワー数（スクレイプ時点） |

#### スクレイピング情報（4カラム）

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `detected_from` | `TEXT[]` | YES | `'{}'::TEXT[]` | ー | 検出元シードのx_username配列（複数シードから検出された場合は追記） |
| `first_detected_at` | `TIMESTAMPTZ` | YES | `NOW()` | ー | 初回検出日時 |
| `last_seen_at` | `TIMESTAMPTZ` | YES | `NOW()` | ー | 最終検出日時（再検出で上書き更新） |
| `scout_comment` | `TEXT` | NO | ー | ー | スカウトのコメント（Google Sheets L列から同期） |

#### 判定フラグ（1カラム）

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `is_illustrator` | `BOOLEAN` | NO | `NULL` | ー | `null`=未判定（Sheets表示）、`true`=確定（Notion表示）、`false`=除外 |

#### アクティブカラム・Notion同期対象（15カラム）

合意事項リストv2.1「アクティブカラム（17項目・Notion同期対象）」のうち、自動カラム（`id`/`updated_at`）を除いた15項目。

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `artist_name` | `TEXT` | NO | ー | ー | 作家名（Notion title、最優先の表示名） |
| `master_status` | `master_status_enum` | NO | `'候補'` | ー | マスターステータス（7値） |
| `rank` | `rank_enum` | NO | ー | ー | 現在のランク（オーナーが必要に応じて変更） |
| `owner_confirmed_by` | `owner_enum[]` | YES | `'{}'::owner_enum[]` | ー | オーナー確認済み担当者配列（空=未確認） |
| `style_tags` | `style_tag_enum[]` | YES | `'{}'::style_tag_enum[]` | ー | 絵柄タグ（複数選択可、空欄可） |
| `genres` | `genre_enum[]` | YES | `'{}'::genre_enum[]` | ー | ジャンル（複数選択可） |
| `x_link` | `TEXT` | NO | ー | ー | Xプロフィールの完全URL（スクレイパーが構築） |
| `pixiv_link` | `TEXT` | NO | ー | ー | Pixivリンク（初回のみスクレイパー、以降はNotion主導） |
| `portfolio_link` | `TEXT` | NO | ー | ー | ポートフォリオサイトURL |
| `other_contact` | `TEXT` | NO | ー | ー | その他連絡先URL |
| `email` | `TEXT` | NO | ー | ー | メールアドレス（旧「メアド」と統合） |
| `credit_name` | `TEXT` | NO | ー | ー | クレジット名義（rich_text、旧「クレジット希望」を改修） |
| `contacted_at` | `DATE` | NO | ー | ー | 連絡した日（最新連絡日で上書き更新） |
| `contacted_by` | `TEXT[]` | YES | `'{}'::TEXT[]` | ー | 連絡担当者の配列（multi_select、拡張可）。オーナー3名以外の値も含む |
| `note` | `TEXT` | NO | ー | ー | 備考（追記式、ステータス変更ログ含む） |

**補足**: `contacted_by` は `owner_enum` ではなく `TEXT[]` として保持する。実際のNotion DBでは、オーナー3名以外の連絡担当者（李・吉澤・長野・木村・野末・赤坂・北條・荻野・加藤・本人からの応募・及川・伊藤 など）が多数記録されているため、ENUM化すると値の追加のたびに `ALTER TYPE` が必要となり運用負荷が高い。multi_selectとして自由に追加可能な `TEXT[]` で保持し、複数担当者が連絡した履歴も配列として表現する。

#### Legacy カラム・Notion非同期（17カラム）

マイグレーションでSupabaseに保持するが、Notionには同期しない旧プロパティ群。

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `legacy_status` | `TEXT` | NO | ー | ー | 旧「ステータス」 |
| `legacy_status_1` | `TEXT` | NO | ー | ー | 旧「ステータス 1」 |
| `legacy_contact_status` | `TEXT` | NO | ー | ー | 旧「連絡状況」 |
| `legacy_capuri_berryfeel_search` | `TEXT[]` | YES | `'{}'::TEXT[]` | ー | 旧「Capuri/BerryFeel探し」 |
| `legacy_mimura_comment` | `TEXT` | NO | ー | ー | 旧「三村コメント」 |
| `legacy_hojo_comment` | `TEXT` | NO | ー | ー | 旧「北條コメント」 |
| `legacy_mimura_points` | `NUMERIC` | NO | ー | ー | 旧「三村点数」（実データに 7.5 等の小数点ありのため NUMERIC） |
| `legacy_hojo_points` | `NUMERIC` | NO | ー | ー | 旧「北條点数」（同上） |
| `legacy_found_date` | `DATE` | NO | ー | ー | 旧「見つけた日」 |
| `legacy_found_by` | `TEXT` | NO | ー | ー | 旧「見つけた人」 |
| `legacy_start_date` | `DATE` | NO | ー | ー | 旧「開始日」 |
| `legacy_end_date` | `DATE` | NO | ー | ー | 旧「終了予定日」 |
| `legacy_capuri_request_id` | `TEXT` | NO | ー | ー | 旧「Capuri依頼」 |
| `legacy_mail_alt` | `TEXT` | NO | ー | ー | 旧「メアド」（統合前のバックアップ） |
| `legacy_recontact_time` | `TEXT` | NO | ー | ー | 旧「再連絡時期」 |
| `legacy_rejection_reason` | `TEXT[]` | YES | `'{}'::TEXT[]` | ー | 旧「断られた理由」 |
| `migration_snapshot` | `JSONB` | NO | ー | ー | マイグレーション時の完全スナップショット（念のため） |

#### Notion連携（3カラム）

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `notion_page_id` | `TEXT` | NO | ー | UNIQUE（NULL許容） | NotionページID（マイグレーション時 or 初回Push時に設定） |
| `last_synced_to_notion_at` | `TIMESTAMPTZ` | NO | ー | ー | 最後にSupabase→Notionへ送った日時 |
| `last_synced_from_notion_at` | `TIMESTAMPTZ` | NO | ー | ー | 最後にNotion→Supabaseへ取り込んだ日時 |

#### Google Sheets連携（3カラム）

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `sheet_row_index` | `INTEGER` | NO | ー | ー | Google Sheets候補プールの行番号（追跡用、削除時はNULL） |
| `last_synced_to_sheet_at` | `TIMESTAMPTZ` | NO | ー | ー | 最後にSupabase→Sheetsへ送った日時 |
| `last_synced_from_sheet_at` | `TIMESTAMPTZ` | NO | ー | ー | 最後にSheets→Supabaseへ取り込んだ日時 |

#### システム自動（2カラム）

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `created_at` | `TIMESTAMPTZ` | YES | `NOW()` | ー | レコード作成日時 |
| `updated_at` | `TIMESTAMPTZ` | YES | `NOW()` | ー | レコード更新日時（トリガーで自動更新） |

### 3.2 CREATE TABLE SQL

```sql
CREATE TABLE illustrators (
  -- ID・基本識別子
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  x_username                      TEXT NOT NULL UNIQUE,
  display_name                    TEXT,
  bio                             TEXT,
  follower_count                  INTEGER CHECK (follower_count >= 0),

  -- スクレイピング情報
  detected_from                   TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  first_detected_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scout_comment                   TEXT,

  -- 判定フラグ（null=未判定、true=確定、false=除外）
  is_illustrator                  BOOLEAN DEFAULT NULL,

  -- アクティブカラム（Notion同期対象）
  artist_name                     TEXT,
  master_status                   master_status_enum DEFAULT '候補',
  rank                            rank_enum,
  owner_confirmed_by              owner_enum[] NOT NULL DEFAULT '{}'::owner_enum[],
  style_tags                      style_tag_enum[] NOT NULL DEFAULT '{}'::style_tag_enum[],
  genres                          genre_enum[] NOT NULL DEFAULT '{}'::genre_enum[],
  x_link                          TEXT,
  pixiv_link                      TEXT,
  portfolio_link                  TEXT,
  other_contact                   TEXT,
  email                           TEXT,
  credit_name                     TEXT,
  contacted_at                    DATE,
  contacted_by                    TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  note                            TEXT,

  -- Legacy カラム（非表示・Supabase個別保持）
  legacy_status                   TEXT,
  legacy_status_1                 TEXT,
  legacy_contact_status           TEXT,
  legacy_capuri_berryfeel_search  TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  legacy_mimura_comment           TEXT,
  legacy_hojo_comment             TEXT,
  legacy_mimura_points            NUMERIC,
  legacy_hojo_points              NUMERIC,
  legacy_found_date               DATE,
  legacy_found_by                 TEXT,
  legacy_start_date               DATE,
  legacy_end_date                 DATE,
  legacy_capuri_request_id        TEXT,
  legacy_mail_alt                 TEXT,
  legacy_recontact_time           TEXT,
  legacy_rejection_reason         TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  migration_snapshot              JSONB,

  -- Notion連携
  notion_page_id                  TEXT UNIQUE,
  last_synced_to_notion_at        TIMESTAMPTZ,
  last_synced_from_notion_at      TIMESTAMPTZ,

  -- Google Sheets連携
  sheet_row_index                 INTEGER,
  last_synced_to_sheet_at         TIMESTAMPTZ,
  last_synced_from_sheet_at       TIMESTAMPTZ,

  -- システム自動
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 整合性制約
  -- is_illustrator=true の場合は artist_name 必須
  CONSTRAINT chk_illustrator_has_artist_name
    CHECK (is_illustrator IS NOT TRUE OR artist_name IS NOT NULL)

  -- ※ contacted_at / contacted_by のペア制約はv1.1で削除。
  --   既存データで片方だけ入っているレコードが存在する可能性があり、
  --   マイグレーション失敗を避けるため。
);

COMMENT ON TABLE illustrators IS 'BL/TL系イラストレーター候補メインテーブル。スクレイパー・Sheets・Notionの3経路で書き込まれる。';
COMMENT ON COLUMN illustrators.x_username IS '正規化済みX username（小文字・@/URL除去）。一意キー。';
COMMENT ON COLUMN illustrators.is_illustrator IS 'null=未判定（Sheets表示）、true=確定（Notion表示）、false=除外（どちらも非表示）';
COMMENT ON COLUMN illustrators.owner_confirmed_by IS 'オーナー確認済み担当者配列。空=未確認（ビュー1の主フィルタ）';
COMMENT ON COLUMN illustrators.contacted_by IS '連絡担当者の配列（multi_select、拡張可）。オーナー3名に限らず、李・吉澤・長野・木村などスタッフ全般の名前が入る。';
COMMENT ON COLUMN illustrators.migration_snapshot IS '念のためマイグレーション時の完全スナップショット（JSONB）';
```

---

## 4. テーブル：sync_failures

### 4.1 目的

3経路の同期ジョブ（スクレイパー / Sheets / Notion）で発生した**個別レコード単位の失敗**を蓄積する。
自動リトライ最大10回、それでも失敗するものは1時間おきのメールでまとめて通知。

### 4.2 カラム一覧

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `id` | `UUID` | YES | `gen_random_uuid()` | PRIMARY KEY | 失敗ログID |
| `source` | `TEXT` | YES | ー | `CHECK (source IN ('supabase', 'notion', 'sheets', 'scraper'))` | 同期元 |
| `target` | `TEXT` | YES | ー | `CHECK (target IN ('supabase', 'notion', 'sheets'))` | 同期先 |
| `record_id` | `UUID` | NO | ー | `REFERENCES illustrators(id) ON DELETE CASCADE` | 対象レコード（該当時） |
| `operation` | `TEXT` | YES | ー | `CHECK (operation IN ('insert', 'update', 'delete', 'fetch'))` | 操作種別 |
| `error_message` | `TEXT` | YES | ー | ー | エラーメッセージ（内部情報を含む可能性あり・通知には要約のみ） |
| `retry_count` | `INTEGER` | YES | `0` | `CHECK (retry_count >= 0 AND retry_count <= 10)` | 現在までのリトライ回数 |
| `created_at` | `TIMESTAMPTZ` | YES | `NOW()` | ー | 失敗発生日時 |
| `resolved_at` | `TIMESTAMPTZ` | NO | ー | ー | 解決済み日時（`NULL`=未解決） |

### 4.3 CREATE TABLE SQL

```sql
CREATE TABLE sync_failures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL CHECK (source IN ('supabase', 'notion', 'sheets', 'scraper')),
  target          TEXT NOT NULL CHECK (target IN ('supabase', 'notion', 'sheets')),
  record_id       UUID REFERENCES illustrators(id) ON DELETE CASCADE,
  operation       TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete', 'fetch')),
  error_message   TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 10),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

COMMENT ON TABLE sync_failures IS '同期失敗ログ。自動リトライ（最大10回）管理と通知メール生成に使用。';
COMMENT ON COLUMN sync_failures.resolved_at IS 'NULL=未解決（通知対象）、NOT NULL=解決済み（通知対象外）';
```

---

## 5. テーブル：scraping_logs

### 5.1 目的

スクレイピング実行の履歴を残し、実行状況の追跡・統計を取る。
バッチモード識別・処理時間・検出件数などを記録。

### 5.2 カラム一覧

| カラム名 | 型 | NOT NULL | デフォルト | 制約 | 説明 |
|---|---|---|---|---|---|
| `id` | `UUID` | YES | `gen_random_uuid()` | PRIMARY KEY | 実行ID |
| `mode` | `TEXT` | YES | ー | `CHECK (mode IN ('initial', 'differential', 'manual'))` | 実行モード |
| `seed_username` | `TEXT` | NO | ー | ー | 対象シードのx_username（全件処理時はNULL） |
| `started_at` | `TIMESTAMPTZ` | YES | `NOW()` | ー | 実行開始日時 |
| `completed_at` | `TIMESTAMPTZ` | NO | ー | ー | 実行完了日時 |
| `status` | `TEXT` | YES | `'running'` | `CHECK (status IN ('running', 'success', 'failed', 'partial'))` | 実行ステータス |
| `candidates_checked` | `INTEGER` | YES | `0` | ー | 確認した候補件数 |
| `candidates_new` | `INTEGER` | YES | `0` | ー | 新規登録件数 |
| `candidates_duplicated` | `INTEGER` | YES | `0` | ー | 既存重複件数（last_seen_at更新のみ） |
| `errors` | `JSONB` | NO | `'[]'::JSONB` | ー | 発生したエラー詳細の配列 |
| `created_at` | `TIMESTAMPTZ` | YES | `NOW()` | ー | レコード作成日時 |

### 5.3 CREATE TABLE SQL

```sql
CREATE TABLE scraping_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                    TEXT NOT NULL CHECK (mode IN ('initial', 'differential', 'manual')),
  seed_username           TEXT,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'partial')),
  candidates_checked      INTEGER NOT NULL DEFAULT 0,
  candidates_new          INTEGER NOT NULL DEFAULT 0,
  candidates_duplicated   INTEGER NOT NULL DEFAULT 0,
  errors                  JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE scraping_logs IS 'スクレイピング実行履歴。バッチごとの統計・エラー記録。';
COMMENT ON COLUMN scraping_logs.mode IS 'initial=初回フルスキャン、differential=差分スキャン、manual=手動実行';
```

---

## 6. インデックス

### 6.1 一覧

| インデックス名 | 対象テーブル | カラム | 種別 | 目的 |
|---|---|---|---|---|
| `illustrators_pkey` | illustrators | id | PRIMARY KEY | 自動 |
| `illustrators_x_username_key` | illustrators | x_username | UNIQUE | 一意キー / 重複チェック高速化 |
| `illustrators_notion_page_id_key` | illustrators | notion_page_id | UNIQUE（部分） | Notion→Supabase取込時の検索 |
| `idx_illustrators_is_illustrator_true` | illustrators | is_illustrator | 部分インデックス | Notion対象の絞り込み |
| `idx_illustrators_is_illustrator_null` | illustrators | is_illustrator | 部分インデックス | Sheets対象（未判定）の絞り込み |
| `idx_illustrators_master_status` | illustrators | master_status | 通常 | ステータス別検索 |
| `idx_illustrators_rank` | illustrators | rank | 通常 | ランク別検索 |
| `idx_illustrators_genres_gin` | illustrators | genres | GIN | ジャンル配列検索（シード抽出） |
| `idx_illustrators_owner_confirmed_by_gin` | illustrators | owner_confirmed_by | GIN | オーナー確認フィルタ（ビュー1） |
| `idx_illustrators_contacted_by_gin` | illustrators | contacted_by | GIN | 連絡担当者による検索 |
| `idx_illustrators_first_detected_at` | illustrators | first_detected_at | 通常（DESC） | 検出日順ソート（Sheets） |
| `idx_illustrators_last_seen_at` | illustrators | last_seen_at | 通常 | 再検出管理 |
| `idx_illustrators_last_synced_to_notion_at` | illustrators | last_synced_to_notion_at | 通常 | Supabase→Notion差分検知 |
| `idx_illustrators_last_synced_from_notion_at` | illustrators | last_synced_from_notion_at | 通常 | Notion→Supabase差分検知 |
| `idx_illustrators_last_synced_to_sheet_at` | illustrators | last_synced_to_sheet_at | 通常 | Supabase→Sheets差分検知 |
| `idx_illustrators_last_synced_from_sheet_at` | illustrators | last_synced_from_sheet_at | 通常 | Sheets→Supabase差分検知 |
| `idx_illustrators_updated_at` | illustrators | updated_at | 通常 | 全般的な差分検知 |
| `idx_sync_failures_unresolved` | sync_failures | resolved_at, created_at | 部分 | 未解決分のみ高速参照 |
| `idx_sync_failures_record_id` | sync_failures | record_id | 通常 | レコード単位で失敗検索 |
| `idx_scraping_logs_started_at` | scraping_logs | started_at | 通常（DESC） | 最新ログ順参照 |
| `idx_scraping_logs_mode_status` | scraping_logs | mode, status | 複合 | モード別成功/失敗カウント |

### 6.2 CREATE INDEX SQL

```sql
-- 部分インデックス（is_illustrator）
CREATE INDEX idx_illustrators_is_illustrator_true
  ON illustrators (id) WHERE is_illustrator = TRUE;
CREATE INDEX idx_illustrators_is_illustrator_null
  ON illustrators (id) WHERE is_illustrator IS NULL;

-- 通常インデックス
CREATE INDEX idx_illustrators_master_status ON illustrators (master_status);
CREATE INDEX idx_illustrators_rank ON illustrators (rank);

-- 配列カラム用GINインデックス
CREATE INDEX idx_illustrators_genres_gin ON illustrators USING GIN (genres);
CREATE INDEX idx_illustrators_owner_confirmed_by_gin ON illustrators USING GIN (owner_confirmed_by);
CREATE INDEX idx_illustrators_contacted_by_gin ON illustrators USING GIN (contacted_by);

-- 日時系
CREATE INDEX idx_illustrators_first_detected_at ON illustrators (first_detected_at DESC);
CREATE INDEX idx_illustrators_last_seen_at ON illustrators (last_seen_at);
CREATE INDEX idx_illustrators_updated_at ON illustrators (updated_at);

-- 同期用（差分検知）
CREATE INDEX idx_illustrators_last_synced_to_notion_at
  ON illustrators (last_synced_to_notion_at);
CREATE INDEX idx_illustrators_last_synced_from_notion_at
  ON illustrators (last_synced_from_notion_at);
CREATE INDEX idx_illustrators_last_synced_to_sheet_at
  ON illustrators (last_synced_to_sheet_at);
CREATE INDEX idx_illustrators_last_synced_from_sheet_at
  ON illustrators (last_synced_from_sheet_at);

-- sync_failures
CREATE INDEX idx_sync_failures_unresolved
  ON sync_failures (created_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_sync_failures_record_id ON sync_failures (record_id);

-- scraping_logs
CREATE INDEX idx_scraping_logs_started_at ON scraping_logs (started_at DESC);
CREATE INDEX idx_scraping_logs_mode_status ON scraping_logs (mode, status);
```

---

## 7. 関数・トリガー

### 7.1 `update_updated_at()`：更新時刻自動更新

```sql
-- 更新時にupdated_atを自動でNOW()に更新するトリガー関数
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- illustratorsテーブルに適用
CREATE TRIGGER trg_illustrators_update_updated_at
  BEFORE UPDATE ON illustrators
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 7.2 `normalize_x_username(url TEXT)`：Xリンク正規化

```sql
-- Xリンク/ユーザー名を正規化（小文字・@/URL除去・クエリ除去）
-- 入力例: 'https://x.com/Example'、'@example'、'Example' → すべて 'example'
CREATE OR REPLACE FUNCTION normalize_x_username(input TEXT)
RETURNS TEXT AS $$
DECLARE
  result TEXT;
BEGIN
  IF input IS NULL OR LENGTH(TRIM(input)) = 0 THEN
    RETURN NULL;
  END IF;

  result := TRIM(input);

  -- プロトコルとドメインの除去（x.com / twitter.com / www. バリエーション対応）
  result := REGEXP_REPLACE(result, '^https?://(www\.)?(x|twitter)\.com/', '', 'i');

  -- 先頭の @ を除去
  result := REGEXP_REPLACE(result, '^@', '');

  -- クエリパラメータ (?...) を除去
  result := REGEXP_REPLACE(result, '\?.*$', '');

  -- 末尾スラッシュ・パス以降を除去
  result := REGEXP_REPLACE(result, '/.*$', '');

  -- 小文字化
  result := LOWER(result);

  -- 空になったらNULL
  IF LENGTH(result) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION normalize_x_username IS 'Xリンク/ユーザー名を正規化。小文字・@/URL除去・クエリ除去。';
```

### 7.3 `extract_pixiv_url(bio TEXT)`：bioからPixivリンク抽出

```sql
-- bioテキスト内からpixivリンクを抽出
CREATE OR REPLACE FUNCTION extract_pixiv_url(bio TEXT)
RETURNS TEXT AS $$
DECLARE
  url_match TEXT;
BEGIN
  IF bio IS NULL THEN
    RETURN NULL;
  END IF;

  -- pixiv.net/users/数字 形式を優先抽出
  url_match := SUBSTRING(bio FROM 'https?://(?:www\.)?pixiv\.net/(?:en/)?users?/[0-9]+');
  IF url_match IS NOT NULL THEN
    RETURN url_match;
  END IF;

  -- www.pixiv.net/member.php?id=数字 形式
  url_match := SUBSTRING(bio FROM 'https?://(?:www\.)?pixiv\.net/member\.php\?id=[0-9]+');
  IF url_match IS NOT NULL THEN
    RETURN url_match;
  END IF;

  -- その他 pixiv.net で始まるURL全般
  url_match := SUBSTRING(bio FROM 'https?://(?:www\.)?pixiv\.net/[^\s]+');
  RETURN url_match;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION extract_pixiv_url IS 'bioテキストからPixivリンクを抽出（pixiv.net/users/xxx優先）';
```

### 7.4 `is_ai_illustrator(bio TEXT)`：AI絵師キーワード判定

```sql
-- bioテキスト内にAI絵師キーワードが含まれるか判定
CREATE OR REPLACE FUNCTION is_ai_illustrator(bio TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF bio IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 大文字小文字を無視して判定
  RETURN bio ~* '(生成AI|AI絵師|AIイラスト|AIアート|stable ?diffusion|midjourney|nijijourney|dall-?e|novelai|ai generated|ai-generated|ai art)';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_ai_illustrator IS 'bioにAI絵師キーワード（生成AI/Stable Diffusion/Midjourney等）が含まれるか判定';
```

### 7.5 `convert_legacy_to_master_status(...)`：旧ステータス→新マスターステータス変換

実DBの値に基づいた変換マップを実装する。優先順位は以下の通り：

```
連絡状況 > ステータス 1 > ステータス > デフォルト（候補）
```

ロジックの要点：

1. `legacy_contact_status` が「未連絡」**以外**の有効値なら、それに基づいて変換する
2. `legacy_contact_status` が空 or 「未連絡」なら、`legacy_status_1` を参照する
3. `legacy_status_1` も空なら、`legacy_status`（旧ネーム/線画）を参照する
4. すべて空 or 未知の値なら「候補」

```sql
-- 優先順位：連絡状況 > ステータス 1 > ステータス > デフォルト（候補）
-- 「連絡状況=未連絡」は下位（ステータス 1 → ステータス）を参照する特殊ケース
CREATE OR REPLACE FUNCTION convert_legacy_to_master_status(
  legacy_contact_status TEXT,
  legacy_status_1       TEXT,
  legacy_status         TEXT
)
RETURNS master_status_enum AS $$
DECLARE
  cs  TEXT;
  s1  TEXT;
  s   TEXT;
BEGIN
  cs := NULLIF(TRIM(COALESCE(legacy_contact_status, '')), '');
  s1 := NULLIF(TRIM(COALESCE(legacy_status_1, '')), '');
  s  := NULLIF(TRIM(COALESCE(legacy_status, '')), '');

  -- 1. 連絡状況が「未連絡」以外の有効値なら、それで変換
  IF cs IS NOT NULL AND cs <> '未連絡' THEN
    RETURN CASE cs
      WHEN '連絡しない'            THEN '依頼不可'::master_status_enum
      WHEN '連絡中'                THEN '連絡中'::master_status_enum
      WHEN '時間を空けて再連絡'    THEN '多忙辞退'::master_status_enum
      WHEN '依頼失敗'              THEN '依頼不可'::master_status_enum
      WHEN '依頼成功'              THEN '依頼成功'::master_status_enum
      ELSE '候補'::master_status_enum  -- 未知の値は候補扱い
    END;
  END IF;

  -- 2. 連絡状況が空 or 未連絡 → ステータス 1 を参照
  IF s1 IS NOT NULL THEN
    RETURN CASE s1
      WHEN '完了'                      THEN '依頼成功'::master_status_enum
      WHEN '依頼中'                    THEN '連絡中'::master_status_enum
      WHEN '返信あり・依頼できそう'    THEN '連絡中'::master_status_enum
      WHEN '未返信'                    THEN '返信なし'::master_status_enum
      WHEN '連絡したい'                THEN '候補'::master_status_enum
      WHEN 'スケジュール確保済み'      THEN '連絡中'::master_status_enum
      WHEN '依頼前'                    THEN '連絡中'::master_status_enum
      WHEN '再連絡'                    THEN '多忙辞退'::master_status_enum
      WHEN '依頼不可'                  THEN '依頼不可'::master_status_enum
      WHEN '多忙のため辞退'            THEN '多忙辞退'::master_status_enum
      ELSE '候補'::master_status_enum
    END;
  END IF;

  -- 3. ステータス 1 も空 → ステータス（旧ネーム/線画）を参照
  IF s IS NOT NULL THEN
    RETURN CASE s
      WHEN 'ネーム:依頼中'       THEN '連絡中'::master_status_enum
      WHEN '線画:依頼中'         THEN '連絡中'::master_status_enum
      WHEN 'ネーム:頼まない'     THEN '依頼不可'::master_status_enum
      WHEN '線画:頼まない'       THEN '依頼不可'::master_status_enum
      WHEN '未依頼'              THEN '候補'::master_status_enum
      WHEN 'ネーム:継続希望'     THEN '依頼成功'::master_status_enum
      WHEN '線画:継続希望'       THEN '依頼成功'::master_status_enum
      ELSE '候補'::master_status_enum
    END;
  END IF;

  -- 4. すべて空 → デフォルト（候補）
  RETURN '候補'::master_status_enum;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION convert_legacy_to_master_status IS '旧ステータス3値から新マスターステータスへ変換。優先順位：連絡状況 > ステータス 1 > ステータス。連絡状況=未連絡は下位フィールドを参照する特殊ケース。';
```

### 7.6 自動遷移関数：連絡中 → 返信なし（30日経過）

```sql
-- 「連絡中」かつ「連絡した日から30日経過」のレコードを「返信なし」に自動遷移
-- GitHub Actions から1日1回呼び出す想定
CREATE OR REPLACE FUNCTION auto_transition_to_no_reply()
RETURNS INTEGER AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  UPDATE illustrators
     SET master_status = '返信なし'::master_status_enum,
         note = COALESCE(note || E'\n', '') ||
                TO_CHAR(NOW(), 'YYYY-MM-DD') ||
                ' [自動遷移: 連絡中→返信なし] 30日経過'
   WHERE master_status = '連絡中'::master_status_enum
     AND contacted_at IS NOT NULL
     AND contacted_at <= (CURRENT_DATE - INTERVAL '30 days');

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_transition_to_no_reply IS '連絡中ステータスから30日経過したレコードを返信なしに自動遷移。戻り値は更新件数。';
```

### 7.7 `normalize_x_username` の自動適用トリガー

x_username の書き込み時に自動で正規化するトリガー。

```sql
CREATE OR REPLACE FUNCTION normalize_x_username_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.x_username IS NOT NULL THEN
    NEW.x_username := normalize_x_username(NEW.x_username);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_illustrators_normalize_x_username
  BEFORE INSERT OR UPDATE OF x_username ON illustrators
  FOR EACH ROW
  EXECUTE FUNCTION normalize_x_username_trigger();
```

---

## 8. RLS（Row Level Security）ポリシー

合意事項リストv2.1「書き込みは3経路のみ」を実装レベルで担保する。

### 8.1 方針

| ロール | illustrators | sync_failures | scraping_logs |
|---|---|---|---|
| `service_role`（同期ジョブ・スクレイパー） | 全操作可 | 全操作可 | 全操作可 |
| `authenticated`（Supabase Studio等） | 読み取りのみ | 読み取りのみ | 読み取りのみ |
| `anon`（匿名） | アクセス不可 | アクセス不可 | アクセス不可 |

**注**: 加藤さん（管理者）がStudioから手動修正したい場合、PostgreSQLのsuperuser権限またはservice_role経由で実行する。

### 8.2 ポリシーSQL

```sql
-- RLS有効化
ALTER TABLE illustrators      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_failures     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_logs     ENABLE ROW LEVEL SECURITY;

-- ===== illustrators =====
-- service_role は全操作可
CREATE POLICY illustrators_service_role_all
  ON illustrators
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- authenticated は SELECT のみ
CREATE POLICY illustrators_authenticated_select
  ON illustrators
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- anon は明示的に拒否（ポリシー未定義で実質拒否になるが、可読性のため明示）
-- ※ RLSは「ポリシーに合致したものだけ許可」なので、anonに対するポリシーを作らなければ拒否される

-- ===== sync_failures =====
CREATE POLICY sync_failures_service_role_all
  ON sync_failures
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY sync_failures_authenticated_select
  ON sync_failures
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- ===== scraping_logs =====
CREATE POLICY scraping_logs_service_role_all
  ON scraping_logs
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY scraping_logs_authenticated_select
  ON scraping_logs
  FOR SELECT
  TO authenticated
  USING (TRUE);
```

### 8.3 anon ロールの封鎖確認

- ポリシーを作らなければ、RLS有効時は全操作が拒否される
- クライアント側で誤ってanon keyを使っても、データ読み書き不可

---

## 9. 重複チェックロジック

### 9.1 UPSERT時のロジック（スクレイパー）

合意事項リストv2.1「重複チェック」セクションの実装。

```sql
-- スクレイパーから1候補を投入するときのUPSERT
-- 入力値は事前に normalize_x_username() で正規化済みとする
INSERT INTO illustrators (
  x_username,
  display_name,
  bio,
  follower_count,
  x_link,
  pixiv_link,
  detected_from,
  first_detected_at,
  last_seen_at,
  is_illustrator
) VALUES (
  $1,                  -- 正規化済みx_username
  $2,                  -- display_name
  $3,                  -- bio
  $4,                  -- follower_count
  $5,                  -- x_link（完全URL）
  extract_pixiv_url($3),  -- bioから自動抽出
  ARRAY[$6]::TEXT[],   -- 検出元シード
  NOW(),
  NOW(),
  NULL                 -- 未判定
)
ON CONFLICT (x_username) DO UPDATE SET
  -- 既存あり：last_seen_at を更新 + 検出元を追加（重複削除）
  last_seen_at = NOW(),
  detected_from = ARRAY(
    SELECT DISTINCT unnest(illustrators.detected_from || EXCLUDED.detected_from)
  )
  -- ★ アクティブカラム（artist_name等）は既存値を変更しない
  -- ★ Google Sheetsには追加しない（UI側で last_seen_at が古い/新しいで判別するわけではなく、
  --    既存IDはそもそもSheetsに表示対象外）
RETURNING id, (xmax = 0) AS inserted;  -- inserted=TRUE なら新規、FALSE なら既存
```

### 9.2 新規 vs 既存の判別

`RETURNING (xmax = 0) AS inserted`:
- `TRUE` → 新規INSERT（`is_illustrator = NULL` のまま → Sheets表示対象）
- `FALSE` → 既存UPDATE（`last_seen_at` 更新のみ → Sheets表示対象外）

### 9.3 Phase 1判定ロジック（スクレイパー側で事前に実施）

```
入力候補1件：
  ① is_ai_illustrator(bio) = TRUE
     → is_illustrator = false で INSERT（Notion/Sheets非表示、二度取り防止）

  ② extract_pixiv_url(bio) IS NULL
     → is_illustrator = false で INSERT（二度取り防止）

  ③ それ以外（Pixivリンクあり、AIキーワードなし）
     → is_illustrator = NULL で UPSERT（スカウト判定待ち、Sheets表示）
```

### 9.4 Notion主導の更新時

```sql
-- Notion→Supabase同期ジョブのUPDATE例
UPDATE illustrators
   SET master_status              = $1,
       rank                       = $2,
       owner_confirmed_by         = $3::owner_enum[],
       style_tags                 = $4::style_tag_enum[],
       genres                     = $5::genre_enum[],
       pixiv_link                 = $6,  -- 2回目以降はNotion主導
       portfolio_link             = $7,
       other_contact              = $8,
       email                      = $9,
       credit_name                = $10,
       contacted_at               = $11,
       contacted_by               = $12::TEXT[],
       note                       = $13,
       last_synced_from_notion_at = NOW()
 WHERE notion_page_id = $14;
```

### 9.5 Sheets主導の更新時（スカウト判定反映）

```sql
-- Sheets→Supabase同期ジョブのUPDATE例
UPDATE illustrators
   SET is_illustrator            = $1,  -- true / false / NULL
       rank                      = COALESCE($2::rank_enum, rank),  -- 仮ランクが入力された場合のみ
       scout_comment             = $3,
       last_synced_from_sheet_at = NOW()
 WHERE id = $4;
```

---

## 10. マイグレーション順序

CREATE文を以下の順で実行します（依存関係を考慮）。

### 10.1 実行順序

```
Step 1: 拡張機能の有効化（必要なら）
  - CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() 用

Step 2: ENUM型の作成
  - master_status_enum
  - rank_enum
  - style_tag_enum
  - owner_enum
  - genre_enum

Step 3: テーブルの作成
  - illustrators
  - sync_failures（illustrators を参照）
  - scraping_logs

Step 4: インデックスの作成
  - illustrators の全インデックス
  - sync_failures の全インデックス
  - scraping_logs の全インデックス

Step 5: 関数の作成
  - update_updated_at
  - normalize_x_username
  - normalize_x_username_trigger
  - extract_pixiv_url
  - is_ai_illustrator
  - convert_legacy_to_master_status
  - auto_transition_to_no_reply

Step 6: トリガーの作成
  - trg_illustrators_update_updated_at
  - trg_illustrators_normalize_x_username

Step 7: RLS有効化とポリシー作成
  - ALTER TABLE ... ENABLE ROW LEVEL SECURITY
  - CREATE POLICY ...

Step 8: マイグレーションデータ投入（詳細は03_マイグレーション手順.md）
  - Notion DBから全レコード取得
  - convert_legacy_to_master_status で変換
  - rank に旧ランクをそのままコピー
  - owner_confirmed_by = {}
  - contacted_by は旧「連絡した人」を配列化（例: ["李"]）
  - is_illustrator = true
  - migration_snapshot に元データを格納
```

### 10.2 マイグレーションファイル構成案（Supabase CLI）

```
supabase/migrations/
├── 20260422000001_create_enums.sql
├── 20260422000002_create_illustrators.sql
├── 20260422000003_create_sync_failures.sql
├── 20260422000004_create_scraping_logs.sql
├── 20260422000005_create_indexes.sql
├── 20260422000006_create_functions.sql
├── 20260422000007_create_triggers.sql
├── 20260422000008_enable_rls.sql
└── 20260422000009_seed_from_notion.sql  -- 後日、Notion側のエクスポートと合わせて作成
```

### 10.3 ロールバック方針

開発中は各ファイルに対応する `DROP` 文を別ファイル（`down.sql`）として用意。
本番適用後はDB自動バックアップ（日次）からのリストアを正とする。

---

## 11. 参考：よくあるクエリパターン

### 11.1 シード抽出（合意事項リストv2.1より）

```sql
-- 合意事項リスト v2.2（2026-04-23）で条件変更
SELECT id, x_username, artist_name, rank, genres
  FROM illustrators
 WHERE rank IN ('S', 'A', 'B')
   AND NOT ('広告用'::genre_enum = ANY(genres))
   AND is_illustrator = TRUE
 ORDER BY rank, last_seen_at DESC;
```

### 11.2 ビュー1「オーナー確認用」のベースクエリ

```sql
SELECT id, artist_name, master_status, rank,
       owner_confirmed_by, style_tags, genres, contacted_at,
       x_link, pixiv_link, portfolio_link, note
  FROM illustrators
 WHERE is_illustrator = TRUE
   AND cardinality(owner_confirmed_by) = 0  -- オーナー確認=空
 ORDER BY
   -- 優先順位：依頼成功 → 候補 → 連絡中 → 返信なし → 多忙辞退 → 条件次第 → 依頼不可
   CASE master_status
     WHEN '依頼成功' THEN 1
     WHEN '候補'     THEN 2
     WHEN '連絡中'   THEN 3
     WHEN '返信なし' THEN 4
     WHEN '多忙辞退' THEN 5
     WHEN '条件次第' THEN 6
     WHEN '依頼不可' THEN 7
   END,
   rank;  -- S → A → B → C（ENUM定義順）
```

### 11.3 差分検知（Supabase→Notion同期）

```sql
-- last_synced_to_notion_at より updated_at が新しいものが同期対象
SELECT *
  FROM illustrators
 WHERE is_illustrator = TRUE
   AND (
        last_synced_to_notion_at IS NULL
     OR updated_at > last_synced_to_notion_at
   );
```

### 11.4 未解決の同期失敗件数

```sql
SELECT source, target, COUNT(*) AS failed_count
  FROM sync_failures
 WHERE resolved_at IS NULL
   AND retry_count >= 10  -- リトライ上限に達したもの（通知対象）
 GROUP BY source, target;
```

### 11.5 特定担当者が連絡したレコード検索（contacted_by 配列検索）

```sql
-- 例：「李」が連絡したレコードを抽出
SELECT id, artist_name, contacted_at, contacted_by, master_status
  FROM illustrators
 WHERE '李' = ANY(contacted_by)
 ORDER BY contacted_at DESC NULLS LAST;
```

---

## 12. 運用上の注意

### 12.1 ENUM値の追加

Notion側でselect/multi_selectの選択肢を追加した場合、対応するENUMにも追加が必要：

```sql
-- 例：ジャンルに「BLコミカライズ」を追加
ALTER TYPE genre_enum ADD VALUE 'BLコミカライズ';
```

**注意**: `ALTER TYPE ... ADD VALUE` はトランザクション内で実行できない。マイグレーションは単独のSQLファイルとして切り出す。

なお `contacted_by` は `TEXT[]` で保持しているため、新しい担当者が増えてもDBスキーマ変更は不要（Notion側の選択肢追加のみで対応可能）。

### 12.2 migration_snapshot の活用

旧データの個別カラム化で漏れがあっても、`migration_snapshot` に完全データが残っているので復旧可能：

```sql
-- 例：マイグレーション後に「この旧プロパティもカラム化したかった」と気づいた場合
ALTER TABLE illustrators ADD COLUMN legacy_new_field TEXT;

UPDATE illustrators
   SET legacy_new_field = migration_snapshot->>'新しく取り出したいプロパティ名'
 WHERE migration_snapshot IS NOT NULL;
```

### 12.3 `updated_at` と同期タイムスタンプの使い分け

- `updated_at` は**どんな更新でも**自動更新される（同期ジョブも含む）
- `last_synced_to_notion_at` はSupabase→Notion書き込み成功時のみ、同期ジョブが明示的に更新
- `last_synced_from_notion_at` はNotion→Supabase取り込み時、同期ジョブが明示的に更新
- ループ防止の基本：`updated_at > last_synced_from_notion_at` かつ Supabase主導フィールドに変更あり → Notionへ送る

---

## 改訂履歴

| バージョン | 日付 | 内容 | 担当 |
|---|---|---|---|
| 1.0 | 2026-04-22 | 初版作成（合意事項リストv2.0ベース） | 加藤 |
| 1.1 | 2026-04-22 | legacy_rank削除・contacted_by型変更・変換関数修正・整合性修正 | 加藤 |
