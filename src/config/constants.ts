/**
 * Global constants for the crawler
 */

/**
 * URL tracking parameters to strip during normalization
 * These don't affect content but create duplicate URLs
 */
export const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'msclkid',
  'ref',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'gad_source',
  'campaignid',
  'adgroupid',
];

/**
 * Content quality thresholds
 */
export const MIN_CONTENT_WORDS = 50;
export const THIN_CONTENT_WORDS = 100;
export const READABILITY_MIN_WORDS = 100;

/**
 * Soft-404 detection patterns
 */
export const SOFT_404_TITLE_PATTERNS = [
  /not found/i,
  /404/i,
  /page.*not.*exist/i,
  /page.*cannot.*be.*found/i,
  /no.*page.*found/i,
];

export const SOFT_404_BODY_PATTERNS = [
  /sorry.*page.*not.*found/i,
  /the.*page.*you.*requested.*could.*not.*be.*found/i,
  /we.*can.*t.*find.*that.*page/i,
  /404.*error/i,
];

/**
 * Known CMS content selectors (fallback extraction)
 */
export const CMS_CONTENT_SELECTORS = [
  '.entry-content',
  '.post-content',
  '.article-content',
  '.content-area',
  '#content',
  '.main-content',
  '[itemprop="articleBody"]',
];

/**
 * Elements to always remove during extraction
 */
export const REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'nav',
  'header',
  'footer',
  'aside',
  '.navigation',
  '.menu',
  '.sidebar',
  '.cookie-banner',
  '.popup',
  '.modal',
  '.advertisement',
  '.ad',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
];

/**
 * Crawl defaults
 */
export const DEFAULT_CONCURRENCY = 10;
export const DEFAULT_REQUEST_TIMEOUT_SECS = 60;
export const DEFAULT_MAX_PAGES = 10000;
export const DEFAULT_FETCH_MODE = 'cheerio' as const;

/**
 * User agent string
 */
export const USER_AGENT = 'Mozilla/5.0 (compatible; ACrawler/1.0; +https://github.com/your-repo)';

/**
 * Markdown generation options
 */
export const INCLUDE_H1_IN_MARKDOWN = true;
export const DETECT_SEO_ISSUES = true;
