import { normalizeXUrl } from '../lib/x-url-normalizer.js';

export interface ScrapedFollowing {
  username: string;
  display_name: string;
  bio: string;
  website: string | null;
  bio_urls: string[];
  follower_count: number;
  following_count: number;
  verified: boolean;
  created_at?: string;
}

export interface ScraperCandidateRecord {
  x_username: string;
  display_name: string;
  bio: string | null;
  follower_count: number;
  detected_from: string[];
  x_link: string;
  pixiv_link: string | null;
  portfolio_link: string | null;
  other_contact: string | null;
  is_illustrator: boolean | null;
  exclusion_reason: string | null;
}

const aiIllustratorPattern =
  /(生成AI|AI絵師|AIイラスト|AIアート|stable ?diffusion|midjourney|nijijourney|dall-?e|novelai|ai generated|ai-generated|ai art)/i;

const pixivPatterns = [
  /https?:\/\/(?:www\.)?pixiv\.net\/(?:en\/)?users?\/[0-9]+/i,
  /https?:\/\/(?:www\.)?pixiv\.net\/member\.php\?id=[0-9]+/i,
  /https?:\/\/(?:www\.)?pixiv\.net\/[^\s]+/i,
];

export function isAiIllustratorText(text: string | null | undefined): boolean {
  return aiIllustratorPattern.test(text ?? '');
}

export function extractPixivUrl(values: Array<string | null | undefined>): string | null {
  const haystack = values.filter((v): v is string => Boolean(v)).join('\n');
  for (const pattern of pixivPatterns) {
    const match = haystack.match(pattern);
    if (match?.[0]) return stripTrailingPunctuation(match[0]);
  }
  return null;
}

export function toCandidateRecord(following: ScrapedFollowing, seedUsername: string): ScraperCandidateRecord | null {
  const xUsername = normalizeXUrl(`@${following.username}`);
  if (!xUsername) return null;

  const pixivLink = extractPixivUrl([following.website, following.bio, ...following.bio_urls]);
  const aiText = [following.display_name, following.bio].join('\n');
  const isAi = isAiIllustratorText(aiText);

  return {
    x_username: xUsername,
    display_name: following.display_name || xUsername,
    bio: following.bio || null,
    follower_count: following.follower_count,
    detected_from: [seedUsername],
    x_link: `https://x.com/${xUsername}`,
    pixiv_link: pixivLink,
    portfolio_link: null,
    other_contact: following.website && following.website !== pixivLink ? following.website : null,
    is_illustrator: isAi || !pixivLink ? false : null,
    exclusion_reason: isAi ? 'ai_keyword' : pixivLink ? null : 'no_pixiv_link',
  };
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[),.、。]+$/g, '');
}
