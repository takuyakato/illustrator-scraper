/**
 * Supabase から rank=S のシード1件を取得し、_shared/test-seed.json に保存する。
 * POC 各手段はこのシードの x_username を使ってフォロー中取得を試みる。
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 親ディレクトリの .env.local を読む
dotenv.config({ path: resolve(__dirname, '../../.env.local') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// rank=S のシードを取得（広告用・プレースホルダは JS 側で除外、PostgREST の .not().cs() 構文エスケープ回避）
const { data: rawData, error } = await supabase
  .from('illustrators')
  .select('id, x_username, artist_name, rank, genres, follower_count, is_illustrator')
  .eq('rank', 'S')
  .eq('is_illustrator', true)
  .limit(20);

const data = (rawData ?? []).filter(
  (r) => !(r.x_username ?? '').startsWith('(no-x-link-') && !(r.genres ?? []).includes('広告用')
);

if (error) {
  console.error('Supabase error:', error);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.error('No S-rank seed found');
  process.exit(1);
}

const outPath = resolve(__dirname, 'test-seed.json');
writeFileSync(outPath, JSON.stringify({ candidates: data, selected: data[0] }, null, 2));

console.log(`✅ Fetched ${data.length} S-rank seeds`);
console.log(`Selected: @${data[0].x_username} (${data[0].artist_name})`);
console.log(`Saved to: ${outPath}`);
