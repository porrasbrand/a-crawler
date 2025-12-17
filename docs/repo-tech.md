Below is the **second handoff technical document** your dev team can implement directly: **repo structure, TypeScript interfaces, SQL migrations, and core module contracts**.

---

# Handoff Tech Doc 2

## Repo Structure, TS Interfaces, SQL Migrations, Core Contracts

## 1) Proposed Repo Structure (Node + TypeScript)

```
crawler-md/
  README.md
  package.json
  tsconfig.json
  .env.example
  .gitignore

  src/
    cli/
      crawl.ts                 # main CLI entry: parse args, start run
      flags.ts                 # yargs/commander option definitions

    config/
      defaultConfig.ts         # defaults (timeouts, concurrency, TTL, etc.)
      domainConfig.ts          # load per-domain overrides (json/db)

    crawl/
      sitemap/
        sitemapParser.ts       # reads sitemap index + child sitemaps
        sitemapTypes.ts        # sitemap TS types
      queue/
        requestFactory.ts      # builds Crawlee Request objects
        urlNormalize.ts        # canonicalize + tracking param removal
        urlPolicy.ts           # include/exclude rules
      runners/
        cheerioRunner.ts       # CheerioCrawler setup + handlers
        playwrightRunner.ts    # PlaywrightCrawler setup + handlers
        runnerSwitch.ts        # decide when to escalate to browser
      classify/
        responseClassifier.ts  # status classification + redirect chain parsing
        soft404.ts             # detect "soft 404" in HTML/text

    extract/
      dom/
        sanitizeDom.ts         # remove scripts/styles/cookie/modals
        removeSelectors.ts     # apply domain removeSelectors
      main/
        readabilityExtract.ts  # main content isolate (Readability-style)
        selectorFallback.ts    # fallback extraction via selectors
        extractMeta.ts         # title/h1/meta description, etc.
      markdown/
        turndown.ts            # Turndown setup + custom rules
        rules.ts               # link/image/table rules
      post/
        dedupeLines.ts         # remove repeated lines / boilerplate
        normalizeWhitespace.ts # collapse whitespace, standardize headings
        qualityScore.ts        # junk ratio + metrics

    storage/
      db/
        db.ts                  # pg client setup
        migrations/            # SQL files
          001_init.sql
          002_indexes.sql
          003_domain_overrides.sql
        repo/
          pagesRepo.ts         # upserts pages
          aliasesRepo.ts       # upserts url_aliases
          runsRepo.ts          # crawl run tracking (optional)
      files/
        exportMarkdown.ts      # optional file output

    observability/
      logger.ts                # pino/winston wrapper
      metrics.ts               # counters, timers
      report.ts                # end-of-run summary

    types/
      core.ts                  # shared types (PageRecord, AliasRecord, etc.)
      enums.ts                 # CrawlStatus, ExtractionMethod, etc.

    index.ts                   # library entrypoint (optional)

  scripts/
    dev.sh
    migrate.sh

  docs/
    HANDOFF_ROADMAP.md
    HANDOFF_TECH_SPEC.md       # this document (store it here)
```

---

## 2) TypeScript Interfaces (Copy/Paste Baseline)

Create `src/types/enums.ts`:

```ts
export enum CrawlStatus {
  OK = "OK",
  REDIRECT_ALIAS = "REDIRECT_ALIAS",
  NOT_FOUND = "NOT_FOUND",
  SOFT_404 = "SOFT_404",
  ERROR = "ERROR",
}

export enum ExtractionMethod {
  READABILITY = "READABILITY",
  SELECTOR_FALLBACK = "SELECTOR_FALLBACK",
  BODY_FALLBACK = "BODY_FALLBACK",
  NONE = "NONE",
}

export type FetchMode = "cheerio" | "playwright";
```

Create `src/types/core.ts`:

```ts
import { CrawlStatus, ExtractionMethod, FetchMode } from "./enums";

export interface CrawlRun {
  run_id: string;              // UUID
  started_at: string;          // ISO
  finished_at?: string;        // ISO
  seed_sitemaps: string[];
  max_pages?: number;
  fetch_mode_default: FetchMode;
  notes?: string;
}

export interface RedirectInfo {
  requested_url: string;       // normalized
  final_url: string;           // normalized
  redirect_chain: string[];    // requested -> ... -> final
  redirect_count: number;
}

export interface PageRecord {
  final_url: string;                 // UNIQUE key (normalized)
  requested_url_original?: string;   // raw input from sitemap
  status_code: number;
  crawl_status: CrawlStatus;

  redirect_chain?: string[];         // if redirected
  fetch_mode?: FetchMode;            // cheerio / playwright

  html_content?: string;             // raw HTML
  clean_html?: string;               // extracted main-content HTML (recommended)
  markdown?: string;                 // final markdown

  title?: string;
  h1?: string;
  meta_description?: string;

  word_count?: number;
  content_hash?: string;             // sha256 of markdown or clean_html
  junk_score?: number;               // 0-100 (optional)
  extraction_method?: ExtractionMethod;

  last_crawled_at?: string;          // ISO
  last_error?: string;               // on ERROR
  run_id?: string;                   // link to crawl run
}

export interface UrlAliasRecord {
  requested_url: string;        // UNIQUE (normalized)
  final_url: string;            // normalized
  status_code: number;
  redirect_chain?: string[];
  first_seen_at?: string;       // ISO
  last_seen_at?: string;        // ISO
  run_id?: string;
}

export interface DomainOverride {
  domain: string;                      // example.com
  main_content_selectors: string[];     // priority order
  remove_selectors: string[];           // boilerplate removal
  force_fetch_mode?: FetchMode;         // optional
  enabled: boolean;
  updated_at?: string;
}

export interface NormalizeOptions {
  enforceHttps?: boolean;
  stripTrackingParams?: boolean;
  normalizeTrailingSlash?: "always" | "never" | "preserve";
  dropFragments?: boolean;
}

export interface CrawlOptions {
  run_id: string;
  sitemaps: string[];
  max_pages?: number;
  include_patterns?: string[];   // regex strings
  exclude_patterns?: string[];
  concurrency?: number;
  request_timeout_secs?: number;
  ttl_hours?: number;            // recrawl TTL
  debug?: boolean;
}
```

---

## 3) SQL Migrations (Postgres / Supabase-ready)

Put these in `src/storage/db/migrations/`.

### 001_init.sql

```sql
-- 001_init.sql
-- Core tables: crawl_runs, pages, url_aliases

BEGIN;

CREATE TABLE IF NOT EXISTS crawl_runs (
  run_id UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  seed_sitemaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_pages INTEGER,
  fetch_mode_default TEXT NOT NULL DEFAULT 'cheerio',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  id BIGSERIAL PRIMARY KEY,

  final_url TEXT NOT NULL UNIQUE,
  requested_url_original TEXT,

  status_code INTEGER NOT NULL,
  crawl_status TEXT NOT NULL,

  redirect_chain JSONB,

  fetch_mode TEXT,

  html_content TEXT,
  clean_html TEXT,
  markdown TEXT,

  title TEXT,
  h1 TEXT,
  meta_description TEXT,

  word_count INTEGER,
  content_hash TEXT,
  junk_score INTEGER,
  extraction_method TEXT,

  last_crawled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,

  run_id UUID REFERENCES crawl_runs(run_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS url_aliases (
  id BIGSERIAL PRIMARY KEY,

  requested_url TEXT NOT NULL UNIQUE,
  final_url TEXT NOT NULL,

  status_code INTEGER NOT NULL,
  redirect_chain JSONB,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  run_id UUID REFERENCES crawl_runs(run_id) ON DELETE SET NULL
);

COMMIT;
```

### 002_indexes.sql

```sql
-- 002_indexes.sql
BEGIN;

-- pages indexes
CREATE INDEX IF NOT EXISTS idx_pages_crawl_status ON pages (crawl_status);
CREATE INDEX IF NOT EXISTS idx_pages_last_crawled_at ON pages (last_crawled_at);
CREATE INDEX IF NOT EXISTS idx_pages_run_id ON pages (run_id);

-- url_aliases indexes
CREATE INDEX IF NOT EXISTS idx_aliases_final_url ON url_aliases (final_url);
CREATE INDEX IF NOT EXISTS idx_aliases_run_id ON url_aliases (run_id);

COMMIT;
```

### 003_domain_overrides.sql

```sql
-- 003_domain_overrides.sql
BEGIN;

CREATE TABLE IF NOT EXISTS domain_overrides (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  main_content_selectors JSONB NOT NULL DEFAULT '[]'::jsonb,
  remove_selectors JSONB NOT NULL DEFAULT '[]'::jsonb,
  force_fetch_mode TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
```

---

## 4) Required Repo Modules (Contracts)

### 4.1 URL Normalizer

File: `src/crawl/queue/urlNormalize.ts`

Contract:

```ts
export function normalizeUrl(input: string, opts?: NormalizeOptions): string;
export function stripTrackingParams(url: string): string;
export function toHttps(url: string): string;
```

**Rules**:

* must normalize before enqueue
* must normalize after response (final URL)

### 4.2 Dedup Sets (In-memory) + DB check (Cross-run)

Create a small service:

`src/crawl/queue/dedupeService.ts`

