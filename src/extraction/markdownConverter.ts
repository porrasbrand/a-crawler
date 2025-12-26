/**
 * HTML to Markdown conversion using Turndown
 * Configured for high-quality output suitable for LLM/RAG ingestion
 */

import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';

/**
 * Create configured Turndown service
 */
function createTurndownService(baseUrl?: string): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: 'atx', // Use # for headings
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
  });

  // Custom rule: Convert relative URLs to absolute
  if (baseUrl) {
    turndownService.addRule('absoluteLinks', {
      filter: ['a', 'img'],
      replacement: (content, node: any) => {
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
            // Skip base64 images - they bloat the markdown
            if (src.startsWith('data:image/')) {
              // Extract image type for reference
              const typeMatch = src.match(/^data:image\/(\w+)/);
              const imageType = typeMatch ? typeMatch[1] : 'unknown';
              return alt ? `![${alt}](data:image/${imageType};base64,...)` : '';
            }
            const absoluteUrl = makeAbsolute(src, baseUrl);
            return `![${alt}](${absoluteUrl})`;
          }
          return '';
        }

        return content;
      },
    });
  }

  // Custom rule: Remove empty links
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

  // Custom rule: Keep meaningful tables, simplify navigation lists
  turndownService.addRule('smartLists', {
    filter: (node: any) => {
      if (node.nodeName !== 'UL' && node.nodeName !== 'OL') return false;

      // Check if this is a navigation list (high link density)
      const listItems = node.querySelectorAll('li');
      const linksInList = node.querySelectorAll('a');

      if (listItems.length > 0 && linksInList.length / listItems.length > 0.8) {
        return true; // Navigation list
      }

      return false;
    },
    replacement: () => '', // Remove navigation lists
  });

  return turndownService;
}

/**
 * H1 detection result
 */
interface H1Detection {
  hasH1: boolean;
  position: number; // Line number (0-indexed)
  text: string | null;
}

/**
 * Result of H1 ensure operation
 */
interface H1EnsureResult {
  markdown: string;
  seoIssues: string[];
  modified: boolean;
}

/**
 * Convert HTML to Markdown
 *
 * @param html - Clean HTML string
 * @param baseUrl - Base URL for resolving relative links
 * @param h1 - H1 heading to prepend (if includeH1 is true)
 * @param includeH1 - Whether to include H1 at start and shift heading levels
 * @returns Markdown string
 */
export function htmlToMarkdown(
  html: string,
  baseUrl?: string,
  h1?: string | null,
  includeH1: boolean = true
): string {
  if (!html) return '';

  try {
    const turndownService = createTurndownService(baseUrl);
    let markdown = turndownService.turndown(html);

    // Post-processing
    markdown = postProcessMarkdown(markdown);

    // Include H1 and shift heading levels if requested
    if (includeH1 && h1) {
      const result = ensureH1InMarkdown(markdown, h1, true);
      markdown = result.markdown;

      // Log SEO issues if any (optional diagnostic)
      if (result.seoIssues.length > 0) {
        console.debug('SEO issues detected:', result.seoIssues);
      }
    }

    return markdown;
  } catch (error) {
    console.error('Markdown conversion failed:', (error as Error).message);
    return '';
  }
}

/**
 * Post-process Markdown for better quality
 */
function postProcessMarkdown(markdown: string): string {
  let processed = markdown;

  // 1. Remove excessive blank lines (max 2 consecutive)
  processed = processed.replace(/\n{3,}/g, '\n\n');

  // 2. Remove repeated content (phone numbers, CTAs)
  processed = deduplicateLines(processed);

  // 3. Clean up common boilerplate patterns
  processed = removeBoilerplate(processed);

  // 4. Normalize heading hierarchy
  processed = normalizeHeadings(processed);

  // 5. Strip base64 image data (catch any that slipped through)
  processed = stripBase64Images(processed);

  // 6. Trim whitespace
  processed = processed.trim();

  return processed;
}

/**
 * Strip base64 image data from markdown to reduce bloat
 * Replaces full base64 content with truncated placeholder
 */
function stripBase64Images(markdown: string): string {
  let result = markdown;

  // Pattern 1: Proper data: URLs - ![alt](data:image/TYPE;base64,LONGDATA...)
  result = result.replace(
    /!\[([^\]]*)\]\(data:image\/(\w+);base64,[A-Za-z0-9+/=]{50,}\)/g,
    (match, alt, imageType) => {
      return alt ? `![${alt}](data:image/${imageType};base64,...)` : '';
    }
  );

  // Pattern 2: Malformed URLs with embedded base64 - ![alt](https://site.com/path;base64,LONGDATA)
  result = result.replace(
    /!\[([^\]]*)\]\([^)]*;base64,[A-Za-z0-9+/=]{50,}\)/g,
    (match, alt) => {
      return alt ? `![${alt}](embedded-base64-removed)` : '';
    }
  );

  return result;
}

/**
 * Remove duplicate consecutive lines
 */
function deduplicateLines(markdown: string): string {
  const lines = markdown.split('\n');
  const deduplicated: string[] = [];
  let previousLine = '';

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip if identical to previous non-empty line
    if (trimmedLine && trimmedLine === previousLine) {
      continue;
    }

    deduplicated.push(line);

    if (trimmedLine) {
      previousLine = trimmedLine;
    }
  }

  return deduplicated.join('\n');
}

