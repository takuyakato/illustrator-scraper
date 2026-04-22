/**
 * Notion API クライアントのラッパー。
 *
 * - Notion SDK（@notionhq/client）を内部で利用
 * - ページネーションをまとめて処理する `queryAll` を提供
 * - レート制限（3 req/sec）対策で 400ms の sleep を挟む
 */

import { Client } from '@notionhq/client';
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  UpdatePageParameters,
} from '@notionhq/client/build/src/api-endpoints.js';

import { loadAppEnv } from './env.js';
import { logger } from './logger.js';

const env = loadAppEnv();

/** 共有 Notion クライアント */
export const notion = new Client({
  auth: env.NOTION_API_KEY,
});

/** Notion API のレート制限対策 sleep（3 req/sec → 400ms で 2.5 req/sec に抑える） */
export const NOTION_RATE_LIMIT_SLEEP_MS = 400;

/** 単純な Promise ベースの sleep */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 型ガード：PageObjectResponse かどうか判定する */
export function isFullPage(
  page: PageObjectResponse | PartialPageObjectResponse,
): page is PageObjectResponse {
  return 'properties' in page;
}

/**
 * 指定データベースの全レコードを取得する。
 * Notion API のページネーションを自動で追跡し、全件をフラットな配列で返す。
 *
 * @param databaseId Notion DB の ID
 */
export async function queryAll(databaseId: string): Promise<PageObjectResponse[]> {
  const results: PageObjectResponse[] = [];
  let startCursor: string | undefined = undefined;
  let pageIndex = 0;

  do {
    pageIndex += 1;
    logger.debug({ databaseId, pageIndex, startCursor }, 'Notion queryAll: ページ取得');

    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (isFullPage(page as PageObjectResponse | PartialPageObjectResponse)) {
        results.push(page as PageObjectResponse);
      }
    }

    startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;

    // レート制限対策の sleep
    await sleep(NOTION_RATE_LIMIT_SLEEP_MS);
  } while (startCursor);

  logger.info({ databaseId, count: results.length }, 'Notion queryAll: 取得完了');
  return results;
}

/**
 * Notion ページの properties を更新する薄いラッパー。
 * レート制限対策の sleep を内蔵。
 */
export async function updatePageProperties(
  pageId: string,
  properties: UpdatePageParameters['properties'],
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties,
  });
  await sleep(NOTION_RATE_LIMIT_SLEEP_MS);
}
