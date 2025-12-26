/**
 * Navigation Structure Extractor
 *
 * Extracts primary nav, footer, utility links, and breadcrumbs from raw HTML.
 * Uses multi-strategy approach similar to contentExtractor.ts
 */

import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import type {
  NavStructure,
  NavItem,
  BreadcrumbItem,
  ContentLink,
  LinkSourceType,
  StructuralStats
} from '../types/navigation.types';
import { normalizeUrl } from '../core/urlNormalizer';
import { detectStructuralElements, getStructuralTypeAtPosition } from './structuralDetector';

// ============================================
// CONFIGURATION
// ============================================

/**
 * Selectors for finding primary navigation
 * Priority order - first match wins
 */
const PRIMARY_NAV_SELECTORS = [
  // ID-based selectors (high priority - most specific)
  '#p-nav ul#nav',
  '#p-nav > ul',
  '#nav',
  '#main-nav ul',
  'ul#nav',

  // WordPress/Theme-specific
  'nav#primary-navigation ul',
  'nav.main-navigation ul',
  '#main-menu > ul',
  '#main-menu ul.menu',
  '#p-nav ul.menu',

  // Semantic HTML
  'header nav > ul',
  'header nav ul',
  'nav[role="navigation"] > ul',
  'nav[role="navigation"] ul',
  '[role="navigation"] ul.menu',

  // Common patterns
  'ul#nav.menu',
  'ul.nav-menu',
  'ul.main-menu',
  '.navbar ul.navbar-nav',

  // Elementor
  '.elementor-nav-menu',
  '[data-elementor-type="header"] nav ul',

  // Generic fallback
  'header ul.menu',
  '#header ul.menu',
];

/**
 * Selectors for footer navigation
 */
const FOOTER_NAV_SELECTORS = [
  // Semantic footer
  'footer nav ul',
  'footer ul.menu',
  'footer ul',

  // ID-based footer
  '#footer nav ul',
  '#footer ul.menu',
  '#footer ul',
  '#site-footer ul',
  '#footer-menu ul',

  // Class-based footer
  '.footer nav ul',
  '.footer ul.menu',
  '.footer-nav ul',
  '.site-footer ul',

  // Elementor
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
  '.social-icons',
  '.header-icons',
];

/**
 * Selectors for language switcher
 */
const LANGUAGE_SWITCHER_SELECTORS = [
  '#lang-option',
  '.lang-switcher',
  '.wpml-ls',
  '.wpml-ls-legacy-dropdown',
  '.polylang-switcher',
  '.language-switcher',
  '.qtranxs-lang-menu',
  '[class*="lang-"]',
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
  '.breadcrumb-trail',
];

/**
 * Patterns that indicate utility links (not primary nav)
 */
const UTILITY_LINK_PROTOCOLS = ['tel:', 'mailto:', 'sms:', 'whatsapp:'];

const SOCIAL_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'linkedin.com',
  'tiktok.com',
  'pinterest.com',
  'maps.google.com',
  'goo.gl/maps',
  'yelp.com',
];

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Extract navigation structure from HTML
 *
 * @param html - Raw HTML string
 * @param pageUrl - Page URL for resolving relative links
 * @returns NavStructure with all navigation elements
 */
