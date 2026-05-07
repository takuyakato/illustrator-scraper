import { describe, expect, it } from 'vitest';

import { extractPixivUrl, isAiIllustratorText, toCandidateRecord, type ScrapedFollowing } from './filter.js';

describe('scraper filter', () => {
  it('extracts pixiv URL from profile website and bio URLs', () => {
    expect(extractPixivUrl(['https://www.pixiv.net/users/1642433'])).toBe('https://www.pixiv.net/users/1642433');
    expect(extractPixivUrl(['text', 'https://www.pixiv.net/member.php?id=12345'])).toBe(
      'https://www.pixiv.net/member.php?id=12345',
    );
  });

  it('detects AI illustrator keywords', () => {
    expect(isAiIllustratorText('生成AIでイラストを作っています')).toBe(true);
    expect(isAiIllustratorText('illustration / pixiv')).toBe(false);
  });

  it('creates pending scout record when pixiv exists and AI keyword is absent', () => {
    const record = toCandidateRecord(makeFollowing({ website: 'https://www.pixiv.net/users/100' }), 'seed_user');

    expect(record).toMatchObject({
      x_username: 'example_user',
      detected_from: ['seed_user'],
      x_link: 'https://x.com/example_user',
      pixiv_link: 'https://www.pixiv.net/users/100',
      is_illustrator: null,
      exclusion_reason: null,
    });
  });

  it('marks records without pixiv as excluded for duplicate prevention', () => {
    const record = toCandidateRecord(makeFollowing({ website: null, bio_urls: [] }), 'seed_user');

    expect(record).toMatchObject({
      x_username: 'example_user',
      pixiv_link: null,
      is_illustrator: false,
      exclusion_reason: 'no_pixiv_link',
    });
  });

  it('marks AI keyword records as excluded even when pixiv exists', () => {
    const record = toCandidateRecord(
      makeFollowing({
        bio: 'Stable Diffusion / https://www.pixiv.net/users/100',
        website: 'https://www.pixiv.net/users/100',
      }),
      'seed_user',
    );

    expect(record).toMatchObject({
      pixiv_link: 'https://www.pixiv.net/users/100',
      is_illustrator: false,
      exclusion_reason: 'ai_keyword',
    });
  });
});

function makeFollowing(overrides: Partial<ScrapedFollowing>): ScrapedFollowing {
  return {
    username: 'Example_User',
    display_name: 'Example User',
    bio: '',
    website: null,
    bio_urls: [],
    follower_count: 123,
    following_count: 45,
    verified: false,
    ...overrides,
  };
}
