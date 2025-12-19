/**
 * Enhanced Markdown Types
 *
 * Defines the structure for markdown that preserves semantic context
 * for link_source_type classification in seo-processor.
 */

/**
 * Types of structural elements we can detect and mark
 */
export type StructuralElementType =
  | 'faq_module'       // FAQ section with Q&A
  | 'toc_or_jump'      // Table of contents / jump links
  | 'breadcrumb'       // Breadcrumb navigation (in content, not nav)
  | 'template_cta'     // Call-to-action blocks
  | 'accordion'        // Accordion/expandable sections
  | 'testimonial'      // Testimonial/review blocks
  | 'author_bio'       // Author biography sections
  | 'related_posts';   // Related posts/articles sections

/**
 * A detected structural element with its boundaries
 */
export interface StructuralElement {
  type: StructuralElementType;
  startIndex: number;     // Character index in original HTML
  endIndex: number;       // Character index in original HTML
  selector?: string;      // CSS selector that matched
  metadata?: Record<string, any>;  // Type-specific metadata
}

/**
 * FAQ-specific metadata
 */
export interface FAQMetadata {
  questionCount: number;
  hasSchema: boolean;      // Has FAQPage schema.org markup
  questions: string[];     // List of question texts
}

/**
 * TOC-specific metadata
 */
export interface TOCMetadata {
  itemCount: number;
  linkCount: number;       // Number of anchor links
  isAnchorBased: boolean;  // Links to same page sections
}

/**
 * CTA-specific metadata
 */
export interface CTAMetadata {
  hasButton: boolean;
  hasForm: boolean;
  actionText?: string;     // Button/link text
}

/**
 * Result of structural element detection
 */
export interface StructuralDetectionResult {
  elements: StructuralElement[];
  stats: {
    faq_modules: number;
    toc_sections: number;
    breadcrumbs: number;
    template_ctas: number;
    accordions: number;
    testimonials: number;
    author_bios: number;
    related_posts: number;
  };
}

/**
 * Enhanced markdown output with metadata
 */
export interface EnhancedMarkdownResult {
  markdown: string;           // Markdown with embedded markers
  plainMarkdown: string;      // Same markdown without markers (for LLM)
  detection: StructuralDetectionResult;
  warnings: string[];
}

/**
 * Marker format for embedded comments
 *
 * Format: <!-- STRUCT:TYPE:ACTION[:DATA] -->
 *
 * Examples:
 *   <!-- STRUCT:FAQ:START -->
 *   <!-- STRUCT:FAQ:Q -->What is liposuction?<!-- STRUCT:FAQ:A -->
 *   <!-- STRUCT:FAQ:END -->
 *
 *   <!-- STRUCT:TOC:START -->
 *   - [Section 1](#section-1)
 *   <!-- STRUCT:TOC:END -->
 *
 *   <!-- STRUCT:CTA:START -->
 *   [Schedule Consultation](/contact)
 *   <!-- STRUCT:CTA:END -->
 */
export const STRUCT_MARKERS = {
  FAQ: {
    START: '<!-- STRUCT:FAQ:START -->',
    END: '<!-- STRUCT:FAQ:END -->',
    QUESTION: '<!-- STRUCT:FAQ:Q -->',
    ANSWER: '<!-- STRUCT:FAQ:A -->',
  },
  TOC: {
    START: '<!-- STRUCT:TOC:START -->',
    END: '<!-- STRUCT:TOC:END -->',
  },
  BREADCRUMB: {
    START: '<!-- STRUCT:BREADCRUMB:START -->',
    END: '<!-- STRUCT:BREADCRUMB:END -->',
  },
  CTA: {
    START: '<!-- STRUCT:CTA:START -->',
    END: '<!-- STRUCT:CTA:END -->',
  },
  ACCORDION: {
    START: '<!-- STRUCT:ACCORDION:START -->',
    END: '<!-- STRUCT:ACCORDION:END -->',
    ITEM_START: '<!-- STRUCT:ACCORDION:ITEM -->',
  },
  TESTIMONIAL: {
    START: '<!-- STRUCT:TESTIMONIAL:START -->',
    END: '<!-- STRUCT:TESTIMONIAL:END -->',
  },
  AUTHOR_BIO: {
    START: '<!-- STRUCT:AUTHOR:START -->',
    END: '<!-- STRUCT:AUTHOR:END -->',
  },
  RELATED: {
    START: '<!-- STRUCT:RELATED:START -->',
    END: '<!-- STRUCT:RELATED:END -->',
  },
} as const;

/**
 * Regex to strip all STRUCT markers from markdown
 */
export const STRUCT_MARKER_REGEX = /<!-- STRUCT:[A-Z_]+:[A-Z_]+ -->/g;
