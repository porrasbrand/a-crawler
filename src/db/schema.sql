-- Self-Hosted Website Crawler Database Schema
-- MySQL 8.0+
-- Character set: utf8mb4 for full Unicode support

CREATE DATABASE IF NOT EXISTS crawler_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE crawler_db;

-- ============================================================================
-- Table 1: crawler_pages
-- Stores canonical pages (deduplicated by final_url)
-- ============================================================================
CREATE TABLE IF NOT EXISTS crawler_pages (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- URLs
  final_url VARCHAR(768) NOT NULL UNIQUE COMMENT 'Normalized final URL after redirects (canonical identity)',
  requested_url_original TEXT COMMENT 'Original URL as requested',

  -- Response metadata
  status_code INT COMMENT 'HTTP status code',
  crawl_status ENUM('OK', 'REDIRECT_ALIAS', 'NOT_FOUND', 'SOFT_404', 'ERROR') NOT NULL COMMENT 'Crawl outcome',
  redirect_chain JSON COMMENT 'Full redirect chain as array',

  -- Content storage
  html_content LONGTEXT COMMENT 'Raw HTML from response',
  clean_html LONGTEXT COMMENT 'Cleaned HTML after DOM processing',
  markdown LONGTEXT COMMENT 'Extracted Markdown content',

  -- Metadata
  title VARCHAR(500) COMMENT 'Page title',
  h1 VARCHAR(500) COMMENT 'First H1 heading',
  meta_description TEXT COMMENT 'Meta description',
  word_count INT DEFAULT 0 COMMENT 'Word count of main content',
  content_hash VARCHAR(32) COMMENT 'MD5 hash of content for change detection',

  -- Extraction metadata
  fetch_mode ENUM('cheerio', 'playwright') COMMENT 'Crawler mode used',
  extraction_method VARCHAR(50) COMMENT 'Method used: readability, semantic, cms_pattern, fallback',
  junk_score FLOAT COMMENT 'Quality score (lower is better)',

  -- Timestamps and tracking
  last_crawled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Last successful crawl time',
  last_error TEXT COMMENT 'Last error message if crawl failed',
  run_id VARCHAR(36) COMMENT 'UUID of crawl run that created/updated this page',

  -- Indexes for performance
  INDEX idx_final_url_hash (final_url(255)),
  INDEX idx_crawl_status (crawl_status),
  INDEX idx_content_hash (content_hash),
  INDEX idx_run_id (run_id),
  INDEX idx_last_crawled (last_crawled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Canonical pages table - one row per unique final_url';

-- ============================================================================
-- Table 2: url_aliases
-- Tracks all discovered URLs that map to canonical pages
-- Critical for redirect analysis and sitemap hygiene
-- ============================================================================
CREATE TABLE IF NOT EXISTS url_aliases (
  requested_url VARCHAR(768) NOT NULL UNIQUE PRIMARY KEY COMMENT 'The URL as requested',
  final_url VARCHAR(768) NOT NULL COMMENT 'Final URL after redirects',
  status_code INT COMMENT 'HTTP status code',
  redirect_chain JSON COMMENT 'Full redirect path',
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'First time this alias was discovered',
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last time seen',
  run_id VARCHAR(36) COMMENT 'Most recent run that saw this alias',

  -- Indexes
  INDEX idx_alias_final_url (final_url(255)),
  INDEX idx_run_id (run_id),
  INDEX idx_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='URL aliases for redirect tracking and deduplication';

-- ============================================================================
-- Table 3: crawl_runs
-- Tracks crawl execution metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS crawl_runs (
  run_id VARCHAR(36) PRIMARY KEY COMMENT 'UUID for this crawl run',
  seed_sitemaps JSON NOT NULL COMMENT 'Array of sitemap URLs used as seeds',
  max_pages INT COMMENT 'Maximum pages limit for this run',
  fetch_mode_default ENUM('cheerio', 'playwright') DEFAULT 'cheerio' COMMENT 'Default crawler mode',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Run start time',
  finished_at TIMESTAMP NULL COMMENT 'Run completion time',
  total_urls_discovered INT DEFAULT 0 COMMENT 'Total URLs found in sitemaps',
  total_pages_crawled INT DEFAULT 0 COMMENT 'Total pages successfully crawled',
  total_redirects INT DEFAULT 0 COMMENT 'Total redirects encountered',
  total_errors INT DEFAULT 0 COMMENT 'Total errors encountered',
  notes TEXT COMMENT 'Optional notes about this run',

  -- Indexes
  INDEX idx_started_at (started_at),
  INDEX idx_finished_at (finished_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Crawl run metadata and statistics';

-- ============================================================================
-- Table 4: domain_overrides
-- Per-domain configuration overrides for extraction
-- Enables site-specific tuning from day one
-- ============================================================================
CREATE TABLE IF NOT EXISTS domain_overrides (
  domain VARCHAR(255) PRIMARY KEY COMMENT 'Domain name (e.g., example.com)',
  enabled BOOLEAN DEFAULT TRUE COMMENT 'Whether this override is active',
  main_content_selectors JSON COMMENT 'Array of CSS selectors for main content',
  remove_selectors JSON COMMENT 'Array of CSS selectors to remove',
  force_fetch_mode ENUM('cheerio', 'playwright') COMMENT 'Force specific crawler mode',
  notes TEXT COMMENT 'Documentation about why this override exists',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update time',

  -- Indexes
  INDEX idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Domain-specific extraction configuration';

-- ============================================================================
-- Example domain override (commented out - for reference)
-- ============================================================================
-- INSERT INTO domain_overrides (domain, enabled, main_content_selectors, remove_selectors, force_fetch_mode, notes)
-- VALUES (
--   'example.com',
--   TRUE,
--   JSON_ARRAY('.article-body', 'main', '.entry-content'),
--   JSON_ARRAY('.sidebar', '.navigation', '.footer'),
--   'cheerio',
--   'WordPress site with standard structure'
-- );

-- ============================================================================
-- Useful queries for monitoring
-- ============================================================================

-- View crawl statistics
-- SELECT
--   run_id,
--   started_at,
--   finished_at,
--   total_urls_discovered,
--   total_pages_crawled,
--   total_redirects,
--   total_errors,
--   TIMESTAMPDIFF(SECOND, started_at, finished_at) as duration_seconds
-- FROM crawl_runs
-- ORDER BY started_at DESC
-- LIMIT 10;

-- View pages by crawl status
-- SELECT
--   crawl_status,
--   COUNT(*) as count,
--   AVG(word_count) as avg_word_count
-- FROM crawler_pages
-- GROUP BY crawl_status;

-- Find redirect chains
-- SELECT
--   requested_url,
--   final_url,
--   redirect_chain,
--   status_code
-- FROM url_aliases
-- WHERE JSON_LENGTH(redirect_chain) > 2
-- LIMIT 20;

-- Check recent crawl activity
-- SELECT
--   DATE(last_crawled_at) as crawl_date,
--   COUNT(*) as pages_crawled,
--   AVG(word_count) as avg_words
-- FROM crawler_pages
-- GROUP BY DATE(last_crawled_at)
-- ORDER BY crawl_date DESC
-- LIMIT 30;
