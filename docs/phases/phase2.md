# Phase 2 — Site Indexing ✅

## Goal

After connecting the extension, the user is guided through an indexing setup: choose to index just the current page (fast, seconds) or the entire site (thorough, runs in background). Indexing feels like part of onboarding — "teach the agent about your app." The side panel shows what the agent "sees" and indexing progress continues silently in the background while the user keeps working.

## Two Modes

### Quick Index (This Page)

- Indexes the current page only — interactive elements, forms, tables, links
- Completes in under a second
- Good for: trying the extension on a single page, quick one-off tasks

### Full Site Index (Recommended)

- Crawls all reachable internal pages via background tab
- Runs in background — user can keep working, close the side panel, navigate freely
- Progress persists — if interrupted, resumes where it left off
- Good for: full automation, multi-page workflows, "the agent knows the whole app"

The user can always upgrade from page → site index later, or re-index anytime.

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
- **Resumable** — crawl state (queue, visited) persisted in Dexie, survives panel close / browser restart
- **Non-blocking** — runs entirely in the service worker, user keeps working normally

### Storage (`storage/site-index.ts`) — NEW

- Dexie (IndexedDB) schema for site indexes
- Tables: `sites` (domain, metadata), `pages` (url, elements, links), `elements` (searchable)
- CRUD operations for site data
- Clear/re-index a site

### Side Panel Updates

#### Onboarding Flow (first visit to a new domain)

- Detects unindexed domain automatically
- Setup card: "Teach the agent about this app"
  - **"Index This Page"** — quick, instant result
  - **"Index Entire Site"** — recommended, with explanation ("takes a minute, runs in background")
- After either choice, transitions to the indexed view

#### Chat Tab → Page Context

- Shows what the agent knows about the current site
- If site is being crawled: subtle progress indicator (e.g., "Indexing... 12/34 pages") — not blocking, user can still interact
- Site overview: domain, total pages, total elements, last indexed
- Page list grouped by URL pattern (collapsible)
- Each page shows: title, URL, element count by type
- Expandable element details (label, type, selector)
- Badge/indicator on pages the agent hasn't indexed yet

#### Settings Tab

- Crawl settings: max pages, throttle delay
- "Re-index Site" / "Index Full Site" button (if only page-indexed)
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
3. Open side panel → see onboarding card: "Teach the agent about this app"
4. Click "Index This Page" → instant result, see page elements listed
5. Click "Index Entire Site" → progress indicator appears, user can keep browsing
6. Close side panel, reopen → crawl still running, progress persists
7. After completion: browse the full site map in the side panel
8. See all pages, elements, navigation links
9. Close and reopen browser — site index persists
10. Navigate to a different site → onboarding card appears again
11. Settings → re-index, upgrade page→site, or clear site data
