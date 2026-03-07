# Build Phases & Tech Stack Decisions

## The First Big Decision: Where Does Indexing Happen?

There are three options. This choice shapes everything.

```
Option A: Browser-Only Indexing
┌─────────────────────────────┐
│  Extension crawls pages     │ ✓ Has user's auth session
│  while user browses         │ ✓ No credentials leave browser
│  Stores in IndexedDB        │ ✗ Only indexes pages user visits
│  Syncs structure to backend │ ✗ Can't run in background when browser closed
└─────────────────────────────┘

Option B: Server-Side Crawling
┌─────────────────────────────┐
│  Backend spins up headless  │ ✓ Can crawl entire site in minutes
│  browser (Playwright)       │ ✓ Runs in background 24/7
│  Indexes all pages at once  │ ✗ Needs user's credentials (DEAL BREAKER for enterprise)
│                             │ ✗ May trigger security alerts
└─────────────────────────────┘

Option C: Hybrid (RECOMMENDED)
┌─────────────────────────────┐
│  Extension opens hidden     │ ✓ Uses user's real session (no creds needed)
│  tabs and crawls in         │ ✓ Can index entire site systematically
│  background while user      │ ✓ Site structure synced to backend
│  is on the site             │ ✓ Works with SSO, 2FA, VPN
│                             │ ✓ Re-indexes incrementally
│  Backend stores structure,  │ ✗ Needs browser open (acceptable tradeoff)
│  coordinates the crawl,     │ ✗ Slower than server-side
│  serves index to agents     │
└─────────────────────────────┘
```

**Option C wins.** Here's why: Enterprise apps sit behind SSO, VPNs, and MFA. We can't get server-side access without becoming a security nightmare. But the extension already has the user's authenticated session — we just need to use it smartly.

### How Hybrid Indexing Works

```
Step 1: User navigates to app, clicks "Index this site"
Step 2: Extension reads the current page (instant)
Step 3: Extension finds all internal links on the page
Step 4: Backend creates a "crawl plan" — ordered list of URLs to visit
Step 5: Extension opens URLs in hidden background tabs (chrome.tabs API)
        - Opens 2-3 tabs at a time (rate limited, not suspicious)
        - Each tab loads, extension content script extracts structure
        - Tab closes after extraction
Step 6: Results stream to backend via WebSocket
Step 7: Backend builds the full site graph
Step 8: When user returns to the site later, incremental re-index catches changes

Timeline: ~200 pages in 10-15 minutes (background, non-blocking)
```

```
┌──────────────────────────────────────────────────────────────┐
│                     CRAWL ORCHESTRATION                       │
│                                                              │
│  Extension                          Backend                  │
│  ────────                          ───────                   │
│                                                              │
│  User clicks "Index"                                         │
│       │                                                      │
│       ├──── Extract links from ────────> Crawl Planner       │
│       │     current page                    │                │
│       │                                     │                │
│       │  <── "Visit these 15 URLs next" ────┘                │
│       │                                                      │
│       ├──── Open tab: /invoices                              │
│       │     Extract structure ─────────> Store page index    │
│       │     Close tab                                        │
│       │                                                      │
│       ├──── Open tab: /invoices/new                          │
│       │     Extract structure ─────────> Store page index    │
│       │     Close tab                    │                   │
│       │                                  ├─> Discover new    │
│       │  <── "Also visit /invoices/:id"──┘   link patterns   │
│       │                                                      │
│       ├──── Open tab: /invoices/12345                        │
│       │     Extract structure ─────────> Store page index    │
│       │     Close tab                                        │
│       │                                                      │
│       │     ... continues until all                          │
│       │     discovered URLs visited ...                      │
│       │                                                      │
│       ├──── "Crawl complete" ──────────> Build site graph    │
│       │                                  Generate embeddings │
│                                          Site ready!         │
└──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack — Final Decisions

### Why Each Choice

#### Extension: TypeScript + React + Vite + CRXJS

```
Build tool: Vite + CRXJS (vite plugin for chrome extensions)
├── Why not Webpack? Slow, painful DX. CRXJS gives HMR for extensions.
├── React for UI (side panel chat, element selector overlay)
├── Tailwind + shadcn/ui for components (fast, consistent)
├── Dexie.js for IndexedDB (type-safe, reactive queries)
└── Manifest V3 (required for Chrome Web Store going forward)
```

#### Backend: Node.js + Hono + Cloudflare Workers

```
Why Hono on Workers (not Express/Fastify on a VPS)?
├── Edge-first: low latency globally (agents need fast responses)
├── Zero cold starts (Workers are pre-warmed)
├── Scales to zero cost when idle (startup-friendly)
├── Built-in WebSocket support via Durable Objects
├── R2 for screenshot storage (S3-compatible, cheap)
├── KV for fast caching (site index lookups)
├── Queues for async jobs (crawl orchestration)
└── Can migrate to self-hosted Node.js later for enterprise
```

BUT — some things need long-running processes (crawl coordination, agent swarms). For those:

```
Long-running tasks: Inngest (NOT Temporal)
├── Why not Temporal? Overkill for early stage. Needs its own infra.
├── Inngest is serverless-native, works with Cloudflare/Vercel
├── Durable functions with retries, sleep, fan-out
├── Perfect for: crawl orchestration, scheduled agents, swarm coordination
├── Can migrate to Temporal later if scale demands it
└── Free tier is generous for MVP
```

#### Database: Postgres (Neon) + pgvector

```
Neon serverless Postgres
├── Serverless: scales to zero, branches for dev/staging
├── pgvector extension: vector search for element embeddings
├── JSONB columns: flexible schema for elements, steps, configs
├── Connection pooling built in (important for Workers)
└── Can migrate to self-hosted Postgres for enterprise
```

#### LLM: Claude API (Anthropic)

```
Model routing by task:
├── Planning / complex reasoning: claude-sonnet-4-6 (fast + smart enough)
├── Simple actions ("click this"): claude-haiku-4-5 (cheap, fast)
├── Visual fallback (screenshot): claude-sonnet-4-6 with vision
├── Flow parameterization: claude-sonnet-4-6 (needs good reasoning)
└── Element description generation: claude-haiku-4-5 (batch, cheap)

