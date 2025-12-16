/**
 * Structured logging with Pino
 */

import pino from 'pino';
import * as dotenv from 'dotenv';

dotenv.config();

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_PRETTY = process.env.LOG_PRETTY === 'true';

/**
 * Create Pino logger instance
 */
export const logger = pino({
  level: LOG_LEVEL,
  transport: LOG_PRETTY
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * Log crawl progress
 */
export function logCrawlProgress(current: number, total: number, url: string) {
  logger.info(
    {
      progress: `${current}/${total}`,
      percentage: Math.round((current / total) * 100),
      url,
    },
    'Crawling page'
  );
}

/**
 * Log crawl statistics
 */
export function logCrawlStats(stats: {
  totalUrls: number;
  crawled: number;
  redirects: number;
  errors: number;
  duration: number;
}) {
  logger.info(
    {
      stats,
    },
    'Crawl completed'
  );
}

/**
 * Log extraction method used
 */
export function logExtraction(url: string, method: string, wordCount: number) {
  logger.debug(
    {
      url,
      method,
      wordCount,
    },
    'Content extracted'
  );
}
