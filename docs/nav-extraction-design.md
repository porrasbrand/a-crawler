# a-crawler Navigation Extraction Design

**Version:** 1.0
**Date:** 2025-12-19
**Status:** Design

---

## 1. Overview

### Goal
Extract navigation structure (primary nav, footer, utility links, breadcrumbs) from each page during crawl, storing it as structured JSON alongside the existing markdown/html_content.

### Why a-crawler (Not seo-processor-worker)
- **Single point of HTML parsing** - Parse once at crawl time, not twice
- **Data freshness** - Original DOM, no escaped characters
- **Follows existing patterns** - Same as markdown, clean_html extraction
- **Separation of concerns** - Crawler extracts, processor analyzes

---

## 2. Architecture

### Current Flow
```
HTML → extractContent() → clean_html, markdown
     → extractMetadata() → title, h1, meta_description
```

### New Flow
```
HTML → extractContent() → clean_html, markdown
     → extractMetadata() → title, h1, meta_description
     → extractNavStructure() → nav_structure (NEW)
```

### Integration Point

In `src/core/crawler.ts`, after line 133 (content extraction):

```typescript
// Existing
const extraction = extractContent(htmlContent, finalUrl, ...);
const markdown = htmlToMarkdown(extraction.cleanHtml, ...);

// NEW - Extract navigation structure
const navStructure = extractNavStructure(htmlContent, finalUrl);
```

---

## 3. Data Model

### 3.1 TypeScript Interfaces

**File:** `src/types/navigation.types.ts` (NEW)

```typescript
/**
 * A single navigation link item
 */
export interface NavItem {
  url: string;                    // Normalized URL
  label: string;                  // Anchor text
  depth: number;                  // 0 = top-level, 1 = submenu, 2 = sub-submenu
  order: number;                  // Position among siblings (0-indexed)
  parent_labels?: string[];       // ["Body", "Liposuction"] for nested items
  is_external: boolean;           // External link?
  link_type: 'text' | 'image' | 'icon';  // Type of link
}

/**
 * A detected navigation cluster
 */
export interface NavCluster {
  cluster_type: NavClusterType;
  selector_matched: string;       // Which selector found this cluster
  items: NavItem[];
  fingerprint: string;            // Hash of sorted URLs for deduplication
}

export type NavClusterType =
  | 'primary_nav'       // Main menu
  | 'footer_nav'        // Footer links
  | 'utility_header'    // Tel, email, directions, social
  | 'language_switcher' // EN/ES toggles
  | 'breadcrumb';       // Page breadcrumbs

/**
 * Complete navigation structure for a page
 */
export interface NavStructure {
  primary_nav: NavItem[];
  footer_nav: NavItem[];
  utility_header: NavItem[];
  language_switcher: NavItem[];
  breadcrumb: BreadcrumbItem[];

  // Metadata for debugging/analysis
  extraction_meta: {
    clusters_found: number;
    primary_nav_selector: string | null;
    footer_nav_selector: string | null;
    has_mega_menu: boolean;
    extraction_time_ms: number;
  };
}

/**
 * Breadcrumb item (simpler than NavItem)
 */
export interface BreadcrumbItem {
  label: string;
  url?: string;  // Last item usually has no URL
}
```

### 3.2 Database Schema

**Add to `crawler_pages` table:**

```sql
ALTER TABLE crawler_pages
  ADD COLUMN nav_structure JSON NULL COMMENT 'Extracted navigation structure';
```

**Update `CrawlerPageInsert` type:**

```typescript
export interface CrawlerPageInsert {
  // ... existing fields ...
  nav_structure?: NavStructure;  // NEW
}
```

---

## 4. Extraction Logic

### 4.1 New File: `src/extraction/navExtractor.ts`

