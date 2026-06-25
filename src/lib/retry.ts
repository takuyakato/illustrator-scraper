import { logger } from './logger.js';

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  label: string;
  attempts?: number;
  delayMs?: number;
}

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isTransientApiError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (
    code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN'
  ) {
    return true;
  }

  const message = getErrorMessage(error);
  return (
    message.includes('Premature close') ||
    message.includes('ERR_STREAM_PREMATURE_CLOSE') ||
    message.includes('socket hang up') ||
    message.includes('network timeout') ||
    message.includes('fetch failed')
  );
}

export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = isTransientApiError(error);
      if (!retryable || attempt >= attempts) {
        throw error;
      }

      const waitMs = delayMs * 2 ** (attempt - 1);
      logger.warn(
        { err: error, label: options.label, attempt, attempts, waitMs },
        '一過性APIエラーのためリトライします',
      );
      await sleep(waitMs);
    }
  }

  throw new Error(`${options.label}: retry attempts exhausted`);
}
