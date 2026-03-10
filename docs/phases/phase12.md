# Phase 12 — Backend-First Indexing + Selector Resilience

IndexedDB was a crutch. Pages and elements should live in Postgres — the single source of truth. The extension indexes the DOM and pushes to the backend. The backend serves page data back when needed. No dual storage, no sync bugs.

This phase also adds selector resilience: when a CSS selector breaks (DOM changed, class renamed, element moved), the system tries fallback selectors, then fuzzy-matches by label + type against the current page index. No embeddings, no LLM calls — just smart string matching.

## What Changes

### Kill IndexedDB (Dexie)
- Remove `apps/extension/src/storage/db.ts` entirely
- Remove `dexie` dependency from extension
- Crawler and indexer push pages directly to backend via API
- Extension fetches page data from backend when needed (cached in memory)
- `StoredSite` / `StoredPage` types move to `@afe/shared` (they map to Postgres tables now)

### Page Sync: Extension → Backend
- After indexing a page (single or crawl), extension sends the page data to the backend
- New WS message: `page_indexed { domain, pageIndex }` — extension pushes, backend stores in `pages` table
- Backend upserts by `siteId + urlPattern` (same dedup logic as IndexedDB had)
- On crawl, each page is pushed as it's indexed (not batched at the end)
- Site totals updated on the backend after each page upsert

### Page Data: Backend → Extension
- Replace `GET_SITE_DATA` (IndexedDB lookup) with `GET /api/sites/:domain/pages` API call
- ChatTab fetches site pages from backend on load, caches in component state
- Crawl progress still broadcast via `chrome.runtime.sendMessage` (local, no change)

### Selector Resilience
When `document.querySelector(selector)` fails during action execution:

1. **Try fallback selectors** — each indexed element already has `fallbackSelectors[]`. Try them in order.
2. **Fuzzy label match** — search the current page's live element index for elements with:
   - Same type (button, input, link, etc.)
   - Similar label (case-insensitive substring match, then Levenshtein distance)
   - Return the best match's selector
3. **Report adaptation** — if a fallback or fuzzy match was used, log it so domain memory can learn

This happens in the extension's action execution layer (ws-client.ts), not the backend.

### Incremental Re-indexing
- Content script already re-indexes on SPA navigation (URL change detection via MutationObserver)
- Add: after re-indexing, push updated page to backend via WS
- Add: detect "significant" DOM changes (element count changed by >20%) and re-index
- Don't re-index on every mutation — debounce to max once per 5 seconds

## Data Flow

### Current (Broken)
```
Extension indexes page → IndexedDB (local only)
Backend pages table → empty
ChatTab reads from → IndexedDB
AI gets page context from → live content script OR stale IndexedDB data
```

### After Phase 12
```
Extension indexes page → pushes to backend via WS
Backend stores in → Postgres pages table (source of truth)
ChatTab reads from → backend API (cached in memory)
AI gets page context from → live content script (preferred) OR backend pages
Crawler indexes pages → pushes each to backend as crawled
```

## Selector Resilience Logic

```typescript
// In extension action execution (ws-client.ts)
function findElement(
  primarySelector: string,
  fallbacks: string[],
  label: string,
  type: string,
): Element | null {
  // 1. Try primary selector
  let el = document.querySelector(primarySelector);
  if (el) return el;

  // 2. Try fallback selectors
  for (const fallback of fallbacks) {
    el = document.querySelector(fallback);
    if (el) {
      console.log(`[AFE] Primary selector failed, used fallback: ${fallback}`);
      return el;
    }
  }

  // 3. Fuzzy match by label + type on current page
  const candidates = document.querySelectorAll(typeToSelector(type));
  let bestMatch: Element | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const candidateLabel = getLabel(candidate);
    const score = similarityScore(label, candidateLabel);
    if (score > bestScore && score > 0.5) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  if (bestMatch) {
    console.log(`[AFE] Fuzzy matched "${label}" (score: ${bestScore})`);
  }

  return bestMatch;
}
```

## API Changes

### New Endpoint
```
POST /api/sites/:domain/pages    Upsert a page (called by extension after indexing)
```

### Modified WS Handler
```
page_indexed { domain, pageIndex }  →  Upsert page in Postgres, update site totals
```

### Removed from Extension
- `apps/extension/src/storage/db.ts` — deleted
- `dexie` dependency — removed
- All `db.pages`, `db.sites`, `storePage()`, `getOrCreateSite()` calls — replaced with API calls or WS messages

## Implementation Order

```
Step 1: Backend page upsert API + WS handler
        POST /api/sites/:domain/pages endpoint
        WS page_indexed message handler
        Upsert logic: match by siteId + urlPattern
        Update site totals after upsert

Step 2: Extension pushes pages to backend
        After single page index → send page_indexed via WS
        After crawl page index → send page_indexed via WS
        After SPA navigation re-index → send page_indexed via WS

Step 3: Extension reads from backend
        Replace GET_SITE_DATA with API call to GET /api/sites/:domain
        ChatTab fetches pages from backend on domain detect
        Cache in component state (no IndexedDB)

Step 4: Kill IndexedDB
        Remove storage/db.ts
        Remove dexie dependency
        Update crawler to not use storePage/getOrCreateSite
        Crawl state (queue, visited) stays in memory (already is)

Step 5: Selector resilience
        Add findElement() with fallback + fuzzy match to ws-client.ts
        Update action handlers (click, type, select) to use findElement()
        Log fallback/fuzzy usage for domain memory

Step 6: Incremental re-indexing
        Debounced DOM change detection in content script
        Push updated page to backend on significant changes
        Threshold: element count changed by >20%
```

## What's NOT in Phase 12

- Vector embeddings (not needed — text matching handles 95% of cases)
- Cross-page element search (AI already sees all pages in system prompt)
- Offline mode (requires backend connection)
- Page diffing (just re-index and overwrite)
