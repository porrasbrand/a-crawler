#!/usr/bin/env node

/**
 * CLI entry point for the crawler
 */

import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import { parseMultipleSitemaps } from './parsers/sitemapParser';
import { runCrawl } from './core/crawler';
import { testConnection, closePool } from './config/database';
import { createCrawlRun, updateCrawlRun, finishCrawlRun } from './db/queries';
import { CrawlOptions } from './types/crawl.types';
import { logger } from './utils/logger';
import { DEFAULT_MAX_PAGES, DEFAULT_FETCH_MODE } from './config/constants';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('crawl')
  .description('Self-hosted website crawler with Markdown extraction')
  .version('1.0.0')
  .requiredOption('-s, --sitemap <urls...>', 'Sitemap XML URL(s)')
  .option('-m, --max-pages <number>', 'Maximum pages to crawl', String(DEFAULT_MAX_PAGES))
  .option(
    '-f, --fetch-mode <mode>',
    'Default fetch mode (cheerio|playwright)',
    DEFAULT_FETCH_MODE
  )
  .option('-d, --debug', 'Enable debug logging')
  .option('--dry-run', 'Parse sitemap without crawling')
  .option('--recrawl', 'Force recrawl of existing pages')
  .action(async (options) => {
    try {
      await main(options);
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Crawl failed');
      process.exit(1);
    }
  });

/**
 * Main crawl execution
 */
async function main(cliOptions: any) {
  const runId = uuidv4();

  // Set log level if debug
  if (cliOptions.debug) {
    process.env.LOG_LEVEL = 'debug';
  }

  logger.info({ runId }, '🚀 A-Crawler starting');
  logger.info({ options: cliOptions }, 'Configuration');

  // Test database connection (skip in dry-run mode)
  if (!cliOptions.dryRun) {
    logger.info('Testing database connection...');
    await testConnection();
  }

  // Parse sitemaps
  logger.info({ sitemaps: cliOptions.sitemap }, 'Parsing sitemaps');
  const sitemapUrls = await parseMultipleSitemaps(cliOptions.sitemap);

  if (sitemapUrls.length === 0) {
    logger.error('No URLs found in sitemaps');
    process.exit(1);
  }

  logger.info({ totalUrls: sitemapUrls.length }, 'URLs discovered from sitemaps');

  // Dry run - just show what would be crawled
  if (cliOptions.dryRun) {
    logger.info('Dry run mode - showing first 10 URLs:');
    sitemapUrls.slice(0, 10).forEach((entry, i) => {
      console.log(`  ${i + 1}. ${entry.normalizedUrl}`);
    });
    if (sitemapUrls.length > 10) {
      console.log(`  ... and ${sitemapUrls.length - 10} more`);
    }
    logger.info('Dry run complete. Exiting without crawling.');
    await closePool();
    return;
  }

  // Create crawl run record
  logger.info({ runId }, 'Creating crawl run record');
  await createCrawlRun({
    run_id: runId,
    seed_sitemaps: cliOptions.sitemap,
    max_pages: parseInt(cliOptions.maxPages, 10),
    fetch_mode_default: cliOptions.fetchMode,
  });

  // Prepare crawl options
  const crawlOptions: CrawlOptions = {
    sitemaps: cliOptions.sitemap,
    maxPages: parseInt(cliOptions.maxPages, 10),
    fetchMode: cliOptions.fetchMode,
    debug: cliOptions.debug,
    recrawl: cliOptions.recrawl,
    runId,
  };

  // Extract just the URLs
  const urls = sitemapUrls.map((entry) => entry.normalizedUrl);

  // Run the crawl
  logger.info({ totalUrls: urls.length }, '🕷️  Starting crawl');
  const stats = await runCrawl(urls, crawlOptions);

  // Update crawl run with statistics
  await updateCrawlRun(runId, {
    total_urls_discovered: stats.urlsDiscovered,
    total_pages_crawled: stats.pagesCrawled,
    total_redirects: stats.redirects,
    total_errors: stats.errors,
  });

  await finishCrawlRun(runId);

  // Display summary
  displaySummary(runId, stats);

  // Close database connections
  await closePool();

  logger.info('✅ Crawl complete');
}

/**
 * Display crawl summary
 */
function displaySummary(runId: string, stats: any) {
  const durationSec = Math.round(stats.durationMs / 1000);
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;

  console.log('\n' + '='.repeat(60));
  console.log('✅ Crawl Complete');
  console.log('='.repeat(60));
  console.log(`Run ID: ${runId}`);
  console.log('');
  console.log('📊 Statistics:');
  console.log(`  • Total URLs discovered:  ${stats.urlsDiscovered.toLocaleString()}`);
  console.log(`  • Pages crawled:          ${stats.pagesCrawled.toLocaleString()}`);
  console.log(`  • Pages skipped (dupes):  ${stats.pagesSkipped.toLocaleString()}`);
  console.log(`  • Redirects:              ${stats.redirects.toLocaleString()}`);
  console.log(`  • Errors:                 ${stats.errors.toLocaleString()}`);
  console.log('');
  console.log(`⏱  Duration: ${minutes}m ${seconds}s`);
  console.log(`💾  Database: ${process.env.MYSQL_DATABASE || 'crawler_db'}`);
  console.log('='.repeat(60) + '\n');
}

// Parse CLI arguments
program.parse();
