/**
 * X ログイン状態を Playwright storageState として保存する。
 *
 * 認証情報は .env.local のみから読む。2FA / CAPTCHA / 追加確認が出た場合は
 * 起動した Chrome 上で手動対応する。
 */
import { chromium } from 'playwright';
import { config as loadDotenv } from 'dotenv';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

loadDotenv({ path: path.resolve(process.cwd(), '.env.local') });

const storagePath = path.resolve(process.cwd(), '.scraper/x-storage-state.json');
const userDataDir = path.resolve(process.cwd(), '.scraper/chrome-profile');
const loginTimeoutMs = 15 * 60 * 1000;

const loginId = process.env.X_LOGIN_ID;
const password = process.env.X_LOGIN_PASSWORD;
const username = process.env.X_LOGIN_USERNAME;

if (!loginId || !password) {
  console.error('X_LOGIN_ID / X_LOGIN_PASSWORD が未設定です。.env.local に設定してください。');
  process.exit(1);
}

mkdirSync(path.dirname(storagePath), { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1280, height: 800 },
  locale: 'ja-JP',
  args: ['--disable-blink-features=AutomationControlled'],
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = context.pages()[0] ?? (await context.newPage());

console.log('Chrome を開きました。X ログインを自動入力します。');
await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded' });

await page.locator('input[autocomplete="username"], input[name="text"]').first().waitFor({ timeout: 30000 });
await page.locator('input[autocomplete="username"], input[name="text"]').first().fill(loginId);
await clickByText(['Next', '次へ']);

const usernameChallenge = page.locator('input[name="text"]').first();
const passwordInput = page.locator('input[name="password"]').first();

await Promise.race([
  passwordInput.waitFor({ timeout: 30000 }).catch(() => undefined),
  usernameChallenge.waitFor({ timeout: 30000 }).catch(() => undefined),
]);

if ((await passwordInput.count()) === 0 || !(await passwordInput.isVisible().catch(() => false))) {
  if (!username) {
    console.warn('追加の username 確認が出ている可能性があります。ブラウザ上で手動対応してください。');
  } else {
    await usernameChallenge.fill(username);
    await clickByText(['Next', '次へ']);
  }
}

await passwordInput.waitFor({ timeout: 120000 });
await passwordInput.fill(password);
await clickByText(['Log in', 'ログイン']);

console.log('ログイン完了を待っています。2FA や CAPTCHA が出た場合はブラウザ上で対応してください。');

const started = Date.now();
while (Date.now() - started < loginTimeoutMs) {
  const cookies = await context.cookies('https://x.com').catch(() => []);
  const hasAuthToken = cookies.some((c) => c.name === 'auth_token' && c.value.length > 0);
  const url = page.url();
  if (hasAuthToken && !url.includes('/i/flow/login') && !url.includes('/login')) {
    await page.waitForTimeout(2000);
    await context.storageState({ path: storagePath });
    console.log(`保存完了: ${storagePath}`);
    await context.close();
    process.exit(0);
  }
  await page.waitForTimeout(1500);
}

console.error('15分以内にログイン完了を検知できませんでした。');
await context.close();
process.exit(1);

async function clickByText(labels: string[]) {
  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }
  await page.keyboard.press('Enter');
}
