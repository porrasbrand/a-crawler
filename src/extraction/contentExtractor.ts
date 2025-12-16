/**
 * Main content extraction using multiple strategies
 * Priority: Domain overrides > Readability > Semantic HTML > CMS patterns > Fallback
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { cleanHtml, extractBySelectors, removeElements } from './htmlCleaner';
import { CMS_CONTENT_SELECTORS, READABILITY_MIN_WORDS } from '../config/constants';
import type { ExtractionMethod } from '../types/database.types';

/**
 * Extraction result
 */
export interface ExtractionResult {
  cleanHtml: string;
  extractionMethod: ExtractionMethod;
  wordCount: number;
  success: boolean;
}

/**
 * Extract main content from HTML
 *
 * @param html - Raw HTML string
 * @param url - Page URL (for Readability)
 * @param domainSelectors - Optional domain-specific selectors
 * @param removeSelectors - Optional selectors to remove
 * @returns Extraction result
 */
export function extractContent(
  html: string,
  url: string,
  domainSelectors?: string[],
  removeSelectors?: string[]
): ExtractionResult {
  if (!html) {
    return {
      cleanHtml: '',
      extractionMethod: 'fallback',
      wordCount: 0,
      success: false,
    };
  }

  // Step 1: Clean HTML first
  let cleanedHtml = cleanHtml(html);

  // Step 2: Apply domain-specific removal if provided
  if (removeSelectors && removeSelectors.length > 0) {
    cleanedHtml = removeElements(cleanedHtml, removeSelectors);
  }

  // Step 3: Try domain-specific selectors first
  if (domainSelectors && domainSelectors.length > 0) {
    const extracted = extractBySelectors(cleanedHtml, domainSelectors);
    if (extracted) {
      const wordCount = countWords(extracted);
      if (wordCount >= READABILITY_MIN_WORDS) {
        return {
          cleanHtml: extracted,
          extractionMethod: 'cms_pattern',
          wordCount,
          success: true,
        };
      }
    }
  }

  // Step 4: Try Readability
  try {
    const readabilityResult = extractWithReadability(cleanedHtml, url);
    if (readabilityResult && readabilityResult.wordCount >= READABILITY_MIN_WORDS) {
      return readabilityResult;
    }
  } catch (error) {
    console.warn('Readability extraction failed:', (error as Error).message);
  }

  // Step 5: Try semantic HTML tags
  const semanticResult = extractBySemantic(cleanedHtml);
  if (semanticResult && semanticResult.wordCount >= READABILITY_MIN_WORDS) {
    return semanticResult;
  }

  // Step 6: Try known CMS selectors
  const cmsResult = extractByCmsPatterns(cleanedHtml);
  if (cmsResult && cmsResult.wordCount >= READABILITY_MIN_WORDS) {
    return cmsResult;
  }

  // Step 7: Fallback - return cleaned body
  return {
    cleanHtml: cleanedHtml,
    extractionMethod: 'fallback',
    wordCount: countWords(cleanedHtml),
    success: true,
  };
}

/**
 * Extract content using Mozilla Readability
 */
function extractWithReadability(html: string, url: string): ExtractionResult | null {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.content) {
      return {
        cleanHtml: article.content,
        extractionMethod: 'readability',
        wordCount: countWords(article.content),
        success: true,
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract content using semantic HTML tags
 */
function extractBySemantic(html: string): ExtractionResult | null {
  const semanticSelectors = [
    'article',
    'main',
    '[role="main"]',
    '[itemprop="articleBody"]',
  ];

  const extracted = extractBySelectors(html, semanticSelectors);
  if (extracted) {
    return {
      cleanHtml: extracted,
      extractionMethod: 'semantic',
      wordCount: countWords(extracted),
      success: true,
    };
  }

  return null;
}

/**
 * Extract content using known CMS patterns
 */
function extractByCmsPatterns(html: string): ExtractionResult | null {
  const extracted = extractBySelectors(html, CMS_CONTENT_SELECTORS);
  if (extracted) {
    return {
      cleanHtml: extracted,
      extractionMethod: 'cms_pattern',
      wordCount: countWords(extracted),
      success: true,
    };
  }

  return null;
}

/**
 * Count words in HTML (strips tags)
 */
export function countWords(html: string): number {
  if (!html) return 0;

  try {
    const dom = new JSDOM(html);
    const text = dom.window.document.body.textContent || '';
    const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
    return words.length;
  } catch (error) {
    // Fallback: simple regex
    const text = html.replace(/<[^>]*>/g, ' ');
    const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
    return words.length;
  }
}

/**
 * Calculate junk score (0-1, lower is better)
 * Based on link density and other signals
 */
export function calculateJunkScore(html: string): number {
  if (!html) return 1.0;

  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const totalText = (document.body.textContent || '').length;
    if (totalText === 0) return 1.0;

    const links = document.querySelectorAll('a');
    const linkText = Array.from(links)
      .map((a) => a.textContent || '')
      .join('').length;

    const linkDensity = linkText / totalText;

    // More signals could be added here
    return Math.min(linkDensity, 1.0);
  } catch (error) {
    return 0.5; // Default moderate score
  }
}
