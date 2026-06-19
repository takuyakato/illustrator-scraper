/**
 * 自動遷移ジョブ（1日1回、JST 03:00）。
 *
 * 以下の自動遷移を実行する。
 *   - 「連絡中」状態で連絡基準日から 14日経過したレコードを「返信なし」に遷移
 *     - contacted_at があれば contacted_at
 *     - contacted_at が空なら created_at の JST 日付
 *   - recontact_at が到来したレコードを現在ステータスに関係なく「再連絡」に遷移
 *
 * 重要: master_status / note は Notion主導フィールドなので、通常の
 * supabase-to-notion では Notion に書き戻されない（パターンB）。
 * このジョブは auto-transition の結果を Notion にも反映させる特別ルート。
 *
 * フロー:
 *   1. 対象候補を事前に SELECT（ID と notion_page_id を記録）
 *   2. Supabase RPC で一括遷移（note に [自動遷移: ...] を追記）
 *   3. 対象候補ごとに Notion ページの master_status / note を直接更新
 *      + last_synced_to_notion_at を NOW に設定（次サイクルでの再送を抑止）
 */

import { logger } from '../lib/logger.js';
import { notion, sleep, NOTION_RATE_LIMIT_SLEEP_MS } from '../lib/notion.js';
import { supabase } from '../lib/supabase.js';
import { recordSyncFailure, resolveSyncFailure } from '../lib/sync-failure.js';
import { getAutoTransitionDates, shouldTransitionToNoReply } from './auto-transition-rules.js';

interface Candidate {
  id: string;
  notion_page_id: string | null;
}

interface NoReplyCandidateRow extends Candidate {
  contacted_at: string | null;
  created_at: string;
  recontact_at: string | null;
}

