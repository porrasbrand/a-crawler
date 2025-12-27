/**
 * Metadata extraction from HTML
 * Extracts title, H1, meta description, and other metadata
 */

import { JSDOM } from 'jsdom';

/**
 * Page metadata
 */
export interface PageMetadata {
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  ogImage: string | null;
  language: string | null;
}

/**
 * Extract all metadata from HTML
 *
 * @param html - Raw HTML string
 * @param url - Page URL (for resolving relative URLs)
 * @returns Page metadata
 */
export function extractMetadata(html: string, url?: string): PageMetadata {
  if (!html) {
    return {
      title: null,
      h1: null,
      metaDescription: null,
      canonicalUrl: null,
      ogImage: null,
      language: null,
    };
  }

  try {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    return {
      title: extractTitle(document),
      h1: extractH1(document),
      metaDescription: extractMetaDescription(document),
      canonicalUrl: extractCanonical(document, url),
      ogImage: extractOgImage(document, url),
      language: extractLanguage(document),
    };
  } catch (error) {
    console.error('Metadata extraction failed:', (error as Error).message);
    return {
      title: null,
      h1: null,
      metaDescription: null,
      canonicalUrl: null,
      ogImage: null,
      language: null,
    };
  }
}

/**
 * Extract page title
 * Priority: <title>, og:title, h1
 */
function extractTitle(document: Document): string | null {
  // Try <title> tag
  const titleElement = document.querySelector('title');
  if (titleElement && titleElement.textContent) {
    return titleElement.textContent.trim();
  }

  // Try og:title
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    const content = ogTitle.getAttribute('content');
    if (content) return content.trim();
  }

  // Fallback to first H1
  const h1 = document.querySelector('h1');
  if (h1 && h1.textContent) {
    return h1.textContent.trim();
  }

  return null;
}

/**
 * Extract first H1 heading
 * Truncates to 500 characters to match database schema
 */
function extractH1(document: Document): string | null {
  const h1 = document.querySelector('h1');
  if (h1 && h1.textContent) {
    const text = h1.textContent.trim();
    // Truncate to 500 chars to match VARCHAR(500) limit
    return text.length > 500 ? text.substring(0, 500) : text;
  }
  return null;
}

/**
 * Extract meta description
 * Priority: meta description, og:description
 */
function extractMetaDescription(document: Document): string | null {
  // Try standard meta description
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    const content = metaDesc.getAttribute('content');
    if (content) return content.trim();
  }

  // Try og:description
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) {
    const content = ogDesc.getAttribute('content');
    if (content) return content.trim();
  }

  return null;
}

/**
 * Extract canonical URL
 */
function extractCanonical(document: Document, baseUrl?: string): string | null {
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    const href = canonical.getAttribute('href');
    if (href) {
      // Make absolute if relative
      if (baseUrl) {
        try {
          return new URL(href, baseUrl).toString();
        } catch {
          return href;
        }
      }
      return href;
    }
  }

  return null;
}

/**
 * Extract Open Graph image
 */
function extractOgImage(document: Document, baseUrl?: string): string | null {
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) {
    const content = ogImage.getAttribute('content');
    if (content) {
      // Make absolute if relative
      if (baseUrl) {
        try {
          return new URL(content, baseUrl).toString();
        } catch {
          return content;
        }
      }
      return content;
    }
  }

  return null;
}

/**
 * Extract language
 */
function extractLanguage(document: Document): string | null {
  // Try <html lang="...">
  const htmlLang = document.documentElement.getAttribute('lang');
  if (htmlLang) return htmlLang.trim();

  // Try meta content-language
  const metaLang = document.querySelector('meta[http-equiv="content-language"]');
  if (metaLang) {
    const content = metaLang.getAttribute('content');
    if (content) return content.trim();
  }

  return null;
}

/**
 * Check if page has multiple H1s (SEO issue)
 */
export function hasMultipleH1s(html: string): boolean {
  try {
    const dom = new JSDOM(html);
    const h1s = dom.window.document.querySelectorAll('h1');
    return h1s.length > 1;
  } catch {
    return false;
  }
}

/**
 * Extract all headings with hierarchy
 */
export function extractHeadingStructure(html: string): Array<{ level: number; text: string }> {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const headings: Array<{ level: number; text: string }> = [];

    for (let level = 1; level <= 6; level++) {
      const elements = document.querySelectorAll(`h${level}`);
      elements.forEach((el) => {
        const text = el.textContent?.trim();
        if (text) {
          headings.push({ level, text });
        }
      });
    }

    return headings;
  } catch {
    return [];
  }
}
