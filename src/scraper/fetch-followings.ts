/**
 * 1シードの followings を最大200件取得して JSON 出力する。
 *
 * Phase 3 本実装の最初の単位。デフォルトは dry-run で、
 * SCRAPER_WRITE=true の時だけ Supabase に書き込む。
 */
import { chromium, type Page } from 'playwright';
import { config as loadDotenv } from 'dotenv';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type ScrapedFollowing, toCandidateRecord } from './filter.js';
import { createSupabaseClientFromEnv, fetchExistingIllustrators, writeScraperCandidates } from './upsert.js';

loadDotenv({ path: path.resolve(process.cwd(), '.env.local') });

const storagePath = path.resolve(process.cwd(), '.scraper/x-storage-state.json');
const outputPath = path.resolve(process.cwd(), 'tmp/scraper-followings.json');
const maxItems = Number(process.env.SCRAPER_MAX_ITEMS ?? 200);
const headless = process.env.SCRAPER_HEADLESS === 'true';
const shouldWrite = process.env.SCRAPER_WRITE === 'true';

type Candidate = ScrapedFollowing;

interface SeedRecord {
  x_username: string;
  artist_name: string;
}

if (!existsSync(storagePath)) {
  console.error(`ログイン状態がありません。先に npm run scraper:login を実行してください: ${storagePath}`);
  process.exit(1);
}

const seed = await resolveSeed();
console.log(`Seed: @${seed.x_username} (${seed.artist_name})`);

const browser = await chromium.launch({ headless });
const context = await browser.newContext({
  storageState: storagePath,
  viewport: { width: 1280, height: 900 },
  locale: 'ja-JP',
});
const page = await context.newPage();

const candidates = new Map<string, Candidate>();
const errors: string[] = [];
let followingGraphqlUrl: string | null = null;
let followingGraphqlHeaders: Record<string, string> | null = null;
let nextCursor: string | null = null;
let graphqlPages = 0;

const started = Date.now();
const initialResponsePromise = page.waitForResponse(
  (res) => {
    const url = res.url();
    return url.includes('/i/api/graphql/') && /\/Following[?/]/.test(url);
  },
  { timeout: 30000 },
);

await page.goto(`https://x.com/${seed.x_username}/following`, { waitUntil: 'domcontentloaded' });

try {
  const initialResponse = await initialResponsePromise;
  followingGraphqlUrl = initialResponse.url();
  followingGraphqlHeaders = pickReusableHeaders(await initialResponse.request().allHeaders());
  graphqlPages += 1;

  const json = await initialResponse.json();
  nextCursor = findBottomCursor(json);
  for (const user of extractEntries(json)) {
    candidates.set(user.username, user);
  }
  console.log(`GraphQL page #${graphqlPages}: total=${candidates.size}`);
} catch (e) {
  errors.push(`Initial Following GraphQL error: ${(e as Error).message}`);
}

while (candidates.size < maxItems && followingGraphqlUrl && followingGraphqlHeaders && nextCursor) {
  const before = candidates.size;
  let json: unknown;
  try {
    json = await fetchFollowingPage(page, followingGraphqlUrl, followingGraphqlHeaders, nextCursor);
    graphqlPages += 1;
  } catch (e) {
    errors.push(`Following page fetch error: ${(e as Error).message}`);
    break;
  }

  for (const user of extractEntries(json)) {
    candidates.set(user.username, user);
  }
  nextCursor = findBottomCursor(json);
  console.log(`GraphQL page #${graphqlPages}: total=${candidates.size}`);

  if (candidates.size === before || !nextCursor) break;
  await page.waitForTimeout(3000 + Math.random() * 5000);
}

const allCandidates = Array.from(candidates.values()).slice(0, maxItems);
const preparedRecords = allCandidates
  .map((candidate) => toCandidateRecord(candidate, seed.x_username))
  .filter((record): record is NonNullable<typeof record> => Boolean(record));
const supabase = createSupabaseClientFromEnv();
const existingByUsername = await fetchExistingIllustrators(
  supabase,
  preparedRecords.map((record) => record.x_username),
);
const newRecords = preparedRecords.filter((record) => !existingByUsername.has(record.x_username));
const duplicateRecords = preparedRecords.filter((record) => existingByUsername.has(record.x_username));
const writeResult = shouldWrite
  ? await writeScraperCandidates(supabase, preparedRecords, existingByUsername)
  : { inserted: 0, updated: 0 };
