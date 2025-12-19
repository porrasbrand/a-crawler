/**
 * Main crawler using Crawlee
 * Phase 1: Basic HTTP crawling with deduplication and redirect handling
 */

import { CheerioCrawler, RequestQueue } from 'crawlee';
import { normalizeUrl } from './urlNormalizer';
import { upsertPage, upsertUrlAlias, pageExists, getDomainOverride } from '../db/queries';
import { CrawlOptions, CrawlStats } from '../types/crawl.types';
import { CrawlerPageInsert, UrlAliasInsert } from '../types/database.types';
import { logger } from '../utils/logger';
import { DEFAULT_CONCURRENCY, DEFAULT_REQUEST_TIMEOUT_SECS, USER_AGENT } from '../config/constants';
import { extractContent, calculateJunkScore } from '../extraction/contentExtractor';
import { htmlToMarkdown } from '../extraction/markdownConverter';
import { extractNavStructure } from '../extraction/navExtractor';
import { extractMetadata } from '../parsers/metadataExtractor';
import { extractDomain } from './urlNormalizer';
import { hashHtmlContent } from '../utils/hash';
import { SitemapUrl } from '../parsers/sitemapParser';

/**
 * Run a crawl with the given options
 *
 * @param urls - Array of sitemap URL entries with type hints
 * @param options - Crawl configuration
 * @returns Crawl statistics
 */
