/**
 * Xリンク / Xユーザー名の正規化。
 *
 * 入力例と正規化後（x_username）：
 *   - `https://x.com/Example`                → `example`
 *   - `https://twitter.com/example/`         → `example`
 *   - `https://x.com/example?ref=xxx`        → `example`
 *   - `@Example`                             → `example`
 *   - `Example`（大文字混じり）              → `example`
 *   - `https://x.com/rachu_yamada　25`       → `rachu_yamada` （全角スペース以降を切る）
 *   - `https://x.com/iku_ju　https://...`    → `iku_ju`
 *   - `https://x.com/example（連絡先…）`     → `example`
 *
 * この関数はスクレイパー・マイグレーションの両方で同じロジックを共有する。
 * Supabase 側の `normalize_x_username()` 関数と挙動を揃えること。
 *
 * 改良履歴 (2026-04-23):
 *   実データで URL のパス部に全角スペース・括弧・連続URLが混入しているケースが
 *   5件見つかり、新URL() の pathname では %エンコードされたまま残っていた。
 *   (例: "rachu_yamada%e3%80%8025") → x_username として無効な文字列になっていた。
 *
 *   対策: pathname 先頭セグメントを decodeURIComponent した後、
 *   X の有効文字（英数字・アンダースコア）だけを先頭から抽出する方式に変更。
 */

/**
 * Xリンクを正規化して x_username（小文字、英数字・アンダースコアのみ）を返す。
 * 入力が空・無効な場合は null を返す。
 */
export function normalizeXUrl(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // @ から始まる場合（URL ではない）
  if (trimmed.startsWith('@')) {
    return extractValidUsername(trimmed.slice(1));
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
    const rawFirst = segments[0];
    if (!rawFirst) return null;

    // %エンコードされた文字をデコードしてから有効文字だけ抽出する
    // （実データで URL に全角スペースや日本語混入ケースがあったため）
    let decoded = rawFirst;
    try {
      decoded = decodeURIComponent(rawFirst);
    } catch {
      // デコードに失敗した場合はエンコード済み文字列のまま
    }
    return extractValidUsername(decoded);
  } catch {
    // URL として不正なら、単独の文字列として扱う
    return extractValidUsername(trimmed.replace(/^@/, ''));
  }
}

/**
 * 文字列の先頭から X ユーザー名として有効な文字だけを抽出する。
 * X の username は英数字・アンダースコアの組み合わせ（最大15文字、当関数では長さ制限はしない）。
 * 無効な文字が現れた時点で打ち切る。
 *
 * 例:
 *   "rachu_yamada　25"  → "rachu_yamada"
 *   "iku_ju https://..." → "iku_ju"
 *   "Example"            → "example"
 *   "　（空白）"         → null
 */
function extractValidUsername(s: string): string | null {
  const m = s.match(/^[a-zA-Z0-9_]+/);
  if (!m || m[0].length === 0) return null;
  return m[0].toLowerCase();
}