export function extractNavStructure(html: string, pageUrl: string): NavStructure {
  const startTime = Date.now();

  if (!html) {
    return createEmptyNavStructure(startTime);
  }

  const $ = cheerio.load(html);
  let baseUrl: string;

  try {
    baseUrl = new URL(pageUrl).origin;
  } catch {
    baseUrl = pageUrl;
  }

  // Extract each type of navigation
  const primaryNav = extractPrimaryNav($, baseUrl);
  const footerNav = extractFooterNav($, baseUrl);
  const utilityHeader = extractUtilityLinks($, baseUrl);
  const languageSwitcher = extractLanguageSwitcher($, baseUrl);
  const breadcrumb = extractBreadcrumb($);

  // Detect structural elements for content link classification
  const structuralDetection = detectStructuralElements(html);

  // Extract content links with structural context
  const contentLinks = extractContentLinks($, html, baseUrl, structuralDetection);

  const extractionTime = Date.now() - startTime;

  return {
    primary_nav: primaryNav.items,
    footer_nav: footerNav.items,
    utility_header: utilityHeader.items,
    language_switcher: languageSwitcher.items,
    breadcrumb,
    content_links: contentLinks,
    structural_stats: structuralDetection.stats,
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

/**
 * Create empty nav structure (for pages without HTML)
 */
function createEmptyNavStructure(startTime: number): NavStructure {
  return {
    primary_nav: [],
    footer_nav: [],
    utility_header: [],
    language_switcher: [],
    breadcrumb: [],
    content_links: [],
    structural_stats: {
      faq_modules: 0,
      toc_sections: 0,
      breadcrumbs: 0,
      template_ctas: 0,
      accordions: 0,
      testimonials: 0,
      author_bios: 0,
      related_posts: 0,
    },
    extraction_meta: {
      clusters_found: 0,
      primary_nav_selector: null,
      footer_nav_selector: null,
      has_mega_menu: false,
      extraction_time_ms: Date.now() - startTime,
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
    const $container = $(selector).first() as cheerio.Cheerio<cheerio.Element>;
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

  // Fallback: Try to find any substantial menu
  const $anyMenu = $('ul.menu, nav ul').first() as cheerio.Cheerio<cheerio.Element>;
  if ($anyMenu.length > 0) {
    const items = extractMenuItems($, $anyMenu, baseUrl);
    const cleanItems = items.filter(item => !item.is_external && !isUtilityLink(item.url));
    if (cleanItems.length >= 3) {
      return { items: cleanItems, selector: 'ul.menu (fallback)' };
    }
  }

  return { items: [], selector: null };
}

/**
 * Extract footer navigation
 */
function extractFooterNav($: cheerio.CheerioAPI, baseUrl: string): ExtractedCluster {
  for (const selector of FOOTER_NAV_SELECTORS) {
    const $container = $(selector).first() as cheerio.Cheerio<cheerio.Element>;
    if ($container.length === 0) continue;

    const items = extractMenuItems($, $container, baseUrl);

    // Footer nav should have at least 2 links
    if (items.length >= 2) {
      return { items, selector };
    }
  }

  // Fallback: Look for links inside footer element (semantic or id/class based)
  const footerFallbacks = ['footer', '#footer', '.footer', '#site-footer', '.site-footer'];
  for (const footerSel of footerFallbacks) {
    const $footer = $(footerSel).first();
    if ($footer.length === 0) continue;

    const items: NavItem[] = [];

    $footer.find('a[href]').each((index, el) => {
      const $link = $(el);
      const href = $link.attr('href') || '';
      const label = $link.text().trim();

      if (href && label && !isUtilityLink(href)) {
        const url = normalizeUrlSafe(href, baseUrl);
        // Avoid duplicates
        if (!items.some(item => item.url === url)) {
          items.push({
            url,
            label,
            depth: 0,
            order: items.length,
            is_external: isExternalLink(href, baseUrl),
            link_type: 'text',
          });
        }
      }
    });

    if (items.length >= 2) {
      return { items: items.slice(0, 20), selector: `${footerSel} (fallback)` }; // Limit to 20
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

    $container.find('a[href]').each((_, el) => {
      const $link = $(el);
      const href = $link.attr('href') || '';
      const label = $link.text().trim() || $link.find('img').attr('alt') || '';

      if (href && (isUtilityLink(href) || isExternalLink(href, baseUrl))) {
        // Avoid duplicates
        if (!allItems.some(item => item.url === href)) {
          allItems.push({
            url: href,
            label: label || '[icon]',
            depth: 0,
            order: allItems.length,
            is_external: isExternalLink(href, baseUrl),
            link_type: $link.find('img, svg, i, .fa, .fas, .fab').length > 0 ? 'icon' : 'text',
          });
          usedSelector = usedSelector || selector;
        }
      }
    });
  }

  // Also scan header for tel/mailto links
  $('header a[href^="tel:"], header a[href^="mailto:"]').each((_, el) => {
    const $link = $(el);
    const href = $link.attr('href') || '';
    const label = $link.text().trim() || href.replace(/^(tel:|mailto:)/, '');

    if (!allItems.some(item => item.url === href)) {
      allItems.push({
        url: href,
        label,
        depth: 0,
        order: allItems.length,
        is_external: false,
        link_type: 'text',
      });
    }
  });

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

      // Extract from class (e.g., "lang-en", "lang-es")
      if (!label) {
        const classes = $link.attr('class') || '';
        const langMatch = classes.match(/lang[_-]([a-z]{2})/i);
        if (langMatch) {
          label = langMatch[1].toUpperCase();
        }
      }

      if (href && label && label.length <= 10) { // Language codes are short
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

    // Strategy 1: Look for links and spans
    $container.find('a, span').each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();

      // Skip separators and empty items
      if (!text || /^[>\/»›\|]+$/.test(text) || text.length > 100) {
        return;
      }

      // Skip if parent is already processed (nested spans)
      if ($el.parent().is('a') || $el.parent().is('span')) {
        const parentText = $el.parent().text().trim();
        if (parentText === text) return;
      }

      const href = $el.is('a') ? $el.attr('href') : undefined;

      // Avoid duplicates
      if (!items.some(item => item.label === text)) {
        items.push({
          label: text,
          url: href || undefined,
        });
      }
    });

    // Valid breadcrumb has at least 2 items
    if (items.length >= 2) {
      return items;
    }

    // Strategy 2: Just get text content and split
    const fullText = $container.text();
    const parts = fullText.split(/[>\/»›\|]/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return parts.map(label => ({ label }));
    }
  }

  return [];
}

/**
 * Extract menu items from a container, preserving hierarchy
 */
function extractMenuItems(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<cheerio.Element>,
  baseUrl: string
): NavItem[] {
  const items: NavItem[] = [];

  // Process top-level menu items
  const $topLevelItems = $container.find('> li');

  // If no direct children, try without >
  const $menuItems = $topLevelItems.length > 0 ? $topLevelItems : $container.find('li');

  $menuItems.each((index, li) => {
    const $li = $(li);

    // Skip if this is a submenu item (has parent li)
    if ($topLevelItems.length > 0 && $li.parent().closest('li').length > 0) {
      return;
    }

    const $link = $li.find('> a, > span > a').first();

    if ($link.length === 0) return;

    const href = $link.attr('href') || '';
    const label = $link.clone().children().remove().end().text().trim() ||
                  $link.text().trim();

    if (!label) return;

    // Check if this has a submenu (important for parent items with href="#")
    const $submenu = $li.find('> ul.sub-menu, > ul.dropdown-menu, > .sub-menu, > ul');
    const hasSubmenu = $submenu.length > 0;

    // Skip pure anchors and javascript ONLY if no submenu (parent items use href="#")
    if (!hasSubmenu && (!href || href === '#' || href.startsWith('javascript:'))) return;

    // Add top-level item (use # for parent items without real href)
    items.push({
      url: href && href !== '#' ? normalizeUrlSafe(href, baseUrl) : '#',
      label,
      depth: 0,
      order: items.length,
      is_external: isExternalLink(href, baseUrl),
      link_type: $link.find('img').length > 0 ? 'image' : 'text',
    });

    // Process submenu items
    if (hasSubmenu) {
      extractSubmenuItems($, $submenu.first(), baseUrl, items, [label], 1);
    }
  });

  return items;
}

/**
 * Recursively extract submenu items
 */
function extractSubmenuItems(
  $: cheerio.CheerioAPI,
  $submenu: cheerio.Cheerio<cheerio.Element>,
  baseUrl: string,
  items: NavItem[],
  parentLabels: string[],
  depth: number
): void {
  if (depth > 3) return; // Max depth limit

  $submenu.find('> li').each((index, li) => {
    const $li = $(li);
    const $link = $li.find('> a').first();

    if ($link.length === 0) return;

    const href = $link.attr('href') || '';
    const label = $link.clone().children().remove().end().text().trim() ||
                  $link.text().trim();

    if (!href || !label) return;
    if (href === '#' || href.startsWith('javascript:')) return;

    items.push({
      url: normalizeUrlSafe(href, baseUrl),
      label,
      depth,
      order: index,
      parent_labels: [...parentLabels],
      is_external: isExternalLink(href, baseUrl),
      link_type: $link.find('img').length > 0 ? 'image' : 'text',
    });

    // Recurse for deeper submenus
    const $deeperSubmenu = $li.find('> ul.sub-menu, > ul.dropdown-menu, > ul');
    if ($deeperSubmenu.length > 0) {
      extractSubmenuItems($, $deeperSubmenu.first(), baseUrl, items, [...parentLabels, label], depth + 1);
    }
  });
}

// ============================================
// CONTENT LINK EXTRACTION
// ============================================

/**
 * Selectors for main content area
 */
const MAIN_CONTENT_SELECTORS = [
  'main',
  '#main-content',
  '#content',
  '.content',
  'article',
  '.entry-content',
  '.post-content',
  '.page-content',
  '[role="main"]',
];

/**
 * Selectors to exclude from content links (nav, footer, etc.)
 */
const CONTENT_EXCLUDE_SELECTORS = [
  'header',
  'nav',
  'footer',
  '.navigation',
  '.nav-menu',
  '.menu',
  '.sidebar',
  '.widget',
  '#header',
  '#footer',
  '#sidebar',
];

/**
 * Extract content links from main body with structural context
 */
function extractContentLinks(
  $: cheerio.CheerioAPI,
  html: string,
  baseUrl: string,
  structuralDetection: { elements: any[]; stats: any }
): ContentLink[] {
  const contentLinks: ContentLink[] = [];
  const seenUrls = new Set<string>();

  // Find main content area
  let $mainContent: cheerio.Cheerio<cheerio.Element> | null = null;
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const $el = $(selector).first();
    if ($el.length > 0) {
      $mainContent = $el as cheerio.Cheerio<cheerio.Element>;
      break;
    }
  }

  // Fallback to body
  if (!$mainContent) {
    $mainContent = $('body') as cheerio.Cheerio<cheerio.Element>;
  }

  // Get all links in main content
  const $links = $mainContent.find('a[href]');
  const totalLinks = $links.length;

  // Track nearest heading for each link
  let currentHeading: string | null = null;

  // Process links in document order
  $links.each((index, el) => {
    const $link = $(el);
    const href = $link.attr('href') || '';

    // Skip empty, anchor-only, and javascript links
    if (!href || href === '#' || href.startsWith('javascript:')) {
      return;
    }

    // Skip if in excluded area
    if ($link.closest(CONTENT_EXCLUDE_SELECTORS.join(',')).length > 0) {
      return;
    }

    // Get label
    const label = $link.text().trim() || $link.find('img').attr('alt') || '';
    if (!label) return;

    // Normalize URL
    const url = normalizeUrlSafe(href, baseUrl);

    // Skip if already seen
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

    // Find position in HTML for structural context
    const linkHtml = $.html($link);
    const linkPosition = html.indexOf(linkHtml);

    // Determine source type from structural context
    let sourceType: LinkSourceType = 'contextual_body';

    if (linkPosition !== -1) {
      const structuralElement = getStructuralTypeAtPosition(linkPosition, structuralDetection.elements);
      if (structuralElement) {
        sourceType = mapStructuralType(structuralElement.type);
      }
    }

    // Check for TOC (anchor links)
    if (href.startsWith('#') || (href.includes('#') && href.startsWith(baseUrl))) {
      sourceType = 'toc_or_jump';
    }

    // Find nearest heading by looking at previous siblings/ancestors
    const $heading = $link.prevAll('h1, h2, h3, h4, h5, h6').first();
    if ($heading.length > 0) {
      currentHeading = $heading.text().trim();
    } else {
      // Check parent's previous siblings
      const $parentHeading = $link.parent().prevAll('h1, h2, h3, h4, h5, h6').first();
      if ($parentHeading.length > 0) {
        currentHeading = $parentHeading.text().trim();
      }
    }

    // Calculate body position percentage
    const bodyPositionPct = Math.round((index / Math.max(totalLinks, 1)) * 100);

    contentLinks.push({
      url,
      label,
      source_type: sourceType,
      nearest_heading: currentHeading || undefined,
      body_position_pct: bodyPositionPct,
      is_external: isExternalLink(href, baseUrl),
    });
  });

  return contentLinks;
}

/**
 * Map structural element type to link source type
 */
function mapStructuralType(type: string): LinkSourceType {
  const mapping: Record<string, LinkSourceType> = {
    faq_module: 'faq_module',
    toc_or_jump: 'toc_or_jump',
    breadcrumb: 'breadcrumb',
    template_cta: 'template_cta',
    accordion: 'faq_module',       // Accordions often contain FAQ-like content
    testimonial: 'testimonial',
    author_bio: 'author_bio',
    related_posts: 'related_posts',
  };

  return mapping[type] || 'contextual_body';
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
  for (const protocol of UTILITY_LINK_PROTOCOLS) {
    if (lowerUrl.startsWith(protocol)) return true;
  }

  // Check social domains
  for (const domain of SOCIAL_DOMAINS) {
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

  // Protocol-based links are not external (tel:, mailto:)
  if (url.startsWith('tel:') || url.startsWith('mailto:')) {
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
    // Handle protocol links
    if (url.startsWith('tel:') || url.startsWith('mailto:')) {
      return url;
    }

    if (url.startsWith('http')) {
      return normalizeUrl(url);
    }

    // Make relative URL absolute
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
