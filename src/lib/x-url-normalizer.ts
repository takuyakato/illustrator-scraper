/**
 * Xリンク / Xユーザー名の正規化（同期ジョブ用）。
 *
 * 実装は `scripts/migration/lib/x-url-normalizer.ts` と共用するため、そこから re-export する。
 * tsconfig の include に scripts も含まれているため、型安全に参照できる。
 */

export { normalizeXUrl } from '../../scripts/migration/lib/x-url-normalizer.js';
