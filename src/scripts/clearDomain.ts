#!/usr/bin/env ts-node
/**
 * Clear all pages for a specific domain from the a-crawler database
 *
 * Usage:
 *   ts-node src/scripts/clearDomain.ts visionflooringaz.com
 */

import { pool, testConnection, closePool } from '../config/database';

async function clearDomain(domain: string): Promise<void> {
  console.log(`\n🗑️  Clearing all pages for domain: ${domain}\n`);

  try {
    // Test connection
    await testConnection();

    // Count pages to delete
    const [countRows] = await pool.execute(
      'SELECT COUNT(*) as total FROM crawler_pages WHERE final_url LIKE ?',
      [`%${domain}%`]
    );
    const total = (countRows as any)[0].total;

    console.log(`Found ${total} pages to delete\n`);

    if (total === 0) {
      console.log('✅ No pages found - domain already clean\n');
      return;
    }

    // Delete pages
    const [result] = await pool.execute(
      'DELETE FROM crawler_pages WHERE final_url LIKE ?',
      [`%${domain}%`]
    );

    console.log(`✅ Deleted ${(result as any).affectedRows} pages\n`);

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    throw error;
  } finally {
    await closePool();
  }
}

// Parse command line arguments
const domain = process.argv[2];

if (!domain) {
  console.error('\n❌ Error: Domain required\n');
  console.error('Usage:');
  console.error('  ts-node src/scripts/clearDomain.ts <domain>\n');
  console.error('Example:');
  console.error('  ts-node src/scripts/clearDomain.ts visionflooringaz.com\n');
  process.exit(1);
}

// Run
clearDomain(domain).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