```typescript
/**
 * Navigation Structure Extractor
 *
 * Extracts primary nav, footer, utility links, and breadcrumbs from raw HTML.
 * Uses multi-strategy approach similar to contentExtractor.ts
 */

import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import type { NavStructure, NavItem, NavCluster, BreadcrumbItem, NavClusterType } from '../types/navigation.types';
import { normalizeUrl } from '../core/urlNormalizer';

// ============================================
// CONFIGURATION
// ============================================

/**
 * Selectors for finding primary navigation
 * Priority order - first match wins
 */
const PRIMARY_NAV_SELECTORS = [
  // WordPress/Theme-specific (high priority)
  '#main-menu ul.menu',
  '#p-nav ul.menu',
  'nav#primary-navigation',
  'nav.main-navigation',

  // Semantic HTML
  'header nav ul',
  'nav[role="navigation"] ul',
  '[role="navigation"] ul.menu',

  // Common patterns
  'ul#nav',
  'ul.nav-menu',
  'ul.main-menu',
  '.navbar ul.navbar-nav',

  // Elementor
  '.elementor-nav-menu',
  '[data-elementor-type="header"] nav ul',

  // Generic fallback
  'header ul.menu',
];

/**
 * Selectors for footer navigation
 */
const FOOTER_NAV_SELECTORS = [
  'footer nav ul',
  'footer ul.menu',
  '#footer ul.menu',
  '.footer-nav ul',
  '.site-footer ul',
  '[data-elementor-type="footer"] nav ul',
  'footer .widget ul',
];

/**
 * Selectors for utility/header links (contact, social, etc.)
 */
const UTILITY_SELECTORS = [
  '#mobile-icons',
  '.header-contact',
  '.top-bar',
  '.utility-nav',
  '.header-social',
  '#d-social',
  '.contact-icons',
];

/**
 * Selectors for language switcher
 */
const LANGUAGE_SWITCHER_SELECTORS = [
  '#lang-option',
  '.lang-switcher',
  '.wpml-ls',
  '.polylang-switcher',
  '[class*="language"]',
  '.qtranxs-lang-menu',
];

/**
 * Selectors for breadcrumbs
 */
const BREADCRUMB_SELECTORS = [
  '.breadcrumb',
  '.breadcrumbs',
  '[aria-label="breadcrumb"]',
  '.yoast-breadcrumb',
  '.rank-math-breadcrumb',
  '[typeof="BreadcrumbList"]',
  '.woocommerce-breadcrumb',
  '#breadcrumbs',
];

/**
 * Patterns that indicate utility links (not primary nav)
 */
const UTILITY_PATTERNS = {
  protocols: ['tel:', 'mailto:', 'sms:', 'whatsapp:'],
  domains: ['facebook.com', 'instagram.com', 'twitter.com', 'youtube.com', 'linkedin.com', 'tiktok.com', 'maps.google.com', 'goo.gl/maps'],
};

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Extract navigation structure from HTML
 */
export function extractNavStructure(html: string, pageUrl: string): NavStructure {
  const startTime = Date.now();
  const $ = cheerio.load(html);
  const baseUrl = new URL(pageUrl).origin;

  // Extract each type of navigation
  const primaryNav = extractPrimaryNav($, baseUrl);
  const footerNav = extractFooterNav($, baseUrl);
  const utilityHeader = extractUtilityLinks($, baseUrl);
  const languageSwitcher = extractLanguageSwitcher($, baseUrl);
  const breadcrumb = extractBreadcrumb($);

  const extractionTime = Date.now() - startTime;

  return {
    primary_nav: primaryNav.items,
    footer_nav: footerNav.items,
    utility_header: utilityHeader.items,
    language_switcher: languageSwitcher.items,
    breadcrumb,
    extraction_meta: {
      clusters_found: [primaryNav, footerNav, utilityHeader, languageSwitcher]
        .filter(c => c.items.length > 0).length,
      primary_nav_selector: primaryNav.selector,
      footer_nav_selector: footerNav.selector,
      has_mega_menu: primaryNav.items.some(item => item.depth >= 2),
      extraction_time_ms: extractionTime,
    },
  };
}

// ============================================
// EXTRACTION HELPERS
// ============================================

interface ExtractedCluster {
  items: NavItem[];
  selector: string | null;
}

/**
 * Extract primary navigation
 */
function extractPrimaryNav($: cheerio.CheerioAPI, baseUrl: string): ExtractedCluster {
  for (const selector of PRIMARY_NAV_SELECTORS) {
    const $container = $(selector).first();
    if ($container.length === 0) continue;

    const items = extractMenuItems($, $container, baseUrl);

    // Must have at least 3 internal links to be primary nav
    const internalLinks = items.filter(item => !item.is_external);
    if (internalLinks.length >= 3) {
      // Filter out utility-like links
      const cleanItems = items.filter(item => !isUtilityLink(item.url));
      if (cleanItems.length >= 3) {
        return { items: cleanItems, selector };
      }
    }
  }

  return { items: [], selector: null };
}

/**
 * Extract footer navigation
 */
function extractFooterNav($: cheerio.CheerioAPI, baseUrl: string): ExtractedCluster {
  for (const selector of FOOTER_NAV_SELECTORS) {
    const $container = $(selector).first();
    if ($container.length === 0) continue;

    const items = extractMenuItems($, $container, baseUrl);

    // Footer nav should have at least 2 links
    if (items.length >= 2) {
      return { items, selector };
    }
  }

  return { items: [], selector: null };
}

/**
 * Extract utility links (contact, social, etc.)
 */
function extractUtilityLinks($: cheerio.CheerioAPI, baseUrl: string): ExtractedCluster {
  const allItems: NavItem[] = [];
  let usedSelector: string | null = null;

  for (const selector of UTILITY_SELECTORS) {
    const $container = $(selector);
    if ($container.length === 0) continue;

    $container.find('a[href]').each((index, el) => {
      const $link = $(el);
      const href = $link.attr('href') || '';
      const label = $link.text().trim() || $link.find('img').attr('alt') || '';

      if (href && (isUtilityLink(href) || isExternalLink(href, baseUrl))) {
        allItems.push({
          url: href,
          label: label || '[icon]',
          depth: 0,
          order: allItems.length,
          is_external: isExternalLink(href, baseUrl),
          link_type: $link.find('img, svg, i').length > 0 ? 'icon' : 'text',
        });
        usedSelector = usedSelector || selector;
      }
    });
  }

  return { items: allItems, selector: usedSelector };
}

/**
 * Extract language switcher links
 */
function extractLanguageSwitcher($: cheerio.CheerioAPI, baseUrl: string): ExtractedCluster {
  for (const selector of LANGUAGE_SWITCHER_SELECTORS) {
    const $container = $(selector);
    if ($container.length === 0) continue;

    const items: NavItem[] = [];

    $container.find('a[href]').each((index, el) => {
      const $link = $(el);
      const href = $link.attr('href') || '';
      let label = $link.text().trim();

      // Common language indicators
      const hreflang = $link.attr('hreflang') || '';
      if (!label && hreflang) {
        label = hreflang.toUpperCase();
      }

      if (href && label) {
        items.push({
          url: normalizeUrlSafe(href, baseUrl),
          label,
          depth: 0,
          order: index,
          is_external: false,
          link_type: 'text',
        });
      }
    });

    // Language switcher typically has 2-5 links
    if (items.length >= 2 && items.length <= 10) {
      return { items, selector };
    }
  }

  return { items: [], selector: null };
}

/**
 * Extract breadcrumb trail
 */
function extractBreadcrumb($: cheerio.CheerioAPI): BreadcrumbItem[] {
  for (const selector of BREADCRUMB_SELECTORS) {
    const $container = $(selector).first();
    if ($container.length === 0) continue;

    const items: BreadcrumbItem[] = [];

    // Get all links and text nodes
    $container.find('a, span').each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();

      // Skip separators
      if (!text || text === '>' || text === '/' || text === '»' || text === '›') {
        return;
      }

      const href = $el.attr('href');
      items.push({
        label: text,
        url: href || undefined,
      });
    });

    // Valid breadcrumb has at least 2 items
    if (items.length >= 2) {
      return items;
    }
  }

  return [];
}

/**
 * Extract menu items from a container, preserving hierarchy
 */
function extractMenuItems(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<any>,
  baseUrl: string
): NavItem[] {
  const items: NavItem[] = [];

  // Process top-level menu items
  $container.find('> li').each((index, li) => {
    const $li = $(li);
    const $link = $li.find('> a').first();

    if ($link.length === 0) return;

    const href = $link.attr('href') || '';
    const label = $link.text().trim();

    if (!href || !label) return;

    // Add top-level item
    items.push({
      url: normalizeUrlSafe(href, baseUrl),
      label,
      depth: 0,
      order: index,
      is_external: isExternalLink(href, baseUrl),
      link_type: $link.find('img').length > 0 ? 'image' : 'text',
    });

    // Process submenu items
    const $submenu = $li.find('> ul.sub-menu, > ul.dropdown-menu, > .sub-menu');
    if ($submenu.length > 0) {
      extractSubmenuItems($, $submenu, baseUrl, items, [label], 1);
    }
  });

  return items;
}

/**
 * Recursively extract submenu items
 */
function extractSubmenuItems(
  $: cheerio.CheerioAPI,
  $submenu: cheerio.Cheerio<any>,
  baseUrl: string,
  items: NavItem[],
  parentLabels: string[],
  depth: number
): void {
  $submenu.find('> li').each((index, li) => {
    const $li = $(li);
    const $link = $li.find('> a').first();

    if ($link.length === 0) return;

    const href = $link.attr('href') || '';
    const label = $link.text().trim();

    if (!href || !label) return;

    items.push({
      url: normalizeUrlSafe(href, baseUrl),
      label,
      depth,
      order: index,
      parent_labels: [...parentLabels],
      is_external: isExternalLink(href, baseUrl),
      link_type: $link.find('img').length > 0 ? 'image' : 'text',
    });

    // Recurse for deeper submenus (max depth 3)
    if (depth < 3) {
      const $deeperSubmenu = $li.find('> ul.sub-menu, > ul.dropdown-menu');
      if ($deeperSubmenu.length > 0) {
        extractSubmenuItems($, $deeperSubmenu, baseUrl, items, [...parentLabels, label], depth + 1);
      }
    }
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Check if URL is a utility link (tel, mailto, social, etc.)
 */
function isUtilityLink(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // Check protocols
  for (const protocol of UTILITY_PATTERNS.protocols) {
    if (lowerUrl.startsWith(protocol)) return true;
  }

  // Check domains
  for (const domain of UTILITY_PATTERNS.domains) {
    if (lowerUrl.includes(domain)) return true;
  }

  return false;
}

/**
 * Check if URL is external
 */
function isExternalLink(url: string, baseUrl: string): boolean {
  if (!url || url.startsWith('#') || url.startsWith('javascript:')) {
    return false;
  }

  try {
    const linkUrl = new URL(url, baseUrl);
    const base = new URL(baseUrl);
    return linkUrl.hostname !== base.hostname;
  } catch {
    return false;
  }
}

/**
 * Safely normalize URL
 */
function normalizeUrlSafe(url: string, baseUrl: string): string {
  try {
    if (url.startsWith('http')) {
      return normalizeUrl(url);
    }
    const absolute = new URL(url, baseUrl).href;
    return normalizeUrl(absolute);
  } catch {
    return url;
  }
}

/**
 * Generate fingerprint for a nav cluster (for deduplication)
 */
export function generateNavFingerprint(items: NavItem[]): string {
  const urls = items
    .filter(item => !item.is_external)
    .map(item => item.url)
    .sort();

  const hash = createHash('md5')
    .update(urls.join('|'))
    .digest('hex')
    .substring(0, 16);

  return hash;
}
```