Why not OpenAI?
├── Claude has better instruction following for tool use
├── Better at structured output (JSON action plans)
├── Vision is strong for screenshot-based element finding
└── Anthropic's safety focus aligns with our enterprise positioning
```

#### Auth: Clerk (not WorkOS yet)

```
Start with Clerk:
├── Faster to integrate (hours, not days)
├── Has org/team support built in
├── Good free tier
├── React components for extension auth
└── Migrate to WorkOS when enterprise customers need SAML/SCIM
```

#### Real-time: PartyKit (WebSocket)

```
Why PartyKit?
├── Built on Cloudflare Durable Objects
├── Extracting rooms for each user session (extension <-> backend)
├── Handles reconnection, multiplexing
├── Stateful: can hold crawl state, agent state in memory
├── Simpler than raw WebSocket management
└── Free tier works for MVP
```

### Full Stack Summary

```
┌─────────────────────────────────────────────────────────────┐
│                      TECH STACK                              │
│                                                              │
│  EXTENSION (Client)                                          │
│  ├── TypeScript                                              │
│  ├── React 19 + Tailwind + shadcn/ui                         │
│  ├── Vite + CRXJS (build tool)                               │
│  ├── Dexie.js (IndexedDB wrapper)                            │
│  ├── Chrome Extension Manifest V3                            │
│  └── PartyKit client (WebSocket)                             │
│                                                              │
│  BACKEND (API + Services)                                    │
│  ├── Hono (API framework, runs on Workers)                   │
│  ├── Cloudflare Workers (compute)                            │
│  ├── Cloudflare R2 (screenshot/file storage)                 │
│  ├── Cloudflare Queues (async job queue)                     │
│  ├── PartyKit / Durable Objects (WebSocket + state)          │
│  ├── Inngest (durable workflows: crawls, agents, swarms)     │
│  └── Drizzle ORM (type-safe DB access)                       │
│                                                              │
│  DATA                                                        │
│  ├── Neon Postgres + pgvector (primary DB + embeddings)       │
│  ├── Upstash Redis (caching, rate limiting)                  │
│  └── Cloudflare KV (fast edge cache for site indexes)        │
│                                                              │
│  AI                                                          │
│  ├── Anthropic Claude API (reasoning, vision, tool use)      │
│  ├── Model routing: Sonnet for planning, Haiku for actions   │
│  └── Embeddings: Voyage AI or OpenAI ada-002 (for pgvector)  │
│                                                              │
│  AUTH & INFRA                                                │
│  ├── Clerk (auth, orgs, user management)                     │
│  ├── Sentry (error tracking)                                 │
│  ├── PostHog (analytics)                                     │
│  └── GitHub Actions (CI/CD)                                  │
│                                                              │
│  MONOREPO                                                    │
│  ├── Turborepo (monorepo build orchestration)                │
│  ├── pnpm (package manager)                                  │
│  └── Biome (linting + formatting, faster than ESLint)        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Build Phases — Detailed

