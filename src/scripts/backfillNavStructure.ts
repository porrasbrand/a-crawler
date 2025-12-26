#!/usr/bin/env ts-node
/**
 * Backfill nav_structure for existing pages
 *
 * Extracts navigation structure from existing html_content and updates
 * the nav_structure column.
 *
 * Usage:
 *   npx ts-node src/scripts/backfillNavStructure.ts [--limit N] [--batch-size N]
 */

import { pool } from '../config/database';
import { extractNavStructure } from '../extraction/navExtractor';
import { RowDataPacket } from 'mysql2';

interface PageRow extends RowDataPacket {
  id: number;
  final_url: string;
  html_content: string | null;
}

async function backfillNavStructure(options: { limit?: number; batchSize?: number }) {
  const { limit = 0, batchSize = 100 } = options;

  console.log('Starting nav_structure backfill...');
  console.log(`Options: limit=${limit || 'unlimited'}, batchSize=${batchSize}`);

  let totalProcessed = 0;
  let totalUpdated = 0;
  let offset = 0;

  // Get count of pages needing backfill
  const [[countResult]] = await pool.execute<RowDataPacket[]>(`
    SELECT COUNT(*) as count
    FROM crawler_pages
    WHERE html_content IS NOT NULL
      AND nav_structure IS NULL
  `);
  const totalPending = (countResult as any).count;
  console.log(`Found ${totalPending} pages needing backfill`);

  if (totalPending === 0) {
    console.log('No pages to backfill');
    return;
  }

  const startTime = Date.now();

  while (true) {
    // Fetch batch of pages
    const limitClause = limit > 0
      ? `LIMIT ${Math.min(batchSize, limit - totalProcessed)}`
      : `LIMIT ${batchSize}`;

    const [pages] = await pool.execute<PageRow[]>(`
      SELECT id, final_url, html_content
      FROM crawler_pages
      WHERE html_content IS NOT NULL
        AND nav_structure IS NULL
      ORDER BY id
      ${limitClause}
    `);

    if (pages.length === 0) break;

    console.log(`Processing batch: ${pages.length} pages (offset ${offset})`);

    for (const page of pages) {
      try {
        if (!page.html_content) continue;

        // Extract nav structure
        const navStructure = extractNavStructure(page.html_content, page.final_url);

        // Update page
        await pool.execute(
          `UPDATE crawler_pages SET nav_structure = ? WHERE id = ?`,
          [JSON.stringify(navStructure), page.id]
        );

        totalUpdated++;

        // Log progress
        if (totalUpdated % 50 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = totalUpdated / elapsed;
          console.log(
            `Progress: ${totalUpdated}/${totalPending} pages ` +
            `(${Math.round(totalUpdated / totalPending * 100)}%) ` +
            `[${rate.toFixed(1)} pages/sec]`
          );
        }
      } catch (error) {
        console.error(`Error processing page ${page.id} (${page.final_url}):`, error);
      }

      totalProcessed++;
    }

    offset += pages.length;

    // Check limit
    if (limit > 0 && totalProcessed >= limit) {
      console.log(`Reached limit of ${limit} pages`);
      break;
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nBackfill complete!`);
  console.log(`Total pages processed: ${totalProcessed}`);
  console.log(`Total pages updated: ${totalUpdated}`);
  console.log(`Time elapsed: ${elapsed.toFixed(1)}s`);
  console.log(`Average rate: ${(totalUpdated / elapsed).toFixed(1)} pages/sec`);
}

// Parse CLI arguments
function parseArgs(): { limit: number; batchSize: number } {
  const args = process.argv.slice(2);
  let limit = 0;
  let batchSize = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
    if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { limit, batchSize };
}

// Run
const options = parseArgs();
backfillNavStructure(options)
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