---

## 5. Integration with Crawler

### 5.1 Update `crawler.ts`

```typescript
// Add import
import { extractNavStructure } from '../extraction/navExtractor';

// In requestHandler, after line 133:
// Calculate junk score
const junkScore = calculateJunkScore(extraction.cleanHtml || htmlContent);

// NEW: Extract navigation structure
const navStructure = extractNavStructure(htmlContent, finalUrl);

logger.debug(
  {
    url: finalUrl,
    primaryNavItems: navStructure.primary_nav.length,
    footerNavItems: navStructure.footer_nav.length,
    hasBreadcrumb: navStructure.breadcrumb.length > 0,
  },
  'Navigation extracted'
);

// Store page data - add nav_structure
const pageData: CrawlerPageInsert = {
  // ... existing fields ...
  nav_structure: navStructure,  // NEW
};
```

### 5.2 Update `CrawlerPageInsert`

```typescript
// In src/types/database.types.ts

import type { NavStructure } from './navigation.types';

export interface CrawlerPageInsert {
  // ... existing fields ...
  nav_structure?: NavStructure;  // NEW
}
```

### 5.3 Update Database Query

```typescript
// In src/db/queries.ts - upsertPage function

// Add nav_structure to INSERT columns
const columns = [
  // ... existing columns ...
  'nav_structure',
];

// Add to VALUES
const values = [
  // ... existing values ...
  pageData.nav_structure ? JSON.stringify(pageData.nav_structure) : null,
];
```

