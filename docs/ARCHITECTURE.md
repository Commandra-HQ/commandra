# Architecture

## How It All Fits Together

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                             │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   CHROME EXTENSION                          │  │
│  │                                                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ Side Panel   │  │ Element      │  │ Content Script   │  │  │
│  │  │ React Chat   │  │ Selector     │  │ (DOM indexing +  │  │  │
│  │  │ Flows, Teach │  │ Overlay      │  │  action execute) │  │  │
│  │  └──────┬───────┘  └──────────────┘  └────────┬─────────┘  │  │
│  │         │                                      │            │  │
│  │         │ SSE (chat)    ┌──────────────────┐   │            │  │
│  │         └──────────────►│  Background SW   │◄──┘            │  │
│  │                         │  (WS client +    │                │  │
│  │                         │   action router) │                │  │
│  │                         └────────┬─────────┘                │  │
│  └──────────────────────────────────┼──────────────────────────┘  │
│                                     │ WebSocket                    │
└─────────────────────────────────────┼────────────────────────────┘
                                      │
┌─────────────────────────────────────┼────────────────────────────┐
│  BACKEND (Docker)                   │                             │
│                                     ▼                             │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    HONO HTTP SERVER                       │    │
│  │                                                          │    │
│  │  Routes:                                                 │    │
│  │  ├── POST /api/chat       → SSE streaming response       │    │
│  │  ├── POST /api/chat/record/start|stop                    │    │
│  │  ├── GET  /api/conversations                             │    │
│  │  ├── GET  /api/audit                                     │    │
│  │  ├── GET  /api/stats                                     │    │
│  │  ├── GET  /api/sites                                     │    │
│  │  ├── CRUD /api/memory                                    │    │
│  │  ├── CRUD /api/flows                                     │    │
│  │  └── POST /api/index      → page/element indexing        │    │
│  └──────────────────┬───────────────────────────────────────┘    │
│                     │                                             │
│  ┌──────────────────▼───────────────────────────────────────┐    │
│  │               ORCHESTRATOR (Custom Agentic Loop)         │    │
│  │                                                          │    │
│  │  while (iterations < maxIterations):                     │    │
│  │    1. Check kill switch + abort signal                   │    │
│  │    2. Call LLM (streaming, with extended thinking)       │    │
│  │    3. Stream thinking + text to client via SSE           │    │
│  │    4. Collect tool calls from response                   │    │
│  │    5. For each tool call:                                │    │
│  │       a. Safety classification (safe/review/blocked)     │    │
│  │       b. Approval gate if review-level                   │    │
│  │       c. Execute tool via WS → extension                 │    │
│  │       d. Audit log to Postgres                           │    │
│  │       e. Record step if in teach mode                    │    │
│  │    6. Feed tool results back to LLM                      │    │
│  │    7. Loop until end_turn or max iterations              │    │
│  └──────────────────┬───────────────────────────────────────┘    │
│                     │                                             │
│  ┌──────────────────▼───────────────────────────────────────┐    │
│  │            LLM PROVIDER LAYER (Provider-Agnostic)        │    │
│  │                                                          │    │
│  │  Interface: LLMProvider { chat() → AsyncIterable<Event> }│    │
│  │                                                          │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────────┐  │    │
│  │  │ Anthropic   │ │ OpenAI      │ │ (Planned)         │  │    │
│  │  │ Claude 4    │ │ GPT-4.1     │ │ Google, Bedrock,  │  │    │
│  │  │ + Thinking  │ │ o3/o4-mini  │ │ Azure, Ollama     │  │    │
│  │  │ + Vision    │ │ + Reasoning │ │                   │  │    │
│  │  └─────────────┘ └─────────────┘ └───────────────────┘  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────┐  ┌───────────────────────────────────┐     │
│  │  WebSocket Server │  │  TOOL REGISTRY (11 Browser Tools) │     │
│  │  (ws library)     │  │                                   │     │
│  │                   │  │  click, type, select, navigate,   │     │
│  │  Connections map  │  │  scroll, screenshot, get_state,   │     │
│  │  Action routing   │  │  extract_text, extract_table,     │     │
│  │  Approval flow    │  │  wait, go_back                    │     │
│  │  Kill switch      │  │                                   │     │
│  └──────────────────┘  │  + save_memory (internal tool)     │     │
│                         └───────────────────────────────────┘     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    POSTGRES + pgvector                    │    │
│  │                                                          │    │
│  │  users, conversations, messages, audit_logs,             │    │
│  │  sites, pages, elements (+ embeddings),                  │    │
│  │  domain_memory, user_memory, flows, flow_steps           │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

