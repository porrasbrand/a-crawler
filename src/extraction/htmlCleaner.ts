/**
 * HTML cleaning utilities
 * Remove unwanted elements before content extraction
 */

import { JSDOM } from 'jsdom';
import { REMOVE_SELECTORS } from '../config/constants';

/**
 * Clean HTML by removing unwanted elements
 *
 * @param html - Raw HTML string
 * @returns Cleaned HTML string
 */
export function cleanHtml(html: string): string {
  if (!html) return '';

  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Check if body exists
    if (!document.body) {
      return html;
    }

    // Remove unwanted elements
    REMOVE_SELECTORS.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => el.remove());
    });

    // Remove empty links
    const emptyLinks = document.querySelectorAll('a:empty');
    emptyLinks.forEach((el) => el.remove());

    // Remove comments
    const walker = document.createTreeWalker(
      document.body,
      dom.window.NodeFilter.SHOW_COMMENT
    );

    const commentsToRemove: Node[] = [];
    let currentNode: Node | null = walker.currentNode;

    while (currentNode) {
      commentsToRemove.push(currentNode);
      currentNode = walker.nextNode();
    }

    commentsToRemove.forEach((comment) => {
      comment.parentNode?.removeChild(comment);
    });

    return document.body.innerHTML;
  } catch (error) {
    console.error('HTML cleaning failed:', (error as Error).message);
    return html; // Return original if cleaning fails
  }
}

/**
 * Remove specific elements by custom selectors
 *
 * @param html - HTML string
 * @param selectors - Array of CSS selectors to remove
 * @returns Cleaned HTML
 */
export function removeElements(html: string, selectors: string[]): string {
  if (!html || !selectors || selectors.length === 0) return html;

  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    if (!document.body) {
      return html;
    }

    selectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => el.remove());
    });

    return document.body.innerHTML;
  } catch (error) {
    console.error('Element removal failed:', (error as Error).message);
    return html;
  }
}

/**
 * Extract element by selectors
 *
 * @param html - HTML string
 * @param selectors - Array of CSS selectors (tries each in order)
 * @returns Extracted HTML or null if not found
 */
export function extractBySelectors(html: string, selectors: string[]): string | null {
  if (!html || !selectors || selectors.length === 0) return null;

  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.innerHTML.trim()) {
        return element.innerHTML;
      }
    }

    return null;
  } catch (error) {
    console.error('Extraction by selectors failed:', (error as Error).message);
    return null;
  }
}

/**
 * Normalize whitespace in HTML
 *
 * @param html - HTML string
 * @returns HTML with normalized whitespace
 */
export function normalizeWhitespace(html: string): string {
  if (!html) return '';

  return html
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/>\s+</g, '><') // Remove whitespace between tags
    .trim();
}
