/**
 * pino ロガーの設定。
 *
 * - 開発時は pino-pretty で人間が読みやすい形式に整形する
 * - 本番（CI）でも構造化ログ（JSON）として残しておく
 * - ログレベルは環境変数 LOG_LEVEL で変更可能（デフォルト info）
 */

import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  transport:
    process.env.NODE_ENV === 'production'
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
