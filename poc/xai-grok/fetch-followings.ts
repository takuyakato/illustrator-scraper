/**
 * 手段3 xAI API (Grok) POC: 自然言語で follow graph を取得できるか検証。
 *
 * Grok は live search で X にアクセス可能とされる。
 * 大量のフォロー中リストを構造化 JSON で返せるかを実測。
 * 期待薄だが、安価で試せるので検証する。
 *
 * 事前: 親の .env.local に XAI_API_KEY が入っていること（CLAUDE.md より）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 親の .env.local を優先して読む
dotenv.config({ path: resolve(__dirname, '../../.env.local') });
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const SEED_PATH = resolve(__dirname, '../_shared/test-seed.json');
const OUTPUT_PATH = resolve(__dirname, 'output-followings.json');

if (!process.env.XAI_API_KEY) {
  console.error('❌ XAI_API_KEY が未設定。親の .env.local または poc/.env.local に設定してください。');
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

const started = Date.now();
const errors: string[] = [];

const prompt = `X の @${seed} アカウントがフォロー中（followings）の他アカウントを最大30件教えてください。\n各アカウントについて以下のキーで JSON 配列として返してください:\n- username (X の @を除いた screen_name)\n- display_name (表示名)\n- bio (プロフィール冒頭 150文字まで)\n- website (プロフィールの website URL、なければ null)\n- follower_count (数値)\n\n余計な説明は不要。有効な JSON 配列のみを返してください。x_search ツールを使って実データを調べてください。`;

let rawText = '';
let parsedCandidates: unknown[] = [];

try {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-4-latest',
      messages: [
        { role: 'system', content: 'あなたは X のデータを構造化 JSON で返すデータ抽出器です。x_search ツールを用いて実データを参照してください。' },
        { role: 'user', content: prompt },
      ],
      // xAI Chat Completions API の新仕様: tools に live_search + sources を指定
      tools: [{ type: 'live_search', sources: [{ type: 'x' }] }],
    }),
  });
  if (!res.ok) {
    errors.push(`HTTP ${res.status}: ${await res.text()}`);
  } else {
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    rawText = json.choices?.[0]?.message?.content ?? '';
    // JSON 抽出（Grok がコードフェンスを付けてくる場合に対応）
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsedCandidates = JSON.parse(match[0]);
      } catch (e) {
        errors.push(`JSON parse error: ${(e as Error).message}`);
      }
    } else {
      errors.push('JSON array not found in response');
    }
    console.log(`  💬 usage.total_tokens=${json.usage?.total_tokens}`);
  }
} catch (e) {
  errors.push((e as Error).message);
}

const duration = Math.round((Date.now() - started) / 1000);
const output = {
  method: 'xai-grok',
  seed,
  stats: {
    totalFetched: parsedCandidates.length,
    durationSec: duration,
    errors: errors.length,
  },
  errors,
  rawText: rawText.slice(0, 2000),
  sample: parsedCandidates.slice(0, 5),
};
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log('\n✅ 完了');
console.log(`   取得件数: ${parsedCandidates.length}`);
console.log(`   所要: ${duration}秒`);
console.log(`   エラー: ${errors.length}件`);
console.log(`   出力: ${OUTPUT_PATH}`);
if (errors.length) {
  console.log(`   エラー内容:`, errors);
}
