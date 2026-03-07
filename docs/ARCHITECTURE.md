# Architecture

## How It All Fits Together

```
┌──────────────────────────────────────────────────────────────┐
│                      USER'S BROWSER                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              CHROME EXTENSION                          │  │
│  │                                                        │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────────┐  │  │
│  │  │ Side Panel │ │ Element    │ │ Content Script     │  │  │
│  │  │ Chat UI    │ │ Selector   │ │ (DOM interaction)  │  │  │
│  │  └─────┬──────┘ └────────────┘ └─────────┬──────────┘  │  │
│  │        │                                  │             │  │
│  │        │  ┌───────────────────────────┐   │             │  │
│  │        └──│   WebSocket Connection    │───┘             │  │
│  │           └─────────────┬─────────────┘                 │  │
│  └─────────────────────────┼──────────────────────────────┘  │
│                            │                                  │
└────────────────────────────┼──────────────────────────────────┘
                             │
┌────────────────────────────┼──────────────────────────────────┐
│  BACKEND (Docker)          │                                  │
│                            ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                 CLAUDE AGENT SDK                         │  │
│  │                                                         │  │
│  │  Coordinator Agent                                      │  │
│  │  ├── Subagent: page-analyzer                            │  │
│  │  ├── Subagent: form-filler                              │  │
│  │  ├── Subagent: data-extractor                           │  │
│  │  └── Subagent: navigator                                │  │
│  │                                                         │  │
│  │  Hooks: safety classification, audit logging             │  │
│  │  Sessions: resume interrupted agents                     │  │
│  └────────────────────────┬────────────────────────────────┘  │
│                           │                                   │
│  ┌────────────────────────┼────────────────────────────────┐  │
│  │         MCP Browser Bridge                              │  │
│  │  (Exposes browser actions as MCP tools)                 │  │
│  │                                                         │  │
│  │  Tools: click, type, navigate, extract_table,           │  │
│  │         screenshot, get_page_state, select_element      │  │
│  │                                                         │  │
│  │  Agent SDK calls these → forwarded to extension via WS  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │ Hono API     │  │ Postgres     │  │ Inngest          │    │
│  │ (HTTP)       │  │ + pgvector   │  │ (Workflows)      │    │
│  └──────────────┘  └──────────────┘  └──────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

## The Three Key Pieces

### 1. Chrome Extension (Thin Client)

The extension lives in the user's browser. It does three things:

**Indexes pages** — a content script walks the DOM on every page load, extracting all interactive elements (buttons, forms, tables, links), their labels, selectors, and positions. Stored in IndexedDB. This is how the agent "knows" the app.

**Executes actions** — when the backend agent decides to click a button or fill a form, the command comes over WebSocket to the content script, which performs the actual DOM interaction. Events are simulated to match human behavior (mousedown → mouseup → click).

**Provides the UI** — side panel for chat, element selector overlay for point-and-click control, activity feed showing what the agent is doing.

The extension is deliberately thin. It doesn't make LLM calls or run agent logic. It's a bridge between the user's authenticated browser session and the backend brain.

### 2. Backend Agent (Claude Agent SDK + MCP Bridge)

This is the brain. We use the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) — the same engine that powers Claude Code — as a library.

**Why Agent SDK instead of raw Claude API?**
- Built-in agentic loop (plan → act → observe → replan)
- Subagent support (our "swarm" — parallel agents with isolated context)
- Hooks system (PreToolUse for safety checks, PostToolUse for audit logging)
- Sessions (resume interrupted agents)
- MCP support (connect to any external tool via standard protocol)

**The MCP Browser Bridge** is our custom MCP server that makes browser actions available as tools the Agent SDK can call:

```
Agent SDK decides: "I need to click the 'Export' button"
    → Calls MCP tool: click_element({ selector: "#export-btn" })
        → MCP Bridge forwards via WebSocket to extension
            → Extension content script clicks the button
                → Result flows back: { success: true }
```

This architecture means the Agent SDK handles all the reasoning, planning, and tool orchestration. We just provide the browser-specific tools.

**Subagents** handle specialized tasks:
- `data-extractor` (Haiku — fast, cheap): reads tables, counts, filters
- `form-filler` (Sonnet — needs reasoning): fills forms, handles validation
- `navigator` (Haiku): navigates multi-page workflows
- `page-analyzer` (Sonnet): understands new pages, classifies elements

### 3. Site Index (The Knowledge Layer)

The agent doesn't guess what's on the page — it knows. The site index is a structured map of every page in the web application.

**Per page:**
- URL pattern, title, page type (dashboard, form, table, detail)
- All interactive elements with multiple selector strategies
- Navigation links (what connects to what)
- Forms with field names, types, validation rules
- Tables with column headers, row counts, pagination

**How it's built:**
- Auto-indexed whenever the user visits a page
- Full site crawl via background tabs (extension opens pages in hidden tabs, extracts structure, closes them)
- Incremental updates via MutationObserver
- Stored locally in IndexedDB + structure synced to Postgres

**Why this matters:**
General browser agents (like OpenAI Operator) figure out the UI from scratch every time. Our agents already have a map. They're faster, more reliable, and cheaper (fewer LLM tokens spent figuring out the page).

---

## Data Flow

```
User types: "Find all overdue invoices and export them"
    │
    ▼
Extension sends to backend:
    ├── User message
    ├── Current page state (URL, title, visible elements)
    ├── Selected elements (if any)
    └── Site index for this domain
    │
    ▼
Agent SDK (Coordinator Agent):
    1. Looks at site index → finds the invoice table
    2. Plans: filter by status=overdue, then click export
    3. Calls MCP tool: click_element("status-filter")
       → Extension clicks it → returns new page state
    4. Calls MCP tool: click_element("overdue-option")
       → Extension clicks it → returns updated table
    5. Calls MCP tool: click_element("export-csv-btn")
       → Extension clicks it → file downloads
    6. Returns result to user
    │
    ▼
Extension displays:
    ├── Agent's plan (before execution)
    ├── Live activity feed (during execution)
    └── Final result message
```

---

## Indexing: Where Does It Happen?

Indexing happens **in the browser**, not server-side. This is a deliberate choice.

Enterprise apps sit behind SSO, VPNs, and MFA. A server-side crawler would need the user's credentials — a security nightmare. The extension already has the authenticated session. It just reads the DOM.

**Single page:** Instant. Content script extracts elements on page load.

**Full site crawl:** Extension opens pages in hidden background tabs (2-3 at a time), extracts structure, closes tabs. ~200 pages in 10-15 minutes, non-blocking.

The backend never sees raw page content. It only receives the structural index — element types, labels, selectors, navigation graph. No actual data values, no PII.

---

## Self-Hosted Deployment

The entire platform runs in Docker:

```yaml
# docker-compose.yml
services:
  api:        # Backend + Agent SDK + MCP Bridge
  db:         # Postgres + pgvector
  inngest:    # Workflow engine (scheduled agents)
```

```bash
git clone https://github.com/AVIVASHISHTA29/agents-for-everyone
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
docker compose up
```

User provides their own Anthropic API key. Everything else is self-contained. For air-gapped environments, customers can route to their own LLM.
