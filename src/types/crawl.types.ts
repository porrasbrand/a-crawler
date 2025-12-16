/**
 * Crawl-related type definitions
 */

import { FetchMode } from './database.types';

/**
 * Crawl options
 */
export interface CrawlOptions {
  sitemaps: string[];
  maxPages?: number;
  fetchMode?: FetchMode;
  debug?: boolean;
  dryRun?: boolean;
  recrawl?: boolean;
  runId: string;
}

/**
 * Crawl statistics
 */
export interface CrawlStats {
  urlsDiscovered: number;
  pagesCrawled: number;
  pagesSkipped: number;
  redirects: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}

/**
 * Page crawl result
 */
export interface PageCrawlResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  redirectChain: string[];
  html: string;
  error?: string;
}
