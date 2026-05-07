/**
 * 手段1 Playwright+GraphQL: 初回ログイン（自動検知式）。
 *
 * 実行すると Chromium または WebKit が開くので X にログインするだけで OK。
 * ログイン成功を検知すると自動で storageState を保存して終了する。
 * → fetch-followings.ts で再利用される。
 */
import { chromium, webkit } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_PATH = resolve(__dirname, 'storage-state.json');
const USER_DATA_DIR = resolve(__dirname, '.chrome-profile'); // 永続プロファイル（gitignore対象）
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const BROWSER = process.env.PW_BROWSER === 'webkit' ? 'webkit' : 'chromium';

// X の anti-bot 検知を回避するため、通常の Chrome に見せかける
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const context =
  BROWSER === 'webkit'
    ? await webkit.launchPersistentContext(resolve(__dirname, '.webkit-profile'), {
        headless: false,
        viewport: { width: 1280, height: 800 },
        locale: 'ja-JP',
      })
    : await chromium.launchPersistentContext(USER_DATA_DIR, {
        channel: 'chrome', // 実 Chrome を使う。なければ Playwright が fallback してくれる
        headless: false,
        viewport: { width: 1280, height: 800 },
        locale: 'ja-JP',
        userAgent: REAL_UA,
        args: [
          '--disable-blink-features=AutomationControlled', // webdriver フラグ隠蔽
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });

// navigator.webdriver を削除（anti-bot 検知の最有名ポイント）
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = context.pages()[0] ?? (await context.newPage());

console.log(`🌐 ${BROWSER === 'webkit' ? 'WebKit' : 'Chrome'} を開きました。X にログインしてください（最大15分待機）。`);
console.log('   ログイン成功を検知すると自動で終了し storageState を保存します。');
console.log(`   プロファイル: ${BROWSER === 'webkit' ? resolve(__dirname, '.webkit-profile') : USER_DATA_DIR}`);

await page.goto('https://x.com/i/flow/login');

// ログイン成功の検知: auth_token Cookie がセットされたら成功とみなす
const started = Date.now();
let loggedIn = false;

while (Date.now() - started < LOGIN_TIMEOUT_MS) {
  try {
    const cookies = await context.cookies('https://x.com');
    const hasAuthToken = cookies.some((c) => c.name === 'auth_token' && c.value.length > 0);
    if (hasAuthToken) {
      // 念のため /home などログイン後画面に遷移するのを待って安定させる
      const url = page.url();
      if (!url.includes('/i/flow/login') && !url.includes('/login')) {
        loggedIn = true;
        break;
      }
    }
  } catch {
    // ページ遷移中は cookies 取得が失敗することがある、無視してリトライ
  }
  await page.waitForTimeout(1500);
}

if (!loggedIn) {
  console.error('\n⏱️  15分以内にログインを検知できませんでした。中断します。');
  await context.close();
  process.exit(1);
}

await page.waitForTimeout(2000); // セッション安定待ち
await context.storageState({ path: STORAGE_PATH });
console.log(`\n📦 保存完了: ${STORAGE_PATH}`);
console.log('   このファイルは gitignore されています（Cookie を含むため）。');
console.log('   続いて fetch-followings.ts を実行してください。');

await context.close();
