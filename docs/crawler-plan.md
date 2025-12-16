
This assumes:

* **Node.js + TypeScript**
* **Self-hosted**
* **Crawlee**
* Goal = **Apify Website Content Crawler parity (and better Markdown)**

---

# SELF-HOSTED WEBSITE CRAWLER & MARKDOWN EXTRACTION

**Technical Roadmap & Handoff Document**

## 0. Executive Intent (Read This First)

We are building a **self-hosted website crawler** that:

1. Accepts **one or more sitemap XML URLs**
2. Crawls all listed pages (respecting redirects, 404s, deduplication)
3. Stores **raw HTML**
4. Produces **clean, slim, high-quality Markdown**
5. Skips duplicate content caused by redirects or canonicalization
6. Produces output suitable for:

   * LLM/RAG ingestion
   * SEO analysis
   * Content auditing
   * Internal linking systems

**Crawling is NOT the hard part.**
**Content extraction + Markdown quality IS the hard part.**

Design accordingly.

---

## 1. High-Level Architecture

```
┌────────────┐
│  Sitemaps  │
└─────┬──────┘
      ↓
┌───────────────┐
│ URL Intake &  │
│ Normalization │
└─────┬─────────┘
      ↓
┌───────────────────┐
│ Crawlee Crawler   │
│ (HTTP + Browser)  │
└─────┬─────────────┘
      ↓
┌────────────────────────┐
│ Response Classification │
│ (200 / Redirect / 404)  │
└─────┬──────────────────┘
      ↓
┌──────────────────────────────┐
│ Deduplication & Canonical ID │
│ (final_url based)            │
└─────┬────────────────────────┘
      ↓
┌────────────────────────┐
│ Content Extraction     │
│ (Main-content isolate) │
└─────┬──────────────────┘
      ↓
┌────────────────────────┐
│ HTML → Markdown Engine │
└─────┬──────────────────┘
      ↓
┌────────────────────────┐
│ Post-Processing & QA   │
└─────┬──────────────────┘
      ↓
┌────────────────────────┐
│ Storage (DB / Files)   │
└────────────────────────┘
```

---

## 2. Technology Decisions (Locked)

### Language

* **Node.js + TypeScript**
* Reason: Crawlee maturity, best HTML → Markdown ecosystem

### Crawling

* **Crawlee**

  * `CheerioCrawler` for most pages (fast)
  * `PlaywrightCrawler` only when required (JS-heavy)

### Parsing & Conversion

* DOM parsing: `jsdom`
* Main content extraction: **Readability-style extraction**
* HTML → Markdown: **Turndown**, with custom rules

### Storage

* Database-backed (Postgres or equivalent)
* Optional filesystem Markdown export

---

## 3. Core Data Model (Mandatory)

### 3.1 Pages Table (Canonical Pages)

Each row represents **one unique final page**.

```ts
Page {
  id
  final_url (UNIQUE)
  requested_url_original
  status_code
  crawl_status ENUM(
    'OK',
    'REDIRECT_ALIAS',
    'NOT_FOUND',
    'SOFT_404',
    'ERROR'
  )
  redirect_chain JSONB
  html_content TEXT
  clean_html TEXT (optional but recommended)
  markdown TEXT
  title
  h1
  word_count
  content_hash
  last_crawled_at
}
```

### 3.2 URL Alias Table (Strongly Recommended)

Tracks all discovered URLs that map to canonical pages.

```ts
UrlAlias {
  requested_url UNIQUE
  final_url
  status_code
  redirect_chain JSONB
  first_seen_at
  last_seen_at
}
```

This is **critical** for:

* redirect analysis
* sitemap hygiene
* internal linking QA

---

## 4. URL Normalization & Deduplication (CRITICAL)

### Rules (Non-Negotiable)

Normalize URLs **before enqueue AND after fetch**:

* lowercase hostname
* strip `#fragment`
* remove tracking params (`utm_*`, `gclid`, etc.)
* normalize trailing slash (choose one)
* enforce HTTPS
* optional: sort query params

### Identity Rule

> **The identity of a page = normalized `final_url`**

### Behavior

