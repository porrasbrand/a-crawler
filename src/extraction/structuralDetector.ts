/**
 * Structural Element Detector
 *
 * Detects semantic structures in HTML for enhanced markdown generation.
 * Used to classify link sources (FAQ, TOC, CTA, etc.)
 */

import * as cheerio from 'cheerio';
import {
  StructuralElement,
  StructuralDetectionResult,
  FAQMetadata,
  TOCMetadata,
  CTAMetadata,
} from '../types/enhancedMarkdown.types';

/**
 * Selectors for detecting FAQ sections
 */
const FAQ_SELECTORS = [
  // Schema.org FAQPage
  '[itemtype*="FAQPage"]',
  '[typeof="FAQPage"]',
  // Class-based
  '.faq',
  '.faqs',
  '.faq-section',
  '.faq-container',
  '.faq-list',
  '.faq-accordion',
  '#faq',
  '#faqs',
  // Common patterns
  '[class*="faq"]',
  '[id*="faq"]',
  // Accordion patterns that are likely FAQs
  '.accordion[class*="question"]',
  '.accordion[class*="faq"]',
  // Elementor accordion widget (commonly used for FAQs)
  '.elementor-widget-n-accordion',
  '.elementor-widget-accordion',
  '[data-widget_type="accordion.default"]',
  '[data-widget_type="n-accordion.default"]',
  // WeDT (WeDstarter Theme) accordion widget
  '.elementor-widget-wdt-accordion-and-toggle',
  '.wdt-accordion-toggle-holder',
  '[data-widget_type="wdt-accordion-and-toggle.default"]',
];

/**
 * Selectors for detecting Q&A items within FAQ
 */
const FAQ_ITEM_SELECTORS = [
  // Schema.org Question
  '[itemtype*="Question"]',
  '[typeof="Question"]',
  // Class-based
  '.faq-item',
  '.faq-question',
  '.question',
  '.accordion-item',
  '[class*="faq-item"]',
  // Elementor accordion items
  '.e-n-accordion-item',
  '.e-n-accordion-item-title',
  '.elementor-accordion-item',
  '.elementor-tab-title',
  // WeDT accordion items
  '.wdt-accordion-toggle-wrapper',
  '.wdt-accordion-toggle-title-holder',
];

/**
 * Selectors for detecting TOC/jump links
 */
const TOC_SELECTORS = [
  // Explicit TOC
  '.toc',
  '.table-of-contents',
  '.tableofcontents',
  '#toc',
  '#table-of-contents',
  'nav.toc',
  '[class*="toc"]',
  '[id*="toc"]',
  // Jump link patterns
  '.jump-links',
  '.page-nav',
  '.content-nav',
  '.in-page-nav',
  '[class*="jump-to"]',
];

/**
 * Selectors for detecting breadcrumbs
 */
const BREADCRUMB_SELECTORS = [
  // Schema.org BreadcrumbList
  '[itemtype*="BreadcrumbList"]',
  '[typeof="BreadcrumbList"]',
  // Class-based
  '.breadcrumb',
  '.breadcrumbs',
  '.breadcrumb-nav',
  '#breadcrumb',
  '#breadcrumbs',
  '[class*="breadcrumb"]',
  'nav[aria-label*="breadcrumb" i]',
];

/**
 * Selectors for detecting CTAs
 */
const CTA_SELECTORS = [
  '.cta',
  '.call-to-action',
  '.cta-section',
  '.cta-block',
  '.cta-banner',
  '.cta-box',
  '[class*="cta"]',
  // Button patterns in specific contexts
  '.hero .btn',
  '.hero button',
  '.banner .btn',
  // Schedule/Contact patterns
  '[class*="schedule"]',
  '[class*="consult"]',
  '[class*="contact-form"]',
];

/**
 * Selectors for detecting accordion sections
 */
const ACCORDION_SELECTORS = [
  '.accordion',
  '.accordions',
  '[class*="accordion"]',
  '[data-accordion]',
  '.collapse-group',
  '.expandable',
];

/**
 * Selectors for detecting testimonials
 */
const TESTIMONIAL_SELECTORS = [
  '.testimonial',
  '.testimonials',
  '.review',
  '.reviews',
  '.customer-review',
  '.patient-review',
  '[class*="testimonial"]',
  '[class*="review"]',
  '[itemtype*="Review"]',
];

