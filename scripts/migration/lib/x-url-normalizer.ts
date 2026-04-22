/**
 * Xリンク / Xユーザー名の正規化。
 *
 * 入力例と正規化後（x_username）：
 *   - `https://x.com/Example`         → `example`
 *   - `https://twitter.com/example/`  → `example`
 *   - `https://x.com/example?ref=xxx` → `example`
 *   - `@Example`                      → `example`
 *   - `Example`（大文字混じり）       → `example`
 *
 * この関数はスクレイパー・マイグレーションの両方で同じロジックを共有する。
 * Supabase 側の `normalize_x_username()` 関数と挙動を揃えること。
 */

/**
 * Xリンクを正規化して x_username（小文字、@なし、スラッシュなし）を返す。
 * 入力が空・無効な場合は null を返す。
 */
export function normalizeXUrl(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // @ から始まる場合（URL ではない）
  if (trimmed.startsWith('@')) {
    const name = trimmed.slice(1).toLowerCase();
    return name === '' ? null : name;
  }

  // URL 形式として解釈を試みる
  try {
    // 'x.com/example' のようにプロトコル無しの場合 URL コンストラクタは失敗するので、
    // http:// を付けて再評価する
    const urlString = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(urlString);

    const host = url.hostname.toLowerCase();
    const isXHost =
      host === 'x.com' ||
      host === 'www.x.com' ||
      host === 'twitter.com' ||
      host === 'www.twitter.com' ||
      host === 'mobile.twitter.com';

    if (!isXHost) {
      // ドメインが X 系でない → null
      return null;
    }

    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    const username = segments[0];
    if (!username) return null;
    return username.toLowerCase();
  } catch {
    // URL として不正なら、単独の文字列として扱う
    const name = trimmed.replace(/^@/, '').toLowerCase();
    return name === '' ? null : name;
  }
}
