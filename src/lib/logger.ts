/**
 * pino ロガー（同期ジョブ共通）。
 *
 * - ローカル実行時は pino-pretty で整形
 * - GitHub Actions 等の CI では JSON 構造化ログ
 * - LOG_LEVEL で閾値変更可能（既定 info）
 */

import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  transport:
    process.env.NODE_ENV === 'production' || process.env.CI === 'true'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
});

export type Logger = typeof logger;
