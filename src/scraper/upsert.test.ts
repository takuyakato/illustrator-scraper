import { describe, expect, it, vi } from 'vitest';

import { fetchExistingIllustrators, writeScraperCandidates } from './upsert.js';
import type { ScraperCandidateRecord } from './filter.js';

describe('scraper upsert', () => {
  it('fetches existing illustrators as a username map', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: [{ x_username: 'existing_user', detected_from: ['seed_a'] }],
            error: null,
          })),
        })),
      })),
    };

    const result = await fetchExistingIllustrators(supabase as never, ['existing_user']);

    expect(result.get('existing_user')).toEqual({
      x_username: 'existing_user',
      detected_from: ['seed_a'],
    });
  });

  it('inserts new records and updates only duplicate tracking fields', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const eq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    const supabase = {
      from: vi.fn((table: string) => {
        expect(table).toBe('illustrators');
        return { upsert, update };
      }),
    };
    const existing = new Map([['duplicate_user', { x_username: 'duplicate_user', detected_from: ['seed_a'] }]]);

    const result = await writeScraperCandidates(
      supabase as never,
      [makeRecord('new_user'), makeRecord('duplicate_user')],
      existing,
    );

    expect(result).toEqual({ inserted: 1, updated: 1 });
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          x_username: 'new_user',
          pixiv_link: 'https://www.pixiv.net/users/100',
          is_illustrator: null,
        }),
      ],
      { onConflict: 'x_username', ignoreDuplicates: true },
    );
    expect(update).toHaveBeenCalledWith({
      detected_from: ['seed_a', 'seed_b'],
      last_seen_at: expect.any(String),
    });
    expect(eq).toHaveBeenCalledWith('x_username', 'duplicate_user');
  });

  it('deduplicates same-batch records before writing', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({ upsert })),
    };

    const result = await writeScraperCandidates(supabase as never, [makeRecord('same_user'), makeRecord('same_user')], new Map());

    expect(result).toEqual({ inserted: 1, updated: 0 });
    expect(upsert).toHaveBeenCalledWith([expect.objectContaining({ x_username: 'same_user' })], {
      onConflict: 'x_username',
      ignoreDuplicates: true,
    });
  });
});

function makeRecord(xUsername: string): ScraperCandidateRecord {
  return {
    x_username: xUsername,
    display_name: xUsername,
    bio: null,
    follower_count: 100,
    detected_from: ['seed_b'],
    x_link: `https://x.com/${xUsername}`,
    pixiv_link: 'https://www.pixiv.net/users/100',
    portfolio_link: null,
    other_contact: null,
    is_illustrator: null,
    exclusion_reason: null,
  };
}