export async function runCrawl(urls: SitemapUrl[], options: CrawlOptions): Promise<CrawlStats> {
  const stats: CrawlStats = {
    urlsDiscovered: urls.length,
    pagesCrawled: 0,
    pagesSkipped: 0,
    redirects: 0,
    errors: 0,
    startTime: new Date(),
  };

  logger.info({ runId: options.runId, totalUrls: urls.length }, 'Starting crawl');

  // Create request queue
  const requestQueue = await RequestQueue.open();

  // Track processed URLs to avoid duplicates in queue
  const queuedUrls = new Set<string>();

  // Enqueue all URLs with normalization and type hints
  for (const urlEntry of urls) {
    try {
      const normalized = normalizeUrl(urlEntry.normalizedUrl);

      if (queuedUrls.has(normalized)) {
        logger.debug({ url: urlEntry.normalizedUrl, normalized }, 'Skipping duplicate URL in queue');
        continue;
      }

      // Check if already crawled (deduplication)
      if (!options.recrawl && (await pageExists(normalized))) {
        logger.debug({ url: normalized }, 'Skipping already crawled page');
        stats.pagesSkipped++;
        continue;
      }

      await requestQueue.addRequest({
        url: normalized,
        userData: {
          originalUrl: urlEntry.url,
          sitemapTypeHint: urlEntry.typeHint,
        },
      });

      queuedUrls.add(normalized);
    } catch (error) {
      logger.warn({ url: urlEntry.normalizedUrl, error: (error as Error).message }, 'Failed to enqueue URL');
    }
  }

  // Create Cheerio crawler
  const crawler = new CheerioCrawler({
    requestQueue,
    maxConcurrency: DEFAULT_CONCURRENCY,
    requestHandlerTimeoutSecs: DEFAULT_REQUEST_TIMEOUT_SECS,
    maxRequestsPerCrawl: options.maxPages,

    requestHandler: async ({ request, response, body }) => {
      const requestedUrl = request.userData.originalUrl || request.loadedUrl || request.url;
      const finalUrl = normalizeUrl(request.loadedUrl || request.url);
      const statusCode = response?.statusCode || 0;
      const sitemapTypeHint = request.userData.sitemapTypeHint as string | null | undefined;

      logger.info({ url: finalUrl, statusCode }, 'Page crawled');

      // Build redirect chain
      const redirectChain: string[] = [];
      if (requestedUrl !== finalUrl) {
        redirectChain.push(requestedUrl);
        redirectChain.push(finalUrl);
      }

      // Determine crawl status
      let crawlStatus: 'OK' | 'NOT_FOUND' | 'ERROR' = 'OK';
      if (statusCode === 404 || statusCode === 410) {
        crawlStatus = 'NOT_FOUND';
      } else if (statusCode >= 400) {
        crawlStatus = 'ERROR';
      }

      // Convert body to string if it's a Buffer
      const htmlContent = typeof body === 'string' ? body : body.toString('utf-8');

      // Extract metadata
      const metadata = extractMetadata(htmlContent, finalUrl);

      // Get domain-specific overrides
      const domain = extractDomain(finalUrl);
      const domainOverride = await getDomainOverride(domain);

      // Extract content
      const extraction = extractContent(
        htmlContent,
        finalUrl,
        domainOverride?.main_content_selectors || undefined,
        domainOverride?.remove_selectors || undefined
      );

      // Convert to Markdown (include H1 and shift heading levels)
      const markdown = extraction.success
        ? htmlToMarkdown(extraction.cleanHtml, finalUrl, metadata.h1, true)
        : '';

      // Calculate content hash
      const contentHash = hashHtmlContent(extraction.cleanHtml || htmlContent);

      // Calculate junk score
      const junkScore = calculateJunkScore(extraction.cleanHtml || htmlContent);

      // Extract navigation structure from raw HTML (before cleaning)
      const navStructure = extractNavStructure(htmlContent, finalUrl);

      logger.debug(
        {
          url: finalUrl,
          extractionMethod: extraction.extractionMethod,
          wordCount: extraction.wordCount,
          markdownLength: markdown.length,
          navItems: navStructure.primary_nav.length,
        },
        'Content extracted'
      );

      // Store page data
      const pageData: CrawlerPageInsert = {
        final_url: finalUrl,
        requested_url_original: requestedUrl,
        status_code: statusCode,
        crawl_status: crawlStatus,
        redirect_chain: redirectChain.length > 0 ? redirectChain : undefined,
        html_content: htmlContent,
        clean_html: extraction.cleanHtml,
        markdown: markdown,
        nav_structure: navStructure,
        title: metadata.title || undefined,
        h1: metadata.h1 || undefined,
        meta_description: metadata.metaDescription || undefined,
        word_count: extraction.wordCount,
        content_hash: contentHash,
        fetch_mode: 'cheerio',
        extraction_method: extraction.extractionMethod,
        junk_score: junkScore,
        sitemap_type_hint: sitemapTypeHint || undefined,
        run_id: options.runId,
      };

      try {
        await upsertPage(pageData);
        stats.pagesCrawled++;
      } catch (error) {
        logger.error(
          { url: finalUrl, error: (error as Error).message },
          'Failed to save page'
        );
        stats.errors++;
      }

      // Store URL alias if redirect occurred
      if (redirectChain.length > 0) {
        const aliasData: UrlAliasInsert = {
          requested_url: requestedUrl,
          final_url: finalUrl,
          status_code: statusCode,
          redirect_chain: redirectChain,
          run_id: options.runId,
        };

        try {
          await upsertUrlAlias(aliasData);
          stats.redirects++;
        } catch (error) {
          logger.error(
            { url: requestedUrl, error: (error as Error).message },
            'Failed to save URL alias'
          );
        }
      }

      // Progress logging
      if (stats.pagesCrawled % 10 === 0) {
        logger.info(
          {
            crawled: stats.pagesCrawled,
            skipped: stats.pagesSkipped,
            redirects: stats.redirects,
            errors: stats.errors,
          },
          'Crawl progress'
        );
      }
    },

    failedRequestHandler: async ({ request }, error) => {
      const url = request.url;
      logger.error({ url, error: error.message }, 'Request failed');

      // Store failed request
      const pageData: CrawlerPageInsert = {
        final_url: normalizeUrl(url),
        requested_url_original: url,
        crawl_status: 'ERROR',
        last_error: error.message,
        run_id: options.runId,
      };

      try {
        await upsertPage(pageData);
      } catch (saveError) {
        logger.error(
          { url, error: (saveError as Error).message },
          'Failed to save error page'
        );
      }

      stats.errors++;
    },

    // Use custom user agent
    preNavigationHooks: [
      async (_, req) => {
        req.headers = {
          ...req.headers,
          'User-Agent': USER_AGENT,
        };
      },
    ],
  });

  // Run the crawler
  logger.info('Starting Crawlee crawler');
  await crawler.run();

  // Calculate final stats
  stats.endTime = new Date();
  stats.durationMs = stats.endTime.getTime() - stats.startTime.getTime();

  logger.info(
    {
      runId: options.runId,
      stats,
      durationSec: Math.round(stats.durationMs / 1000),
    },
    'Crawl completed'
  );

  return stats;
}
