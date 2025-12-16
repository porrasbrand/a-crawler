# Self-Hosted Website Crawler - Implementation Plan

## Executive Summary

**Goal:** Build a standalone, self-hosted website crawler that accepts sitemap XMLs, crawls pages, extracts high-quality Markdown content, handles redirects/deduplication, and stores results in a local MySQL database.

**Key Decisions:**
- ✅ **Standalone service** in `/a-crawler/` (independent from seo-processor-worker)
- ✅ **MySQL database** (localhost:3306, create new `crawler_db`)
- ✅ **New clean schema** following docs/crawler-plan.md specifications
- ✅ **Full feature set**: Sitemap parsing, Crawlee (HTTP+Browser), content extraction, domain overrides

---

## Architecture Overview

### Technology Stack
- **Runtime:** Node.js + TypeScript
- **Crawling:** Crawlee (CheerioCrawler + PlaywrightCrawler)
- **Database:** MySQL 8.0+ (localhost)
- **Content Extraction:** @mozilla/readability + jsdom
- **Markdown:** Turndown with custom rules
- **CLI:** Commander.js
- **Logging:** Pino (structured logging)

### Database Connection
```
Host: localhost
Port: 3306
User: loco
Password: Probandolo901!
Database: crawler_db (to be created)
```

---

## Project Structure

