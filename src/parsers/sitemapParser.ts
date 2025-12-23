/**
 * Sitemap XML parser
 * Extracts URLs from sitemap.xml files
 */

import Sitemapper from 'sitemapper';
import { normalizeUrl, isValidUrl } from '../core/urlNormalizer';

/**
 * Extract page type hint from sitemap filename
 *
 * Analyzes sitemap URL to determine content type based on filename patterns.
 * Common patterns from WordPress (Yoast SEO), RankMath, and other CMSs.
 *
 * @param sitemapUrl - URL of the sitemap (e.g., "https://example.com/post-sitemap.xml")
 * @returns Type hint string or null if no pattern matches
 *
 * Examples:
 *   "post-sitemap.xml" → "post"
 *   "page-sitemap.xml" → "page"
 *   "category-sitemap.xml" → "pagination"
 *   "product-sitemap.xml" → "product"
 */
export function extractSitemapTypeHint(sitemapUrl: string): string | null {
  const filename = sitemapUrl.split('/').pop() || '';
  const lowerFilename = filename.toLowerCase();

  // WordPress Yoast SEO patterns
  if (/^post-sitemap/i.test(lowerFilename)) return 'post';
  if (/^page-sitemap/i.test(lowerFilename)) return 'page';
  if (/^(category|post_category)-sitemap/i.test(lowerFilename)) return 'pagination';
  if (/^(tag|post_tag)-sitemap/i.test(lowerFilename)) return 'pagination';
  if (/^(author|post_author)-sitemap/i.test(lowerFilename)) return 'pagination';

  // RankMath patterns
  if (/^sitemap-posts/i.test(lowerFilename)) return 'post';
  if (/^sitemap-pages/i.test(lowerFilename)) return 'page';
  if (/^sitemap-categories/i.test(lowerFilename)) return 'pagination';
  if (/^sitemap-tags/i.test(lowerFilename)) return 'pagination';

  // Generic patterns
  if (lowerFilename.includes('blog')) return 'post';
  if (lowerFilename.includes('article')) return 'post';
  if (lowerFilename.includes('news')) return 'post';

  // Custom post types (WordPress)
  if (lowerFilename.includes('product')) return 'product';
  if (lowerFilename.includes('event')) return 'event';
  if (lowerFilename.includes('portfolio')) return 'portfolio';

  // No recognizable pattern
  return null;
}

/**
 * Sitemap URL entry
 */
export interface SitemapUrl {
  url: string;
  normalizedUrl: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  sitemapSource?: string;  // Which sitemap this URL came from
  typeHint?: string | null; // Page type hint from sitemap filename (post/page/etc)
}

/**
 * Parse a sitemap XML and extract all URLs
 *
 * @param sitemapUrl - URL to sitemap.xml
 * @returns Array of URL entries with type hints
 */
export async function parseSitemap(sitemapUrl: string): Promise<SitemapUrl[]> {
  console.log(`📋 Parsing sitemap: ${sitemapUrl}`);

  // Extract type hint from sitemap filename
  const typeHint = extractSitemapTypeHint(sitemapUrl);
  if (typeHint) {
    console.log(`   Type hint: "${typeHint}" (from sitemap filename)`);
  }

  try {
    const sitemapper = new Sitemapper({
      url: sitemapUrl,
      timeout: 30000, // 30 second timeout
      requestHeaders: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ACrawler/1.0; +https://github.com/your-repo)',
      },
    });

    const { sites, errors } = await sitemapper.fetch();

    if (errors && errors.length > 0) {
      console.warn(`⚠️  Sitemap parsing warnings:`, errors);
    }

    // Filter and normalize URLs
    const urls: SitemapUrl[] = [];
    for (const url of sites) {
      if (!isValidUrl(url)) {
        console.warn(`⚠️  Skipping invalid URL from sitemap: ${url}`);
        continue;
      }

      try {
        const normalizedUrl = normalizeUrl(url);
        urls.push({
          url,
          normalizedUrl,
          sitemapSource: sitemapUrl,
          typeHint,
        });
      } catch (error) {
        console.warn(`⚠️  Failed to normalize URL: ${url}`, (error as Error).message);
      }
    }

    console.log(`✅ Found ${urls.length} URLs in sitemap`);
    return urls;
  } catch (error) {
    throw new Error(
      `Failed to parse sitemap "${sitemapUrl}": ${(error as Error).message}`
    );
  }
}

