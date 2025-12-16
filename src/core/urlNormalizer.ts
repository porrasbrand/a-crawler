/**
 * URL Normalizer - CRITICAL COMPONENT
 * All deduplication depends on consistent URL normalization
 *
 * The identity of a page = normalized final_url
 */

import { TRACKING_PARAMS } from '../config/constants';

/**
 * Normalize a URL for consistent comparison and deduplication
 *
 * Rules (applied in order):
 * 1. Add https:// if protocol missing
 * 2. Parse with URL API
 * 3. Lowercase hostname
 * 4. Remove fragment (#)
 * 5. Strip tracking parameters
 * 6. Sort remaining query parameters alphabetically
 * 7. Remove trailing slash (except root /)
 *
 * @param url - Raw URL string
 * @returns Normalized URL
 */
export function normalizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL: must be a non-empty string');
  }

  try {
    let normalized = url.trim();

    // Add protocol if missing
    if (!normalized.match(/^https?:\/\//i)) {
      normalized = `https://${normalized}`;
    }

    // Parse URL
    const urlObj = new URL(normalized);

    // Convert hostname to lowercase
    urlObj.hostname = urlObj.hostname.toLowerCase();

    // Remove fragment
    urlObj.hash = '';

    // Remove tracking parameters
    const searchParams = new URLSearchParams(urlObj.search);
    TRACKING_PARAMS.forEach((param) => {
      searchParams.delete(param);
    });

    // Sort remaining parameters alphabetically for consistency
    const sortedParams = new URLSearchParams(
      Array.from(searchParams.entries()).sort(([a], [b]) => a.localeCompare(b))
    );

    urlObj.search = sortedParams.toString();

    // Remove trailing slash (except for root path)
    let pathname = urlObj.pathname;
    if (pathname !== '/' && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    urlObj.pathname = pathname;

    return urlObj.toString();
  } catch (error) {
    throw new Error(`Failed to normalize URL "${url}": ${(error as Error).message}`);
  }
}

/**
 * Extract domain from URL
 *
 * @param url - Full URL
 * @returns Domain (e.g., "example.com")
 */
export function extractDomain(url: string): string {
  try {
    const normalized = normalizeUrl(url);
    const urlObj = new URL(normalized);
    return urlObj.hostname;
  } catch (error) {
    throw new Error(`Failed to extract domain from "${url}": ${(error as Error).message}`);
  }
}

/**
 * Validate URL format
 *
 * @param url - URL to validate
 * @returns True if valid URL
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  try {
    normalizeUrl(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a relative URL against a base URL
 *
 * @param relativeUrl - Relative URL (e.g., "/about", "../contact")
 * @param baseUrl - Base URL to resolve against
 * @returns Absolute normalized URL
 */
export function resolveUrl(relativeUrl: string, baseUrl: string): string {
  try {
    const base = normalizeUrl(baseUrl);
    const resolved = new URL(relativeUrl, base);
    return normalizeUrl(resolved.toString());
  } catch (error) {
    throw new Error(
      `Failed to resolve "${relativeUrl}" against "${baseUrl}": ${(error as Error).message}`
    );
  }
}

/**
 * Get URL path without domain
 *
 * @param url - Full URL
 * @returns Path (e.g., "/about/team")
 */
export function getUrlPath(url: string): string {
  try {
    const normalized = normalizeUrl(url);
    const urlObj = new URL(normalized);
    return urlObj.pathname;
  } catch (error) {
    throw new Error(`Failed to get path from "${url}": ${(error as Error).message}`);
  }
}

/**
 * Check if two URLs are equivalent (after normalization)
 *
 * @param url1 - First URL
 * @param url2 - Second URL
 * @returns True if URLs are equivalent
 */
export function areUrlsEquivalent(url1: string, url2: string): boolean {
  try {
    return normalizeUrl(url1) === normalizeUrl(url2);
  } catch {
    return false;
  }
}
