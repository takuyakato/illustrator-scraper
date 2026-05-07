/**
 * 手段1 Playwright+GraphQL 傍受: フォロー中取得 POC。
 *
 * 事前: npm run pw:login で storage-state.json を作成しておく。
 *
 * 仕組み:
 *   1. X のフォロー中ページにアクセス（storageState でログイン済み）
 *   2. スクロールしながら page.on('response') で GraphQL レスポンスを傍受
 *   3. レスポンスの構造化 JSON から User データを抽出
 *   4. 200 件到達 or スクロール上限で終了
 *
 * 出力: output-followings.json（サンプル + 統計）
 */
import { chromium, webkit, type Response } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_PATH = resolve(__dirname, 'storage-state.json');
const SEED_PATH = resolve(__dirname, '../_shared/test-seed.json');
const OUTPUT_PATH = resolve(__dirname, 'output-followings.json');
const DEBUG_GRAPHQL_PATH = resolve(__dirname, 'output-graphql-debug.json');

const MAX_ITEMS = 200;
const MAX_SCROLLS = 50;
const SCROLL_DELAY_MIN_MS = 3000;
const SCROLL_DELAY_MAX_MS = 8000;
const MAX_STAGNANT_SCROLLS = 4;
const BROWSER = process.env.PW_BROWSER === 'webkit' ? 'webkit' : 'chromium';

interface Candidate {
  username: string;
  display_name: string;
  bio: string;
  website: string | null;
  follower_count: number;
  following_count: number;
  verified: boolean;
  created_at?: string;
}

if (!existsSync(STORAGE_PATH)) {
  console.error('❌ storage-state.json がありません。先に `npm run pw:login` を実行してください。');
  process.exit(1);
}
if (!existsSync(SEED_PATH)) {
  console.error('❌ test-seed.json がありません。先に `npm run seed` を実行してください。');
  process.exit(1);
}

const seedData = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as {
  candidates?: Array<{ x_username: string; artist_name: string }>;
  selected: { x_username: string; artist_name: string };
};
const seedRecord =
  process.env.X_SEED_USERNAME && seedData.candidates
    ? (seedData.candidates.find((c) => c.x_username === process.env.X_SEED_USERNAME) ?? {
        x_username: process.env.X_SEED_USERNAME,
        artist_name: 'env override',
      })
    : seedData.selected;
const seed = seedRecord.x_username;
console.log(`🎯 Seed: @${seed} (${seedRecord.artist_name})`);

const started = Date.now();
const candidates = new Map<string, Candidate>();
const errors: string[] = [];
let graphqlHits = 0;
let savedDebugGraphql = false;
let followingGraphqlUrl: string | null = null;
let followingGraphqlHeaders: Record<string, string> | null = null;
let nextCursor: string | null = null;

const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch({ headless: false });
const context = await browser.newContext({
  storageState: STORAGE_PATH,
  viewport: { width: 1280, height: 900 },
  locale: 'ja-JP',
});
const page = await context.newPage();

page.on('response', async (res: Response) => {
  const url = res.url();
  // X 内部 GraphQL の Following 系エンドポイント（ハッシュが変わるのでパスで判定）
  if (!url.includes('/i/api/graphql/') || !/\/Following[?/]/.test(url)) return;

  graphqlHits += 1;
  try {
    const json = await res.json();
    followingGraphqlUrl = url;
    followingGraphqlHeaders = pickReusableHeaders(await res.request().allHeaders());
    nextCursor = findBottomCursor(json) ?? nextCursor;
    if (!savedDebugGraphql) {
      writeFileSync(DEBUG_GRAPHQL_PATH, JSON.stringify({ url, json }, null, 2));
      savedDebugGraphql = true;
    }
    const entries = extractEntries(json);
    for (const user of entries) {
      if (!candidates.has(user.username)) candidates.set(user.username, user);
    }
    console.log(`  📡 GraphQL hit #${graphqlHits}: entries=${entries.length}, total=${candidates.size}`);
  } catch (e) {
    errors.push(`GraphQL parse error: ${(e as Error).message}`);
  }
});

