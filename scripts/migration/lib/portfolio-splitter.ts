/**
 * 「その他連絡先」の URL を `portfolio_link` と `other_contact` に振り分ける。
 *
 * 既存の「その他連絡先」カラムには、実際にはポートフォリオサービス
 * （lit.link / potofu.me 等）の URL が多く混在しているため、
 * マイグレーション時にパターンマッチで自動振り分けを行う。
 *
 * 振り分けルール（03_マイグレーション手順.md Section 7.5）：
 *   - `lit.link/*`                   → portfolio_link
 *   - `potofu.me/*` / `potofu.jp/*`  → portfolio_link
 *   - `skeb.jp/*`                    → portfolio_link
 *   - `booth.pm/*`                   → portfolio_link
 *   - 上記以外                       → other_contact（元のまま）
 */

export interface SplitResult {
  portfolio: string | null;
  other: string | null;
}

/**
 * URL を portfolio / other_contact に振り分ける。
 */
export function splitPortfolioAndOther(url: string | null | undefined): SplitResult {
  if (!url) return { portfolio: null, other: null };

  const lower = url.toLowerCase();

  if (
    lower.includes('lit.link') ||
    lower.includes('potofu.me') ||
    lower.includes('potofu.jp') ||
    lower.includes('skeb.jp') ||
    lower.includes('booth.pm')
  ) {
    return { portfolio: url, other: null };
  }

  return { portfolio: null, other: url };
}