/**
 * Selectors for detecting author bio
 */
const AUTHOR_BIO_SELECTORS = [
  '.author-bio',
  '.author-box',
  '.about-author',
  '.author-info',
  '[class*="author-bio"]',
  '[class*="author-box"]',
  '[itemtype*="Person"][class*="author"]',
];

/**
 * Selectors for detecting related posts
 */
const RELATED_POSTS_SELECTORS = [
  '.related-posts',
  '.related-articles',
  '.related-content',
  '.you-may-also-like',
  '[class*="related-post"]',
  '[class*="related-article"]',
];

/**
 * Detect all structural elements in HTML
 *
 * @param html - Raw HTML string
 * @returns Detection result with all found elements
 */
export function detectStructuralElements(html: string): StructuralDetectionResult {
  const $ = cheerio.load(html);
  const elements: StructuralElement[] = [];
  const stats = {
    faq_modules: 0,
    toc_sections: 0,
    breadcrumbs: 0,
    template_ctas: 0,
    accordions: 0,
    testimonials: 0,
    author_bios: 0,
    related_posts: 0,
  };

  // Detect FAQ sections
  const faqElements = detectFAQSections($, html);
  elements.push(...faqElements);
  stats.faq_modules = faqElements.length;

  // Detect TOC sections
  const tocElements = detectTOCSections($, html);
  elements.push(...tocElements);
  stats.toc_sections = tocElements.length;

  // Detect breadcrumbs
  const breadcrumbElements = detectBreadcrumbs($, html);
  elements.push(...breadcrumbElements);
  stats.breadcrumbs = breadcrumbElements.length;

  // Detect CTAs
  const ctaElements = detectCTAs($, html);
  elements.push(...ctaElements);
  stats.template_ctas = ctaElements.length;

  // Detect accordions (non-FAQ)
  const accordionElements = detectAccordions($, html, faqElements);
  elements.push(...accordionElements);
  stats.accordions = accordionElements.length;

  // Detect testimonials
  const testimonialElements = detectTestimonials($, html);
  elements.push(...testimonialElements);
  stats.testimonials = testimonialElements.length;

  // Detect author bios
  const authorElements = detectAuthorBios($, html);
  elements.push(...authorElements);
  stats.author_bios = authorElements.length;

  // Detect related posts
  const relatedElements = detectRelatedPosts($, html);
  elements.push(...relatedElements);
  stats.related_posts = relatedElements.length;

  return { elements, stats };
}

/**
 * Detect FAQ from JSON-LD schema
 */
function detectJsonLdFAQ($: cheerio.CheerioAPI, html: string): StructuralElement | null {
  let faqElement: StructuralElement | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (faqElement) return; // Already found one

    const $script = $(el);
    const scriptContent = $script.html();
    if (!scriptContent) return;

    try {
      const data = JSON.parse(scriptContent);

      // Check if it's FAQPage (can be array or object)
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];

        if (types.includes('FAQPage')) {
          // Extract questions from mainEntity
          const questions: string[] = [];
          const mainEntity = item.mainEntity || [];
          const entities = Array.isArray(mainEntity) ? mainEntity : [mainEntity];

          for (const entity of entities) {
            if (entity['@type'] === 'Question' && entity.name) {
              questions.push(entity.name);
            }
          }

          // Find position of this script tag in HTML
          const scriptHtml = $.html($script);
          const startIndex = html.indexOf(scriptHtml);

          const metadata: FAQMetadata = {
            questionCount: questions.length,
            hasSchema: true,
            questions,
          };

          faqElement = {
            type: 'faq_module',
            startIndex: startIndex !== -1 ? startIndex : 0,
            endIndex: startIndex !== -1 ? startIndex + scriptHtml.length : 0,
            selector: 'script[type="application/ld+json"] (FAQPage)',
            metadata,
          };
          return;
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  });

  return faqElement;
}

/**
 * Detect FAQ sections
 */
