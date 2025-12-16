/**
 * Database type definitions
 * Corresponds to MySQL schema in src/db/schema.sql
 */

export type CrawlStatus = 'OK' | 'REDIRECT_ALIAS' | 'NOT_FOUND' | 'SOFT_404' | 'ERROR';
export type FetchMode = 'cheerio' | 'playwright';
export type ExtractionMethod = 'readability' | 'semantic' | 'cms_pattern' | 'fallback';

/**
 * crawler_pages table
 */
export interface CrawlerPage {
  id: number;
  final_url: string;
  requested_url_original: string | null;
  status_code: number | null;
  crawl_status: CrawlStatus;
  redirect_chain: string[] | null;
  html_content: string | null;
  clean_html: string | null;
  markdown: string | null;
  title: string | null;
  h1: string | null;
  meta_description: string | null;
  word_count: number;
  content_hash: string | null;
  fetch_mode: FetchMode | null;
  extraction_method: ExtractionMethod | null;
  junk_score: number | null;
  last_crawled_at: Date;
  last_error: string | null;
  run_id: string | null;
}

/**
 * Insert type for crawler_pages (excluding auto-generated fields)
 */
export interface CrawlerPageInsert {
  final_url: string;
  requested_url_original?: string;
  status_code?: number;
  crawl_status: CrawlStatus;
  redirect_chain?: string[];
  html_content?: string;
  clean_html?: string;
  markdown?: string;
  title?: string;
  h1?: string;
  meta_description?: string;
  word_count?: number;
  content_hash?: string;
  fetch_mode?: FetchMode;
  extraction_method?: ExtractionMethod;
  junk_score?: number;
  last_error?: string;
  run_id?: string;
}

/**
 * url_aliases table
 */
export interface UrlAlias {
  requested_url: string;
  final_url: string;
  status_code: number | null;
  redirect_chain: string[] | null;
  first_seen_at: Date;
  last_seen_at: Date;
  run_id: string | null;
}

/**
 * Insert type for url_aliases
 */
export interface UrlAliasInsert {
  requested_url: string;
  final_url: string;
  status_code?: number;
  redirect_chain?: string[];
  run_id?: string;
}

/**
 * crawl_runs table
 */
export interface CrawlRun {
  run_id: string;
  seed_sitemaps: string[];
  max_pages: number | null;
  fetch_mode_default: FetchMode;
  started_at: Date;
  finished_at: Date | null;
  total_urls_discovered: number;
  total_pages_crawled: number;
  total_redirects: number;
  total_errors: number;
  notes: string | null;
}

/**
 * Insert type for crawl_runs
 */
export interface CrawlRunInsert {
  run_id: string;
  seed_sitemaps: string[];
  max_pages?: number;
  fetch_mode_default?: FetchMode;
  notes?: string;
}

/**
 * Update type for crawl_runs (statistics)
 */
export interface CrawlRunUpdate {
  finished_at?: Date;
  total_urls_discovered?: number;
  total_pages_crawled?: number;
  total_redirects?: number;
  total_errors?: number;
}

/**
 * domain_overrides table
 */
export interface DomainOverride {
  domain: string;
  enabled: boolean;
  main_content_selectors: string[] | null;
  remove_selectors: string[] | null;
  force_fetch_mode: FetchMode | null;
  notes: string | null;
  updated_at: Date;
}

/**
 * Insert/Update type for domain_overrides
 */
export interface DomainOverrideUpsert {
  domain: string;
  enabled?: boolean;
  main_content_selectors?: string[];
  remove_selectors?: string[];
  force_fetch_mode?: FetchMode;
  notes?: string;
}
