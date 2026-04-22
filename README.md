# illustrator-scraper

BL/TL系イラストレーター候補をX（旧Twitter）のフォローグラフから自動発掘する半自動スクレイピングシステム。

## 📐 システム構成

```
[X（Twitter）フォローグラフ]
         ↓ スクレイパー（順次一括・オンデマンド）
[Supabase（真のデータストア・直接編集なし）]
         ↓ 10分おき同期      ↑ 10分おき同期
[Google Sheets（スカウト作業場所）]   [Notion（オーナー・連絡担当の作業場所）]
                                           ↓ relation
                                    [Notion 案件管理DB（別DB）]
```

## 📚 ドキュメント

実装・運用の前に必ず以下を参照してください（順序推奨）：

1. **[合意事項リスト v2.1](./docs/00_合意事項リスト.md)** ← 最優先・すべての仕様の根拠
2. [実装ロードマップ](./docs/architecture/00_実装ロードマップ.md) ← Phase 0〜5 の進め方
3. [Supabaseスキーマ v1.1](./docs/architecture/02_Supabaseスキーマ.md)
4. [マイグレーション手順書 v1.1](./docs/architecture/03_マイグレーション手順.md)
5. [整合性チェックリスト](./docs/architecture/99_整合性チェックリスト.md)

古いドキュメント（Notion中心時代・参考のみ）は `docs/_archive/` 配下にあります。

## 🚀 セットアップ

### 必要環境

- Node.js 20以降
- pnpm または npm
- Supabase Proプラン以上
- Notion インテグレーション `Claude.Bisque`

### 初期セットアップ

```bash
# 依存関係インストール
npm install
# または
pnpm install

# 環境変数ファイルを作成してから編集
cp .env.local.example .env.local
# .env.local を開いて実値を記入

# 型チェック
npm run typecheck
```

## 🏗 マイグレーション（Phase 1）

Notion の既存DBデータを Supabase に移行する手順は [マイグレーション手順書 v1.1](./docs/architecture/03_マイグレーション手順.md) を参照。

### 実行コマンド

```bash
# 1. ドライラン（実データを変更しない・動作確認）
npm run migrate:dryrun

# 2. 本番実行
npm run migrate:run

# 3. Berryfeel別DBの統合
npm run migrate:berryfeel

# 4. Notion側のクリーンアップ
npm run migrate:notion-cleanup
```

## 🔒 セキュリティ

- 秘密情報は `.env.local` のみ（コード・Markdown・README に直接書かない）
- `.env*` は `.gitignore` で除外
- Supabase `service_role_key` はサーバーサイドのみ（クライアントに渡さない）
- 詳細は [`/Users/takuyakato/projects/CLAUDE.md`](../CLAUDE.md) のセキュリティ原則を参照

## 📝 ライセンス

Private / 内部利用のみ
