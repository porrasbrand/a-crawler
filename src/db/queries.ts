/**
 * Database query functions
 * All queries use safe upsert logic to prevent data loss
 */

import { pool } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  CrawlerPage,
  CrawlerPageInsert,
  UrlAlias,
  UrlAliasInsert,
  CrawlRun,
  CrawlRunInsert,
  CrawlRunUpdate,
  DomainOverride,
  DomainOverrideUpsert,
} from '../types/database.types';

/**
 * Upsert a page into crawler_pages
 * Uses content_hash to prevent overwriting good content with empty/bad data
 *
 * @param page - Page data to insert/update
 */
export async function upsertPage(page: CrawlerPageInsert): Promise<void> {
  const query = `
    INSERT INTO crawler_pages (
      final_url, requested_url_original, status_code, crawl_status,
      redirect_chain, html_content, clean_html, markdown,
      title, h1, meta_description, word_count, content_hash,
      sitemap_type_hint,
      fetch_mode, extraction_method, junk_score, last_error, run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status_code = VALUES(status_code),
      crawl_status = VALUES(crawl_status),
      redirect_chain = VALUES(redirect_chain),
      fetch_mode = VALUES(fetch_mode),

      -- ONLY update HTML content if new hash is present AND different
      html_content = IF(
        VALUES(content_hash) IS NOT NULL AND VALUES(content_hash) != COALESCE(content_hash, ''),
        VALUES(html_content),
        html_content
      ),
      clean_html = IF(
        VALUES(content_hash) IS NOT NULL AND VALUES(content_hash) != COALESCE(content_hash, ''),
        VALUES(clean_html),
        clean_html
      ),
      -- ALWAYS update markdown if provided (allows markdown generation logic improvements)
      markdown = COALESCE(VALUES(markdown), markdown),

      -- Update metadata (COALESCE preserves existing if new is NULL)
      title = COALESCE(VALUES(title), title),
      h1 = COALESCE(VALUES(h1), h1),
      meta_description = COALESCE(VALUES(meta_description), meta_description),
      word_count = COALESCE(VALUES(word_count), word_count),
      extraction_method = COALESCE(VALUES(extraction_method), extraction_method),
      junk_score = COALESCE(VALUES(junk_score), junk_score),
      content_hash = COALESCE(VALUES(content_hash), content_hash),
      sitemap_type_hint = COALESCE(VALUES(sitemap_type_hint), sitemap_type_hint),

      last_error = VALUES(last_error),
      last_crawled_at = CURRENT_TIMESTAMP,
      run_id = VALUES(run_id)
  `;

  const params = [
    page.final_url,
    page.requested_url_original || null,
    page.status_code || null,
    page.crawl_status,
    page.redirect_chain ? JSON.stringify(page.redirect_chain) : null,
    page.html_content || null,
    page.clean_html || null,
    page.markdown || null,
    page.title || null,
    page.h1 || null,
    page.meta_description || null,
    page.word_count || 0,
    page.content_hash || null,
    page.sitemap_type_hint || null,
    page.fetch_mode || null,
    page.extraction_method || null,
    page.junk_score || null,
    page.last_error || null,
    page.run_id || null,
  ];

  await pool.execute(query, params);
}

/**
 * Upsert a URL alias
 * Always updates last_seen_at to track redirect persistence
 *
 * @param alias - URL alias data
 */
export async function upsertUrlAlias(alias: UrlAliasInsert): Promise<void> {
  const query = `
    INSERT INTO url_aliases (
      requested_url, final_url, status_code, redirect_chain, run_id
    ) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      final_url = VALUES(final_url),
      status_code = VALUES(status_code),
      redirect_chain = VALUES(redirect_chain),
      last_seen_at = CURRENT_TIMESTAMP,
      run_id = VALUES(run_id)
  `;

  const params = [
    alias.requested_url,
    alias.final_url,
    alias.status_code || null,
    alias.redirect_chain ? JSON.stringify(alias.redirect_chain) : null,
    alias.run_id || null,
  ];

  await pool.execute(query, params);
}

/**
 * Check if a page already exists (for deduplication)
 *
 * @param finalUrl - Normalized final URL to check
 * @returns True if page exists
 */
export async function pageExists(finalUrl: string): Promise<boolean> {
  const query = 'SELECT 1 FROM crawler_pages WHERE final_url = ? LIMIT 1';
  const [rows] = await pool.execute<RowDataPacket[]>(query, [finalUrl]);
  return rows.length > 0;
}

/**
 * Get a page by final URL
 *
 * @param finalUrl - Normalized final URL
 * @returns Page data or null if not found
 */
export async function getPageByUrl(finalUrl: string): Promise<CrawlerPage | null> {
  const query = 'SELECT * FROM crawler_pages WHERE final_url = ? LIMIT 1';
  const [rows] = await pool.execute<RowDataPacket[]>(query, [finalUrl]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    ...row,
    redirect_chain: row.redirect_chain ? JSON.parse(row.redirect_chain) : null,
  } as CrawlerPage;
}

/**
 * Create a new crawl run
 *
 * @param run - Crawl run data
 */
