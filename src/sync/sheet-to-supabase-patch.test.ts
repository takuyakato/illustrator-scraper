import { describe, expect, it } from 'vitest';

import { buildSheetToSupabasePatch } from './sheet-to-supabase-patch.js';

describe('buildSheetToSupabasePatch', () => {
  it('ランク確定時にartist_nameが空ならdisplay_nameで補完する', () => {
    const patch = buildSheetToSupabasePatch(
      {
        rowIndex: 2,
        xUsername: 'sayhanawork',
        judgment: '',
        tentativeRank: 'S',
        scoutComment: '',
        syncStatus: '同期失敗',
        confirmedBy: [],
      },
      {
        artist_name: null,
        display_name: 'SayHANa 林花',
        x_username: 'sayhanawork',
      },
      '2026-06-18T00:00:00.000Z',
    );

    expect(patch).toMatchObject({
      is_illustrator: true,
      rank: 'S',
      artist_name: 'SayHANa 林花',
    });
  });

  it('artist_nameが既にある場合は上書きしない', () => {
    const patch = buildSheetToSupabasePatch(
      {
        rowIndex: 4,
        xUsername: 'lovecacao',
        judgment: '',
        tentativeRank: 'A',
        scoutComment: '',
        syncStatus: '未同期',
        confirmedBy: [],
      },
      {
        artist_name: '既存作家名',
        display_name: 'LOVECACAO',
        x_username: 'lovecacao',
      },
      '2026-06-18T00:00:00.000Z',
    );

    expect(patch).toMatchObject({
      is_illustrator: true,
      rank: 'A',
    });
    expect(patch).not.toHaveProperty('artist_name');
  });

  it('非イラストレーター判定ではartist_nameを補完しない', () => {
    const patch = buildSheetToSupabasePatch(
      {
        rowIndex: 5,
        xUsername: 'not_artist',
        judgment: 'イラストレーターじゃない',
        tentativeRank: 'S',
        scoutComment: '対象外',
        syncStatus: '未同期',
        confirmedBy: [],
      },
      {
        artist_name: null,
        display_name: 'Not Artist',
        x_username: 'not_artist',
      },
      '2026-06-18T00:00:00.000Z',
    );

    expect(patch).toEqual({
      scout_comment: '対象外',
      last_synced_from_sheet_at: '2026-06-18T00:00:00.000Z',
      is_illustrator: false,
    });
  });

  it('確認者をowner_confirmed_byに反映する', () => {
    const patch = buildSheetToSupabasePatch(
      {
        rowIndex: 6,
        xUsername: 'checked_artist',
        judgment: '',
        tentativeRank: 'S',
        scoutComment: '',
        syncStatus: '未同期',
        confirmedBy: ['北條', '三村'],
      },
      {
        artist_name: null,
        display_name: 'Checked Artist',
        x_username: 'checked_artist',
      },
      '2026-06-18T00:00:00.000Z',
    );

    expect(patch).toMatchObject({
      is_illustrator: true,
      rank: 'S',
      artist_name: 'Checked Artist',
      owner_confirmed_by: ['北條', '三村'],
    });
  });
});