### Phase 0: Project Scaffolding (Week 1)

**Goal:** Monorepo setup, extension skeleton that loads on any page.

```
agents-for-everyone/
├── apps/
│   ├── extension/              # Chrome extension
│   │   ├── src/
│   │   │   ├── background/     # Service worker
│   │   │   ├── content/        # Content scripts (injected into pages)
│   │   │   ├── sidepanel/      # Side panel UI (chat interface)
│   │   │   ├── popup/          # Extension popup (quick actions)
│   │   │   └── shared/         # Shared types, utils
│   │   ├── manifest.json
│   │   └── vite.config.ts
│   │
│   ├── web/                    # Marketing site + dashboard (later)
│   │   └── ...
│   │
│   └── api/                    # Backend API (Hono on Workers)
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   └── db/
│       └── wrangler.toml
│
├── packages/
│   ├── shared/                 # Shared types between extension & API
│   │   ├── src/
│   │   │   ├── types/          # AgentAction, FlowStep, PageSnapshot, etc.
│   │   │   └── constants/
│   │   └── package.json
│   │
│   └── agent-core/             # Agent logic (used by extension + backend)
│       ├── src/
│       │   ├── indexer/        # DOM extraction, element classification
│       │   ├── executor/       # Action execution engine
│       │   ├── resolver/       # Element resolution (self-healing)
│       │   ├── safety/         # Safety classification, rules engine
│       │   └── planner/        # LLM interaction, plan generation
│       └── package.json
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── ARCHITECTURE.md
```

**Deliverables:**
- [ ] Turborepo + pnpm workspace configured
- [ ] Extension loads in Chrome, shows side panel
- [ ] Service worker (background script) running
- [ ] Content script injecting on all pages
- [ ] Basic "Hello World" in side panel when clicking extension
- [ ] API deployed to Cloudflare Workers (health check endpoint)
- [ ] Shared types package with initial type definitions
- [ ] CI: lint + type-check on push

---

### Phase 1: Site Indexer — "Understand Any Page" (Weeks 2-4)

**Goal:** Extension can index any page and show what it found. This is the foundation.

#### Week 2: DOM Extraction Engine

Build the core indexer that extracts structured data from any DOM:

```typescript
// packages/agent-core/src/indexer/dom-walker.ts

interface DOMWalkerConfig {
  maxDepth: number;           // how deep to walk (default: 50)
  includeHidden: boolean;     // index hidden elements? (default: false)
  includeShadowDOM: boolean;  // penetrate shadow roots? (default: true)
  includeIframes: boolean;    // recurse into iframes? (default: true)
}

class DOMWalker {
  // Walk the entire DOM tree and extract interactive elements
  extract(root: Document | ShadowRoot, config: DOMWalkerConfig): PageSnapshot {
    const elements: IndexedElement[] = [];

    // 1. Find all interactive elements
    const interactiveSelectors = [
      'a[href]', 'button', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
      '[onclick]', '[tabindex]', '[contenteditable="true"]',
      'details', 'summary',
    ];

    // 2. Find all data display elements
    const dataSelectors = [
      'table', '[role="grid"]', '[role="table"]',
      'ul', 'ol', '[role="list"]',
      'form', '[role="form"]',
    ];

    // 3. Find navigation elements
    const navSelectors = [
      'nav', '[role="navigation"]',
      '[role="menubar"]', '[role="menu"]',
      '.sidebar', '.breadcrumb', '.pagination',
    ];

    // Walk and classify each element
    // Generate multiple selector strategies for each
    // Extract semantic meaning (label, role, context)
  }
}
```

```typescript
// packages/agent-core/src/indexer/element-classifier.ts

class ElementClassifier {
  // Determine what type of element this is and what it does
  classify(el: HTMLElement): ElementClassification {
    return {
      type: this.getElementType(el),        // button, input, table, etc.
      role: this.getSemanticRole(el),        // submit, cancel, navigate, filter
      label: this.getLabel(el),             // human-readable label
      interactable: this.isInteractable(el),
      formContext: this.getFormContext(el),  // which form does this belong to?
      tableContext: this.getTableContext(el), // which table row/column?
    };
  }

  getLabel(el: HTMLElement): string {
    // Priority: aria-label > label[for] > placeholder > text content > title > name
    return (
      el.getAttribute('aria-label') ||
      this.findAssociatedLabel(el) ||
      el.getAttribute('placeholder') ||
      el.textContent?.trim().substring(0, 100) ||
      el.getAttribute('title') ||
      el.getAttribute('name') ||
      ''
    );
  }
}
```

