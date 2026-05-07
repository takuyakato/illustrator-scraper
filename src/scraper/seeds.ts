import type { SupabaseClient } from '@supabase/supabase-js';

export interface ScraperSeed {
  x_username: string;
  artist_name: string;
  rank: string | null;
  genres: string[];
}

export async function fetchScraperSeeds(supabase: SupabaseClient, limit?: number): Promise<ScraperSeed[]> {
  const { data, error } = await supabase
    .from('illustrators')
    .select('x_username, artist_name, rank, genres')
    .in('rank', ['S', 'A', 'B'])
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

  return typeof limit === 'number' && limit > 0 ? seeds.slice(0, limit) : seeds;
}
