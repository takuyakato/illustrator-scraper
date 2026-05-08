import { describe, expect, it, vi } from 'vitest';

import { fetchScraperSeeds } from './seeds.js';

describe('fetchScraperSeeds', () => {
  it('filters out placeholder and advertising seeds, and applies optional limit', async () => {
    const order2 = vi.fn(async () => ({
      data: [
        { x_username: 'valid_s', artist_name: 'S', rank: 'S', genres: ['BLサンド'] },
        { x_username: '(no-x-link-123)', artist_name: 'No X', rank: 'S', genres: [] },
        { x_username: 'ad_user', artist_name: 'Ad', rank: 'A', genres: ['広告用'] },
        { x_username: 'valid_b', artist_name: 'B', rank: 'B', genres: [] },
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

    expect(seeds).toEqual([{ x_username: 'valid_s', artist_name: 'S', rank: 'S', genres: ['BLサンド'] }]);
  });

  it('passes rank filter to Supabase and applies offset', async () => {
    const inFilter = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          order: vi.fn(async () => ({
            data: [
              { x_username: 'first', artist_name: 'First', rank: 'A', genres: [] },
              { x_username: 'second', artist_name: 'Second', rank: 'A', genres: [] },
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
    expect(seeds).toEqual([{ x_username: 'second', artist_name: 'Second', rank: 'A', genres: [] }]);
  });
});
