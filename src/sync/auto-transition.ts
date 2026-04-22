/**
 * 自動遷移ジョブ（1日1回、JST 03:00）。
 *
 * 「連絡中」状態で contacted_at から30日経過したレコードを「返信なし」に遷移する。
 *
 * 重要: master_status / note は Notion主導フィールドなので、通常の
 * supabase-to-notion では Notion に書き戻されない（パターンB）。
 * このジョブは auto-transition の結果を Notion にも反映させる特別ルート。
 *
 * フロー:
 *   1. 対象候補（連絡中 + 30日経過）を事前に SELECT（ID と notion_page_id を記録）
 *   2. Supabase RPC で一括遷移（note に [自動遷移: ...] を追記）
 *   3. 対象候補ごとに Notion ページの master_status / note を直接更新
 *      + last_synced_to_notion_at を NOW に設定（次サイクルでの再送を抑止）
 */

import { logger } from '../lib/logger.js';
import { notion, sleep, NOTION_RATE_LIMIT_SLEEP_MS } from '../lib/notion.js';
import { supabase } from '../lib/supabase.js';
import { recordSyncFailure } from '../lib/sync-failure.js';

interface Candidate {
  id: string;
  notion_page_id: string | null;
}

export async function runAutoTransition(): Promise<{
  candidateCount: number;
  supabaseAffected: number;
  notionUpdated: number;
  notionFailed: number;
}> {
  // 1. 対象候補を取得（RPC 実行前に ID をキャプチャ）
  //    Postgres 側の function と同じ条件: 連絡中 + contacted_at <= CURRENT_DATE - 30日
  const thresholdDate = new Date();
  thresholdDate.setUTCDate(thresholdDate.getUTCDate() - 30);
  const thresholdYmd = thresholdDate.toISOString().slice(0, 10);

  const { data: candidates, error: qErr } = await supabase
    .from('illustrators')
    .select('id, notion_page_id')
    .eq('master_status', '連絡中')
    .not('contacted_at', 'is', null)
    .lte('contacted_at', thresholdYmd);

  if (qErr) {
    logger.error({ err: qErr }, 'auto-transition: 候補取得失敗');
    throw qErr;
  }
  const targets = (candidates ?? []) as Candidate[];
  logger.info({ candidateCount: targets.length, thresholdYmd }, '対象候補を取得');

  // 2. Supabase RPC で一括遷移
  const { data: affected, error: rpcErr } = await supabase.rpc('auto_transition_to_no_reply');
  if (rpcErr) {
    logger.error({ err: rpcErr }, 'auto-transition: RPC 失敗');
    throw rpcErr;
  }
  const supabaseAffected = (affected as number) ?? 0;
  logger.info({ supabaseAffected }, 'Supabase 側の遷移完了');

  // 候補件数と RPC の影響件数に差分がある場合は警告
  // （通常は一致するはずだが、競合などで少しずれる可能性）
  if (supabaseAffected !== targets.length) {
    logger.warn(
      { candidateCount: targets.length, supabaseAffected },
      'RPC 影響件数と事前候補件数が一致せず（race の可能性）',
    );
  }

  // 3. Notion 側にも master_status / note を反映
  let notionUpdated = 0;
  let notionFailed = 0;

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
      await supabase
        .from('illustrators')
        .update({ last_synced_to_notion_at: new Date().toISOString() })
        .eq('id', c.id);

      notionUpdated += 1;
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