**Deliverables:**
- [ ] DOMWalker extracts all interactive elements from any page
- [ ] ElementClassifier correctly identifies element types and labels
- [ ] Multi-strategy selector generation (id, data-testid, aria, css, xpath, text)
- [ ] Shadow DOM penetration working
- [ ] iframe detection and recursive extraction
- [ ] Unit tests with sample DOMs (grab HTML from real apps)

#### Week 3: Page Index Storage & Display

```typescript
// apps/extension/src/content/indexer.ts

class PageIndexer {
  private walker = new DOMWalker();
  private classifier = new ElementClassifier();
  private db: Dexie;  // IndexedDB

  // Called when page loads or DOM changes significantly
  async indexCurrentPage() {
    const snapshot = this.walker.extract(document, defaultConfig);

    // Store locally
    await this.db.pages.put({
      url: this.normalizeUrl(window.location.href),
      domain: window.location.hostname,
      snapshot,
      indexedAt: Date.now()
    });

    // Notify side panel
    chrome.runtime.sendMessage({
      type: 'PAGE_INDEXED',
      data: { url: window.location.href, elementCount: snapshot.elements.length }
    });
  }

  // Watch for DOM changes
  startObserving() {
    const observer = new MutationObserver(
      debounce(() => this.indexCurrentPage(), 2000)
    );
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
}
```

Side panel shows what was indexed:

```
┌─────────────────────────────────────────┐
│  Page: Invoice Dashboard                │
│  URL: /app/invoices                     │
│  Indexed: 2 seconds ago                 │
│                                         │
│  Found 34 interactive elements:         │
│                                         │
│  Buttons (5)                            │
│  ├── "Create Invoice" [primary CTA]     │
│  ├── "Export CSV"                        │
│  ├── "Export PDF"                        │
│  ├── "Refresh"                          │
│  └── "Filter"                           │
│                                         │
│  Forms (1)                              │
│  └── Search form                        │
│      └── "Search invoices..." [input]   │
│                                         │
│  Tables (1)                             │
│  └── Invoice list                       │
│      ├── Columns: #, Vendor, Amount,    │
│      │   Date, Status, Actions          │
│      ├── Rows: 48 visible              │
│      └── Pagination: 5 pages            │
│                                         │
│  Navigation (12)                        │
│  ├── "Dashboard" → /app                 │
│  ├── "Invoices" → /app/invoices [here]  │
│  ├── "Reports" → /app/reports           │
│  └── ... 9 more                         │
│                                         │
│  Links (15)                             │
│  └── Invoice detail links (×15)         │
│      → /app/invoices/:id                │
│                                         │
│  [Start Full Site Crawl]                │
└─────────────────────────────────────────┘
```

**Deliverables:**
- [ ] Auto-index on page load (content script)
- [ ] MutationObserver for dynamic content
- [ ] IndexedDB storage with Dexie
- [ ] Side panel shows indexed elements in structured view
- [ ] Elements grouped by type (buttons, forms, tables, nav)

#### Week 4: Full Site Crawl (Background Tabs)

```typescript
// apps/extension/src/background/crawler.ts

class SiteCrawler {
  private visited: Set<string> = new Set();
  private queue: string[] = [];
  private maxConcurrentTabs = 2;
  private activeTabs: Map<number, string> = new Map();
  private crawlId: string;

  async startCrawl(startUrl: string, domain: string) {
    this.crawlId = crypto.randomUUID();
    this.queue = [startUrl];

    // Notify UI: crawl started
    this.broadcastStatus('started', { total: 1, completed: 0 });

    while (this.queue.length > 0 || this.activeTabs.size > 0) {
      // Fill up to maxConcurrentTabs
      while (this.queue.length > 0 && this.activeTabs.size < this.maxConcurrentTabs) {
        const url = this.queue.shift()!;
        if (this.visited.has(url)) continue;
        this.visited.add(url);

        await this.crawlPage(url, domain);
      }

      // Wait for a tab to finish before continuing
      if (this.activeTabs.size >= this.maxConcurrentTabs) {
        await this.waitForTabComplete();
      }
    }

    this.broadcastStatus('completed', {
      total: this.visited.size,
      completed: this.visited.size
    });
  }

  private async crawlPage(url: string, domain: string) {
    // Open hidden tab
    const tab = await chrome.tabs.create({
      url,
      active: false,   // background tab
      pinned: false
    });

    this.activeTabs.set(tab.id!, url);

    // Wait for tab to load
    await this.waitForTabLoad(tab.id!);

    // Execute content script to extract page data
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: extractPageData,  // injected function
    });

    const pageData: PageSnapshot = result.result;

    // Store the page index
    await this.storePageIndex(url, pageData);

    // Discover new URLs from this page
    const newUrls = pageData.links
      .map(link => link.href)
      .filter(href => this.isSameDomain(href, domain))
      .filter(href => !this.visited.has(href))
      .filter(href => !this.isExcluded(href));  // skip logout, external links

    this.queue.push(...newUrls);

    // Close the tab
    await chrome.tabs.remove(tab.id!);
    this.activeTabs.delete(tab.id!);

    // Update progress
    this.broadcastStatus('progress', {
      total: this.visited.size + this.queue.length,
      completed: this.visited.size,
      current: url
    });
  }

  // URLs to never crawl
  private isExcluded(url: string): boolean {
    const excludePatterns = [
      /logout/i, /signout/i, /sign-out/i,
      /delete/i, /remove/i, /destroy/i,
      /\.pdf$/, /\.zip$/, /\.csv$/,
      /\?.*page=\d+/,  // pagination variants (index one, skip rest)
    ];
    return excludePatterns.some(p => p.test(url));
  }
}
```