* If multiple URLs redirect to the same final URL:

  * Crawl **once**
  * Store others as aliases
* If final URL already crawled:

  * Skip parsing
  * Record alias only

---

## 5. Redirect Handling

### Store Full Redirect Chain

Example:

```
/old-page
→ /services
→ /
```

Save:

* redirect_chain
* redirect_count
* final status code

### Classification

* 301 / 308 → permanent
* 302 / 307 → temporary (still dedupe)

---

## 6. 404 / Soft-404 Strategy

### Hard 404 / 410

* Save record
* Skip extraction
* Mark crawl_status accordingly

### Soft 404

Detect when:

* HTTP 200
* Title/body contains “Page Not Found”, “404”, etc.
* Content length below threshold

Mark:

```
crawl_status = 'SOFT_404'
```

---

## 7. Content Extraction Pipeline (Golden Goal)

### Step 1: DOM Cleanup

Remove:

* `<script>`, `<style>`
* cookie banners
* modals
* nav/header/footer
* repetitive CTAs

### Step 2: Main Content Isolation

Priority order:

1. Readability extraction
2. `<article>`, `<main>`
3. Known CMS containers (configurable per domain)
4. Full body fallback (aggressive pruning)

**Store which strategy succeeded** (debugging + tuning).

### Step 3: HTML → Markdown

Rules:

* Preserve heading hierarchy
* Normalize links to absolute
* Keep meaningful tables
* Keep image alt + src
* Drop empty anchors & nav lists

### Step 4: Post-Processing

* Deduplicate repeated lines
* Remove phone/menu/footer boilerplate
* Collapse whitespace
* Minimum content thresholds

---

## 8. Domain Overrides (Plan for Reality)

You WILL need site-specific tuning.

### Domain Config Example

```json
{
  "domain": "example.com",
  "mainContentSelectors": [
    ".entry-content",
    "#content",
    "main"
  ],
  "removeSelectors": [
    ".header",
    ".footer",
    ".cta-box"
  ]
}
```

Design for this **from day one**.

---

## 9. Crawling Strategy

### Sitemap-Driven (Initial Phase)

* Only URLs from sitemap XML
* No link discovery yet (controlled scope)

### Fetch Mode Decision

* Default: CheerioCrawler
* Escalate to Playwright if:

  * content empty
  * JS markers detected
  * known JS site

---

## 10. Recrawl Policy (Future-Safe)

Do NOT hardcode “never recrawl”.

Instead:

* Skip if `last_crawled_at < TTL`
* Respect sitemap `<lastmod>` when present
* Allow forced recrawl flag

---

## 11. Observability & QA (Required)

Track per crawl:

* total URLs
* unique final URLs
* redirects
* 404s
* soft-404s
* avg markdown length
* % skipped due to dedupe

Provide:

* debug mode that stores extraction strategy & failures
* sample Markdown output inspection

---

## 12. CLI Interface (Suggested)

```bash
crawl \
  --sitemap https://site.com/sitemap.xml \
  --domain-config ./configs/site.json \
  --output db \
  --max-pages 5000 \
  --debug
```

---

## 13. Phased Delivery Plan

### Phase 1 – Foundations

* Sitemap intake
* Crawlee setup
* URL normalization
* Redirect + dedupe logic
* Raw HTML storage

### Phase 2 – Extraction MVP

* Main content isolation
* HTML → Markdown
* Basic cleanup

### Phase 3 – Quality Pass

* Boilerplate removal
* Soft-404 detection
* Domain overrides

### Phase 4 – Production Hardening

* Retry logic
* Metrics
* Recrawl rules
* Error recovery

---

## 14. Success Criteria (Non-Subjective)

This project is **successful** when:

* Multiple URLs redirecting to home produce **one Markdown file**
* Navigation, headers, footers are **absent**
* Markdown reads like a clean article/service page
* Output is usable **without manual cleanup**
* Crawl results are deterministic and repeatable

---

## Final Guidance to the Dev Team

Do not optimize for:

* speed first
* clever heuristics
* “one-size-fits-all” extraction

Optimize for:

* **correctness**
* **traceability**
* **Markdown quality**

This crawler will become **infrastructure**.
Treat it like one.

---
