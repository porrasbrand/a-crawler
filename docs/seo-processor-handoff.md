# SEO Processor Integration Handoff

**Document Version:** 1.0
**Last Updated:** 2025-12-16
**Purpose:** Guide the SEO processor worker to extract and process crawl data from the a-crawler database

---

## Table of Contents
1. [Overview](#overview)
2. [Database Connection](#database-connection)
3. [Database Schema](#database-schema)
4. [Most Recent Crawl](#most-recent-crawl)
5. [Data Extraction Queries](#data-extraction-queries)
6. [Schema Mapping Guide](#schema-mapping-guide)
7. [Processing Recommendations](#processing-recommendations)

---

## Overview

### A-Crawler (This System)
- **Location:** `/home/ubuntu/awsc-new/awesome/a-crawler`
- **Purpose:** Sitemap-based website crawler that extracts and stores page content
- **Database:** MySQL 8.0+ (`crawler_db`)
- **Key Features:**
  - Sitemap parsing and URL discovery
  - Redirect chain tracking and deduplication
  - Content extraction (HTML, clean HTML, markdown)
  - Metadata extraction (title, h1, description, word count)
  - Multi-run tracking with UUIDs

### SEO Processor Worker (Target System)
- **Location:** `/home/ubuntu/awsc-new/awesome/seo-processor-worker`
- **Purpose:** SEO analysis and internal link opportunity discovery
- **Database:** Supabase PostgreSQL
- **Expected Input:** Page data, links, headings for SEO analysis

---

## Database Connection

### Connection Details
```javascript
const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'loco',
  password: process.env.MYSQL_PASSWORD || 'Probandolo901!',
  database: process.env.MYSQL_DATABASE || 'crawler_db',
};
```

### Environment Variables (.env)
```bash
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=loco
MYSQL_PASSWORD=Probandolo901!
MYSQL_DATABASE=crawler_db
```

### Connection Example (Node.js)
```javascript
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'loco',
  password: process.env.MYSQL_PASSWORD || 'Probandolo901!',
  database: process.env.MYSQL_DATABASE || 'crawler_db',
});
```

---

## Database Schema

### Table: `crawler_pages`
**Primary table containing all crawled page data**

| Column | Type | Description |
|--------|------|-------------|
| `id` | INT AUTO_INCREMENT | Primary key |
| `final_url` | VARCHAR(768) UNIQUE | Normalized final URL after redirects (canonical) |
| `requested_url_original` | TEXT | Original URL as requested |
| `status_code` | INT | HTTP status code |
| `crawl_status` | ENUM | One of: 'OK', 'REDIRECT_ALIAS', 'NOT_FOUND', 'SOFT_404', 'ERROR' |
| `redirect_chain` | JSON | Full redirect path as array |
| `html_content` | LONGTEXT | Raw HTML from response |
| `clean_html` | LONGTEXT | Cleaned HTML after DOM processing |
| `markdown` | LONGTEXT | Extracted markdown content |
| `title` | VARCHAR(500) | Page title |
| `h1` | VARCHAR(500) | First H1 heading |
| `meta_description` | TEXT | Meta description |
| `word_count` | INT | Word count of main content |
| `content_hash` | VARCHAR(32) | MD5 hash for change detection |
| `fetch_mode` | ENUM | 'cheerio' or 'playwright' |
| `extraction_method` | VARCHAR(50) | Method used (readability, semantic, etc.) |
| `junk_score` | FLOAT | Quality score (lower is better) |
| `last_crawled_at` | TIMESTAMP | Last successful crawl time |
| `last_error` | TEXT | Last error message if failed |
| `run_id` | VARCHAR(36) | UUID of crawl run |

### Table: `url_aliases`
**Tracks all discovered URLs that map to canonical pages**

| Column | Type | Description |
|--------|------|-------------|
| `requested_url` | VARCHAR(768) PRIMARY KEY | The URL as requested |
| `final_url` | VARCHAR(768) | Final URL after redirects |
| `status_code` | INT | HTTP status code |
| `redirect_chain` | JSON | Full redirect path |
| `first_seen_at` | TIMESTAMP | First discovery time |
| `last_seen_at` | TIMESTAMP | Last seen time |
| `run_id` | VARCHAR(36) | Most recent run that saw this alias |

### Table: `crawl_runs`
**Tracks crawl execution metadata**

| Column | Type | Description |
|--------|------|-------------|
| `run_id` | VARCHAR(36) PRIMARY KEY | UUID for this crawl run |
| `seed_sitemaps` | JSON | Array of sitemap URLs used as seeds |
| `max_pages` | INT | Maximum pages limit for this run |
| `fetch_mode_default` | ENUM | 'cheerio' or 'playwright' |
| `started_at` | TIMESTAMP | Run start time |
| `finished_at` | TIMESTAMP | Run completion time |
| `total_urls_discovered` | INT | Total URLs found in sitemaps |
| `total_pages_crawled` | INT | Total pages successfully crawled |
| `total_redirects` | INT | Total redirects encountered |
| `total_errors` | INT | Total errors encountered |
| `notes` | TEXT | Optional notes about this run |

### Table: `domain_overrides`
**Per-domain configuration overrides (optional)**

| Column | Type | Description |
|--------|------|-------------|
| `domain` | VARCHAR(255) PRIMARY KEY | Domain name |
| `enabled` | BOOLEAN | Whether override is active |
| `main_content_selectors` | JSON | CSS selectors for main content |
| `remove_selectors` | JSON | CSS selectors to remove |
| `force_fetch_mode` | ENUM | Force specific crawler mode |
| `notes` | TEXT | Documentation |
| `updated_at` | TIMESTAMP | Last update time |

---

## Most Recent Crawl

### Latest Crawl Details
**Run ID:** `5ad1a11e-7b57-4bec-90ff-5bc442508f97`
**Sitemap:** https://www.infiniskin.com/sitemap_index.xml
**Started:** 2025-12-16 15:43:17 UTC
**Finished:** 2025-12-16 16:00:13 UTC
**Duration:** ~17 minutes

### Crawl Statistics
- Total URLs discovered: **1,568**
- Successfully crawled: **1,566 pages**
- Redirects handled: **3**
- Errors encountered: **2**
- Success rate: **99.87%**

### Error Pages
Two pages failed due to redirect loops (10+ redirects):
1. `https://www.infiniskin.com/posts/radio-frequency-fat-reduction-vs-coolsculpting`
2. `https://www.infiniskin.com/posts/fully-ablative-laser-resurfacing-what-expect`

---

## Data Extraction Queries

### Get Latest Crawl Run
```sql
SELECT * FROM crawl_runs
ORDER BY started_at DESC
LIMIT 1;
```

### Get All Successfully Crawled Pages from Latest Run
```sql
SELECT
  id,
  final_url,
  requested_url_original,
  status_code,
  crawl_status,
  title,
  h1,
  meta_description,
  word_count,
  markdown,
  html_content,
  clean_html,
  content_hash,
  fetch_mode,
  extraction_method,
  junk_score,
  last_crawled_at
FROM crawler_pages
WHERE run_id = '5ad1a11e-7b57-4bec-90ff-5bc442508f97'
  AND crawl_status = 'OK'
ORDER BY id;
```

### Get Pages with Pagination
```sql
-- Batch 1 (first 100 pages)
SELECT * FROM crawler_pages
WHERE run_id = '5ad1a11e-7b57-4bec-90ff-5bc442508f97'
  AND crawl_status = 'OK'
ORDER BY id
LIMIT 100 OFFSET 0;

-- Batch 2 (next 100 pages)
SELECT * FROM crawler_pages
WHERE run_id = '5ad1a11e-7b57-4bec-90ff-5bc442508f97'
  AND crawl_status = 'OK'
ORDER BY id
LIMIT 100 OFFSET 100;
```

### Get Redirect Mappings for Latest Run
```sql
SELECT
  requested_url,
  final_url,
  status_code,
  redirect_chain
FROM url_aliases
WHERE run_id = '5ad1a11e-7b57-4bec-90ff-5bc442508f97'
  AND JSON_LENGTH(redirect_chain) > 0
ORDER BY last_seen_at DESC;
```

### Get Pages by Crawl Status
```sql
SELECT
  crawl_status,
  COUNT(*) as count,
  AVG(word_count) as avg_word_count
FROM crawler_pages
WHERE run_id = '5ad1a11e-7b57-4bec-90ff-5bc442508f97'
GROUP BY crawl_status;
```

### Get Error Pages with Details
```sql
SELECT
  id,
  final_url,
  requested_url_original,
  crawl_status,
  last_error,
  last_crawled_at
FROM crawler_pages
WHERE run_id = '5ad1a11e-7b57-4bec-90ff-5bc442508f97'
  AND crawl_status = 'ERROR'
ORDER BY last_crawled_at DESC;
```

---

## Schema Mapping Guide

### A-Crawler → SEO Processor Field Mapping

The SEO processor expects data in Supabase format. Here's how to map fields:

#### Page Data Mapping

| A-Crawler Field | SEO Processor Field | Transformation |
|-----------------|---------------------|----------------|
| `final_url` | `url` | Direct mapping |
| `final_url` | `normalized_url` | Normalize (lowercase, remove trailing slash) |
| `final_url` | `url_hash` | MD5 hash of normalized_url |
| `requested_url_original` | `requested_url` | Direct mapping |
| `final_url` | `final_url` | Direct mapping |
| `requested_url_original != final_url` | `redirect_detected` | Boolean comparison |
| `title` | `title` | Direct mapping |
| `meta_description` | `description` | Direct mapping |
| `h1` | `h1` | Direct mapping |
| N/A | `canonical_url` | Extract from HTML `<link rel="canonical">` |
| N/A | `language_code` | Extract from HTML `<html lang>` or `<meta>` |
| `status_code` | `http_status` | Direct mapping |
| N/A | `depth` | Calculate from URL path segments |
| N/A | `load_time_ms` | Not available (set null) |
| `crawl_status = 'OK'` | `is_crawled` | Boolean: true if OK |
| `status_code = 200 AND no noindex` | `is_indexable` | Check robots meta tag |
| `markdown` | `markdown` | Direct mapping |
| N/A | `html_url` | Set to null or store HTML separately |
| `html_content` | `html_content` | Direct mapping |
| `crawl_status = 'OK' ? 'success' : 'failed'` | `html_fetch_status` | Map enum |
| `word_count` | `word_count` | Direct mapping |
| N/A | `page_type` | Classify based on URL patterns |
| `h1 != null` | `has_h1` | Boolean |
| Count H1 tags in HTML | `has_multiple_h1` | Boolean |
| Extract from HTML | `og_image_url` | Parse `<meta property="og:image">` |
| Extract from HTML | `raw_json_ld` | Parse `<script type="application/ld+json">` |
| `content_hash` | `content_hash` | Direct mapping |
| `fetch_mode` | N/A | Not used in SEO processor |
| `extraction_method` | N/A | Not used in SEO processor |
| `run_id` | `crawl_id` | Map to crawl_id (needs lookup/creation) |

### Additional Data to Extract from HTML

The crawler stores `html_content` which you'll need to parse for:

1. **Links** - Extract all `<a>` tags:
   - `href` → target_url
   - anchor text
   - context (surrounding text)
   - link type (text/image/button)
   - location (main/nav/footer/aside)
   - rel attribute
   - target attribute

2. **Headings** - Extract all `<h1>` through `<h6>`:
   - level (1-6)
   - text content
   - position index

3. **Open Graph** - Extract meta tags:
   - `og:title`
   - `og:description`
   - `og:image`
   - `og:type`

4. **Structured Data** - Extract JSON-LD:
   - Parse `<script type="application/ld+json">` blocks

---

## Processing Recommendations

### Step-by-Step Processing Flow

1. **Identify Latest Crawl Run**
   ```javascript
   const [runs] = await connection.execute(
     'SELECT * FROM crawl_runs ORDER BY started_at DESC LIMIT 1'
   );
   const latestRun = runs[0];
   ```

2. **Extract Pages in Batches**
   ```javascript
   const BATCH_SIZE = 100;
   let offset = 0;
   let hasMore = true;

   while (hasMore) {
     const [pages] = await connection.execute(
       `SELECT * FROM crawler_pages
        WHERE run_id = ? AND crawl_status = 'OK'
        ORDER BY id LIMIT ? OFFSET ?`,
       [latestRun.run_id, BATCH_SIZE, offset]
     );

     if (pages.length === 0) {
       hasMore = false;
       break;
     }

     // Process batch
     await processBatch(pages);

     offset += BATCH_SIZE;
   }
   ```

3. **Parse HTML Content**
   ```javascript
   const cheerio = require('cheerio');

   function extractAdditionalData(htmlContent) {
     const $ = cheerio.load(htmlContent);

     return {
       canonicalUrl: $('link[rel="canonical"]').attr('href'),
       languageCode: $('html').attr('lang') || $('meta[http-equiv="content-language"]').attr('content'),
       ogImage: $('meta[property="og:image"]').attr('content'),
       links: extractLinks($),
       headings: extractHeadings($),
       jsonLd: extractJsonLd($),
       hasMultipleH1: $('h1').length > 1,
       robotsMeta: $('meta[name="robots"]').attr('content'),
     };
   }
   ```

4. **Transform and Insert into Supabase**
   ```javascript
   async function transformAndInsert(crawlerPage, additionalData) {
     const page = {
       crawl_id: getCrawlId(crawlerPage.run_id), // Map or create
       url: crawlerPage.final_url,
       normalized_url: normalizeUrl(crawlerPage.final_url),
       url_hash: md5(normalizeUrl(crawlerPage.final_url)),
       requested_url: crawlerPage.requested_url_original,
       final_url: crawlerPage.final_url,
       redirect_detected: crawlerPage.requested_url_original !== crawlerPage.final_url,
       title: crawlerPage.title,
       description: crawlerPage.meta_description,
       h1: crawlerPage.h1,
       canonical_url: additionalData.canonicalUrl,
       language_code: additionalData.languageCode,
       http_status: crawlerPage.status_code,
       depth: calculateDepth(crawlerPage.final_url),
       load_time_ms: null,
       is_crawled: true,
       is_indexable: isIndexable(crawlerPage, additionalData),
       markdown: crawlerPage.markdown,
       html_url: null,
       html_content: crawlerPage.html_content,
       html_fetch_status: 'success',
       word_count: crawlerPage.word_count,
       page_type: classifyPageType(crawlerPage.final_url),
       has_h1: crawlerPage.h1 != null,
       has_multiple_h1: additionalData.hasMultipleH1,
       og_image_url: additionalData.ogImage,
       raw_json_ld: additionalData.jsonLd,
       content_hash: crawlerPage.content_hash,
     };

     await insertPage(page);

     // Insert related data
     if (additionalData.links.length > 0) {
       await insertLinks(page.id, additionalData.links);
     }
     if (additionalData.headings.length > 0) {
       await insertHeadings(page.id, additionalData.headings);
     }
   }
   ```

### Helper Functions

```javascript
const crypto = require('crypto');

function normalizeUrl(url) {
  let normalized = url.toLowerCase().trim();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function calculateDepth(url) {
  const urlObj = new URL(url);
  const pathSegments = urlObj.pathname.split('/').filter(s => s.length > 0);
  return pathSegments.length;
}

function isIndexable(page, additionalData) {
  if (page.status_code !== 200) return false;
  if (additionalData.robotsMeta) {
    return !additionalData.robotsMeta.toLowerCase().includes('noindex');
  }
  return true;
}

function classifyPageType(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('/blog/') || urlLower.includes('/posts/')) return 'blog';
  if (urlLower.includes('/product/') || urlLower.includes('/products/')) return 'product';
  if (urlLower.includes('/category/') || urlLower.includes('/categories/')) return 'category';
  if (urlLower.match(/\/$/) || urlLower.endsWith('/index.html')) return 'homepage';
  return 'page';
}
```

### Error Handling

```javascript
async function processBatch(pages) {
  const results = {
    success: 0,
    failed: 0,
    errors: []
  };

  for (const page of pages) {
    try {
      const additionalData = extractAdditionalData(page.html_content);
      await transformAndInsert(page, additionalData);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        pageId: page.id,
        url: page.final_url,
        error: error.message
      });
      console.error(`Failed to process page ${page.id}:`, error);
    }
  }

  console.log(`Batch processed: ${results.success} success, ${results.failed} failed`);
  return results;
}
```

---

## Additional Notes

### Data Quality Considerations

1. **Content Extraction Quality**
   - `junk_score`: Lower is better. Consider filtering pages with high junk scores.
   - `extraction_method`: Indicates how content was extracted. 'readability' is usually highest quality.

2. **Redirect Handling**
   - Always use `final_url` as the canonical identifier
   - `url_aliases` table contains all redirect mappings
   - Check `redirect_chain` for multi-hop redirects

3. **Error Handling**
   - Pages with `crawl_status = 'ERROR'` should be skipped
   - Check `last_error` field for error details
   - Consider retrying failed pages separately

### Performance Tips

1. **Batch Processing**
   - Process pages in batches of 50-100 to balance memory and performance
   - Use transactions for bulk inserts to Supabase

2. **HTML Parsing**
   - Consider caching parsed HTML to avoid re-parsing
   - Use streaming for large HTML content

3. **Database Queries**
   - Add indexes on frequently queried fields
   - Use `SELECT` with specific columns instead of `SELECT *`

### Contact & Support

For questions about the crawler data structure or processing:
- Crawler location: `/home/ubuntu/awsc-new/awesome/a-crawler`
- Database: `crawler_db` on localhost MySQL
- Latest crawl run ID: `5ad1a11e-7b57-4bec-90ff-5bc442508f97`

---

**End of Document**