export async function createCrawlRun(run: CrawlRunInsert): Promise<void> {
  const query = `
    INSERT INTO crawl_runs (
      run_id, seed_sitemaps, max_pages, fetch_mode_default, notes
    ) VALUES (?, ?, ?, ?, ?)
  `;

  const params = [
    run.run_id,
    JSON.stringify(run.seed_sitemaps),
    run.max_pages || null,
    run.fetch_mode_default || 'cheerio',
    run.notes || null,
  ];

  await pool.execute(query, params);
}

/**
 * Update crawl run statistics
 *
 * @param runId - Crawl run UUID
 * @param stats - Statistics to update
 */
export async function updateCrawlRun(runId: string, stats: CrawlRunUpdate): Promise<void> {
  const updates: string[] = [];
  const params: any[] = [];

  if (stats.finished_at !== undefined) {
    updates.push('finished_at = ?');
    params.push(stats.finished_at);
  }
  if (stats.total_urls_discovered !== undefined) {
    updates.push('total_urls_discovered = ?');
    params.push(stats.total_urls_discovered);
  }
  if (stats.total_pages_crawled !== undefined) {
    updates.push('total_pages_crawled = ?');
    params.push(stats.total_pages_crawled);
  }
  if (stats.total_redirects !== undefined) {
    updates.push('total_redirects = ?');
    params.push(stats.total_redirects);
  }
  if (stats.total_errors !== undefined) {
    updates.push('total_errors = ?');
    params.push(stats.total_errors);
  }

  if (updates.length === 0) return;

  params.push(runId);
  const query = `UPDATE crawl_runs SET ${updates.join(', ')} WHERE run_id = ?`;

  await pool.execute(query, params);
}

/**
 * Finish a crawl run (set finished_at)
 *
 * @param runId - Crawl run UUID
 */
export async function finishCrawlRun(runId: string): Promise<void> {
  const query = 'UPDATE crawl_runs SET finished_at = CURRENT_TIMESTAMP WHERE run_id = ?';
  await pool.execute(query, [runId]);
}

/**
 * Get all domain overrides
 *
 * @param enabledOnly - Only return enabled overrides
 * @returns Array of domain overrides
 */
export async function getDomainOverrides(
  enabledOnly: boolean = true
): Promise<DomainOverride[]> {
  let query = 'SELECT * FROM domain_overrides';
  if (enabledOnly) {
    query += ' WHERE enabled = TRUE';
  }

  const [rows] = await pool.execute<RowDataPacket[]>(query);

  return rows.map((row) => ({
    ...row,
    main_content_selectors: row.main_content_selectors
      ? JSON.parse(row.main_content_selectors)
      : null,
    remove_selectors: row.remove_selectors ? JSON.parse(row.remove_selectors) : null,
  })) as DomainOverride[];
}

/**
 * Get domain override for a specific domain
 *
 * @param domain - Domain name
 * @returns Domain override or null
 */
export async function getDomainOverride(domain: string): Promise<DomainOverride | null> {
  const query = 'SELECT * FROM domain_overrides WHERE domain = ? AND enabled = TRUE LIMIT 1';
  const [rows] = await pool.execute<RowDataPacket[]>(query, [domain]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    ...row,
    main_content_selectors: row.main_content_selectors
      ? JSON.parse(row.main_content_selectors)
      : null,
    remove_selectors: row.remove_selectors ? JSON.parse(row.remove_selectors) : null,
  } as DomainOverride;
}

/**
 * Upsert a domain override
 *
 * @param override - Domain override data
 */
export async function upsertDomainOverride(override: DomainOverrideUpsert): Promise<void> {
  const query = `
    INSERT INTO domain_overrides (
      domain, enabled, main_content_selectors, remove_selectors, force_fetch_mode, notes
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      enabled = VALUES(enabled),
      main_content_selectors = VALUES(main_content_selectors),
      remove_selectors = VALUES(remove_selectors),
      force_fetch_mode = VALUES(force_fetch_mode),
      notes = VALUES(notes),
      updated_at = CURRENT_TIMESTAMP
  `;

  const params = [
    override.domain,
    override.enabled !== undefined ? override.enabled : true,
    override.main_content_selectors
      ? JSON.stringify(override.main_content_selectors)
      : null,
    override.remove_selectors ? JSON.stringify(override.remove_selectors) : null,
    override.force_fetch_mode || null,
    override.notes || null,
  ];

  await pool.execute(query, params);
}

/**
 * Get pages by run_id
 *
 * @param runId - Crawl run UUID
 * @returns Array of pages
 */
export async function getPagesByRunId(runId: string): Promise<CrawlerPage[]> {
  const query = 'SELECT * FROM crawler_pages WHERE run_id = ? ORDER BY id';
  const [rows] = await pool.execute<RowDataPacket[]>(query, [runId]);

  return rows.map((row) => ({
    ...row,
    redirect_chain: row.redirect_chain ? JSON.parse(row.redirect_chain) : null,
  })) as CrawlerPage[];
}

/**
 * Get crawl run by ID
 *
 * @param runId - Crawl run UUID
 * @returns Crawl run data or null
 */
export async function getCrawlRun(runId: string): Promise<CrawlRun | null> {
  const query = 'SELECT * FROM crawl_runs WHERE run_id = ? LIMIT 1';
  const [rows] = await pool.execute<RowDataPacket[]>(query, [runId]);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    ...row,
    seed_sitemaps: row.seed_sitemaps ? JSON.parse(row.seed_sitemaps) : [],
  } as CrawlRun;
}
