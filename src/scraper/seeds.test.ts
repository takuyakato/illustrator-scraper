import { describe, expect, it, vi } from 'vitest';

import { fetchScraperSeeds } from './seeds.js';

describe('fetchScraperSeeds', () => {
  it('filters out placeholder and advertising seeds, and applies optional limit', async () => {
    const order2 = vi.fn(async () => ({
      data: [
        makeSeedRow({ id: '1', x_username: 'valid_s', artist_name: 'S', rank: 'S', genres: ['BLサンド'] }),
        makeSeedRow({ id: '2', x_username: '(no-x-link-123)', artist_name: 'No X', rank: 'S', genres: [] }),
        makeSeedRow({ id: '3', x_username: 'ad_user', artist_name: 'Ad', rank: 'A', genres: ['広告用'] }),
        makeSeedRow({ id: '4', x_username: 'valid_b', artist_name: 'B', rank: 'B', genres: [] }),
      ],
      error: null,
    }));
    const order1 = vi.fn(() => ({ order: order2 }));
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: order1,
            })),
          })),
        })),
      })),
    };

    const seeds = await fetchScraperSeeds(supabase as never, { limit: 1 });

    expect(seeds).toEqual([
      {
        id: '1',
        x_username: 'valid_s',
        artist_name: 'S',
        rank: 'S',
        genres: ['BLサンド'],
        last_scraped_followings_at: null,
        last_scrape_status: null,
      },
    ]);
  });

  it('passes rank filter to Supabase and applies offset', async () => {
    const inFilter = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          order: vi.fn(async () => ({
            data: [
              makeSeedRow({ id: '1', x_username: 'first', artist_name: 'First', rank: 'A', genres: [] }),
              makeSeedRow({ id: '2', x_username: 'second', artist_name: 'Second', rank: 'A', genres: [] }),
            ],
            error: null,
          })),
        })),
      })),
    }));
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: inFilter,
        })),
      })),
    };

    const seeds = await fetchScraperSeeds(supabase as never, { ranks: ['A'], offset: 1 });

    expect(inFilter).toHaveBeenCalledWith('rank', ['A']);
    expect(seeds).toEqual([
      {
        id: '2',
        x_username: 'second',
        artist_name: 'Second',
        rank: 'A',
        genres: [],
        last_scraped_followings_at: null,
        last_scrape_status: null,
      },
    ]);
  });

  it('prioritizes never-scraped seeds, then older scraped seeds', async () => {
    const supabase = makeSupabaseWithRows([
      makeSeedRow({
        id: '1',
        x_username: 'recent',
        artist_name: 'Recent',
        rank: 'S',
        last_scraped_followings_at: '2026-05-08T00:00:00.000Z',
      }),
      makeSeedRow({ id: '2', x_username: 'never', artist_name: 'Never', rank: 'A' }),
      makeSeedRow({
        id: '3',
        x_username: 'old',
        artist_name: 'Old',
        rank: 'S',
        last_scraped_followings_at: '2026-05-01T00:00:00.000Z',
      }),
    ]);

    const seeds = await fetchScraperSeeds(supabase as never, { ranks: ['S', 'A'] });

    expect(seeds.map((seed) => seed.x_username)).toEqual(['never', 'old', 'recent']);
  });
});

function makeSupabaseWithRows(rows: Array<Record<string, unknown>>) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn(async () => ({
                data: rows,
                error: null,
              })),
            })),
          })),
        })),
      })),
    })),
  };
}

function makeSeedRow(overrides: Record<string, unknown>) {
  return {
    id: 'id',
    x_username: 'user',
    artist_name: 'Artist',
    rank: 'S',
    genres: [],
    last_scraped_followings_at: null,
    last_scrape_status: null,
    ...overrides,
  };
}