/**
 * Remove common boilerplate patterns
 */
function removeBoilerplate(markdown: string): string {
  let cleaned = markdown;

  // Remove breadcrumb patterns
  cleaned = cleaned.replace(/^Home\s*>\s*.+$/gm, '');

  // Remove "Posted on X by Y" patterns
  cleaned = cleaned.replace(/^Posted on .+ by .+$/gm, '');

  // Remove copyright notices (common patterns)
  cleaned = cleaned.replace(/^©\s*\d{4}.+$/gm, '');
  cleaned = cleaned.replace(/^Copyright\s+©\s+\d{4}.+$/gim, '');

  // Remove "Last updated" patterns
  cleaned = cleaned.replace(/^Last updated:?\s*.+$/gim, '');

  return cleaned;
}

/**
 * Normalize heading hierarchy
 * Ensures logical H1 -> H2 -> H3 progression
 */
function normalizeHeadings(markdown: string): string {
  const lines = markdown.split('\n');
  const normalized: string[] = [];
  let lastHeadingLevel = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const currentLevel = headingMatch[1].length;
      const headingText = headingMatch[2];

      // Don't allow skipping levels (e.g., H1 -> H3)
      let adjustedLevel = currentLevel;
      if (currentLevel > lastHeadingLevel + 1) {
        adjustedLevel = lastHeadingLevel + 1;
      }

      normalized.push(`${'#'.repeat(adjustedLevel)} ${headingText}`);
      lastHeadingLevel = adjustedLevel;
    } else {
      normalized.push(line);
    }
  }

  return normalized.join('\n');
}

/**
 * Make URL absolute
 */
function makeAbsolute(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url; // Return original if conversion fails
  }
}

/**
 * Detect if markdown contains H1 heading
 *
 * @param markdown - Markdown string
 * @returns Detection result with position and text
 */
function detectH1InMarkdown(markdown: string): H1Detection {
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1Match = line.match(/^#\s+(.+)$/);

    if (h1Match) {
      return {
        hasH1: true,
        position: i,
        text: h1Match[1].trim(),
      };
    }
  }

  return {
    hasH1: false,
    position: -1,
    text: null,
  };
}

/**
 * Shift all heading levels down by one
 * (H1 → H2, H2 → H3, etc., cap at H6)
 *
 * @param markdown - Markdown string
 * @param skipFirstH1 - If true, don't shift the first H1 found
 * @returns Markdown with shifted heading levels
 */
function shiftHeadingLevels(markdown: string, skipFirstH1: boolean = false): string {
  const lines = markdown.split('\n');
  const shifted: string[] = [];
  let firstH1Seen = false;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,5})\s+(.+)$/);

    if (headingMatch) {
      const currentLevel = headingMatch[1].length;
      const headingText = headingMatch[2];

      // Skip shifting the first H1 if requested
      if (skipFirstH1 && currentLevel === 1 && !firstH1Seen) {
        firstH1Seen = true;
        shifted.push(line);
        continue;
      }

      // Shift down one level (cap at H6)
      const newLevel = Math.min(currentLevel + 1, 6);
      shifted.push(`${'#'.repeat(newLevel)} ${headingText}`);
    } else {
      shifted.push(line);
    }
  }

  return shifted.join('\n');
}

/**
 * Ensure H1 is at the start of markdown and shift heading levels
 *
 * @param markdown - Original markdown
 * @param h1 - H1 text to prepend
 * @param detectSeoIssues - Whether to detect SEO issues
 * @returns Result with modified markdown and SEO issues
 */
function ensureH1InMarkdown(
  markdown: string,
  h1: string,
  detectSeoIssues: boolean = true
): H1EnsureResult {
  const result: H1EnsureResult = {
    markdown,
    seoIssues: [],
    modified: false,
  };

  // Return original if H1 is empty
  if (!h1 || !h1.trim()) {
    return result;
  }

  // Detect existing H1
  const detection = detectH1InMarkdown(markdown);

  // Case 1: H1 already at the start with matching text
  if (detection.hasH1 && detection.position === 0) {
    // Check if it matches our H1
    if (detection.text === h1.trim()) {
      // Already perfect, no changes needed
      return result;
    }
  }

  // Case 2: H1 exists but not at start (SEO issue)
  if (detection.hasH1 && detection.position > 0 && detectSeoIssues) {
    result.seoIssues.push(
      `H1 found at line ${detection.position + 1}, not at document start`
    );
  }

  // Remove any existing H1 from content to avoid duplication
  let cleanedMarkdown = markdown;
  if (detection.hasH1) {
    const lines = markdown.split('\n');
    lines.splice(detection.position, 1);
    cleanedMarkdown = lines.join('\n');
  }

  // Prepend H1 at the start (do NOT shift other heading levels)
  result.markdown = `# ${h1.trim()}\n\n${cleanedMarkdown}`;
  result.modified = true;

  return result;
}

/**
 * Extract plain text from Markdown (for previews)
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return '';

  let text = markdown;

  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`[^`]+`/g, '');

  // Remove links
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

  // Remove images
  text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

  // Remove headings markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove emphasis
  text = text.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1');

  // Remove lists
  text = text.replace(/^[-*+]\s+/gm, '');
  text = text.replace(/^\d+\.\s+/gm, '');

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
