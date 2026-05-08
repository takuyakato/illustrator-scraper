import type { SupabaseClient } from '@supabase/supabase-js';

export interface ScraperSeed {
  id: string;
  x_username: string;
  artist_name: string;
  rank: string | null;
  genres: string[];
  last_scraped_followings_at: string | null;
  last_scrape_status: string | null;
}

export interface FetchScraperSeedsOptions {
  ranks?: string[];
  limit?: number;
  offset?: number;
  staleDays?: number;
}

export interface MarkScraperSeedRunParams {
  xUsername: string;
  status: 'success' | 'failed' | 'partial' | 'timeout';
  error?: string | null;
}

export async function fetchScraperSeeds(
  supabase: SupabaseClient,
  options: FetchScraperSeedsOptions = {},
): Promise<ScraperSeed[]> {
  const ranks = options.ranks?.length ? options.ranks : ['S', 'A', 'B'];
  const { data, error } = await supabase
    .from('illustrators')
    .select('id, x_username, artist_name, rank, genres, last_scraped_followings_at, last_scrape_status')
    .in('rank', ranks)
    .eq('is_illustrator', true)
    .order('rank', { ascending: true })
    .order('x_username', { ascending: true });

  if (error) throw error;

  const seeds = (data ?? [])
    .filter((row) => row.x_username)
    .filter((row) => !row.x_username.startsWith('(no-x-link-'))
    .filter((row) => !(row.genres ?? []).includes('広告用'))
    .map((row) => ({
      id: row.id as string,
      x_username: row.x_username as string,
      artist_name: row.artist_name ?? '',
      rank: row.rank ?? null,
      genres: Array.isArray(row.genres) ? row.genres : [],
      last_scraped_followings_at: row.last_scraped_followings_at ?? null,
      last_scrape_status: row.last_scrape_status ?? null,
    }))
    .filter((row) => isRunnableSeed(row, options.staleDays))
    .sort(compareScraperSeeds);

  const offset = options.offset && options.offset > 0 ? options.offset : 0;
  const sliced = seeds.slice(offset);
  return typeof options.limit === 'number' && options.limit > 0 ? sliced.slice(0, options.limit) : sliced;
}

export async function markScraperSeedRun(
  supabase: SupabaseClient,
  params: MarkScraperSeedRunParams,
): Promise<void> {
  const { error } = await supabase
    .from('illustrators')
    .update({
      last_scraped_followings_at: new Date().toISOString(),
      last_scrape_status: params.status,
      last_scrape_error: params.error?.slice(0, 1000) ?? null,
    })
    .eq('x_username', params.xUsername);

  if (error) throw error;
}

function isRunnableSeed(seed: ScraperSeed, staleDays: number | undefined): boolean {
  if (!seed.last_scraped_followings_at) return true;
  if (typeof staleDays !== 'number' || staleDays <= 0) return false;

  const lastScrapedAt = Date.parse(seed.last_scraped_followings_at);
  if (!Number.isFinite(lastScrapedAt)) return false;

  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastScrapedAt >= staleMs;
}

function compareScraperSeeds(a: ScraperSeed, b: ScraperSeed): number {
  const aTime = scrapedTime(a);
  const bTime = scrapedTime(b);
  if (aTime !== bTime) return aTime - bTime;

  const rankDiff = rankPriority(a.rank) - rankPriority(b.rank);
  if (rankDiff !== 0) return rankDiff;

  return a.x_username.localeCompare(b.x_username);
}

function scrapedTime(seed: ScraperSeed): number {
  if (!seed.last_scraped_followings_at) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(seed.last_scraped_followings_at);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function rankPriority(rank: string | null): number {
  const order = ['S', 'A', 'B', 'C'];
  const index = rank ? order.indexOf(rank) : -1;
  return index >= 0 ? index : order.length;
}
