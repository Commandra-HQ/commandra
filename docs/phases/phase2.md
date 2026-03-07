# Phase 2 — Site Indexing

## Goal

User clicks "Index Site" in the side panel. The extension crawls every reachable page of the current web app (following internal links), indexes all interactive elements on each page, and stores the full site map locally. The side panel shows the site structure and what the agent "sees." No backend involvement — everything stays in the extension.

## Why Full Site, Not Single Page

The agent needs to understand the entire application to be useful. If a user says "go to the invoices page and filter by unpaid," the agent needs to know that page exists, how to get there, and what elements are on it. Single-page indexing isn't enough — we need the full navigation graph.

## How the Crawler Works

1. User navigates to any page in their internal tool and clicks "Index Site"
2. Extension indexes the current page (elements + internal links)
3. For each discovered internal link:
   - Open in a **reused background tab** (not visible to the user)
   - Wait for page load + render (handles SPAs)
   - Run the indexer content script
   - Extract new internal links (adds to crawl queue)
   - Close/reuse the tab for the next page
4. Crawl continues breadth-first until all reachable pages are indexed or limits are hit
5. Results stored in **Dexie** (IndexedDB) — persists across sessions

### Crawl Rules
- **Same-origin only** — never follow links to external domains
- **Deduplicate by URL pattern** — `/invoices/123` and `/invoices/456` are the same page pattern (`/invoices/:id`), index once
- **Max pages** — configurable limit (default 50) to prevent runaway crawls
- **Throttle** — 1-2 second delay between pages to avoid hammering the server
- **Auth preserved** — background tabs share the user's session cookies, so authenticated pages work
- **Skip non-HTML** — ignore links to PDFs, images, API endpoints, etc.

## What Ships

### Content Script (`content/indexer.ts`)
- Improve existing indexer with better selector strategies (data-testid, aria, nth-child fallbacks)
- Filter hidden/zero-size elements
- Detect page type heuristically (dashboard, form, table, detail, settings)
- Re-export `indexPage()` for use by background script via messaging

### Background Script (`background/crawler.ts`) — NEW
- Manages the crawl queue (BFS)
- Opens/reuses a single background tab for crawling
- Injects content script and collects page index via `chrome.scripting.executeScript`
- URL pattern deduplication (`/users/123` → `/users/:id`)
- Respects crawl limits and throttle
- Sends progress updates to side panel

### Storage (`storage/site-index.ts`) — NEW
- Dexie (IndexedDB) schema for site indexes
- Tables: `sites` (domain, metadata), `pages` (url, elements, links), `elements` (searchable)
- CRUD operations for site data
- Clear/re-index a site

### Side Panel Updates

#### Chat Tab → Page Context
- When no site indexed: "Index Site" button with domain name
- During crawl: progress bar (pages indexed / pages discovered), current page being crawled
- After crawl: site overview showing:
  - Domain, total pages, total elements, last indexed timestamp
  - Page list grouped by URL pattern (collapsible)
  - Each page shows: title, URL, element count by type
  - Expandable element details (label, type, selector)

#### Settings Tab
- Crawl settings: max pages, throttle delay
- "Re-index Site" button
- "Clear Site Data" button
- Storage usage indicator

### Messaging Layer
- Content script ↔ background: `chrome.runtime.sendMessage` for page index results
- Background ↔ side panel: `chrome.runtime.sendMessage` for crawl progress and completion
- Message types added to `@afe/shared`: `INDEX_PAGE`, `CRAWL_START`, `CRAWL_PROGRESS`, `CRAWL_COMPLETE`, `CRAWL_STOP`

## Technical Decisions

- **Dexie over chrome.storage** — structured queries, better for large datasets, indexed fields
- **Background tab over fetch** — fetch won't render SPAs, won't execute JS, can't index dynamic content
- **URL pattern dedup** — replace numeric path segments with `:id` to avoid indexing 1000 detail pages
- **No backend storage yet** — site index stays local until Phase 9 when we add pgvector embeddings

## Out of Scope
- Sending index to backend / Postgres
- Element embeddings (pgvector)
- Click-to-select elements (Phase 6)
- Chat / agent using the index (Phase 3)
- Scheduled re-indexing (Phase 12)

## Implementation Order

1. **Messaging layer** — content ↔ background ↔ side panel communication
2. **Improve indexer** — better selectors, page type detection, hidden element filtering
3. **Dexie storage** — schema, CRUD, site/page/element tables
4. **Crawler** — background tab management, BFS queue, throttle, dedup
5. **Side panel UI** — index button, progress, site overview, page/element browser
6. **Test on real sites** — GitHub, Google Sheets, a login-gated dashboard

## How to Verify
1. `make dev` — start everything
2. Navigate to any web app (e.g., GitHub)
3. Open side panel → click "Index Site"
4. Watch progress bar as pages are crawled
5. After completion: browse the full site map in the side panel
6. See all pages, elements, navigation links
7. Close and reopen browser — site index persists
8. Navigate to a different site → index it separately
9. Settings → re-index or clear site data