**Deliverables:**
- [ ] Background tab crawling (2 concurrent tabs)
- [ ] Crawl progress shown in side panel
- [ ] URL discovery from page links
- [ ] Exclusion patterns (skip logout, downloads, etc.)
- [ ] Crawl pause/resume/cancel
- [ ] De-duplication of URL patterns (/invoices/123 and /invoices/456 are same pattern)
- [ ] Sync page structure to backend API
- [ ] Backend stores site graph in Postgres

---

### Phase 2: Element Selector + Chat Interface (Weeks 5-8)

**Goal:** Users can select elements on the page AND chat with the agent about them.

#### Week 5-6: Element Selector Overlay

The interactive overlay that lets users point at elements:

```typescript
// apps/extension/src/content/selector.ts

class ElementSelector {
  private overlay: HTMLDivElement;
  private tooltip: HTMLDivElement;
  private selectedElements: Map<string, SelectedElement> = new Map();
  private active: boolean = false;

  activate() {
    this.active = true;
    this.injectOverlay();

    // Capture all mouse events at the top level
    document.addEventListener('mousemove', this.onMouseMove, { capture: true });
    document.addEventListener('click', this.onClick, { capture: true });
    document.addEventListener('keydown', this.onKeyDown, { capture: true });

    // Visual indicator that selection mode is active
    document.body.style.cursor = 'crosshair';
  }

  private onMouseMove = (e: MouseEvent) => {
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
    if (!el || el === this.overlay || el === this.tooltip) return;

    // Highlight the element
    const rect = el.getBoundingClientRect();
    this.overlay.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px solid #3B82F6;
      background: rgba(59, 130, 246, 0.1);
      pointer-events: none;
      z-index: 2147483647;
      transition: all 0.1s ease;
    `;

    // Show tooltip with element info
    this.showTooltip(el, rect);
  };

  private onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const el = e.target as HTMLElement;
    const ref = this.buildElementRef(el);

    if (this.selectedElements.has(ref.selector)) {
      // Deselect
      this.selectedElements.delete(ref.selector);
    } else {
      // Select
      this.selectedElements.set(ref.selector, {
        ref,
        element: el,
        highlightDiv: this.createPersistentHighlight(el)
      });
    }

    // Notify side panel of selection change
    chrome.runtime.sendMessage({
      type: 'ELEMENTS_SELECTED',
      data: Array.from(this.selectedElements.values()).map(s => s.ref)
    });
  };

  // "Select All Similar" — find all elements matching the same pattern
  selectAllSimilar(el: HTMLElement) {
    const pattern = this.inferPattern(el);
    const matches = document.querySelectorAll(pattern);
    for (const match of matches) {
      const ref = this.buildElementRef(match as HTMLElement);
      this.selectedElements.set(ref.selector, {
        ref,
        element: match as HTMLElement,
        highlightDiv: this.createPersistentHighlight(match as HTMLElement)
      });
    }
  }

  // Keyboard shortcuts
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.deactivate();
    if (e.key === 'a' && e.ctrlKey) this.selectAllSimilar(this.lastHovered);
    if (e.key === 'p') this.selectParent(this.lastHovered);
  };
}
```

#### Week 7-8: Chat Interface + LLM Integration

The side panel chat that can reference selected elements:

```typescript
// apps/extension/src/sidepanel/Chat.tsx