function detectFAQSections($: cheerio.CheerioAPI, html: string): StructuralElement[] {
  const elements: StructuralElement[] = [];
  const seen = new Set<number>();

  // First, check for JSON-LD FAQPage schema
  const jsonLdFaq = detectJsonLdFAQ($, html);
  if (jsonLdFaq) {
    elements.push(jsonLdFaq);
    seen.add(jsonLdFaq.startIndex);
  }

  for (const selector of FAQ_SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);

      // Try to find position in original HTML, fallback to hash-based dedup
      let startIndex = html.indexOf(outerHtml);

      // If exact match fails, try finding by a unique attribute or generate key
      if (startIndex === -1) {
        // Try finding by data-id or id attribute
        const dataId = $el.attr('data-id') || $el.attr('id') || '';
        if (dataId) {
          const idPattern = `data-id="${dataId}"`;
          startIndex = html.indexOf(idPattern);
        }
      }

      // Use content hash as fallback for deduplication
      const dedupKey = startIndex !== -1 ? startIndex : outerHtml.length * 1000 + outerHtml.slice(0, 100).length;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);

      // Extract FAQ metadata
      const questions: string[] = [];
      let hasSchema = false;

      // Check for schema.org
      if ($el.attr('itemtype')?.includes('FAQPage') || $el.attr('typeof') === 'FAQPage') {
        hasSchema = true;
      }

      // Find questions within this FAQ section
      for (const itemSelector of FAQ_ITEM_SELECTORS) {
        $el.find(itemSelector).each((_, item) => {
          const $item = $(item);
          // Try multiple patterns for question text
          let questionText = $item.find('.faq-question, [itemprop="name"], .question, summary, button').first().text().trim();

          // Elementor new accordion pattern
          if (!questionText) {
            questionText = $item.find('.e-n-accordion-item-title-text').first().text().trim();
          }

          // Elementor legacy accordion pattern
          if (!questionText) {
            questionText = $item.find('.elementor-accordion-title').first().text().trim();
          }

          // WeDT accordion pattern
          if (!questionText) {
            questionText = $item.find('.wdt-accordion-toggle-title').first().text().trim();
          }

          // If item itself is the title element
          if (!questionText && $item.hasClass('e-n-accordion-item-title')) {
            questionText = $item.find('.e-n-accordion-item-title-text').text().trim() ||
                          $item.text().trim();
          }

          if (questionText && !questions.includes(questionText)) {
            questions.push(questionText);
          }
        });
      }

      // Direct accordion title extraction (fallback)
      if (questions.length === 0) {
        $el.find('.e-n-accordion-item-title-text, .elementor-accordion-title, .wdt-accordion-toggle-title').each((_, titleEl) => {
          const questionText = $(titleEl).text().trim();
          if (questionText && !questions.includes(questionText)) {
            questions.push(questionText);
          }
        });
      }

      // Also check for dt/dd pattern (definition list FAQ)
      $el.find('dt').each((_, dt) => {
        const questionText = $(dt).text().trim();
        if (questionText && !questions.includes(questionText)) {
          questions.push(questionText);
        }
      });

      const metadata: FAQMetadata = {
        questionCount: questions.length,
        hasSchema,
        questions,
      };

      elements.push({
        type: 'faq_module',
        startIndex,
        endIndex: startIndex + outerHtml.length,
        selector,
        metadata,
      });
    });
  }

  return elements;
}

/**
 * Detect TOC sections
 */
function detectTOCSections($: cheerio.CheerioAPI, html: string): StructuralElement[] {
  const elements: StructuralElement[] = [];
  const seen = new Set<number>();

  for (const selector of TOC_SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);
      const startIndex = html.indexOf(outerHtml);

      if (startIndex === -1 || seen.has(startIndex)) return;
      seen.add(startIndex);

      // Count items and anchor links
      const links = $el.find('a');
      let anchorCount = 0;

      links.each((_, link) => {
        const href = $(link).attr('href') || '';
        if (href.startsWith('#')) {
          anchorCount++;
        }
      });

      const metadata: TOCMetadata = {
        itemCount: $el.find('li').length || links.length,
        linkCount: links.length,
        isAnchorBased: anchorCount > 0 && anchorCount >= links.length * 0.5,
      };

      // Only include if it looks like a real TOC (has anchor links)
      if (metadata.isAnchorBased) {
        elements.push({
          type: 'toc_or_jump',
          startIndex,
          endIndex: startIndex + outerHtml.length,
          selector,
          metadata,
        });
      }
    });
  }

  return elements;
}

/**
 * Detect breadcrumbs
 */