## The Three Key Pieces

### 1. Chrome Extension (Thin Client)

The extension lives in the user's browser. It does three things:

**Indexes pages** — a content script walks the DOM on every page load, extracting all interactive elements (buttons, forms, tables, links), their labels, selectors, and positions. Synced to Postgres via the API. This is how the agent "knows" the app.

**Executes actions** — when the backend agent decides to click a button or fill a form, the command comes over WebSocket to the background service worker, which injects a script into the page via `chrome.scripting.executeScript`. Events are simulated to match human behavior (mousedown → mouseup → click).

**Provides the UI** — side panel for chat (with markdown rendering, streaming thinking, block-based messages), element selector overlay for point-and-click control, flows tab for saved automations, teach mode for recording.

The extension is deliberately thin. It doesn't make LLM calls or run agent logic. It's a bridge between the user's authenticated browser session and the backend brain.

### 2. Backend Orchestrator (Custom, Provider-Agnostic)

The brain. We built our own agentic loop — ~300 lines of TypeScript, no framework dependencies.

**Why custom instead of an agent framework?**
- **Provider-agnostic** — works with Anthropic, OpenAI, and any future provider
- **Full streaming control** — we stream thinking, text, and tool events as structured SSE
- **Safety hooks built in** — classification + approval happen inside the loop, not as external middleware
- **Simpler** — no framework abstractions, easy to debug and extend

**How the loop works:**
```
1. Receive user message + page context
2. Build system prompt with page index, selected elements, domain memory, user memory
3. Call LLM (streaming)
4. Stream thinking + text to client as SSE events
5. If LLM returns tool calls:
   a. Classify each action (safe / review / blocked)
   b. If review: send approval request via WS, wait for response
   c. Execute tool → WS → extension → DOM → result
   d. Log to audit table
   e. Feed results back to LLM
6. Repeat until end_turn or max iterations (15)
7. Save conversation + trigger background memory extraction
```

**Tool dispatch** happens via WebSocket directly — no MCP layer. The tool registry maps tool names to WS message handlers. Each tool sends an `action_request` to the extension and awaits the response.

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
- Synced to Postgres via API, with pgvector embeddings for semantic search

**Why this matters:**
General browser agents (like OpenAI Operator) figure out the UI from scratch every time. Our agents already have a map. They're faster, more reliable, and cheaper (fewer LLM tokens spent figuring out the page).

---

## Data Flow

```
User types: "Find all overdue invoices and export them"
    │
    ▼
Extension sends to backend (POST /api/chat, SSE stream):
    ├── User message
    ├── Current page state (URL, title, visible elements)
    ├── Selected elements (if any)
    └── Conversation ID (for history continuity)
    │
    ▼
Orchestrator:
    1. Loads domain memory + user memory for this site
    2. Builds system prompt with page index + memories
    3. Calls LLM → streams thinking + plan to client
    4. Calls tool: click("status-filter")
       → WS → extension clicks it → returns new page state
    5. Calls tool: click("overdue-option")
       → WS → extension clicks it → returns updated table
    6. Calls tool: click("export-csv-btn")
       → WS → extension clicks it → file downloads
    7. Returns result to user
    │
    ▼
Extension displays:
    ├── Streaming thinking (collapsible)
    ├── Agent's plan (expandable steps)
    ├── Live tool activity (during execution)
    └── Final result (rendered as markdown)
```

---

## Indexing: Where Does It Happen?

Indexing happens **in the browser**, not server-side. This is a deliberate choice.

Enterprise apps sit behind SSO, VPNs, and MFA. A server-side crawler would need the user's credentials — a security nightmare. The extension already has the authenticated session. It just reads the DOM.

**Single page:** Instant. Content script extracts elements on page load.

**Full site crawl:** Extension opens pages in hidden background tabs (2-3 at a time), extracts structure, closes tabs. ~200 pages in 10-15 minutes, non-blocking.

The backend never sees raw page content. It only receives the structural index — element types, labels, selectors, navigation graph. No actual data values, no PII.

---

## Deployment

The entire platform runs in Docker:

```yaml
# docker-compose.yml
services:
  api:        # Backend (Hono + WS + Orchestrator)
  db:         # Postgres + pgvector
```

```bash
git clone https://github.com/AVIVASHISHTA29/agents-for-everyone
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
docker compose up
```

User provides their own LLM API key (Anthropic, OpenAI, or others). Everything else is self-contained. For air-gapped environments, customers can route to their own LLM (Ollama, Bedrock, Azure OpenAI).

See `docs/BUSINESS_PLAN.md` for cloud vs self-hosted deployment details.
