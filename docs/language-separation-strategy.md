# Language Separation Strategy for Multi-Language Sites

## Problem Statement

InfiniSkin (and likely other sites) has duplicate content in multiple languages:
- English: `https://www.infiniskin.com/about/`
- Spanish: `https://www.infiniskin.com/es/todo-acerca-de-infini/`

**Current Issues:**
1. **Cannibalization False Positives**: EN/ES pages targeting same keywords show as competing
2. **Polluted Link Mesh**: Mixed language pages in same silo visualization
3. **Inaccurate Metrics**: Page counts, hub selection, link analysis include both languages
4. **Confused Silos**: Spanish pages mixed with English silos or vice versa
5. **SEO Analysis Noise**: Can't analyze English site structure cleanly

## Recommended Solution: Hybrid Database + Query-Level Filtering

### Phase 1: Database Schema Enhancement

**Add language column to pages table:**
```sql
-- Add language column
ALTER TABLE pages ADD COLUMN language VARCHAR(10) DEFAULT 'en';

-- Create index for performance
CREATE INDEX idx_pages_language ON pages(language);

-- Populate based on URL pattern detection
UPDATE pages SET language = CASE
  WHEN url LIKE '%/es/%' THEN 'es'
  WHEN url LIKE '%/fr/%' THEN 'fr'
  WHEN url LIKE '%/de/%' THEN 'de'
  ELSE 'en'
END;

-- Add to crawls table for configuration
ALTER TABLE crawls ADD COLUMN primary_language VARCHAR(10) DEFAULT 'en';
ALTER TABLE crawls ADD COLUMN analyze_languages JSON COMMENT 'Languages to include: ["en"] or ["en","es"]';

-- Update existing crawls
UPDATE crawls SET primary_language = 'en', analyze_languages = '["en"]';
```

**Add language awareness to silos:**
```sql
-- Silos should be language-specific
ALTER TABLE silos ADD COLUMN language VARCHAR(10) DEFAULT 'en';
CREATE INDEX idx_silos_language ON silos(language);

-- Future: Silos link across languages
ALTER TABLE silos ADD COLUMN equivalent_silo_ids JSON COMMENT 'Silos in other languages covering same topic';
```

### Phase 2: Crawler Enhancement

**Update page classification to detect language:**

File: `src/services/ai/pageClassifier.ts`

```typescript
export interface PageClassification {
  page_type_v2: string;
  subject_v2: string;
  user_intent: string;
  language: string;  // NEW: 'en', 'es', 'fr', etc.
  is_translated_content: boolean;  // NEW: true if part of multi-lang site
}

function detectLanguage(url: string, content: string): string {
  // URL pattern detection (primary)
  if (url.includes('/es/')) return 'es';
  if (url.includes('/fr/')) return 'fr';
  if (url.includes('/de/')) return 'de';

  // HTML lang attribute (secondary)
  const langMatch = content.match(/<html[^>]+lang=["']([^"']+)["']/i);
  if (langMatch) return langMatch[1].split('-')[0]; // en-US -> en

  // Content-based detection (tertiary, use library like franc)
  // const detected = franc(content);

  return 'en'; // default
}
```

### Phase 3: API Query Updates

**All endpoints must filter by language:**

File: `seo-dashboard-api.ts`

```typescript
// Add language parameter to all endpoints
app.get('/api/silos/:crawlId', async (req: Request, res: Response) => {
  const crawlId = parseInt(req.params.crawlId);
  const language = req.query.language as string || 'en';

  const [silos] = await mysqlPool.query(`
    SELECT * FROM silos
    WHERE crawl_id = ? AND language = ?
    ORDER BY page_count DESC
  `, [crawlId, language]);

  res.json(silos);
});

app.get('/api/silos/:siloId/link-mesh', async (req: Request, res: Response) => {
  const language = req.query.language as string || 'en';

  // Get pages in silo (language-filtered)
  const [pages] = await mysqlPool.query(`
    SELECT p.* FROM pages p
    JOIN page_silo_assignments psa ON p.id = psa.page_id
    WHERE psa.silo_id = ? AND p.language = ?
  `, [siloId, language]);

  // Links should also be language-aware
  const { data: links } = await supabase
    .from('links')
    .select('*')
    .in('source_page_id', pageIds)
    .in('target_page_id', pageIds);  // Only links within same language

  res.json({ nodes, edges });
});

// Cannibalization - CRITICAL to filter by language
app.get('/api/cannibalization/:crawlId', async (req: Request, res: Response) => {
  const language = req.query.language as string || 'en';

  const [conflicts] = await mysqlPool.query(`
    SELECT
      c1.page_id as page1_id,
      c2.page_id as page2_id,
      c1.subject_v2 as conflicting_subject
    FROM classifications c1
    JOIN classifications c2 ON c1.subject_v2 = c2.subject_v2
      AND c1.page_id < c2.page_id
    JOIN pages p1 ON c1.page_id = p1.id
    JOIN pages p2 ON c2.page_id = p2.id
    WHERE p1.crawl_id = ?
      AND p1.language = ?
      AND p2.language = ?
      AND c1.subject_v2 IS NOT NULL
  `, [crawlId, language, language]);

  res.json(conflicts);
});
```