function detectBreadcrumbs($: cheerio.CheerioAPI, html: string): StructuralElement[] {
  const elements: StructuralElement[] = [];
  const seen = new Set<number>();

  for (const selector of BREADCRUMB_SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);
      const startIndex = html.indexOf(outerHtml);

      if (startIndex === -1 || seen.has(startIndex)) return;
      seen.add(startIndex);

      elements.push({
        type: 'breadcrumb',
        startIndex,
        endIndex: startIndex + outerHtml.length,
        selector,
      });
    });
  }

  return elements;
}

/**
 * Detect CTA sections
 */
function detectCTAs($: cheerio.CheerioAPI, html: string): StructuralElement[] {
  const elements: StructuralElement[] = [];
  const seen = new Set<number>();

  for (const selector of CTA_SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);
      const startIndex = html.indexOf(outerHtml);

      if (startIndex === -1 || seen.has(startIndex)) return;
      seen.add(startIndex);

      const hasButton = $el.find('button, .btn, [class*="button"]').length > 0;
      const hasForm = $el.find('form, input[type="submit"]').length > 0;
      const actionText = $el.find('button, .btn, a.btn, [class*="button"]').first().text().trim();

      const metadata: CTAMetadata = {
        hasButton,
        hasForm,
        actionText: actionText || undefined,
      };

      elements.push({
        type: 'template_cta',
        startIndex,
        endIndex: startIndex + outerHtml.length,
        selector,
        metadata,
      });
    });
  }

  return elements;
}

/**
 * Detect accordion sections (that are NOT already classified as FAQ)
 */
function detectAccordions(
  $: cheerio.CheerioAPI,
  html: string,
  faqElements: StructuralElement[]
): StructuralElement[] {
  const elements: StructuralElement[] = [];
  const seen = new Set<number>();

  // Create a set of FAQ start indices to avoid double-counting
  const faqStartIndices = new Set(faqElements.map(f => f.startIndex));

  for (const selector of ACCORDION_SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);
      const startIndex = html.indexOf(outerHtml);

      if (startIndex === -1 || seen.has(startIndex)) return;
      if (faqStartIndices.has(startIndex)) return; // Skip if already FAQ

      seen.add(startIndex);

      elements.push({
        type: 'accordion',
        startIndex,
        endIndex: startIndex + outerHtml.length,
        selector,
      });
    });
  }

  return elements;
}

/**
 * Detect testimonial sections
 */
function detectTestimonials($: cheerio.CheerioAPI, html: string): StructuralElement[] {
  const elements: StructuralElement[] = [];
  const seen = new Set<number>();

  for (const selector of TESTIMONIAL_SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);
      const startIndex = html.indexOf(outerHtml);

      if (startIndex === -1 || seen.has(startIndex)) return;
      seen.add(startIndex);

      elements.push({
        type: 'testimonial',
        startIndex,
        endIndex: startIndex + outerHtml.length,
        selector,
      });
    });
  }

  return elements;
}

/**
 * Detect author bio sections
 */
function detectAuthorBios($: cheerio.CheerioAPI, html: string): StructuralElement[] {
  const elements: StructuralElement[] = [];
  const seen = new Set<number>();

  for (const selector of AUTHOR_BIO_SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);
      const startIndex = html.indexOf(outerHtml);

      if (startIndex === -1 || seen.has(startIndex)) return;
      seen.add(startIndex);

      elements.push({
        type: 'author_bio',
        startIndex,
        endIndex: startIndex + outerHtml.length,
        selector,
      });
    });
  }

  return elements;
}

/**
 * Detect related posts sections
 */
function detectRelatedPosts($: cheerio.CheerioAPI, html: string): StructuralElement[] {
  const elements: StructuralElement[] = [];
  const seen = new Set<number>();

  for (const selector of RELATED_POSTS_SELECTORS) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);
      const startIndex = html.indexOf(outerHtml);

      if (startIndex === -1 || seen.has(startIndex)) return;
      seen.add(startIndex);

      elements.push({
        type: 'related_posts',
        startIndex,
        endIndex: startIndex + outerHtml.length,
        selector,
      });
    });
  }

  return elements;
}

/**
 * Check if a position in HTML falls within any structural element
 *
 * @param position - Character position in HTML
 * @param elements - Detected structural elements
 * @returns The structural element type if found, null otherwise
 */
export function getStructuralTypeAtPosition(
  position: number,
  elements: StructuralElement[]
): StructuralElement | null {
  for (const element of elements) {
    if (position >= element.startIndex && position <= element.endIndex) {
      return element;
    }
  }
  return null;
}
