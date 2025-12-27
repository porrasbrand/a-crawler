# A-Crawler: Self-Hosted Website Crawler

A standalone, self-hosted website crawler built with Node.js, TypeScript, and Crawlee. Accepts sitemap XMLs, crawls pages, extracts high-quality Markdown content, handles redirects/deduplication, and stores results in MySQL.

## Features

- **Sitemap-driven crawling** - Parse sitemap.xml files to discover URLs
- **Smart deduplication** - Normalizes URLs and tracks redirects to avoid duplicates
- **Redirect tracking** - Stores full redirect chains for analysis
- **MySQL storage** - Clean schema with safe upsert logic
- **Fast HTTP crawling** - Uses CheerioCrawler (Phase 1) with Playwright escalation planned
- **CLI interface** - Simple command-line tool for running crawls
- **Structured logging** - Pino logger with pretty output

## Current Status: Phase 1

✅ **Implemented:**
- Sitemap XML parsing
- URL normalization and deduplication
- CheerioCrawler integration
- Raw HTML storage
- Redirect chain tracking
- MySQL database integration
- CLI interface
- Structured logging

🚧 **In Progress:**
- Content extraction and Markdown conversion (Phase 2)
- Soft-404 detection (Phase 3)
- Domain-specific overrides (Phase 3)
- Playwright fallback for JS-heavy sites (Phase 3)

## Prerequisites

- **Node.js** 16+ (recommended: 20+)
- **MySQL** 8.0+
- **Git** (for cloning)

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up MySQL Database

Create the database and tables:

```bash
# Using mysql command line
mysql -u loco -p < src/db/schema.sql

# Or using the npm script
npm run db:setup
```

This creates:
- Database: `crawler_db`
- Tables: `crawler_pages`, `url_aliases`, `crawl_runs`, `domain_overrides`

### 3. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your MySQL credentials (default values are already set):

```bash
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=loco
MYSQL_PASSWORD=Probandolo901!
MYSQL_DATABASE=crawler_db
```

## Quick Start - Automated Pipeline

**Easiest way:** Run the complete workflow with a single command from the root directory:

```bash
cd /home/ubuntu/awsc-new/awesome
npm run pipeline -- https://example.com/sitemap.xml
```

This automatically handles crawling, ingestion, and all analysis phases!

See the [main README](../README.md) for all pipeline options.

## Complete Workflow: Crawl → Analyze (Manual)

### 1. Crawl the Site (a-crawler)

```bash
cd /home/ubuntu/awsc-new/awesome/a-crawler
npm run crawl -- --sitemap https://example.com/sitemap.xml
```

Example with real sitemap:
```bash
npm run crawl -- --sitemap https://1stchoiceplumbingheatingandairconditioning.com/sitemap_index.xml
```

### 2. Ingest Crawl Data (seo-processor-worker)

After the crawl completes, switch to the seo-processor-worker directory and ingest the data:

```bash
cd /home/ubuntu/awsc-new/awesome/seo-processor-worker
npm run ingest:acrawler
```

This will:
- Auto-detect the latest crawl from MySQL a-crawler database
- Detect the domain automatically
- Create/find the site in the database
- Create a new crawl with an auto-increment ID (e.g., 1005, 1006, etc.)
- Import all pages, links, and headings
- Resolve internal links
- Give you a **crawl ID** to use for the next steps

### 3. Run Analysis Phases (seo-processor-worker)

After ingestion completes, run the analysis phases using the crawl ID:

```bash
# Phase 4 - SQL Aggregation (basic metrics, link depth, SEO issues)
npm run analyze -- <crawlId> --phase4

# Phase 5 - AI Analysis (AI Classifier + Silo Builder + Hub Detection)
npm run analyze -- <crawlId> --phase5

# Phase 6 - Link Opportunities (semantic matching + LLM anchor suggestions)
npm run analyze -- <crawlId> --phase6
```

You can also run them all sequentially or just the phases you need!

## Usage

### Basic Crawl

```bash
npm run crawl -- --sitemap https://example.com/sitemap.xml
```

### With Options

```bash
npm run crawl -- \
  --sitemap https://example.com/sitemap.xml \
  --max-pages 5000 \
  --debug
```

### Multiple Sitemaps

```bash
npm run crawl -- \
  --sitemap https://example.com/sitemap.xml \
  --sitemap https://example.com/sitemap2.xml
```

### Dry Run (Parse Only)

Test sitemap parsing without crawling:

```bash
npm run crawl -- --sitemap https://example.com/sitemap.xml --dry-run
```

### Recrawl Existing Pages

Force recrawl of pages that already exist in database:

```bash
npm run crawl -- --sitemap https://example.com/sitemap.xml --recrawl
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --sitemap <urls...>` | Sitemap XML URL(s) (required) | - |
| `-m, --max-pages <number>` | Maximum pages to crawl | 10000 |
| `-f, --fetch-mode <mode>` | Fetch mode: cheerio or playwright | cheerio |
| `-d, --debug` | Enable debug logging | false |
| `--dry-run` | Parse sitemap without crawling | false |
| `--recrawl` | Force recrawl of existing pages | false |