function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedElements, setSelectedElements] = useState<ElementRef[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  // Listen for element selections from content script
  useEffect(() => {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'ELEMENTS_SELECTED') {
        setSelectedElements(msg.data);
      }
    });
  }, []);

  async function sendMessage(text: string) {
    // Build context for the LLM
    const context = {
      message: text,
      currentPage: await getCurrentPageIndex(),
      selectedElements: selectedElements,
      siteIndex: await getSiteIndex(),
      conversationHistory: messages,
    };

    // Send to backend → LLM
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify(context),
    });

    // Stream response
    const reader = response.body.getReader();
    // ... handle streaming response with action plans
  }

  return (
    <div className="flex flex-col h-full">
      {/* Selected elements indicator */}
      {selectedElements.length > 0 && (
        <SelectedElementsBanner
          elements={selectedElements}
          onClear={() => setSelectedElements([])}
        />
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.map(msg => <ChatMessage key={msg.id} message={msg} />)}
      </div>

      {/* Agent activity indicator */}
      {isAgentRunning && <AgentActivityFeed />}

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        placeholder={
          selectedElements.length > 0
            ? `What do you want to do with ${selectedElements.length} selected element(s)?`
            : "What do you want to do on this page?"
        }
      />
    </div>
  );
}
```

Backend chat endpoint:

```typescript
// apps/api/src/routes/chat.ts

app.post('/api/chat', async (c) => {
  const { message, currentPage, selectedElements, siteIndex, conversationHistory } = await c.req.json();

  // Build the LLM prompt
  const systemPrompt = buildAgentSystemPrompt({
    currentPage,
    selectedElements,
    siteIndex,
    capabilities: ['click', 'type', 'navigate', 'extract', 'select', 'wait'],
  });

  // Call Claude
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      ...conversationHistory,
      { role: 'user', content: message }
    ],
    tools: agentTools,  // defined tool schemas for browser actions
  });

  // Parse response — could be:
  // 1. A text reply (explanation, question)
  // 2. A tool call (action to execute)
  // 3. A plan (multiple steps to show user)

  return streamResponse(response, c);
});

// Tool definitions the LLM can call
const agentTools = [
  {
    name: 'click_element',
    description: 'Click an element on the page',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or element description' },
        reason: { type: 'string', description: 'Why clicking this element' },
      },
      required: ['selector', 'reason'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into an input field',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        clear_first: { type: 'boolean', description: 'Clear existing text before typing' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'extract_data',
    description: 'Extract data from the page (table, text, values)',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        format: { type: 'string', enum: ['text', 'table_json', 'html'] },
      },
      required: ['selector', 'format'],
    },
  },
  {
    name: 'navigate',
    description: 'Navigate to a URL',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    },
  },
  {
    name: 'create_plan',
    description: 'Present a multi-step plan to the user for approval before executing',
    input_schema: {
      type: 'object',
      properties: {
        plan_name: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              action: { type: 'string' },
              risk_level: { type: 'string', enum: ['safe', 'review', 'destructive'] },
            },
          },
        },
      },
      required: ['plan_name', 'steps'],
    },
  },
  // ... more tools: scroll, select_dropdown, upload_file, wait_for, etc.
];
```

**Deliverables:**
- [ ] Element selector overlay with hover highlight and click-to-select
- [ ] "Select All Similar" functionality
- [ ] Selected elements shown in side panel
- [ ] Chat interface in side panel with streaming responses
- [ ] Backend chat endpoint with Claude integration
- [ ] LLM can reference selected elements and current page structure
- [ ] LLM can generate action plans (displayed to user for approval)
- [ ] Basic action execution: click, type, navigate from LLM tool calls

---

### Phase 3: Action Execution + Safety (Weeks 9-12)

**Goal:** Agent can actually DO things on the page, safely.

#### Week 9-10: Action Runtime

```typescript
// packages/agent-core/src/executor/action-runtime.ts

class ActionRuntime {
  private resolver: ElementResolver;
  private safety: SafetyClassifier;
  private undoStack: UndoStack;

  async execute(action: BrowserAction): Promise<ActionResult> {
    // 1. Safety check
    const risk = this.safety.classify(action);
    if (risk === 'blocked') {
      return { success: false, error: 'Action blocked by safety rules', risk };
    }

    // 2. Resolve element (self-healing)
    let element: HTMLElement | null = null;
    if ('target' in action && action.target) {
      element = await this.resolver.resolve(action.target);
      if (!element) {
        return { success: false, error: `Could not find element: ${action.target}` };
      }
      // Scroll into view
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300);
    }