### Phase 4: Frontend Language Selector

**Add language toggle to dashboard header:**

File: `seo-dashboard/index.html`

```html
<header>
  <div class="logo">
    <h1>SEO Analytics Dashboard</h1>
  </div>
  <div class="controls">
    <!-- NEW: Language Selector -->
    <select id="languageSelect">
      <option value="en">English (EN)</option>
      <option value="es">Español (ES)</option>
      <option value="all">All Languages</option>
    </select>

    <select id="siteSelect">...</select>
    <select id="crawlSelect">...</select>
    <button id="loadBtn">Load Analysis</button>
  </div>
</header>
```

File: `seo-dashboard/app.js`

```javascript
// Language state management
let currentLanguage = localStorage.getItem('selectedLanguage') || 'en';

// Language selector handler
document.getElementById('languageSelect').addEventListener('change', (e) => {
  currentLanguage = e.target.value;
  localStorage.setItem('selectedLanguage', currentLanguage);

  // Reload current view with new language filter
  if (currentCrawlId) {
    loadDashboard(currentCrawlId);
  }
});

// Update all API calls to include language
async function loadSilos(crawlId) {
  const response = await fetch(
    `${API_BASE}/api/silos/${crawlId}?language=${currentLanguage}`
  );
  const silos = await response.json();
  // ...
}
```

### Phase 5: Silo Building with Language Awareness

**Update Phase 5 to build language-specific silos:**

File: `src/scripts/runPhase5.ts`

```typescript
async function buildSilos(crawlId: number) {
  // Detect languages in this crawl
  const languages = await getLanguagesInCrawl(crawlId);

  for (const lang of languages) {
    console.log(`Building silos for language: ${lang}`);

    // Get pages for this language only
    const pages = await mysqlPool.query(`
      SELECT * FROM pages
      WHERE crawl_id = ? AND language = ?
    `, [crawlId, lang]);

    // Build silos using only same-language pages
    const silos = await buildSilosForLanguage(pages, lang);

    // Save with language tag
    for (const silo of silos) {
      await mysqlPool.query(`
        INSERT INTO silos (crawl_id, name, language, ...)
        VALUES (?, ?, ?, ...)
      `, [crawlId, silo.name, lang, ...]);
    }
  }
}
```

## Benefits of This Approach

### 1. **Clean Separation**
- Each language analyzed independently
- No false cannibalization between EN/ES versions
- Accurate link mesh visualization

### 2. **Flexibility**
- Can analyze single language: `?language=en`
- Can compare across languages: `?language=all`
- Can add more languages without code changes

### 3. **Accurate Metrics**
- Hub selection considers only same-language pages
- Orphan detection per language
- Link authority calculated within language

### 4. **Future-Proof**
- Supports multi-language sites (FR, DE, IT, etc.)
- Can map equivalent silos across languages
- Can analyze translation coverage

### 5. **SEO Best Practices**
- Aligns with hreflang separation
- Mirrors Google's language-based indexing
- Enables language-specific optimization

## Implementation Priority

**Immediate (Week 1):**
1. Add `language` column to `pages` table
2. Populate language based on URL pattern
3. Add language filter to silo query endpoint
4. Add language selector to dashboard UI

**Short-term (Week 2):**
1. Update link-mesh endpoint to filter by language
2. Update cannibalization detection
3. Add language to silos table
4. Update Phase 5 silo building

**Long-term (Month 1):**
1. Enhance crawler to detect language from HTML/content
2. Build cross-language silo mapping
3. Add translation coverage analysis
4. Add hreflang validation

## Testing Strategy

**Test Cases:**
1. **Small bilingual site**: Verify EN and ES pages separate correctly
2. **Large site (InfiniSkin)**: Confirm 990-page liposuction silo becomes ~495 EN + ~495 ES
3. **Link mesh**: Spanish pages should only show Spanish links
4. **Cannibalization**: EN page shouldn't conflict with ES translation
5. **Hub selection**: Each language gets its own hub page

## Rollout Plan

1. **Database Migration**: Run during low-traffic period
2. **Backward Compatibility**: Default to `language='en'` for existing queries
3. **Gradual Rollout**: Test with one crawl before applying to all
4. **User Communication**: Add help tooltip explaining language filter

## Alternative: URL-Based Filtering (Not Recommended)

```sql
-- Quick fix but fragile
WHERE url NOT LIKE '%/es/%'
```

**Why not recommended:**
- Breaks if URL structure changes
- Doesn't scale to more languages
- No database-level enforcement
- Easy to forget filter in new queries
- Can't handle language detection beyond URL

## Conclusion

The **hybrid database + query-level filtering** approach provides:
- Clean data separation
- Flexible analysis options
- Future-proof architecture
- Minimal code changes (just add `?language=en` to queries)

**Next Step**: Approve this strategy and I'll implement Phase 1 (database migration + basic filtering) immediately.