/**
 * Check if URL is a sitemap index (contains <sitemapindex> tag)
 *
 * @param sitemapUrl - URL to check
 * @returns True if it's a sitemap index
 */
async function isSitemapIndex(sitemapUrl: string): Promise<boolean> {
  try {
    const response = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ACrawler/1.0)',
      },
    });
    const xmlText = await response.text();
    return xmlText.includes('<sitemapindex');
  } catch {
    return false;
  }
}

/**
 * Parse sitemap index and extract child sitemap URLs
 * Must manually parse XML because Sitemapper auto-expands indexes
 *
 * @param sitemapIndexUrl - URL to sitemap_index.xml
 * @returns Array of child sitemap URLs
 */
async function parseSitemapIndex(sitemapIndexUrl: string): Promise<string[]> {
  console.log(`📋 Parsing sitemap index: ${sitemapIndexUrl}`);

  try {
    const response = await fetch(sitemapIndexUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ACrawler/1.0)',
      },
    });

    const xmlText = await response.text();

    // Extract <loc> URLs from <sitemap> entries (not <url> entries!)
    // Pattern: <sitemap><loc>URL</loc></sitemap>
    const sitemapMatches = xmlText.matchAll(/<sitemap>[\s\S]*?<loc>(.*?)<\/loc>[\s\S]*?<\/sitemap>/g);

    const childSitemaps: string[] = [];
    for (const match of sitemapMatches) {
      const url = match[1].trim();
      if (url) {
        childSitemaps.push(url);
      }
    }

    console.log(`✅ Found ${childSitemaps.length} child sitemaps`);
    childSitemaps.forEach(url => {
      const hint = extractSitemapTypeHint(url);
      console.log(`   - ${url} ${hint ? `[${hint}]` : ''}`);
    });

    return childSitemaps;
  } catch (error) {
    throw new Error(
      `Failed to parse sitemap index "${sitemapIndexUrl}": ${(error as Error).message}`
    );
  }
}

/**
 * Parse multiple sitemaps and combine results
 * Handles sitemap index files by parsing child sitemaps individually
 *
 * @param sitemapUrls - Array of sitemap URLs (can include sitemap_index.xml)
 * @returns Combined array of unique URL entries with type hints
 */
export async function parseMultipleSitemaps(
  sitemapUrls: string[]
): Promise<SitemapUrl[]> {
  console.log(`📋 Parsing ${sitemapUrls.length} sitemap(s)...`);

  const allUrls: SitemapUrl[] = [];
  const seenUrls = new Set<string>();
  const sitemapsToParse: string[] = [];

  // Expand sitemap index files into child sitemaps
  for (const sitemapUrl of sitemapUrls) {
    const isIndex = await isSitemapIndex(sitemapUrl);

    if (isIndex) {
      console.log(`   📂 Detected sitemap index, expanding...`);
      try {
        const childSitemaps = await parseSitemapIndex(sitemapUrl);
        sitemapsToParse.push(...childSitemaps);
      } catch (error) {
        console.error(`❌ Failed to expand sitemap index ${sitemapUrl}:`, (error as Error).message);
      }
    } else {
      sitemapsToParse.push(sitemapUrl);
    }
  }

  console.log(`📋 Total sitemaps to parse: ${sitemapsToParse.length}`);

  // Parse each sitemap (now with type hints preserved)
  for (const sitemapUrl of sitemapsToParse) {
    try {
      const urls = await parseSitemap(sitemapUrl);

      // Deduplicate across sitemaps
      for (const urlEntry of urls) {
        if (!seenUrls.has(urlEntry.normalizedUrl)) {
          seenUrls.add(urlEntry.normalizedUrl);
          allUrls.push(urlEntry);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to parse sitemap ${sitemapUrl}:`, (error as Error).message);
      // Continue with other sitemaps even if one fails
    }
  }

  console.log(`✅ Total unique URLs across all sitemaps: ${allUrls.length}`);
  return allUrls;
}

/**
 * Validate sitemap URL format
 *
 * @param url - URL to validate
 * @returns True if valid sitemap URL
 */
export function isValidSitemapUrl(url: string): boolean {
  if (!isValidUrl(url)) return false;

  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.xml') || lowerUrl.includes('sitemap');
}
