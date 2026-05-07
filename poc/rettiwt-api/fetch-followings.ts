/**
 * 手段2 rettiwt-api v7.0.1: フォロー中取得 POC。
 *
 * 事前:
 *   1. Chrome 拡張「X Auth Helper」or Firefox 拡張「Rettiwt Auth Helper」で API key 生成
 *   2. poc/.env.local に RETTIWT_API_KEY=<base64 key> を設定
 */
import { Rettiwt } from 'rettiwt-api';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const SEED_PATH = resolve(__dirname, '../_shared/test-seed.json');
const OUTPUT_PATH = resolve(__dirname, 'output-followings.json');
const MAX_ITEMS = 200;

if (!process.env.RETTIWT_API_KEY) {
  console.error('❌ RETTIWT_API_KEY が未設定。poc/.env.local に設定してください。');
  process.exit(1);
}
if (!existsSync(SEED_PATH)) {
  console.error('❌ test-seed.json がありません。先に `npm run seed` を実行してください。');
  process.exit(1);
}

const seedData = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as {
  selected: { x_username: string; artist_name: string };
};
const seed = seedData.selected.x_username;
console.log(`🎯 Seed: @${seed} (${seedData.selected.artist_name})`);

const rettiwt = new Rettiwt({ apiKey: process.env.RETTIWT_API_KEY });
const started = Date.now();
const candidates: Array<Record<string, unknown>> = [];
const errors: string[] = [];

try {
  // Step 1: ユーザー ID を解決
  const user = await rettiwt.user.details(seed);
  if (!user) {
    console.error(`❌ ユーザー @${seed} が見つかりません`);
    process.exit(1);
  }
  console.log(`  👤 Resolved: id=${user.id}, followers=${user.followersCount}`);

  // Step 2: フォロー中をページング取得
  let cursor: string | undefined;
  let batchNum = 0;
  while (candidates.length < MAX_ITEMS) {
    batchNum += 1;
    const page = await rettiwt.user.following(user.id, 40, cursor);
    const items = page?.list ?? [];
    for (const u of items) {
      candidates.push({
        username: (u as { userName?: string }).userName,
        display_name: (u as { fullName?: string }).fullName,
        bio: (u as { description?: string }).description,
        website: (u as { location?: string; url?: string }).url,
        follower_count: (u as { followersCount?: number }).followersCount,
        following_count: (u as { followingsCount?: number }).followingsCount,
        verified: (u as { isVerified?: boolean }).isVerified,
        created_at: (u as { createdAt?: string }).createdAt,
      });
    }
    console.log(`  📄 Batch ${batchNum}: +${items.length}, total=${candidates.length}`);
    cursor = (page as { next?: { value?: string } })?.next?.value;
    if (!items.length || !cursor) break;
    // 3〜8秒ランダム遅延
    await new Promise((r) => setTimeout(r, 3000 + Math.random() * 5000));
  }
} catch (e) {
  const msg = (e as Error).message;
  errors.push(msg);
  console.error('❌ エラー:', msg);
}

const duration = Math.round((Date.now() - started) / 1000);
const output = {
  method: 'rettiwt-api',
  seed,
  stats: {
    totalFetched: candidates.length,
    durationSec: duration,
    errors: errors.length,
  },
  errors,
  sample: candidates.slice(0, 5),
  allUsernames: candidates.map((c) => c.username),
};
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log('\n✅ 完了');
console.log(`   取得件数: ${candidates.length}`);
console.log(`   所要: ${duration}秒`);
console.log(`   エラー: ${errors.length}件`);
console.log(`   出力: ${OUTPUT_PATH}`);
