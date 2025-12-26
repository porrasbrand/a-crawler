-- Migration: Add Enhanced Markdown Support
-- Version: 001
-- Date: 2025-12-19
-- Purpose: Store markdown with structural markers for link source classification

-- Add columns for enhanced markdown output
-- - markdown_enhanced: Markdown with STRUCT markers (e.g., <!-- STRUCT:FAQ:START -->)
-- - structural_stats: JSON with detection counts (faq_modules, toc_sections, etc.)

ALTER TABLE crawler_pages
  ADD COLUMN markdown_enhanced LONGTEXT COMMENT 'Markdown with structural markers for link classification',
  ADD COLUMN structural_stats JSON COMMENT 'Structural element detection stats (faq_modules, toc_sections, etc.)';

-- Note: The existing `markdown` column continues to store clean/plain markdown for LLM use
-- The new `markdown_enhanced` column stores the same content BUT with embedded structural markers
-- like <!-- STRUCT:FAQ:START --> which enable seo-processor to classify link sources without re-parsing HTML
