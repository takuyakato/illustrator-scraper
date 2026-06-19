export interface NoReplyCandidateRuleInput {
  contacted_at: string | null;
  created_at: string;
}

export interface AutoTransitionDates {
  todayJst: string;
  thresholdYmd: string;
}

export function toJstYmd(value: string): string {
  return new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getAutoTransitionDates(now: Date = new Date()): AutoTransitionDates {
  const todayJstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const thresholdDate = new Date(todayJstDate);
  thresholdDate.setUTCDate(thresholdDate.getUTCDate() - 14);

  return {
    todayJst: todayJstDate.toISOString().slice(0, 10),
    thresholdYmd: thresholdDate.toISOString().slice(0, 10),
  };
}

export function shouldTransitionToNoReply(row: NoReplyCandidateRuleInput, thresholdYmd: string): boolean {
  const transitionBaseYmd = row.contacted_at ?? toJstYmd(row.created_at);
  return transitionBaseYmd <= thresholdYmd;
}
