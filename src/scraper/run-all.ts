/**
 * 対象シード全員の followings 取得を順次実行する。
 *
 * デフォルトは dry-run。各シードの処理は scraper:fetch-followings と同じく
 * SCRAPER_WRITE=true の時だけ Supabase に書き込む。
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

import { createSupabaseClientFromEnv } from './upsert.js';
import { fetchScraperSeeds, markScraperSeedRun } from './seeds.js';

loadDotenv({ path: path.resolve(process.cwd(), '.env.local') });

const perSeedOutputPath = path.resolve(process.cwd(), 'tmp/scraper-followings.json');
const runOutputPath = path.resolve(process.cwd(), 'tmp/scraper-run-all.json');
const seedLimit = parsePositiveInt(process.env.SCRAPER_SEED_LIMIT);
const seedOffset = parseNonNegativeInt(process.env.SCRAPER_SEED_OFFSET) ?? 0;
const seedRanks = parseCsv(process.env.SCRAPER_SEED_RANKS) ?? ['S', 'A', 'B'];
const delayMs = parsePositiveInt(process.env.SCRAPER_SEED_DELAY_MS) ?? 30000;
const staleDays = parsePositiveInt(process.env.SCRAPER_SEED_STALE_DAYS);
const shouldWrite = process.env.SCRAPER_WRITE === 'true';

const supabase = createSupabaseClientFromEnv();
const seeds = await fetchScraperSeeds(supabase, {
  ranks: seedRanks,
  limit: seedLimit,
  offset: seedOffset,
  staleDays,
});

console.log(
  `対象シード: ${seeds.length}件 (${shouldWrite ? 'write' : 'dry-run'}, ranks=${seedRanks.join(',')}, offset=${seedOffset}, staleDays=${staleDays ?? 'none'})`,
);
if (seeds.length === 0) {
  process.exit(0);
}

const results: Array<Record<string, unknown>> = [];
const startedAt = new Date().toISOString();
let hasNonSuccessResult = false;
let hasStateWriteFailure = false;

for (let i = 0; i < seeds.length; i += 1) {
  const seed = seeds[i];
  console.log(`\n[${i + 1}/${seeds.length}] @${seed.x_username} (${seed.artist_name})`);

  rmSync(perSeedOutputPath, { force: true });
  const exitCode = await runFetchForSeed(seed.x_username);
  let summary: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(readFileSync(perSeedOutputPath, 'utf8')) as { stats?: Record<string, unknown> };
    summary = raw.stats ?? {};
  } catch (e) {
    summary = { outputReadError: (e as Error).message };
  }
  const scrapeStatus = toScrapeStatus(exitCode, summary);
  const scrapeError = toScrapeError(exitCode, summary);

  results.push({
    seed,
    exitCode,
    scrapeStatus,
    scrapeError,
    ...summary,
  });

  if (shouldWrite) {
    try {
      await markScraperSeedRun(supabase, {
        xUsername: seed.x_username,
        status: scrapeStatus,
        error: scrapeError,
      });
    } catch (e) {
      console.error(`@${seed.x_username} のスクレイプ状態保存に失敗しました: ${(e as Error).message}`);
      hasStateWriteFailure = true;
    }
  }

  if (scrapeStatus !== 'success') {
    hasNonSuccessResult = true;
  }

  writeRunSummary(startedAt, results);

  if (exitCode !== 0) {
    console.error(`@${seed.x_username} が失敗しました。次のシードへ進みます。`);
  }

  if (i < seeds.length - 1) {
    await sleep(delayMs);
  }
}

writeRunSummary(startedAt, results);
console.log(`\n完了: ${runOutputPath}`);
if (hasNonSuccessResult || hasStateWriteFailure) {
  console.error('1件以上のseedが非成功で終了したため、ジョブを失敗扱いにします。');
  process.exitCode = 1;
}

function runFetchForSeed(username: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'scraper:fetch-followings'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        X_SEED_USERNAME: username,
      },
      stdio: 'inherit',
    });

    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

function writeRunSummary(startedAt: string, rows: Array<Record<string, unknown>>) {
  mkdirSync(path.dirname(runOutputPath), { recursive: true });
  writeFileSync(
    runOutputPath,
    JSON.stringify(
      {
        mode: shouldWrite ? 'write' : 'dry-run',
        startedAt,
        updatedAt: new Date().toISOString(),
        totalSeeds: seeds.length,
        completedSeeds: rows.length,
        totals: summarize(rows),
        results: rows,
      },
      null,
      2,
    ),
  );
}

function summarize(rows: Array<Record<string, unknown>>) {
  const numericKeys = ['totalFetched', 'prepared', 'newCandidates', 'duplicated', 'inserted', 'updated', 'pendingScout'];
  return Object.fromEntries(
    numericKeys.map((key) => [key, rows.reduce((sum, row) => sum + (typeof row[key] === 'number' ? row[key] : 0), 0)]),
  );
}

function toScrapeStatus(
  exitCode: number,
  summary: Record<string, unknown>,
): 'success' | 'failed' | 'partial' | 'timeout' {
  if (typeof summary.outputReadError === 'string') {
    return exitCode !== 0 && String(summary.outputReadError).toLowerCase().includes('timeout')
      ? 'timeout'
      : 'failed';
  }

  if (exitCode !== 0) {
    const message = String(summary.outputReadError ?? '').toLowerCase();
    return message.includes('timeout') ? 'timeout' : 'failed';
  }

  const errors = typeof summary.errors === 'number' ? summary.errors : 0;
  return errors > 0 ? 'partial' : 'success';
}

function toScrapeError(exitCode: number, summary: Record<string, unknown>): string | null {
  const errors = typeof summary.errors === 'number' ? summary.errors : 0;
  if (exitCode === 0 && errors === 0) return null;

  if (typeof summary.outputReadError === 'string') {
    return summary.outputReadError;
  }

  return `exitCode=${exitCode}, errors=${errors}`;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