export async function runAutoTransition(): Promise<{
  candidateCount: number;
  supabaseAffected: number;
  noReplyCandidateCount: number;
  noReplyAffected: number;
  recontactCandidateCount: number;
  recontactAffected: number;
  notionUpdated: number;
  notionFailed: number;
}> {
  // 1. 対象候補を取得（RPC 実行前に ID をキャプチャ）
  //    recontact_at が到来している連絡中は「返信なし」ではなく「再連絡」を優先する。
  const { todayJst, thresholdYmd } = getAutoTransitionDates();

  const { data: noReplyCandidates, error: noReplyQErr } = await supabase
    .from('illustrators')
    .select('id, notion_page_id, contacted_at, created_at, recontact_at')
    .eq('master_status', '連絡中')
    .or(`recontact_at.is.null,recontact_at.gt.${todayJst}`);

  if (noReplyQErr) {
    logger.error({ err: noReplyQErr }, 'auto-transition: 返信なし候補取得失敗');
    throw noReplyQErr;
  }
  const noReplyTargets = ((noReplyCandidates ?? []) as NoReplyCandidateRow[])
    .filter((row) => shouldTransitionToNoReply(row, thresholdYmd))
    .map(({ id, notion_page_id }) => ({ id, notion_page_id }));
  logger.info({ candidateCount: noReplyTargets.length, thresholdYmd }, '返信なし遷移候補を取得');

  const { data: recontactCandidates, error: recontactQErr } = await supabase
    .from('illustrators')
    .select('id, notion_page_id')
    .neq('master_status', '再連絡')
    .not('recontact_at', 'is', null)
    .lte('recontact_at', todayJst);

  if (recontactQErr) {
    logger.error({ err: recontactQErr }, 'auto-transition: 再連絡候補取得失敗');
    throw recontactQErr;
  }
  const recontactTargets = (recontactCandidates ?? []) as Candidate[];
  logger.info({ candidateCount: recontactTargets.length, todayJst }, '再連絡遷移候補を取得');

  // 2. Supabase RPC で一括遷移
  const { data: noReplyAffectedData, error: noReplyRpcErr } = await supabase.rpc(
    'auto_transition_to_no_reply',
  );
  if (noReplyRpcErr) {
    logger.error({ err: noReplyRpcErr }, 'auto-transition: 返信なしRPC 失敗');
    throw noReplyRpcErr;
  }
  const noReplyAffected = (noReplyAffectedData as number) ?? 0;

  const { data: recontactAffectedData, error: recontactRpcErr } = await supabase.rpc(
    'auto_transition_to_recontact',
  );
  if (recontactRpcErr) {
    logger.error({ err: recontactRpcErr }, 'auto-transition: 再連絡RPC 失敗');
    throw recontactRpcErr;
  }
  const recontactAffected = (recontactAffectedData as number) ?? 0;
  const supabaseAffected = noReplyAffected + recontactAffected;
  logger.info({ noReplyAffected, recontactAffected, supabaseAffected }, 'Supabase 側の遷移完了');

  // 候補件数と RPC の影響件数に差分がある場合は警告
  // （通常は一致するはずだが、競合などで少しずれる可能性）
  if (noReplyAffected !== noReplyTargets.length || recontactAffected !== recontactTargets.length) {
    logger.warn(
      {
        noReplyCandidateCount: noReplyTargets.length,
        noReplyAffected,
        recontactCandidateCount: recontactTargets.length,
        recontactAffected,
      },
      'RPC 影響件数と事前候補件数が一致せず（race の可能性）',
    );
  }

  // 3. Notion 側にも master_status / note を反映
  let notionUpdated = 0;
  let notionFailed = 0;

  const targets = [...noReplyTargets, ...recontactTargets];
  for (const c of targets) {
    if (!c.notion_page_id) {
      // Notion ページ未作成（is_illustrator=true だがまだ同期されていない）レコードはスキップ
      continue;
    }
    try {
      // 最新の master_status / note を Supabase から再取得（RPC 適用後の値）
      const { data: fresh, error: rErr } = await supabase
        .from('illustrators')
        .select('master_status, note')
        .eq('id', c.id)
        .single();
      if (rErr) throw rErr;

      await notion.pages.update({
        page_id: c.notion_page_id,
        properties: {
          マスターステータス: { status: { name: fresh.master_status } },
          備考: { rich_text: [{ text: { content: fresh.note ?? '' } }] },
        } as Parameters<typeof notion.pages.update>[0]['properties'],
      });
      await sleep(NOTION_RATE_LIMIT_SLEEP_MS);

      // last_synced_to_notion_at 単独 UPDATE（次サイクルの supabase-to-notion で再送を抑止）
      const { error: stampErr } = await supabase
        .from('illustrators')
        .update({ last_synced_to_notion_at: new Date().toISOString() })
        .eq('id', c.id);
      if (stampErr) {
        throw new Error(`last_synced_to_notion_at 更新失敗: ${stampErr.message}`);
      }

      notionUpdated += 1;
      await resolveSyncFailure({
        source: 'supabase',
        target: 'notion',
        record_id: c.id,
      });
    } catch (e) {
      notionFailed += 1;
      const msg = (e as Error).message ?? String(e);
      await recordSyncFailure({
        source: 'supabase',
        target: 'notion',
        record_id: c.id,
        operation: 'update',
        error_message: `auto-transition Notion push: ${msg}`,
      });
      logger.error({ err: e, id: c.id }, 'auto-transition: Notion 反映失敗');
    }
  }

  const summary = {
    candidateCount: targets.length,
    supabaseAffected,
    noReplyCandidateCount: noReplyTargets.length,
    noReplyAffected,
    recontactCandidateCount: recontactTargets.length,
    recontactAffected,
    notionUpdated,
    notionFailed,
  };
  logger.info(summary, 'auto-transition 完了');
  return summary;
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  runAutoTransition()
    .then(() => process.exit(0))
    .catch((e) => {
      logger.fatal({ err: e }, 'auto-transition ジョブ全体失敗');
      process.exit(1);
    });
}
