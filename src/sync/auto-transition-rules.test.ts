import { describe, expect, it } from 'vitest';

import { getAutoTransitionDates, shouldTransitionToNoReply, toJstYmd } from './auto-transition-rules.js';

describe('auto-transition rules', () => {
  it('JST日付と14日前の閾値を返す', () => {
    expect(getAutoTransitionDates(new Date('2026-06-18T18:00:00.000Z'))).toEqual({
      todayJst: '2026-06-19',
      thresholdYmd: '2026-06-05',
    });
  });

  it('created_at はJST日付に変換する', () => {
    expect(toJstYmd('2026-06-04T18:30:00.000Z')).toBe('2026-06-05');
  });

  it('contacted_at が14日閾値以前なら返信なし対象にする', () => {
    expect(
      shouldTransitionToNoReply(
        {
          contacted_at: '2026-06-05',
          created_at: '2026-06-10T00:00:00.000Z',
        },
        '2026-06-05',
      ),
    ).toBe(true);
  });

  it('contacted_at が閾値より新しければ返信なし対象にしない', () => {
    expect(
      shouldTransitionToNoReply(
        {
          contacted_at: '2026-06-06',
          created_at: '2026-06-01T00:00:00.000Z',
        },
        '2026-06-05',
      ),
    ).toBe(false);
  });

  it('contacted_at が空なら created_at のJST日付で判定する', () => {
    expect(
      shouldTransitionToNoReply(
        {
          contacted_at: null,
          created_at: '2026-06-04T18:30:00.000Z',
        },
        '2026-06-05',
      ),
    ).toBe(true);
  });
});