console.log(`🌐 Navigating to https://x.com/${seed}/following ...`);
await page.goto(`https://x.com/${seed}/following`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

for (let i = 0; i < MAX_SCROLLS && candidates.size < MAX_ITEMS; i++) {
  const before = candidates.size;
  if (!followingGraphqlUrl || !followingGraphqlHeaders || !nextCursor) {
    console.log('  🔚 次ページ cursor がありません。終了します。');
    break;
  }

  const json = await fetchFollowingPage(page, followingGraphqlUrl, followingGraphqlHeaders, nextCursor);
  graphqlHits += 1;
  const entries = extractEntries(json);
  for (const user of entries) {
    if (!candidates.has(user.username)) candidates.set(user.username, user);
  }
  nextCursor = findBottomCursor(json);
  console.log(`  📡 GraphQL page #${graphqlHits}: entries=${entries.length}, total=${candidates.size}`);

  if (candidates.size === before || !nextCursor) break;

  const delay = SCROLL_DELAY_MIN_MS + Math.random() * (SCROLL_DELAY_MAX_MS - SCROLL_DELAY_MIN_MS);
  await page.waitForTimeout(delay);
}

const duration = Math.round((Date.now() - started) / 1000);
const allCandidates = Array.from(candidates.values());

const output = {
  method: 'playwright+graphql',
  seed,
  stats: {
    totalFetched: allCandidates.length,
    durationSec: duration,
    graphqlHits,
    errors: errors.length,
  },
  errors,
  sample: allCandidates.slice(0, 5),
  candidates: allCandidates,
  allUsernames: allCandidates.map((c) => c.username),
};
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log('\n✅ 完了');
console.log(`   取得件数: ${allCandidates.length}`);
console.log(`   所要: ${duration}秒`);
console.log(`   GraphQL hits: ${graphqlHits}`);
console.log(`   エラー: ${errors.length}件`);
console.log(`   出力: ${OUTPUT_PATH}`);

await browser.close();

function extractEntries(graphqlJson: unknown): Candidate[] {
  // X の GraphQL レスポンス構造は timeline_V2 によくある形
  // data.user.result.timeline.timeline.instructions[*].entries[*].content.itemContent.user_results.result.legacy
  const result: Candidate[] = [];
  const instructions = findPath(graphqlJson, ['data', 'user', 'result', 'timeline', 'timeline', 'instructions']);
  if (!Array.isArray(instructions)) return result;

  for (const instr of instructions) {
    if (instr?.type !== 'TimelineAddEntries') continue;
    for (const entry of instr.entries ?? []) {
      const userResult = entry?.content?.itemContent?.user_results?.result;
      const legacy = userResult?.legacy;
      const core = userResult?.core;
      const username = core?.screen_name ?? legacy?.screen_name;
      if (!username) continue;
      result.push({
        username,
        display_name: core?.name ?? legacy?.name ?? '',
        bio: legacy.description ?? '',
        website: legacy.entities?.url?.urls?.[0]?.expanded_url ?? null,
        follower_count: Number(legacy.followers_count ?? 0),
        following_count: Number(legacy.friends_count ?? 0),
        verified: Boolean(userResult?.verification?.verified ?? legacy.verified ?? userResult.is_blue_verified ?? false),
        created_at: core?.created_at ?? legacy.created_at,
      });
    }
  }
  return result;
}

function findPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

function findBottomCursor(graphqlJson: unknown): string | null {
  const instructions = findPath(graphqlJson, ['data', 'user', 'result', 'timeline', 'timeline', 'instructions']);
  if (!Array.isArray(instructions)) return null;

  for (const instr of instructions) {
    if (!Array.isArray(instr?.entries)) continue;
    for (const entry of instr.entries) {
      const content = entry?.content;
      if (content?.entryType === 'TimelineTimelineCursor' && content?.cursorType === 'Bottom') {
        return typeof content.value === 'string' ? content.value : null;
      }
    }
  }
  return null;
}

function pickReusableHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = [
    'authorization',
    'x-client-transaction-id',
    'x-client-uuid',
    'x-csrf-token',
    'x-twitter-active-user',
    'x-twitter-auth-type',
    'x-twitter-client-language',
  ];
  return Object.fromEntries(allowed.flatMap((key) => (headers[key] ? [[key, headers[key]]] : [])));
}

async function fetchFollowingPage(
  page: Awaited<ReturnType<typeof browser.newPage>>,
  url: string,
  headers: Record<string, string>,
  cursor: string,
): Promise<unknown> {
  return await page.evaluate(
    async ({ url, headers, cursor }) => {
      const nextUrl = new URL(url);
      const rawVariables = nextUrl.searchParams.get('variables');
      const variables = rawVariables ? JSON.parse(rawVariables) : {};
      variables.cursor = cursor;
      nextUrl.searchParams.set('variables', JSON.stringify(variables));

      const res = await fetch(nextUrl.toString(), { credentials: 'include', headers });
      if (!res.ok) throw new Error(`Following page HTTP ${res.status}: ${await res.text()}`);
      return await res.json();
    },
    { url, headers, cursor },
  );
}