## Output

After crawling, you'll see a summary like this:

```
============================================================
✅ Crawl Complete
============================================================
Run ID: 550e8400-e29b-41d4-a716-446655440000

📊 Statistics:
  • Total URLs discovered:  1,247
  • Pages crawled:          1,089
  • Pages skipped (dupes):    45
  • Redirects:               142
  • Errors:                    2

⏱  Duration: 8m 23s
💾  Database: crawler_db
============================================================
```

## Database Schema

### crawler_pages
Stores canonical pages (deduplicated by `final_url`):
- Raw HTML content
- Metadata (title, H1, status code)
- Crawl status enum
- Redirect chain (JSON)
- Content hash for change detection

### url_aliases
Tracks all discovered URLs that redirect to canonical pages:
- Maps requested_url → final_url
- Stores full redirect chain
- Tracks first/last seen timestamps

### crawl_runs
Tracks crawl execution metadata:
- Run UUID
- Seed sitemaps
- Statistics (pages crawled, redirects, errors)
- Start/finish timestamps

### domain_overrides
Per-domain extraction configuration (for future Phase 3):
- Custom CSS selectors
- Force fetch mode (cheerio vs playwright)
- Enabled/disabled flag

## Querying Results

### View Recent Crawls

```sql
SELECT
  run_id,
  started_at,
  finished_at,
  total_urls_discovered,
  total_pages_crawled,
  total_redirects
FROM crawl_runs
ORDER BY started_at DESC
LIMIT 10;
```

### View Crawled Pages

```sql
SELECT
  final_url,
  title,
  status_code,
  crawl_status,
  word_count,
  last_crawled_at
FROM crawler_pages
WHERE crawl_status = 'OK'
ORDER BY last_crawled_at DESC
LIMIT 20;
```

### Find Redirect Chains

```sql
SELECT
  requested_url,
  final_url,
  redirect_chain
FROM url_aliases
WHERE JSON_LENGTH(redirect_chain) > 2
LIMIT 20;
```

## Architecture

```
src/
├── index.ts                 # CLI entry point
├── config/
│   ├── database.ts          # MySQL connection pool
│   └── constants.ts         # Global constants
├── core/
│   ├── crawler.ts           # Crawlee orchestration
│   └── urlNormalizer.ts     # URL normalization (critical!)
├── db/
│   ├── schema.sql           # MySQL table definitions
│   └── queries.ts           # Database queries
├── parsers/
│   └── sitemapParser.ts     # Sitemap XML parsing
├── utils/
│   ├── hash.ts              # MD5 content hashing
│   └── logger.ts            # Pino structured logging
└── types/
    ├── database.types.ts    # DB interfaces
    └── crawl.types.ts       # Crawl types
```

## Key Design Principles

1. **Correctness over speed** - Get it right, then optimize
2. **URL normalization is critical** - All deduplication depends on it
3. **Safe upserts** - Only update content when hash changes
4. **Full traceability** - Store extraction method, fetch mode, errors
5. **Deterministic crawls** - Same input = same output

## Development

### Build TypeScript

```bash
npm run build
```

### Run Compiled Version

```bash
npm start -- --sitemap https://example.com/sitemap.xml
```

### Watch Mode (with nodemon)

```bash
npx nodemon --exec ts-node src/index.ts -- --sitemap https://example.com/sitemap.xml --debug
```

## Troubleshooting

### Database Connection Failed

Check your MySQL credentials in `.env` and ensure MySQL is running:

```bash
mysql -u loco -p
```

### No URLs Found in Sitemap

Verify the sitemap URL is accessible:

```bash
curl https://example.com/sitemap.xml
```

### Pages Not Being Crawled

Check if pages already exist in database. Use `--recrawl` to force:

```bash
npm run crawl -- --sitemap https://example.com/sitemap.xml --recrawl
```

## Roadmap

### Phase 2: Content Extraction (Coming Soon)
- Main content isolation with Readability
- HTML → Markdown conversion with Turndown
- Metadata extraction (title, H1, meta description)
- Word count and content hashing

### Phase 3: Quality & Edge Cases
- Soft-404 detection
- Domain-specific configuration overrides
- Playwright fallback for JS-heavy sites
- Boilerplate removal and cleanup

### Phase 4: Production Hardening
- Enhanced logging and metrics
- Retry logic for transient failures
- Progress bar for crawls
- Comprehensive documentation

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.

---

**Built with:**
- [Crawlee](https://crawlee.dev) - Web scraping and crawling framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [MySQL](https://www.mysql.com/) - Relational database
- [Pino](https://getpino.io/) - Fast structured logging
- [Commander.js](https://github.com/tj/commander.js/) - CLI framework
