/**
 * Enhanced Markdown Converter
 *
 * Converts HTML to markdown while preserving structural context markers.
 * These markers allow seo-processor to classify link sources without re-parsing HTML.
 */

import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import {
  EnhancedMarkdownResult,
  StructuralElement,
  STRUCT_MARKERS,
  STRUCT_MARKER_REGEX,
} from '../types/enhancedMarkdown.types';
import { detectStructuralElements } from './structuralDetector';
import { htmlToMarkdown } from './markdownConverter';

/**
 * Custom marker tag name used during conversion
 */
const MARKER_TAG = 'struct-marker';

/**
 * Convert HTML to enhanced markdown with structural markers
 *
 * @param html - Raw HTML string
 * @param baseUrl - Base URL for resolving relative links
 * @param h1 - H1 heading (optional)
 * @param includeH1 - Whether to include H1 at start
 * @returns Enhanced markdown result with both marked and plain versions
 */
export function htmlToEnhancedMarkdown(
  html: string,
  baseUrl?: string,
  h1?: string | null,
  includeH1: boolean = true
): EnhancedMarkdownResult {
  const warnings: string[] = [];

  // Step 1: Detect structural elements
  const detection = detectStructuralElements(html);

  // Step 2: Insert marker tags into HTML
  const markedHtml = insertMarkerTags(html, detection.elements);

  // Step 3: Convert to markdown with marker rules
  const markedMarkdown = convertWithMarkers(markedHtml, baseUrl, h1, includeH1);

  // Step 4: Generate plain markdown (without markers) for LLM use
  const plainMarkdown = markedMarkdown.replace(STRUCT_MARKER_REGEX, '').trim();

  // Step 5: Clean up excessive whitespace from marker removal
  const cleanedPlainMarkdown = plainMarkdown
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    markdown: markedMarkdown,
    plainMarkdown: cleanedPlainMarkdown,
    detection,
    warnings,
  };
}

/**
 * Insert marker tags around detected structural elements
 */
function insertMarkerTags(html: string, elements: StructuralElement[]): string {
  if (elements.length === 0) return html;

  const $ = cheerio.load(html);

  // Sort elements by start index descending (to insert from end first)
  const sortedElements = [...elements].sort((a, b) => b.startIndex - a.startIndex);

  for (const element of sortedElements) {
    // Find the element by selector
    if (!element.selector) continue;

    $(element.selector).each((_, el) => {
      const $el = $(el);
      const outerHtml = $.html($el);

      // Only process if this is the same element (by checking position)
      const currentStart = html.indexOf(outerHtml);
      if (Math.abs(currentStart - element.startIndex) > 100) return; // Allow some tolerance

      // Wrap with marker based on type
      const markerType = getMarkerType(element.type);
      if (markerType) {
        $el.before(`<${MARKER_TAG} data-type="${markerType}">`);
        $el.after(`</${MARKER_TAG}>`);
      }
    });
  }

  return $.html();
}

/**
 * Map structural element type to marker type
 */
function getMarkerType(type: string): string | null {
  const mapping: Record<string, string> = {
    faq_module: 'FAQ',
    toc_or_jump: 'TOC',
    breadcrumb: 'BREADCRUMB',
    template_cta: 'CTA',
    accordion: 'ACCORDION',
    testimonial: 'TESTIMONIAL',
    author_bio: 'AUTHOR',
    related_posts: 'RELATED',
  };
  return mapping[type] || null;
}

/**
 * Convert HTML to markdown with custom rules for markers
 */
function convertWithMarkers(
  html: string,
  baseUrl?: string,
  h1?: string | null,
  includeH1: boolean = true
): string {
  const $ = cheerio.load(html);

  // Create Turndown service with custom marker rules
  const turndownService = createEnhancedTurndownService(baseUrl);

  // Convert to markdown
  let markdown = turndownService.turndown($.html('body') || $.html());

  // Post-process
  markdown = postProcessEnhancedMarkdown(markdown);

  // Include H1 if requested
  if (includeH1 && h1) {
    markdown = `# ${h1.trim()}\n\n${markdown}`;
  }

  return markdown;
}

/**
 * Create Turndown service with enhanced marker rules
 */
