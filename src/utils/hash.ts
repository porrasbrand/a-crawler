/**
 * Hashing utilities
 * Used for content change detection and deduplication
 */

import crypto from 'crypto';

/**
 * Generate MD5 hash of content
 *
 * @param content - Content to hash
 * @returns MD5 hash string (32 characters)
 */
export function md5Hash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Generate content hash from HTML
 * Normalizes whitespace before hashing for consistency
 *
 * @param html - HTML content
 * @returns MD5 hash
 */
export function hashHtmlContent(html: string): string {
  if (!html) return '';

  // Normalize whitespace for consistent hashing
  const normalized = html
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();

  return md5Hash(normalized);
}

/**
 * Generate content hash from markdown
 *
 * @param markdown - Markdown content
 * @returns MD5 hash
 */
export function hashMarkdownContent(markdown: string): string {
  if (!markdown) return '';

  const normalized = markdown
    .replace(/\s+/g, ' ')
    .trim();

  return md5Hash(normalized);
}

/**
 * Compare two hashes for equality
 *
 * @param hash1 - First hash
 * @param hash2 - Second hash
 * @returns True if hashes match
 */
export function hashesMatch(hash1: string | null, hash2: string | null): boolean {
  if (!hash1 || !hash2) return false;
  return hash1 === hash2;
}
