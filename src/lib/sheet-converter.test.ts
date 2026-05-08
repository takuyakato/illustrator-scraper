import { describe, expect, it } from 'vitest';

import { parseSheetRows, rowToSheetA2I, rowToSheetFull, SYNC_STATUS_UNSYNCED } from './sheet-converter.js';
import type { IllustratorRow } from './types.js';

describe('sheet-converter', () => {
  it('writes x_link to C column and keeps full rows unsynced', () => {
    const row = makeIllustratorRow({
      x_username: 'example_user',
      x_link: 'https://x.com/example_user',
    });

    expect(rowToSheetA2I(row)[2]).toBe('https://x.com/example_user');
    expect(rowToSheetFull(row)[12]).toBe(SYNC_STATUS_UNSYNCED);
  });

  it('parses X account URL or legacy username from column C', () => {
    const rows = parseSheetRows([
      ['2026-05-08', '', 'https://x.com/example_user', '', '', '', '', '', '', '', '', '', '未同期'],
      ['2026-05-08', '', 'legacy_user', '', '', '', '', '', '', '', '', '', '未同期'],
    ]);

    expect(rows.map((row) => row.xUsername)).toEqual(['example_user', 'legacy_user']);
  });
});

function makeIllustratorRow(overrides: Partial<IllustratorRow>): IllustratorRow {
  return {
    id: 'id',
    x_username: 'example_user',
    display_name: 'Example',
    bio: null,
    follower_count: 123,
    detected_from: ['seed_a'],
    first_detected_at: '2026-05-08T00:00:00.000Z',
    last_seen_at: '2026-05-08T00:00:00.000Z',
    last_scraped_followings_at: null,
    last_scrape_status: null,
    last_scrape_error: null,
    scout_comment: null,
    is_illustrator: null,
    artist_name: null,
    master_status: '候補',
    rank: null,
    owner_confirmed_by: [],
    style_tags: [],
    genres: [],
    x_link: 'https://x.com/example_user',
    pixiv_link: null,
    portfolio_link: null,
    other_contact: null,
    email: null,
    credit_name: null,
    contacted_at: null,
    contacted_by: [],
    note: null,
    legacy_contact_status: null,
    legacy_mimura_comment: null,
    legacy_hojo_comment: null,
    legacy_hojo_points: null,
    legacy_found_by: null,
    legacy_capuri_request_id: null,
    migration_snapshot: null,
    notion_page_id: null,
    last_synced_to_notion_at: null,
    last_synced_from_notion_at: null,
    sheet_row_index: null,
    last_synced_to_sheet_at: null,
    last_synced_from_sheet_at: null,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}
