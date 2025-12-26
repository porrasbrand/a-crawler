#!/usr/bin/env ts-node
/**
 * Backfill Enhanced Markdown
 *
 * Processes existing pages in the database to populate:
 * - markdown_enhanced (markdown with STRUCT markers)
 * - structural_stats (detection counts)
 *
 * Uses stored clean_html - no need to re-crawl from web.
 *
 * Usage:
 *   npx ts-node src/scripts/backfillEnhancedMarkdown.ts [--limit N] [--url-pattern PATTERN]
 */

import { pool } from '../config/database';
import { htmlToEnhancedMarkdown } from '../extraction/enhancedMarkdownConverter';
import { RowDataPacket } from 'mysql2';

interface PageRow extends RowDataPacket {
  id: number;
  final_url: string;
  clean_html: string | null;
  h1: string | null;
}

async function backfillEnhancedMarkdown(options: {
  limit?: number;
  urlPattern?: string;
  dryRun?: boolean;
  forceAll?: boolean;
}) {
  const { limit = 1000, urlPattern, dryRun = false, forceAll = false } = options;

  console.log('🔄 Backfilling Enhanced Markdown');
  console.log(`   Limit: ${limit}`);
  console.log(`   URL Pattern: ${urlPattern || 'all'}`);
  console.log(`   Force All: ${forceAll}`);
  console.log(`   Dry Run: ${dryRun}`);
  console.log('');

  // Build query based on options
  // --force-all: reprocess all pages (e.g., after fixing base64 stripping)
  let query = `
    SELECT id, final_url, clean_html, h1
    FROM crawler_pages
    WHERE clean_html IS NOT NULL
  `;

  if (!forceAll) {
    query += ` AND markdown_enhanced IS NULL`;
  }
  const params: any[] = [];

  if (urlPattern) {
    query += ` AND final_url LIKE ?`;
    params.push(`%${urlPattern}%`);
  }

  query += ` ORDER BY id LIMIT ?`;
  params.push(limit);

  // Get pages to process
  const [rows] = await pool.execute<PageRow[]>(query, params);
  console.log(`📋 Found ${rows.length} pages to process`);

  if (rows.length === 0) {
    console.log('✅ Nothing to backfill');
    await pool.end();
    return;
  }

  let processed = 0;
  let updated = 0;
  let errors = 0;
  let withStructure = 0;

  for (const row of rows) {
    try {
      // Generate enhanced markdown from stored clean_html
      const result = htmlToEnhancedMarkdown(
        row.clean_html!,
        row.final_url,
        row.h1,
        true
      );

      // Check if any structural elements were detected
      const hasStructure = Object.values(result.detection.stats).some(v => v > 0);
      if (hasStructure) {
        withStructure++;
      }

      if (!dryRun) {
        // Update the database - both markdown (plain) and markdown_enhanced (with markers)
        await pool.execute(
          `UPDATE crawler_pages
           SET markdown = ?,
               markdown_enhanced = ?,
               structural_stats = ?
           WHERE id = ?`,
          [
            result.plainMarkdown,
            result.markdown,
            JSON.stringify(result.detection.stats),
            row.id
          ]
        );
        updated++;
      }

      processed++;

      // Progress logging
      if (processed % 100 === 0) {
        console.log(`   Processed ${processed}/${rows.length} (${withStructure} with structural elements)`);
      }
    } catch (err) {
      errors++;
      console.error(`   ❌ Error processing ${row.final_url}: ${(err as Error).message}`);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('✅ Backfill Complete');
  console.log('='.repeat(60));
  console.log(`   Pages processed: ${processed}`);
  console.log(`   Pages updated: ${updated}`);
  console.log(`   Pages with structural elements: ${withStructure}`);
  console.log(`   Errors: ${errors}`);

  await pool.end();
}

// Parse CLI args
const args = process.argv.slice(2);
const options: { limit?: number; urlPattern?: string; dryRun?: boolean; forceAll?: boolean } = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--url-pattern' && args[i + 1]) {
    options.urlPattern = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    options.dryRun = true;
  } else if (args[i] === '--force-all') {
    options.forceAll = true;
  }
}

backfillEnhancedMarkdown(options).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
