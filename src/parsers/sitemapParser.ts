/**
 * Sitemap XML parser
 * Extracts URLs from sitemap.xml files
 */

import Sitemapper from 'sitemapper';
import { normalizeUrl, isValidUrl } from '../core/urlNormalizer';

/**
 * Sitemap URL entry
 */
export interface SitemapUrl {
  url: string;
  normalizedUrl: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

/**
 * Parse a sitemap XML and extract all URLs
 *
 * @param sitemapUrl - URL to sitemap.xml
 * @returns Array of URL entries
 */
export async function parseSitemap(sitemapUrl: string): Promise<SitemapUrl[]> {
  console.log(`📋 Parsing sitemap: ${sitemapUrl}`);

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
 * Parse multiple sitemaps and combine results
 *
 * @param sitemapUrls - Array of sitemap URLs
 * @returns Combined array of unique URL entries
 */
export async function parseMultipleSitemaps(
  sitemapUrls: string[]
): Promise<SitemapUrl[]> {
  console.log(`📋 Parsing ${sitemapUrls.length} sitemap(s)...`);

  const allUrls: SitemapUrl[] = [];
  const seenUrls = new Set<string>();

  for (const sitemapUrl of sitemapUrls) {
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