const durationSec = Math.round((Date.now() - started) / 1000);

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      method: 'playwright-graphql',
      seed,
      stats: {
        mode: shouldWrite ? 'write' : 'dry-run',
        totalFetched: allCandidates.length,
        prepared: preparedRecords.length,
        newCandidates: newRecords.length,
        duplicated: duplicateRecords.length,
        inserted: writeResult.inserted,
        updated: writeResult.updated,
        excludedByAi: preparedRecords.filter((record) => record.exclusion_reason === 'ai_keyword').length,
        excludedByNoPixiv: preparedRecords.filter((record) => record.exclusion_reason === 'no_pixiv_link').length,
        pendingScout: preparedRecords.filter((record) => record.is_illustrator === null).length,
        durationSec,
        graphqlPages,
        errors: errors.length,
      },
      errors,
      sample: allCandidates.slice(0, 5),
      candidates: allCandidates,
      preparedRecords,
      newRecords,
      duplicateUsernames: duplicateRecords.map((record) => record.x_username),
    },
    null,
    2,
  ),
);

console.log(
  `完了(${shouldWrite ? 'write' : 'dry-run'}): fetched=${allCandidates.length}, new=${newRecords.length}, duplicated=${duplicateRecords.length}, inserted=${writeResult.inserted}, updated=${writeResult.updated}, pending=${preparedRecords.filter((record) => record.is_illustrator === null).length}, excluded=${preparedRecords.filter((record) => record.is_illustrator === false).length} / ${durationSec}秒 / errors=${errors.length}`,
);
console.log(`出力: ${outputPath}`);

await browser.close();
if (errors.length > 0 && allCandidates.length === 0) {
  process.exit(1);
}

async function resolveSeed(): Promise<SeedRecord> {
  if (process.env.X_SEED_USERNAME) {
    return { x_username: process.env.X_SEED_USERNAME, artist_name: 'env override' };
  }

  const supabase = createSupabaseClientFromEnv();

  const { data, error } = await supabase
    .from('illustrators')
    .select('x_username, artist_name, genres, is_illustrator, rank')
    .eq('rank', 'S')
    .eq('is_illustrator', true)
    .limit(20);

  if (error) throw error;

  const seed = (data ?? []).find(
    (r) => r.x_username && !r.x_username.startsWith('(no-x-link-') && !(r.genres ?? []).includes('広告用'),
  );
  if (!seed?.x_username) {
    console.error('利用可能な S ランクシードが見つかりませんでした。X_SEED_USERNAME を指定してください。');
    process.exit(1);
  }

  return { x_username: seed.x_username, artist_name: seed.artist_name ?? '' };
}

function extractEntries(graphqlJson: unknown): Candidate[] {
  const result: Candidate[] = [];
  const instructions = findPath(graphqlJson, ['data', 'user', 'result', 'timeline', 'timeline', 'instructions']);
  if (!Array.isArray(instructions)) return result;

  for (const instr of instructions) {
    if (!Array.isArray(instr?.entries)) continue;
    for (const entry of instr.entries) {
      const userResult = entry?.content?.itemContent?.user_results?.result;
      const legacy = userResult?.legacy;
      const core = userResult?.core;
      const username = core?.screen_name ?? legacy?.screen_name;
      if (!username) continue;

      result.push({
        username,
        display_name: core?.name ?? legacy?.name ?? '',
        bio: legacy?.description ?? '',
        website: legacy?.entities?.url?.urls?.[0]?.expanded_url ?? null,
        bio_urls: (legacy?.entities?.description?.urls ?? [])
          .map((u: { expanded_url?: string }) => u.expanded_url)
          .filter((url: string | undefined): url is string => Boolean(url)),
        follower_count: Number(legacy?.followers_count ?? 0),
        following_count: Number(legacy?.friends_count ?? 0),
        verified: Boolean(userResult?.verification?.verified ?? legacy?.verified ?? userResult?.is_blue_verified ?? false),
        created_at: core?.created_at ?? legacy?.created_at,
      });
    }
  }
  return result;
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

function findPath(obj: unknown, keys: string[]): unknown {
  let cur = obj;
  for (const key of keys) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
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
  page: Page,
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
