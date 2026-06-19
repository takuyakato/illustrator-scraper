import type { ScoutRowInput } from '../lib/sheet-converter.js';

export interface SheetSyncTarget {
  artist_name: string | null;
  display_name: string | null;
  x_username: string;
}

export const VALID_RANKS = new Set(['S', 'A', 'B', 'C']);
export const JUDGMENT_NOT_ILLUSTRATOR = 'イラストレーターじゃない';

export function buildSheetToSupabasePatch(
  input: ScoutRowInput,
  target: SheetSyncTarget,
  syncedAtIso: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    scout_comment: input.scoutComment || null,
    last_synced_from_sheet_at: syncedAtIso,
  };

  if (input.confirmedBy.length > 0) {
    patch.owner_confirmed_by = input.confirmedBy;
  }

  if (input.judgment === JUDGMENT_NOT_ILLUSTRATOR) {
    patch.is_illustrator = false;
    return patch;
  }

  if (VALID_RANKS.has(input.tentativeRank)) {
    patch.is_illustrator = true;
    patch.rank = input.tentativeRank;

    // is_illustrator=true では artist_name が必須。スクレイパー流入候補は
    // artist_name が空なので、初回確定時だけ表示名で初期補完する。
    if (!target.artist_name || target.artist_name.trim() === '') {
      patch.artist_name = target.display_name?.trim() || target.x_username;
    }
  }

  return patch;
}