function createEnhancedTurndownService(baseUrl?: string): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
  });

  // Rule: Convert marker tags to markdown comments
  turndownService.addRule('structMarker', {
    filter: (node: any) => {
      return node.nodeName.toLowerCase() === MARKER_TAG;
    },
    replacement: (content: string, node: any) => {
      const type = node.getAttribute('data-type');
      if (!type) return content;

      const markers = (STRUCT_MARKERS as any)[type];
      if (!markers) return content;

      return `${markers.START}\n${content.trim()}\n${markers.END}\n`;
    },
  });

  // Rule: Convert relative URLs to absolute
  if (baseUrl) {
    turndownService.addRule('absoluteLinks', {
      filter: ['a', 'img'],
      replacement: (content: string, node: any) => {
        const element = node as HTMLElement;

        if (element.tagName === 'A') {
          const href = element.getAttribute('href');
          if (href) {
            const absoluteUrl = makeAbsolute(href, baseUrl);
            return `[${content}](${absoluteUrl})`;
          }
          return content;
        }

        if (element.tagName === 'IMG') {
          const src = element.getAttribute('src');
          const alt = element.getAttribute('alt') || '';
          if (src) {
            const absoluteUrl = makeAbsolute(src, baseUrl);
            return `![${alt}](${absoluteUrl})`;
          }
          return '';
        }

        return content;
      },
    });
  }

  // Rule: Remove empty links
  turndownService.addRule('removeEmptyLinks', {
    filter: (node: any) => {
      return (
        node.nodeName === 'A' &&
        !node.textContent.trim() &&
        !node.querySelector('img')
      );
    },
    replacement: () => '',
  });

  // Rule: Handle FAQ question/answer patterns
  turndownService.addRule('faqItems', {
    filter: (node: any) => {
      // Detect FAQ question elements
      if (node.classList) {
        const classList = Array.from(node.classList);
        return (
          classList.some((c: any) => c.includes('faq-question')) ||
          classList.some((c: any) => c.includes('question')) ||
          node.getAttribute('itemprop') === 'name'
        );
      }
      return false;
    },
    replacement: (content: string) => {
      return `${STRUCT_MARKERS.FAQ.QUESTION}${content.trim()}\n`;
    },
  });

  turndownService.addRule('faqAnswers', {
    filter: (node: any) => {
      if (node.classList) {
        const classList = Array.from(node.classList);
        return (
          classList.some((c: any) => c.includes('faq-answer')) ||
          classList.some((c: any) => c.includes('answer')) ||
          node.getAttribute('itemprop') === 'acceptedAnswer' ||
          node.getAttribute('itemprop') === 'text'
        );
      }
      return false;
    },
    replacement: (content: string) => {
      return `${STRUCT_MARKERS.FAQ.ANSWER}${content.trim()}\n`;
    },
  });

  return turndownService;
}

/**
 * Post-process enhanced markdown
 */
function postProcessEnhancedMarkdown(markdown: string): string {
  let processed = markdown;

  // 1. Remove excessive blank lines (max 2 consecutive)
  processed = processed.replace(/\n{3,}/g, '\n\n');

  // 2. Clean up marker spacing
  processed = processed.replace(/<!-- STRUCT:([A-Z_]+):START -->\n\n/g, '<!-- STRUCT:$1:START -->\n');
  processed = processed.replace(/\n\n<!-- STRUCT:([A-Z_]+):END -->/g, '\n<!-- STRUCT:$1:END -->');

  // 3. Trim whitespace
  processed = processed.trim();

  return processed;
}

/**
 * Make URL absolute
 */
function makeAbsolute(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

/**
 * Strip all structural markers from markdown
 *
 * @param markdown - Enhanced markdown with markers
 * @returns Plain markdown without markers
 */
export function stripStructuralMarkers(markdown: string): string {
  return markdown
    .replace(STRUCT_MARKER_REGEX, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract links with their structural context
 *
 * @param enhancedMarkdown - Markdown with structural markers
 * @returns Array of links with their context
 */
export interface LinkWithContext {
  url: string;
  label: string;
  linkSourceType: string;  // 'contextual_body' | 'faq_module' | 'toc_or_jump' | etc.
  nearestHeading?: string;
  position: number;        // Character position in markdown
}

export function extractLinksWithContext(enhancedMarkdown: string): LinkWithContext[] {
  const links: LinkWithContext[] = [];
  const lines = enhancedMarkdown.split('\n');

  let currentStructure: string | null = null;
  let currentHeading: string | null = null;
  let charPosition = 0;

  for (const line of lines) {
    // Track structural context
    const startMatch = line.match(/<!-- STRUCT:([A-Z_]+):START -->/);
    const endMatch = line.match(/<!-- STRUCT:([A-Z_]+):END -->/);

    if (startMatch) {
      currentStructure = startMatch[1].toLowerCase();
    } else if (endMatch) {
      currentStructure = null;
    }

    // Track headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      currentHeading = headingMatch[2];
    }

    // Find links
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;

    while ((match = linkRegex.exec(line)) !== null) {
      const linkSourceType = mapStructureToLinkSource(currentStructure);

      links.push({
        url: match[2],
        label: match[1],
        linkSourceType,
        nearestHeading: currentHeading || undefined,
        position: charPosition + match.index,
      });
    }

    charPosition += line.length + 1; // +1 for newline
  }

  return links;
}

/**
 * Map structural marker type to link_source_type
 */
function mapStructureToLinkSource(structure: string | null): string {
  if (!structure) return 'contextual_body';

  const mapping: Record<string, string> = {
    faq: 'faq_module',
    toc: 'toc_or_jump',
    breadcrumb: 'breadcrumb',
    cta: 'template_cta',
    accordion: 'faq_module',    // Accordions are often FAQ-like
    testimonial: 'contextual_body',
    author: 'contextual_body',
    related: 'related_posts',
  };

  return mapping[structure] || 'contextual_body';
}
