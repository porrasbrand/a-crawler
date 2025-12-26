/**
 * Navigation Structure Types
 *
 * Defines the structure for extracted navigation data from HTML pages.
 * Used by navExtractor.ts and stored in crawler_pages.nav_structure
 */

/**
 * Link source type for classification
 * Used by Hub Selection v2 for Intent scoring
 */
export type LinkSourceType =
  | 'contextual_body'   // In-content editorial links
  | 'faq_module'        // FAQ section links
  | 'toc_or_jump'       // Table of contents / anchor links
  | 'breadcrumb'        // Breadcrumb navigation
  | 'primary_nav'       // Main menu
  | 'footer'            // Footer links
  | 'template_cta'      // Call-to-action blocks
  | 'repeated_block'    // Template blocks (detected by seo-processor)
  | 'related_posts'     // Related posts section
  | 'author_bio'        // Author biography section
  | 'testimonial';      // Testimonial section

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
 * Content link with structural context
 * For links within the main body content (not nav/footer)
 */
export interface ContentLink {
  url: string;                    // Normalized URL
  label: string;                  // Anchor text
  source_type: LinkSourceType;    // Structural context
  nearest_heading?: string;       // Closest H2/H3 above this link
  body_position_pct: number;      // 0-100, where in content this appears
  is_external: boolean;           // External link?
}

/**
 * Breadcrumb item (simpler than NavItem)
 */
export interface BreadcrumbItem {
  label: string;
  url?: string;  // Last item usually has no URL
}

/**
 * Navigation cluster type
 */
export type NavClusterType =
  | 'primary_nav'       // Main menu
  | 'footer_nav'        // Footer links
  | 'utility_header'    // Tel, email, directions, social
  | 'language_switcher' // EN/ES toggles
  | 'breadcrumb';       // Page breadcrumbs

/**
 * Extraction metadata for debugging/analysis
 */
export interface NavExtractionMeta {
  clusters_found: number;
  primary_nav_selector: string | null;
  footer_nav_selector: string | null;
  has_mega_menu: boolean;
  extraction_time_ms: number;
}

/**
 * Structural detection stats
 */
export interface StructuralStats {
  faq_modules: number;
  toc_sections: number;
  breadcrumbs: number;
  template_ctas: number;
  accordions: number;
  testimonials: number;
  author_bios: number;
  related_posts: number;
}

/**
 * Complete navigation structure for a page
 */
export interface NavStructure {
  primary_nav: NavItem[];
  footer_nav: NavItem[];
  utility_header: NavItem[];
  language_switcher: NavItem[];
  breadcrumb: BreadcrumbItem[];
  content_links: ContentLink[];       // Links from main content with context
  structural_stats: StructuralStats;  // Counts of detected structural elements
  extraction_meta: NavExtractionMeta;
}
