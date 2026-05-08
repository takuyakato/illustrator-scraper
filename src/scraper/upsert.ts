import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ScraperCandidateRecord } from './filter.js';

export interface ExistingIllustratorForScraper {
  x_username: string;
  detected_from: string[] | null;
}

export interface ScraperWriteResult {
  inserted: number;
  updated: number;
}

export function createSupabaseClientFromEnv(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function fetchExistingIllustrators(
  supabase: SupabaseClient,
  usernames: string[],
): Promise<Map<string, ExistingIllustratorForScraper>> {
  const uniqueUsernames = [...new Set(usernames)];
  const result = new Map<string, ExistingIllustratorForScraper>();
  const chunkSize = 100;

  for (let i = 0; i < uniqueUsernames.length; i += chunkSize) {
    const chunk = uniqueUsernames.slice(i, i + chunkSize);
    const { data, error } = await supabase.from('illustrators').select('x_username, detected_from').in('x_username', chunk);
    if (error) throw error;

    for (const row of data ?? []) {
      if (typeof row.x_username === 'string') {
        result.set(row.x_username, {
          x_username: row.x_username,
          detected_from: Array.isArray(row.detected_from) ? row.detected_from : [],
        });
      }
    }
  }

  return result;
}

export async function writeScraperCandidates(
  supabase: SupabaseClient,
  records: ScraperCandidateRecord[],
  existingByUsername: Map<string, ExistingIllustratorForScraper>,
): Promise<ScraperWriteResult> {
  const now = new Date().toISOString();
  const uniqueRecords = dedupeRecordsByUsername(records);
  const newRecords = uniqueRecords.filter((record) => !existingByUsername.has(record.x_username));
  const duplicateRecords = uniqueRecords.filter((record) => existingByUsername.has(record.x_username));

  if (newRecords.length > 0) {
    const { error } = await supabase
      .from('illustrators')
      .upsert(
        newRecords.map((record) => ({
          x_username: record.x_username,
          display_name: record.display_name,
          bio: record.bio,
          follower_count: record.follower_count,
          detected_from: record.detected_from,
          first_detected_at: now,
          last_seen_at: now,
          x_link: record.x_link,
          pixiv_link: record.pixiv_link,
          portfolio_link: record.portfolio_link,
          other_contact: record.other_contact,
          is_illustrator: record.is_illustrator,
        })),
        { onConflict: 'x_username', ignoreDuplicates: true },
      );
    if (error) throw error;
  }

  for (const record of duplicateRecords) {
    const existing = existingByUsername.get(record.x_username);
    const detectedFrom = [...new Set([...(existing?.detected_from ?? []), ...record.detected_from])];
    const { error } = await supabase
      .from('illustrators')
      .update({
        detected_from: detectedFrom,
        last_seen_at: now,
      })
      .eq('x_username', record.x_username);

    if (error) throw error;
  }

  return {
    inserted: newRecords.length,
    updated: duplicateRecords.length,
  };
}

function dedupeRecordsByUsername(records: ScraperCandidateRecord[]): ScraperCandidateRecord[] {
  const byUsername = new Map<string, ScraperCandidateRecord>();
  for (const record of records) {
    const existing = byUsername.get(record.x_username);
    if (!existing) {
      byUsername.set(record.x_username, record);
      continue;
    }

    byUsername.set(record.x_username, {
      ...existing,
      detected_from: [...new Set([...existing.detected_from, ...record.detected_from])],
      pixiv_link: existing.pixiv_link ?? record.pixiv_link,
      is_illustrator: existing.is_illustrator === null || record.is_illustrator === null ? null : existing.is_illustrator,
      exclusion_reason: existing.exclusion_reason ?? record.exclusion_reason,
    });
  }
  return [...byUsername.values()];
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`${key} が未設定です。`);
    process.exit(1);
  }
  return value;
}