    // 3. Record state for undo
    const beforeState = element ? this.captureState(element) : null;

    // 4. Execute
    try {
      switch (action.type) {
        case 'click':
          await this.simulateClick(element!);
          break;
        case 'type':
          if (action.clear) {
            (element as HTMLInputElement).value = '';
            element!.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await this.simulateTyping(element!, action.text);
          break;
        case 'select':
          await this.simulateSelect(element!, action.value);
          break;
        case 'navigate':
          window.location.href = action.url;
          break;
        // ... other actions
      }
    } catch (err) {
      return { success: false, error: err.message };
    }

    // 5. Push to undo stack
    if (beforeState) {
      this.undoStack.push({ action, beforeState });
    }

    // 6. Wait for DOM to settle
    await this.waitForDOMSettle();

    return { success: true, risk };
  }

  // Simulate human-like interactions (not just setting values)
  private async simulateClick(el: HTMLElement) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  private async simulateTyping(el: HTMLElement, text: string) {
    el.focus();
    for (const char of text) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
      (el as HTMLInputElement).value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await sleep(30 + Math.random() * 50);  // human-like delay
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
```

#### Week 11-12: Safety Layer + ReAct Loop

```typescript
// packages/agent-core/src/safety/classifier.ts

class SafetyClassifier {
  classify(action: BrowserAction): RiskLevel {
    // Rule-based classification
    const rules: SafetyRule[] = [
      // BLOCKED: destructive actions
      { pattern: /delete|remove|destroy|drop|purge/i, level: 'blocked', applies_to: 'button_text' },
      { pattern: /admin|settings|permissions|roles/i, level: 'blocked', applies_to: 'url' },

      // REVIEW: write actions
      { pattern: /submit|send|approve|reject|publish|post/i, level: 'review', applies_to: 'button_text' },
      { pattern: /create|update|edit|modify/i, level: 'review', applies_to: 'button_text' },
      { actionType: 'type', level: 'review' },  // any typing needs review (could be filling sensitive data)

      // SAFE: read-only actions
      { actionType: 'navigate', level: 'safe' },
      { actionType: 'extract', level: 'safe' },
      { actionType: 'scroll', level: 'safe' },
      { pattern: /search|filter|sort|view|export|download|copy/i, level: 'safe', applies_to: 'button_text' },
    ];

    return this.evaluateRules(action, rules);
  }
}

// The main agent loop
// packages/agent-core/src/planner/react-loop.ts

class AgentReActLoop {
  private maxSteps = 20;
  private llm: AnthropicClient;
  private runtime: ActionRuntime;
  private safety: SafetyClassifier;

  async run(task: string, context: AgentContext): Promise<AgentResult> {
    const history: AgentStep[] = [];

    for (let i = 0; i < this.maxSteps; i++) {
      // THINK: Ask LLM what to do next
      const decision = await this.llm.decide({
        task,
        completedSteps: history,
        currentPageState: await this.getPageState(),
        siteIndex: context.siteIndex,
        selectedElements: context.selectedElements,
      });

      // Is the task done?
      if (decision.type === 'done') {
        return { success: true, message: decision.summary, steps: history };
      }

      // Is the agent stuck?
      if (decision.type === 'stuck') {
        return { success: false, message: decision.reason, steps: history };
      }

      // Does it need user input?
      if (decision.type === 'ask_user') {
        const userResponse = await this.askUser(decision.question);
        history.push({ type: 'user_response', content: userResponse });
        continue;
      }

      // ACT: Execute the action
      const action = decision.action;
      const risk = this.safety.classify(action);

      if (risk === 'blocked') {
        history.push({ type: 'blocked', action, reason: 'Safety rules' });
        continue;  // LLM will see this was blocked and try something else
      }

      if (risk === 'review') {
        const approved = await this.requestApproval(action);
        if (!approved) {
          history.push({ type: 'denied', action });
          continue;
        }
      }

      const result = await this.runtime.execute(action);
      history.push({ type: 'action', action, result });

      // OBSERVE: Check what happened
      await sleep(500);  // let page settle
      const newState = await this.getPageState();
      history.push({ type: 'observation', pageState: newState });
    }

    return { success: false, message: 'Max steps reached', steps: history };
  }
}
```

**Deliverables:**
- [ ] Action runtime: click, type, select, navigate, scroll, extract
- [ ] Human-like event simulation (not just .click())
- [ ] Self-healing element resolution (8 fallback strategies)
- [ ] Safety classifier (safe/review/blocked)
- [ ] Approval UI in side panel for review-level actions
- [ ] Undo stack for reversible actions
- [ ] ReAct loop: plan → act → observe → replan
- [ ] Agent can complete multi-step tasks end-to-end
- [ ] Activity feed showing what agent is doing in real-time

---

### Phase 4: Flows + Agents (Weeks 13-18)

**Goal:** One-time tasks become reusable flows, flows become autonomous agents.

#### Week 13-14: Chat → Flow Promotion

- User completes a task via chat
- Agent offers to save as flow
- LLM identifies parameters (which values change between runs)
- Flow stored in backend with versioning

#### Week 15-16: Agent Creation + Triggers

- User creates agent from flow
- Configure trigger: schedule (cron), manual, webhook
- Inngest handles scheduled execution
- Agent runs in background tab when triggered
- Notification on completion (via extension notification or Slack webhook)

#### Week 17-18: Recording Mode

- Record mode: capture user's clicks/types as they perform a task
- Generate flow from recording
- LLM cleans up + parameterizes the recorded steps
- User can edit generated flow

**Deliverables:**
- [ ] Flow CRUD API (create, read, update, delete, version)
- [ ] Chat-to-flow promotion with LLM parameterization
- [ ] Agent creation with trigger configuration
- [ ] Inngest integration for scheduled workflows
- [ ] Recording mode in extension
- [ ] Flow/agent management UI in side panel

---

### Phase 5: Multi-Agent Swarm (Weeks 19-24)

**Goal:** Complex tasks decomposed into parallel sub-agents.

#### Week 19-20: Swarm Coordinator

- Coordinator receives complex task
- LLM decomposes into parallelizable sub-tasks
- Spawns sub-agents with isolated contexts
- Each sub-agent gets its own tab (or shares tabs sequentially)

#### Week 21-22: Cross-App Workflows

- Agent can work across multiple internal apps
- Data handoff between sub-agents (one extracts, another inputs)
- Each app has its own site index; swarm coordinator bridges them

#### Week 23-24: Team Features

- Share flows within organization
- Admin dashboard: see all agents, audit logs
- Permission management: who can create/run agents
- Flow marketplace (discover flows created by teammates)

**Deliverables:**
- [ ] Swarm coordinator with parallel sub-agent execution
- [ ] Tab management for concurrent agents
- [ ] Agent-to-agent message passing
- [ ] Cross-application workflow support
- [ ] Team/org management
- [ ] Admin audit dashboard
- [ ] Shared flow library

---

### Phase 6: Enterprise + Polish (Weeks 25-30)

- Self-hosted deployment option (Docker compose)
- SSO/SCIM via WorkOS
- On-prem LLM support (route to customer's own model)
- SOC 2 compliance documentation
- Exportable audit trails
- Role-based access control
- Landing page + docs site

---

## Key Technical Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Background tabs blocked by browser | Medium | High | Use chrome.offscreen API as fallback; test on Chrome Enterprise policies |
| Content Security Policy blocks injection | Medium | Medium | Use chrome.scripting API (MV3); inject via world: 'MAIN' if needed |
| LLM generates wrong action plans | High | High | Safety layer catches destructive actions; dry-run mode; approval gates |
| Rate-limited by enterprise apps | Medium | Medium | Configurable delays between actions; respect robots.txt-like signals |
| Session expires during long crawl | Medium | Low | Detect auth redirects; pause crawl; notify user to re-authenticate |
| Extension review/approval delays | Low | High | Follow Chrome Web Store policies strictly from day 1; consider enterprise sideloading |
| IndexedDB storage limits | Low | Low | Compress data; use chrome.storage.local for overflow; backend is source of truth |

---

## Cost Projections (Per User/Month)

| Component | Usage | Cost |
|-----------|-------|------|
| Claude Sonnet (planning) | ~50 tasks × 4K tokens avg | ~$2.00 |
| Claude Haiku (actions) | ~500 action decisions × 1K tokens | ~$0.25 |
| Embeddings (indexing) | ~1000 elements × re-index weekly | ~$0.10 |
| Cloudflare Workers | ~10K requests | ~$0.50 |
| Neon Postgres | ~100MB per org | ~$0.50 |
| Inngest | ~200 function runs | Free tier |
| **Total infrastructure cost per user** | | **~$3-4/month** |

Pricing model: $29/user/month (individual), $19/user/month (team 5+), custom enterprise.
Gross margin: ~85-90%.
