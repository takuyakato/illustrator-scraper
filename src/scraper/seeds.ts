import type { SupabaseClient } from '@supabase/supabase-js';

export interface ScraperSeed {
  x_username: string;
  artist_name: string;
  rank: string | null;
  genres: string[];
}

export interface FetchScraperSeedsOptions {
  ranks?: string[];
  limit?: number;
  offset?: number;
}

export async function fetchScraperSeeds(
  supabase: SupabaseClient,
  options: FetchScraperSeedsOptions = {},
): Promise<ScraperSeed[]> {
  const ranks = options.ranks?.length ? options.ranks : ['S', 'A', 'B'];
  const { data, error } = await supabase
    .from('illustrators')
    .select('x_username, artist_name, rank, genres')
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
      x_username: row.x_username as string,
      artist_name: row.artist_name ?? '',
      rank: row.rank ?? null,
      genres: Array.isArray(row.genres) ? row.genres : [],
    }));

  const offset = options.offset && options.offset > 0 ? options.offset : 0;
  const sliced = seeds.slice(offset);
  return typeof options.limit === 'number' && options.limit > 0 ? sliced.slice(0, options.limit) : sliced;
}