---

## 6. Backfill Strategy

For existing crawls (like 1005), add a backfill script:

**File:** `src/scripts/backfillNavStructure.ts`

```typescript
#!/usr/bin/env node

/**
 * Backfill nav_structure for existing pages
 * Uses stored html_content to extract navigation
 */

import { pool } from '../db/connection';
import { extractNavStructure } from '../extraction/navExtractor';

async function backfill(runId?: string) {
  console.log('Starting nav_structure backfill...');

  // Get pages with HTML but no nav_structure
  const query = runId
    ? `SELECT id, final_url, html_content FROM crawler_pages
       WHERE run_id = ? AND html_content IS NOT NULL AND nav_structure IS NULL`
    : `SELECT id, final_url, html_content FROM crawler_pages
       WHERE html_content IS NOT NULL AND nav_structure IS NULL`;

  const [rows] = await pool.query(query, runId ? [runId] : []);
  const pages = rows as any[];

  console.log(`Found ${pages.length} pages to process`);

  let processed = 0;
  let errors = 0;

  for (const page of pages) {
    try {
      // Unescape stored HTML
      const html = page.html_content.replace(/\\n/g, '\n');

      // Extract nav structure
      const navStructure = extractNavStructure(html, page.final_url);

      // Update page
      await pool.query(
        'UPDATE crawler_pages SET nav_structure = ? WHERE id = ?',
        [JSON.stringify(navStructure), page.id]
      );

      processed++;

      if (processed % 100 === 0) {
        console.log(`Processed ${processed}/${pages.length} pages`);
      }
    } catch (error) {
      console.error(`Error processing page ${page.id}:`, error);
      errors++;
    }
  }

  console.log(`\nBackfill complete: ${processed} processed, ${errors} errors`);
}

// Run
const runId = process.argv[2];
backfill(runId).catch(console.error);
```

