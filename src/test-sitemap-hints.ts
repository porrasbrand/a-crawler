/**
 * Test Sitemap Type Hint Extraction
 *
 * Verifies that sitemap parser correctly extracts page type hints
 * from sitemap filenames (post-sitemap.xml, page-sitemap.xml, etc)
 */

import { parseMultipleSitemaps, extractSitemapTypeHint } from './parsers/sitemapParser';

async function testSitemapHints() {
  console.log('🧪 Testing Sitemap Type Hint Extraction\n');

  // Test 1: Type hint extraction from various filenames
  console.log('=== Test 1: extractSitemapTypeHint() ===\n');

  const testCases = [
    'https://www.infiniskin.com/post-sitemap.xml',
    'https://www.infiniskin.com/post-sitemap2.xml',
    'https://www.infiniskin.com/page-sitemap.xml',
    'https://www.infiniskin.com/category-sitemap.xml',
    'https://www.infiniskin.com/tag-sitemap.xml',
    'https://www.infiniskin.com/product-sitemap.xml',
    'https://www.infiniskin.com/sitemap-posts.xml',
    'https://www.infiniskin.com/sitemap-pages.xml',
    'https://www.infiniskin.com/sitemap_index.xml',
    'https://example.com/blog-sitemap.xml',
    'https://example.com/news-sitemap.xml',
  ];

  testCases.forEach(url => {
    const hint = extractSitemapTypeHint(url);
    console.log(`${url.padEnd(60)} → ${hint || '(no hint)'}`);
  });

  // Test 2: Parse real sitemap and show distribution
  console.log('\n=== Test 2: Parse InfiniSkin Sitemaps ===\n');

  const sitemaps = [
    'https://www.infiniskin.com/sitemap_index.xml'
  ];

  try {
    const urls = await parseMultipleSitemaps(sitemaps);

    // Group by type hint
    const typeHintCounts = new Map<string, number>();
    urls.forEach(entry => {
      const hint = entry.typeHint || 'no-hint';
      typeHintCounts.set(hint, (typeHintCounts.get(hint) || 0) + 1);
    });

    console.log('\n📊 Type Hint Distribution:');
    console.log('─'.repeat(50));

    // Sort by count descending
    const sorted = Array.from(typeHintCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    sorted.forEach(([hint, count]) => {
      const percentage = ((count / urls.length) * 100).toFixed(1);
      console.log(`  ${hint.padEnd(20)} ${count.toString().padStart(5)} (${percentage}%)`);
    });

    console.log('─'.repeat(50));
    console.log(`  Total URLs: ${urls.length}`);

    // Show sample URLs for each hint type
    console.log('\n📋 Sample URLs by Type Hint:');
    sorted.forEach(([hint, count]) => {
      const samples = urls.filter(e => (e.typeHint || 'no-hint') === hint).slice(0, 3);
      console.log(`\n  ${hint} (${count} total):`);
      samples.forEach(sample => {
        console.log(`    - ${sample.url}`);
      });
      if (count > 3) {
        console.log(`    ... and ${count - 3} more`);
      }
    });

  } catch (error) {
    console.error('❌ Failed to parse sitemaps:', (error as Error).message);
    process.exit(1);
  }

  console.log('\n✅ Test complete!\n');
}

testSitemapHints()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
