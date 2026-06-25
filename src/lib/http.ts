import type { GaxiosOptions } from 'gaxios';

type HeaderRecord = Record<string, unknown>;

export const IDENTITY_ENCODING_HEADERS = {
  'Accept-Encoding': 'identity',
} as const;

export function withIdentityEncodingHeaders(headers?: HeaderRecord): HeaderRecord {
  return {
    ...(headers ?? {}),
    ...IDENTITY_ENCODING_HEADERS,
  };
}

export function withIdentityEncodingGaxiosOptions(options?: GaxiosOptions): GaxiosOptions {
  return {
    ...(options ?? {}),
    headers: withIdentityEncodingHeaders(options?.headers),
  };
}

export async function fetchWithIdentityEncoding(
  url: string,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  },
): Promise<{
  ok: boolean;
  text: () => Promise<string>;
  headers: unknown;
  status: number;
}> {
  return fetch(url, {
    body: init?.body,
    headers: withIdentityEncodingHeaders(init?.headers) as Record<string, string>,
    method: init?.method,
  });
}