---

## 7. What seo-processor-worker Does With This Data

seo-processor-worker no longer parses HTML. Instead:

```typescript
// Phase 6: Navigation Analysis (simplified)

async function analyzeNavigation(crawlId: number, language: string) {
  // 1. Get all nav_structures for this crawl + language
  const pages = await fetchPages(crawlId, {
    select: ['id', 'url', 'nav_structure', 'language'],
    where: { language }
  });

  // 2. Fingerprint primary nav clusters
  const fingerprints = new Map<string, { count: number; items: NavItem[] }>();

  for (const page of pages) {
    if (!page.nav_structure?.primary_nav?.length) continue;

    const fp = generateNavFingerprint(page.nav_structure.primary_nav);
    const existing = fingerprints.get(fp);

    if (existing) {
      existing.count++;
    } else {
      fingerprints.set(fp, { count: 1, items: page.nav_structure.primary_nav });
    }
  }

  // 3. Find consensus (appears on 60%+ pages)
  const threshold = pages.length * 0.6;
  let primaryNavItems: NavItem[] = [];

  for (const [fp, data] of fingerprints) {
    if (data.count >= threshold) {
      primaryNavItems = data.items;
      break;
    }
  }

  // 4. Mark pages that are in primary nav
  const navUrls = new Set(primaryNavItems.map(item => item.url));

  for (const page of pages) {
    const isInNav = navUrls.has(page.url);
    const navItem = primaryNavItems.find(item => item.url === page.url);

    await updatePage(page.id, {
      is_in_primary_nav: isInNav,
      primary_nav_depth: navItem?.depth ?? null,
      primary_nav_order: navItem?.order ?? null,
      primary_nav_label: navItem?.label ?? null,
    });
  }
}
```