```ts
export interface DedupeService {
  hasFinalUrl(finalUrl: string): Promise<boolean>;
  markFinalUrl(finalUrl: string): Promise<void>;

  hasRequestedUrl(reqUrl: string): Promise<boolean>;
  markRequestedUrl(reqUrl: string): Promise<void>;
}
```

Implementation strategy:

* In-memory `Set` for this run
* Preload DB `final_url` set for the domain/run OR query on-demand:

  * `SELECT 1 FROM pages WHERE final_url = $1 LIMIT 1`

### 4.3 Response Classifier

File: `src/crawl/classify/responseClassifier.ts`

```ts
export interface ClassifiedResponse {
  status_code: number;
  requested_url: string;
  final_url: string;
  redirect_chain: string[];
  crawl_status: CrawlStatus;
}

export function classifyResponse(args: {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  redirectChain: string[];
}): ClassifiedResponse;
```

Logic:

* 404/410 → NOT_FOUND (or GONE if you add)
* non-2xx → ERROR unless you want more statuses
* redirectChain.length > 1 → record, but crawl_status might still be OK if final is 200

### 4.4 Soft-404 Detector

File: `src/crawl/classify/soft404.ts`

```ts
export function isSoft404(args: {
  title?: string;
  h1?: string;
  textSnippet: string;
  wordCount: number;
}): boolean;
```

Start with:

* patterns: “page not found”, “404”, “nothing found”, etc.
* wordCount threshold (e.g., < 150)

### 4.5 Extraction Pipeline

File: `src/extract/index.ts`

```ts
export interface ExtractResult {
  clean_html?: string;
  markdown?: string;
  title?: string;
  h1?: string;
  meta_description?: string;
  word_count?: number;
  content_hash?: string;
  junk_score?: number;
  extraction_method: ExtractionMethod;
}

export async function extractToMarkdown(args: {
  url: string;
  html: string;
  domainOverride?: DomainOverride;
  debug?: boolean;
}): Promise<ExtractResult>;
```

### 4.6 Storage Repos (DB)

Files:

* `src/storage/db/repo/pagesRepo.ts`
* `src/storage/db/repo/aliasesRepo.ts`
* `src/storage/db/repo/runsRepo.ts`

Contracts:

```ts
export interface PagesRepo {
  upsertPage(page: PageRecord): Promise<void>;
  getPageByFinalUrl(finalUrl: string): Promise<PageRecord | null>;
  shouldRecrawl(finalUrl: string, ttlHours: number): Promise<boolean>;
}

export interface AliasesRepo {
  upsertAlias(alias: UrlAliasRecord): Promise<void>;
}

export interface RunsRepo {
  startRun(run: CrawlRun): Promise<void>;
  finishRun(run_id: string): Promise<void>;
}
```

**Upsert behavior**:

* `pages.final_url` is the unique key
* only overwrite `html_content/markdown/clean_html` when this is the first crawl OR content changed OR forced recrawl
* always update `last_crawled_at`

---

## 5) Critical Flow (Exact Expected Behavior)

For each sitemap URL:

1. Normalize requested URL
2. If requested URL already seen (this run): skip
3. Fetch (Cheerio default; escalate if required)
4. Obtain final URL + redirect chain
5. Normalize final URL
6. Upsert alias record (requested → final, redirect chain, status)
7. If status is 404/410: save page record with NOT_FOUND; stop
8. If final URL already crawled recently (TTL): stop (record alias already done)
9. If final URL already crawled in this run: stop
10. Extract main content → markdown
11. Soft404 check (post-extraction)
12. Save canonical page record

This is exactly what prevents “many pages redirect to home and we crawl home 50 times”.

---

## 6) Developer Notes (So This Doesn’t Drift)

* Treat **final_url** as canonical identity.
* Always store aliases even when skipping content.
* Extraction method must be recorded (READABILITY vs fallback) so you can tune per domain.
* Domain overrides are not optional at scale—build the table now.
* Add a `debug` mode to save intermediate artifacts for a small sample (first N pages).

---

## 7) What I’d Ask the Team to Deliver (Definition of Done)

### MVP Done

* CLI accepts sitemap
* Crawler runs end-to-end
* DB tables created by migrations
* Redirect dedupe works (home crawled once)
* Pages store `html_content` + `markdown`

### Quality Done

* Nav/footer removed on your Elementor/WordPress sites
* Soft-404 flagged correctly
* Domain overrides working
* End-of-run report printed + stored

---

If you want, I can also provide:

* a ready-to-run `crawl.ts` CLI skeleton
* a `docker-compose.yml` for Postgres + the service
* the exact `INSERT ... ON CONFLICT ... DO UPDATE` SQL for the repos (so your team doesn’t improvise and accidentally overwrite good data).
