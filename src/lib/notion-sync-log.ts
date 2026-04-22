/**
 * Notion 同期失敗ログページへの追記ヘルパー。
 *
 * - ページ ID は NOTION_SYNC_LOG_PAGE_ID
 * - 1時間おきに未解決（retry_count>=10 かつ resolved_at IS NULL）を集計して
 *   H3 ブロック + bullet list を append する
 * - Notion 書き込み自体が失敗した場合は stderr（logger）にフォールバック
 */

import { logger } from './logger.js';
import { loadSyncEnv } from './env.js';
import { notion, sleep, NOTION_RATE_LIMIT_SLEEP_MS } from './notion.js';

const env = loadSyncEnv();

export interface SyncLogFailure {
  source: string;
  target: string;
  error_message: string;
  created_at?: string;
}

/**
 * 失敗リストを受け取り、Notion ログページに追記する。
 * 0件なら何もしない（呼び出し側で弾いてもよいが、二重防御としてここでもチェック）。
 */
export async function appendFailureLogToNotion(failures: SyncLogFailure[]): Promise<void> {
  if (failures.length === 0) {
    logger.info('failure 0件。Notion ログへの追記をスキップ');
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const grouped: Record<string, SyncLogFailure[]> = {};
  for (const f of failures) {
    const key = `${f.source}→${f.target}`;
    (grouped[key] ??= []).push(f);
  }

  // Notion blocks 構築
  const children: Array<Record<string, unknown>> = [
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [
          {
            type: 'text',
            text: { content: `[${now}] 同期失敗通知（計 ${failures.length} 件）` },
          },
        ],
      },
    },
  ];

  for (const [key, items] of Object.entries(grouped)) {
    const sample = (items[0]?.error_message ?? '').slice(0, 200);
    children.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          {
            type: 'text',
            text: { content: `${key}: ${items.length} 件 / 例: ${sample}` },
          },
        ],
      },
    });
  }

  try {
    await notion.blocks.children.append({
      block_id: env.NOTION_SYNC_LOG_PAGE_ID,
      // @ts-expect-error Notion SDK の型が children の型を細かく要求するが、最小表現で十分動く
      children,
    });
    logger.info({ count: failures.length }, '失敗通知を Notion ログページに追記');
    await sleep(NOTION_RATE_LIMIT_SLEEP_MS);
  } catch (e) {
    logger.error({ err: e, failureCount: failures.length }, 'Notion ログ追記に失敗（フォールバックで stderr 出力）');
  }
}
