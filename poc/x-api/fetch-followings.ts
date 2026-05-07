/**
 * 手段4 X API pay-per-use POC: フォロー中取得 + コスト実測。
 *
 * 事前:
 *   1. https://developer.x.com/ で Developer アカウント作成
 *   2. Pay-per-use 有効化、最小デポジット、Bearer Token 取得
 *   3. poc/.env.local に X_API_BEARER_TOKEN=<token> を設定
 *
 * 料金: Following/Followers Read = $0.010 / profile
 *   → 200 件取得 ≈ $2
 *
 * エンドポイント: GET /2/users/:id/following
 *   - max_results: 1〜1000（Basic/pay-per-use）
 *   - pagination_token: 次ページ用
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const SEED_PATH = resolve(__dirname, '../_shared/test-seed.json');
const OUTPUT_PATH = resolve(__dirname, 'output-followings.json');
const MAX_ITEMS = 200;
const COST_PER_PROFILE = 0.01; // USD
const BUDGET_USD = 3; // POC 予算上限（$3、200件取得で $2 なので余裕）

if (!process.env.X_API_BEARER_TOKEN) {
  console.error('❌ X_API_BEARER_TOKEN が未設定。poc/.env.local に設定してください。');
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
console.log(`💰 POC 予算上限: $${BUDGET_USD}`);

const bearer = process.env.X_API_BEARER_TOKEN;
const started = Date.now();
const candidates: Array<Record<string, unknown>> = [];
const errors: string[] = [];

try {
  // Step 1: username -> id 解決
  const userRes = await fetch(
    `https://api.x.com/2/users/by/username/${seed}?user.fields=id,name,description,public_metrics`,
    { headers: { Authorization: `Bearer ${bearer}` } }
  );
  if (!userRes.ok) {
    errors.push(`user lookup HTTP ${userRes.status}: ${await userRes.text()}`);
    throw new Error('user lookup failed');
  }
  const userJson = (await userRes.json()) as { data?: { id: string; name: string } };
  const userId = userJson.data?.id;
  if (!userId) throw new Error('user id not found');
  console.log(`  👤 Resolved: id=${userId}`);

  // Step 2: フォロー中ページング
  let paginationToken: string | undefined;
  let batchNum = 0;
  while (candidates.length < MAX_ITEMS) {
    const estimatedCost = candidates.length * COST_PER_PROFILE;
    if (estimatedCost >= BUDGET_USD) {
      console.log(`  🛑 予算上限 $${BUDGET_USD} に到達、停止`);
      break;
    }
    const params = new URLSearchParams({
      max_results: '100',
      'user.fields': 'id,name,username,description,url,entities,public_metrics,verified,created_at',
    });
    if (paginationToken) params.set('pagination_token', paginationToken);

    const res = await fetch(`https://api.x.com/2/users/${userId}/following?${params.toString()}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) {
      errors.push(`following HTTP ${res.status}: ${await res.text()}`);
      break;
    }
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        username: string;
        name: string;
        description?: string;
        url?: string;
        entities?: { url?: { urls?: Array<{ expanded_url?: string }> } };
        public_metrics?: { followers_count?: number; following_count?: number };
        verified?: boolean;
        created_at?: string;
      }>;
      meta?: { next_token?: string };
    };
    batchNum += 1;
    for (const u of json.data ?? []) {
      const website = u.entities?.url?.urls?.[0]?.expanded_url ?? u.url ?? null;
      candidates.push({
        username: u.username,
        display_name: u.name,
        bio: u.description ?? '',
        website,
        follower_count: u.public_metrics?.followers_count ?? 0,
        following_count: u.public_metrics?.following_count ?? 0,
        verified: u.verified ?? false,
        created_at: u.created_at,
      });
    }
    console.log(`  📄 Batch ${batchNum}: +${json.data?.length ?? 0}, total=${candidates.length}`);
    paginationToken = json.meta?.next_token;
    if (!paginationToken || !json.data?.length) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
} catch (e) {
  errors.push((e as Error).message);
}

const actualCost = candidates.length * COST_PER_PROFILE;
const duration = Math.round((Date.now() - started) / 1000);
const output = {
  method: 'x-api-pay-per-use',
  seed,
  stats: {
    totalFetched: candidates.length,
    durationSec: duration,
    errors: errors.length,
    estimatedCostUSD: actualCost,
  },
  errors,
  sample: candidates.slice(0, 5),
  allUsernames: candidates.map((c) => c.username),
};
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log('\n✅ 完了');
console.log(`   取得件数: ${candidates.length}`);
console.log(`   所要: ${duration}秒`);
console.log(`   推定コスト: $${actualCost.toFixed(2)}`);
console.log(`   エラー: ${errors.length}件`);
console.log(`   出力: ${OUTPUT_PATH}`);