---

## 8. Testing Plan

### Unit Tests

```typescript
// src/extraction/__tests__/navExtractor.test.ts

describe('extractNavStructure', () => {
  it('extracts primary nav from WordPress menu', () => {
    const html = `
      <header>
        <nav id="p-nav">
          <ul id="nav" class="menu">
            <li class="menu-item"><a href="/gallery/">Photos</a></li>
            <li class="menu-item"><a href="/videos/">Videos</a></li>
          </ul>
        </nav>
      </header>
    `;

    const result = extractNavStructure(html, 'https://example.com/');

    expect(result.primary_nav).toHaveLength(2);
    expect(result.primary_nav[0].label).toBe('Photos');
    expect(result.primary_nav[0].url).toBe('https://example.com/gallery/');
  });

  it('extracts submenu items with parent labels', () => {
    const html = `
      <ul class="menu">
        <li><a href="/body/">Body</a>
          <ul class="sub-menu">
            <li><a href="/liposuction/">Liposuction</a></li>
          </ul>
        </li>
      </ul>
    `;

    const result = extractNavStructure(html, 'https://example.com/');

    expect(result.primary_nav).toHaveLength(2);
    expect(result.primary_nav[1].depth).toBe(1);
    expect(result.primary_nav[1].parent_labels).toEqual(['Body']);
  });

  it('filters out utility links from primary nav', () => {
    const html = `
      <ul class="menu">
        <li><a href="tel:555-1234">Call</a></li>
        <li><a href="/contact/">Contact</a></li>
      </ul>
    `;

    const result = extractNavStructure(html, 'https://example.com/');

    expect(result.primary_nav).toHaveLength(1);
    expect(result.primary_nav[0].label).toBe('Contact');
  });
});
```

### Integration Test

```bash
# Run backfill on a few pages
ts-node src/scripts/backfillNavStructure.ts run_infiniskin_001

# Verify results
mysql -e "SELECT id, JSON_LENGTH(nav_structure->'$.primary_nav') as nav_items
          FROM crawler_pages
          WHERE run_id = 'run_infiniskin_001'
          LIMIT 10"
```

---

## 9. Summary

### Files to Create
1. `src/types/navigation.types.ts` - Type definitions
2. `src/extraction/navExtractor.ts` - Extraction logic
3. `src/scripts/backfillNavStructure.ts` - Backfill script

### Files to Modify
1. `src/types/database.types.ts` - Add nav_structure to CrawlerPageInsert
2. `src/core/crawler.ts` - Call extractNavStructure
3. `src/db/queries.ts` - Store nav_structure in upsertPage
4. `src/db/schema.sql` - Add nav_structure column

### Database Migration
```sql
ALTER TABLE crawler_pages
  ADD COLUMN nav_structure JSON NULL;
```

### Estimated Effort
- Type definitions: 30 min
- Extractor implementation: 2 hours
- Crawler integration: 30 min
- Backfill script: 30 min
- Testing: 1 hour
- **Total: ~4-5 hours**
