/**
 * Notion API クライアント（同期ジョブ用）。
 *
 * - @notionhq/client を内部で保持
 * - 3 req/sec のレート制限に合わせ sleep(400ms) を共通ヘルパーとして提供
 * - databases.query をページネーション込みでラップした queryAll を提供
 */

import { Client } from '@notionhq/client';
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  QueryDatabaseParameters,
} from '@notionhq/client/build/src/api-endpoints.js';

import { loadSyncEnv } from './env.js';
import { fetchWithIdentityEncoding } from './http.js';
import { logger } from './logger.js';
import { withTransientRetry } from './retry.js';

const env = loadSyncEnv();

export const notion = new Client({
  auth: env.NOTION_API_KEY,
  fetch: fetchWithIdentityEncoding,
});

/** Notion API レート制限対策（3 req/sec → 400ms sleep で 2.5 req/sec に抑える） */
export const NOTION_RATE_LIMIT_SLEEP_MS = 400;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isFullPage(
  page: PageObjectResponse | PartialPageObjectResponse,
): page is PageObjectResponse {
  return 'properties' in page;
}

/**
 * databases.query をページネーション込みでラップし、全件を配列で返す。
 * filter/sorts は呼び出し側で指定可能。
 */
export async function queryAll(
  params: Omit<QueryDatabaseParameters, 'start_cursor' | 'page_size'>,
): Promise<PageObjectResponse[]> {
  const results: PageObjectResponse[] = [];
  let cursor: string | undefined = undefined;
  let pageIndex = 0;

  do {
    pageIndex += 1;
    const res = await withTransientRetry(
      () => notion.databases.query({
        ...params,
        start_cursor: cursor,
        page_size: 100,
      }),
      { label: `notion.databases.query page=${pageIndex}` },
    );

    for (const p of res.results) {
      if (isFullPage(p as PageObjectResponse | PartialPageObjectResponse)) {
        results.push(p as PageObjectResponse);
      }
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    logger.debug({ pageIndex, cursor, accumulated: results.length }, 'Notion queryAll 進行中');
    await sleep(NOTION_RATE_LIMIT_SLEEP_MS);
  } while (cursor);

  return results;
}