```
/home/ubuntu/awsc-new/awesome/a-crawler/
├── src/
│   ├── index.ts                      # CLI entry point
│   ├── config/
│   │   ├── database.ts               # MySQL connection pool
│   │   ├── constants.ts              # Tracking params, thresholds
│   │   └── domainOverrides.ts        # Domain config loader
│   ├── core/
│   │   ├── crawler.ts                # Crawlee orchestration
│   │   ├── urlNormalizer.ts          # URL normalization
│   │   ├── redirectHandler.ts        # Redirect chain tracking
│   │   └── deduplicator.ts           # Deduplication logic
│   ├── extraction/
│   │   ├── contentExtractor.ts       # Main content isolation
│   │   ├── htmlCleaner.ts            # DOM cleanup
│   │   ├── markdownConverter.ts      # Turndown with rules
│   │   └── soft404Detector.ts        # Soft-404 detection
│   ├── parsers/
│   │   ├── sitemapParser.ts          # Sitemap XML parsing
│   │   └── metadataExtractor.ts      # Title, H1, meta
│   ├── db/
│   │   ├── schema.sql                # MySQL table definitions
│   │   ├── queries.ts                # Safe upsert queries
│   │   └── migrations.ts             # DB setup script
│   ├── services/
│   │   ├── crawlManager.ts           # Crawl lifecycle
│   │   └── domainConfigService.ts    # Domain CRUD
│   ├── utils/
│   │   ├── hash.ts                   # MD5 content hashing
│   │   ├── logger.ts                 # Structured logging
│   │   └── validators.ts             # URL validation
│   └── types/
│       ├── database.types.ts         # DB interfaces
│       ├── crawl.types.ts            # Crawl types
│       └── extraction.types.ts       # Extraction types
├── docs/                             # Already exists
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## Database Schema (MySQL)

### Tables to Create

#### 1. crawler_pages (Canonical pages)
```sql
CREATE TABLE crawler_pages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  final_url VARCHAR(2048) NOT NULL UNIQUE,
  requested_url_original TEXT,
  status_code INT,
  crawl_status ENUM('OK', 'REDIRECT_ALIAS', 'NOT_FOUND', 'SOFT_404', 'ERROR'),
  redirect_chain JSON,
  html_content LONGTEXT,
  clean_html LONGTEXT,
  markdown LONGTEXT,
  title VARCHAR(500),
  h1 VARCHAR(500),
  meta_description TEXT,
  word_count INT DEFAULT 0,
  content_hash VARCHAR(32),
  fetch_mode ENUM('cheerio', 'playwright'),
  extraction_method VARCHAR(50),
  junk_score FLOAT,
  last_crawled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  run_id VARCHAR(36),
  INDEX idx_final_url (final_url(255)),
  INDEX idx_crawl_status (crawl_status),
  INDEX idx_run_id (run_id)
);
```

#### 2. url_aliases (Redirect mapping)
```sql
CREATE TABLE url_aliases (
  requested_url VARCHAR(2048) PRIMARY KEY,
  final_url VARCHAR(2048) NOT NULL,
  status_code INT,
  redirect_chain JSON,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  run_id VARCHAR(36)
);
```

#### 3. crawl_runs (Crawl tracking)
```sql
CREATE TABLE crawl_runs (
  run_id VARCHAR(36) PRIMARY KEY,
  seed_sitemaps JSON NOT NULL,
  max_pages INT,
  fetch_mode_default ENUM('cheerio', 'playwright') DEFAULT 'cheerio',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  total_urls_discovered INT DEFAULT 0,
  total_pages_crawled INT DEFAULT 0,
  notes TEXT
);
```

#### 4. domain_overrides (Per-domain config)
```sql
CREATE TABLE domain_overrides (
  domain VARCHAR(255) PRIMARY KEY,
  enabled BOOLEAN DEFAULT TRUE,
  main_content_selectors JSON,
  remove_selectors JSON,
  force_fetch_mode ENUM('cheerio', 'playwright'),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## Core Implementation Logic

### 1. URL Normalization (CRITICAL)
- Normalize BEFORE enqueue AND AFTER fetch
- Rules: lowercase host, strip fragments, remove tracking params, sort query params
- **Identity = normalized final_url** (all deduplication uses this)

### 2. Crawling Strategy
- Default: **CheerioCrawler** (fast, 10-20 pages/sec)
- Escalate to **PlaywrightCrawler** when:
  - Domain override specifies playwright
  - Content extraction yields <50 words
  - JS framework markers detected

### 3. Content Extraction Pipeline
Priority order:
1. Check `domain_overrides` table for custom selectors
2. Try @mozilla/readability (mark as 'readability' if >100 words)
3. Try semantic HTML tags (`<article>`, `<main>`)
4. Try CMS patterns (`.entry-content`, `.post-content`)
5. Full body with aggressive nav/header/footer removal

### 4. Redirect Handling
- Crawlee auto-follows redirects
- Store full chain: `[url1, url2, final_url]`
- Create entries in both `crawler_pages` (final_url) and `url_aliases` (each step)

### 5. Safe Upserts (Hash-Based)
- Only update content when `content_hash` (MD5) changes
- Prevents accidental data loss from extraction failures
- Reference: `docs/sql-upserts.md`

---

## CLI Interface

### Basic Usage
```bash
# Install dependencies
npm install

# Create database
mysql -u loco -p < src/db/schema.sql

# Run crawler
npm run crawl -- --sitemap https://example.com/sitemap.xml

# With options
npm run crawl -- \
  --sitemap https://example.com/sitemap.xml \
  --max-pages 5000 \
  --debug
```

### CLI Flags
- `--sitemap <url>` (required): Sitemap XML URL(s)
- `--max-pages <n>`: Maximum pages to crawl (default: 10000)
- `--fetch-mode <mode>`: Default mode - cheerio|playwright (default: cheerio)
- `--debug`: Enable verbose logging
- `--dry-run`: Parse sitemap without crawling
- `--recrawl`: Force recrawl of existing pages

---

## Implementation Phases

### Phase 1: Foundations (Priority 1)
**Goal:** Basic sitemap crawling + HTML storage

**Files to Create:**
- `src/config/database.ts` - MySQL connection pool
- `src/core/urlNormalizer.ts` - URL normalization (adapt from seo-processor-worker)
- `src/parsers/sitemapParser.ts` - Sitemap XML parsing
- `src/core/crawler.ts` - Basic CheerioCrawler setup
- `src/db/schema.sql` - Database tables
- `src/db/queries.ts` - Upsert page/alias queries
- `src/index.ts` - CLI with Commander.js
- `package.json` - Dependencies
- `.env.example` - Environment template

**Success Criteria:**
✅ Parse sitemap.xml and extract URLs
✅ Crawl with CheerioCrawler
✅ Store raw HTML in `crawler_pages`
✅ Track redirects in `url_aliases`
✅ No duplicate pages

---

### Phase 2: Content Extraction (Priority 2)
**Goal:** Clean Markdown output

**Files to Create:**
- `src/extraction/contentExtractor.ts` - Readability integration
- `src/extraction/htmlCleaner.ts` - DOM cleanup
- `src/extraction/markdownConverter.ts` - Turndown with rules
- `src/parsers/metadataExtractor.ts` - Title, H1, meta extraction
- `src/utils/hash.ts` - MD5 content hashing

**Success Criteria:**
✅ Markdown is clean (no nav/footer)
✅ Links are absolute
✅ Headings preserved
✅ Metadata extracted (title, h1, word_count)

---

### Phase 3: Quality & Edge Cases (Priority 3)
**Goal:** Handle production scenarios

**Files to Create:**
- `src/extraction/soft404Detector.ts` - Soft-404 detection
- `src/config/domainOverrides.ts` - Load domain configs
- `src/services/domainConfigService.ts` - CRUD for overrides
- Add PlaywrightCrawler fallback to `crawler.ts`

**Success Criteria:**
✅ Soft-404s detected
✅ Domain overrides work
✅ Playwright escalation functional

---

### Phase 4: Production Hardening (Priority 4)
**Goal:** Observability and reliability

**Files to Create:**
- `src/services/crawlManager.ts` - Crawl lifecycle
- `src/utils/logger.ts` - Pino structured logging
- Enhanced CLI with all flags
- `README.md` - Usage documentation

**Success Criteria:**
✅ Structured logging
✅ Crawl statistics
✅ Debug mode
✅ Well documented

---

## Critical Files (Implement First)

### Must-Have (Week 1)
1. **src/db/schema.sql** - Database foundation
2. **src/core/urlNormalizer.ts** - Deduplication depends on this
3. **src/db/queries.ts** - Safe upsert logic
4. **src/core/crawler.ts** - Main orchestration
5. **src/index.ts** - CLI interface

### High Priority (Week 2)
6. **src/extraction/contentExtractor.ts** - Core value proposition
7. **src/extraction/markdownConverter.ts** - Markdown quality
8. **src/parsers/sitemapParser.ts** - URL intake

---

## Dependencies (package.json)

```json
{
  "dependencies": {
    "crawlee": "^3.15.3",
    "playwright": "^1.40.0",
    "cheerio": "^1.0.0-rc.12",
    "mysql2": "^3.6.5",
    "jsdom": "^23.0.1",
    "@mozilla/readability": "^0.6.0",
    "turndown": "^7.2.2",
    "commander": "^11.1.0",
    "dotenv": "^16.3.1",
    "sitemapper": "^3.2.8",
    "uuid": "^9.0.1",
    "pino": "^8.16.2",
    "pino-pretty": "^10.2.3"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "ts-node": "^10.9.2",
    "@types/node": "^20.10.5",
    "@types/jsdom": "^21.1.6",
    "@types/turndown": "^5.0.4",
    "@types/uuid": "^9.0.7"
  }
}
```

---

## Key Design Principles

1. **Correctness over speed** - Get it right, then optimize
2. **Markdown quality first** - Main content isolation is critical
3. **Traceability** - Store extraction_method, fetch_mode for debugging
4. **Safe upserts** - Only update when content hash changes
5. **Domain configurability** - Per-site overrides from day one
6. **Deterministic crawls** - Same input = same output

---

## Success Metrics

### Quality Checklist
- [ ] No navigation in Markdown
- [ ] Headings logical (H1 → H2 → H3)
- [ ] Links absolute
- [ ] Multiple redirects → 1 page
- [ ] Soft-404s detected
- [ ] Errors don't crash crawler

### Performance Targets
- CheerioCrawler: 10-20 pages/sec
- PlaywrightCrawler: 1-3 pages/sec
- Memory: <1GB for 10k pages

---

## Next Steps

1. ✅ Plan approved - ready to implement
2. Create initial project structure (`package.json`, `tsconfig.json`)
3. Set up MySQL database and schema
4. Implement Phase 1 (foundations)
5. Test on real sitemap
6. Iterate through remaining phases
