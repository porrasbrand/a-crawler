Below are **copy-paste-ready, opinionated SQL upserts** for each repo.
These are designed to **prevent accidental data loss**, avoid overwriting good content, and enforce your canonical rules.

Everything here assumes **PostgreSQL / Supabase**.

---

# SQL UPSERTS — CANONICAL & SAFE

## 1️⃣ `pages` — Canonical Page Record (MOST IMPORTANT)

**Rule philosophy**

* `final_url` is the identity
* Do **NOT** overwrite good content with empty / worse data
* Only replace content when:

  * page is new
  * OR content hash changed
  * OR forced recrawl

---

### ✅ SAFE UPSERT: `pages`

```sql
INSERT INTO pages (
  final_url,
  requested_url_original,
  status_code,
  crawl_status,
  redirect_chain,
  fetch_mode,
  html_content,
  clean_html,
  markdown,
  title,
  h1,
  meta_description,
  word_count,
  content_hash,
  junk_score,
  extraction_method,
  last_crawled_at,
  last_error,
  run_id
)
VALUES (
  $1,  -- final_url
  $2,  -- requested_url_original
  $3,  -- status_code
  $4,  -- crawl_status
  $5,  -- redirect_chain::jsonb
  $6,  -- fetch_mode
  $7,  -- html_content
  $8,  -- clean_html
  $9,  -- markdown
  $10, -- title
  $11, -- h1
  $12, -- meta_description
  $13, -- word_count
  $14, -- content_hash
  $15, -- junk_score
  $16, -- extraction_method
  now(),
  $17, -- last_error
  $18  -- run_id
)
ON CONFLICT (final_url)
DO UPDATE
SET
  status_code = EXCLUDED.status_code,
  crawl_status = EXCLUDED.crawl_status,
  redirect_chain = EXCLUDED.redirect_chain,
  fetch_mode = EXCLUDED.fetch_mode,

  -- ONLY overwrite content if new hash is present AND different
  html_content = CASE
    WHEN EXCLUDED.content_hash IS NOT NULL
     AND EXCLUDED.content_hash IS DISTINCT FROM pages.content_hash
    THEN EXCLUDED.html_content
    ELSE pages.html_content
  END,

  clean_html = CASE
    WHEN EXCLUDED.content_hash IS NOT NULL
     AND EXCLUDED.content_hash IS DISTINCT FROM pages.content_hash
    THEN EXCLUDED.clean_html
    ELSE pages.clean_html
  END,

  markdown = CASE
    WHEN EXCLUDED.content_hash IS NOT NULL
     AND EXCLUDED.content_hash IS DISTINCT FROM pages.content_hash
    THEN EXCLUDED.markdown
    ELSE pages.markdown
  END,

  title = COALESCE(EXCLUDED.title, pages.title),
  h1 = COALESCE(EXCLUDED.h1, pages.h1),
  meta_description = COALESCE(EXCLUDED.meta_description, pages.meta_description),
  word_count = COALESCE(EXCLUDED.word_count, pages.word_count),
  junk_score = COALESCE(EXCLUDED.junk_score, pages.junk_score),
  extraction_method = COALESCE(EXCLUDED.extraction_method, pages.extraction_method),

  content_hash = COALESCE(EXCLUDED.content_hash, pages.content_hash),
  last_error = EXCLUDED.last_error,
  last_crawled_at = now(),
  run_id = EXCLUDED.run_id;
```

### 🔒 Why this is safe

* Prevents empty crawls from wiping good Markdown
* Protects against JS failures overwriting static HTML
* Allows content refresh only when it actually changed

---

## 2️⃣ `url_aliases` — Redirects, Duplicates, Sitemap Hygiene

**Rule philosophy**

* Always record aliases
* Never delete history
* Update `last_seen_at` every time

---

### ✅ UPSERT: `url_aliases`

```sql
INSERT INTO url_aliases (
  requested_url,
  final_url,
  status_code,
  redirect_chain,
  first_seen_at,
  last_seen_at,
  run_id
)
VALUES (
  $1,  -- requested_url (normalized)
  $2,  -- final_url (normalized)
  $3,  -- status_code
  $4,  -- redirect_chain::jsonb
  now(),
  now(),
  $5   -- run_id
)
ON CONFLICT (requested_url)
DO UPDATE
SET
  final_url = EXCLUDED.final_url,
  status_code = EXCLUDED.status_code,
  redirect_chain = EXCLUDED.redirect_chain,
  last_seen_at = now(),
  run_id = EXCLUDED.run_id;
```

### 🔍 What this gives you later

* Full redirect maps
* Sitemap QA reports
* Internal link cleanup opportunities
* “Why do 42 URLs redirect to home?” answers

---

## 3️⃣ `crawl_runs` — Start & Finish

### ▶️ Start crawl run

```sql
INSERT INTO crawl_runs (
  run_id,
  seed_sitemaps,
  max_pages,
  fetch_mode_default,
  notes
)
VALUES (
  $1, -- run_id (UUID)
  $2, -- seed_sitemaps::jsonb
  $3, -- max_pages
  $4, -- fetch_mode_default
  $5  -- notes
);
```

### ⏹ Finish crawl run

```sql
UPDATE crawl_runs
SET finished_at = now()
WHERE run_id = $1;
```

---

## 4️⃣ `domain_overrides` — Controlled Manual Power

### ✅ UPSERT: `domain_overrides`

```sql
INSERT INTO domain_overrides (
  domain,
  enabled,
  main_content_selectors,
  remove_selectors,
  force_fetch_mode,
  updated_at
)
VALUES (
  $1, -- domain
  $2, -- enabled
  $3, -- main_content_selectors::jsonb
  $4, -- remove_selectors::jsonb
  $5, -- force_fetch_mode
  now()
)
ON CONFLICT (domain)
DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  main_content_selectors = EXCLUDED.main_content_selectors,
  remove_selectors = EXCLUDED.remove_selectors,
  force_fetch_mode = EXCLUDED.force_fetch_mode,
  updated_at = now();
```

---

## 5️⃣ Read-Only Guards (Recommended)

### Prevent accidental full-table overwrites

Have your team **never** use `DELETE FROM pages` in app code.

Create a read-only view for analytics:

```sql
CREATE OR REPLACE VIEW pages_clean AS
SELECT
  final_url,
  title,
  h1,
  word_count,
  junk_score,
  crawl_status,
  last_crawled_at
FROM pages
WHERE crawl_status = 'OK';
```

---

## 6️⃣ One Non-Negotiable Rule (Tell the Team)

> **No raw UPDATEs on `pages` outside these upserts.**
> If content changes behavior, we change the SQL — not the app logic.

This is how you avoid:

* accidental markdown wipes
* silent data corruption
* “why did all our pages suddenly lose content?”

---

## What This Enables Next (Strategically)

With these upserts in place you can safely add:

* content change detection
* diff-based audits
* “which pages actually changed since last crawl”
* LLM embeddings without duplication
* internal-link graph building

