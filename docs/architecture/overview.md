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
│  │  │              │  │ Overlay      │  │  action execute) │  │  │
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
│  │  Auth Middleware: JWT → { id, email, orgId?, role? }       │    │
│  │  ├── POST /api/auth/login    → email/password → JWT       │    │
│  │  ├── POST /api/auth/register → create account + JWT       │    │
│  │  └── POST /api/token/exchange → external auth → JWT       │    │
│  │                                                          │    │
│  │  Routes:                                                 │    │
│  │  ├── POST /api/chat       → SSE streaming response       │    │
│  │  ├── GET  /api/conversations                             │    │
│  │  ├── GET  /api/audit                                     │    │
│  │  ├── GET  /api/stats                                     │    │
│  │  ├── GET  /api/sites                                     │    │
│  │  ├── CRUD /api/memory                                    │    │
│  │  ├── CRUD /api/orgs        → org + member management     │    │
│  │  └── POST /api/index      → page/element indexing        │    │
│  └──────────────────┬───────────────────────────────────────┘    │
│                     │                                             │
│  ┌──────────────────▼───────────────────────────────────────┐    │
│  │               ORCHESTRATOR (Custom Agentic Loop)         │    │
│  │                                                          │    │
│  │  while (iterations < maxIterations):                     │    │
│  │    1. Check kill switch + abort signal                   │    │
│  │    2. Token budget: strip old screenshots, truncate      │    │
│  │       long results, drop oldest msgs if >200K est.      │    │
│  │    3. Call LLM (streaming, with extended thinking)       │    │
│  │    4. Stream thinking + text to client via SSE           │    │
│  │    5. Collect tool calls from response                   │    │
│  │    6. Partition tool calls by safety:                    │    │
│  │       a. Safe → execute in parallel (Promise.allSettled) │    │
│  │       b. Review → sequential with approval gates         │    │
│  │       c. Blocked → reject immediately                    │    │
│  │       d. Audit log each to Postgres                      │    │
│  │    7. Feed tool results back to LLM                      │    │
│  │    8. Loop until end_turn or max iterations              │    │
│  └──────────────────┬───────────────────────────────────────┘    │
│                     │                                             │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │             MULTI-AGENT SWARM                             │    │
│  │                                                          │    │
│  │  Coordinator (strong model, main tab)                     │    │
│  │    ├── spawn_agent → sub-agent (fast model, bg tab)       │    │
│  │    ├── spawn_agent → sub-agent (fast model, bg tab)       │    │
│  │    └── wait_for_agents → collect results                  │    │
│  │                                                          │    │
│  │  Max 3 concurrent sub-agents, 5 iters each, 60s timeout  │    │
│  │  Each sub-agent gets dedicated tab via open_tab WS action │    │
│  │  Tab cleanup: close_tab on complete/fail/timeout          │    │
│  └──────────────────────────────────────────────────────────┘    │
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
│  │  │ + Caching   │ │             │ │                   │  │    │
│  │  └─────────────┘ └─────────────┘ └───────────────────┘  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │               AGENT REGISTRY + SCHEDULER                 │    │
│  │                                                          │    │
│  │  loadAgent(slug) → reads AGENT.yaml + SOUL.md + SKILLS   │    │
│  │  resolveAgent(task) → domain match                        │    │
│  │  scheduler → cron eval → spawn agent runs                 │    │
│  │  self-improve → writes SKILLS/LEARNINGS/ERRORS post-run   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────┐  ┌───────────────────────────────────┐     │
│  │  WebSocket Server │  │  TOOL REGISTRY (21 Tools)          │     │
│  │  (ws library)     │  │                                   │     │
│  │                   │  │  Browser: click, type, select,    │     │
│  │  Connections map  │  │  navigate, scroll, screenshot,    │     │
│  │  Action routing   │  │  get_state, extract_text,         │     │
│  │  Approval flow    │  │  extract_table, wait, go_back     │     │
│  │  Kill switch      │  │  Tab: open_tab, close_tab         │     │
│  └──────────────────┘  │  Internal: save_memory,            │     │
│                         │  recall_memory, spawn_agent,       │     │
│                         │  wait_for_agents,                  │     │
│                         │  save_knowledge, read_knowledge,   │     │
│                         │  list_knowledge,                   │     │
│                         │  save_to_workspace,                │     │
│                         │  read_from_workspace,              │     │
│                         │  list_workspace                    │     │
│                         └───────────────────────────────────┘     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              SUPABASE (Storage + Postgres)                │    │
│  │                                                          │    │
│  │  Storage (agents bucket):                                  │    │
│  │    {userId}/{slug}/SOUL.md, SKILLS.md, LEARNINGS.md, ...  │    │
│  │    domains/{userId}/{domain}/KNOWLEDGE.md, WORKFLOWS.md   │    │
│  │    domains/{userId}/{domain}/AGENTS.md, MEMORY.md         │    │
│  │    runs/{userId}/{date}/{time}_{slug}_{convId}.md          │    │
│  │                                                          │    │
│  │  Postgres:                                                 │    │
│  │    users, organizations, org_members,                      │    │
│  │    agents (metadata + stats), agent_runs,                 │    │
│  │    conversations (+ outcome), messages, audit_logs,       │    │
│  │    sites, pages, elements,                                │    │
│  │    domain_memory, user_memory                             │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

## The Key Pieces

### 1. Chrome Extension (Thin Client)

The extension lives in the user's browser. It does three things:

**Indexes pages** — a content script walks the DOM on every page load, extracting all interactive elements (buttons, forms, tables, links), their labels, selectors, and positions. Synced to Postgres via the API. This is how the agent "knows" the app.

**Executes actions** — when the backend agent decides to click a button or fill a form, the command comes over WebSocket to the background service worker (`ws-client.ts` → `action-handler.ts`), which injects self-contained page functions from `page-scripts.ts` via `chrome.scripting.executeScript`. Element finding uses a 4-tier resilience strategy: primary selector → fallback selectors → fuzzy label matching → vector search.

**Provides the UI** — side panel chat interface split into focused modules:
- `ChatTab.tsx` — main component (state management, event handlers)
- `chat-layout.tsx` — context bar, plan panel, input area
- `message-blocks.tsx` — block-based rendering (thinking, text, tool calls, approvals, plans, sub-agents)
- `use-chat-stream.ts` — SSE streaming hook with rAF-batched React state updates

The extension is deliberately thin. It doesn't make LLM calls or run agent logic. It's a bridge between the user's authenticated browser session and the backend brain.

### 2. Backend Orchestrator (Custom, Provider-Agnostic)

The brain. We built our own agentic loop — modular TypeScript, no framework dependencies. The orchestrator is split into focused modules:

| Module | Purpose |
|--------|---------|
| `orchestrator.ts` | Main agentic loop — LLM streaming, tool dispatch, compaction |
| `tool-definitions.ts` | Internal tool schemas (memory, knowledge, agents, plans) |
| `internal-tools.ts` | Server-side tool handlers — no WS routing |
| `browser-tools.ts` | Browser tool execution with safety classification + approval gates |
| `token-budget.ts` | Context window estimation and trimming |

**Why custom instead of an agent framework?**
- **Provider-agnostic** — works with Anthropic, OpenAI, and any future provider
- **Full streaming control** — we stream thinking, text, and tool events as structured SSE
- **Safety hooks built in** — classification + approval happen inside the loop, not as external middleware
- **Modular** — each concern in its own file, easy to debug and extend

**How the loop works** (in `orchestrator.ts`):
```
1. Receive user message + page context
2. Build system prompt with page index, selected elements, domain memory, user memory
3. Build tool list from tool-definitions.ts (browser tools + internal tools)
4. Token budget management (token-budget.ts): strip old screenshots,
   truncate long results, drop oldest messages if over 200K token estimate.
   Auto-compact at 80% context usage.
5. Call LLM (streaming)
6. Stream thinking + text to client as SSE events
7. If LLM returns tool calls:
   a. Partition by safety classification (browser-tools.ts)
   b. Safe tools → execute in parallel (Promise.allSettled)
   c. Review tools → execute sequentially with approval gates
   d. Blocked tools → reject immediately
   e. Internal tools handled by internal-tools.ts (no WS routing)
   f. Log each to audit table
   g. Feed results back to LLM
8. Repeat until end_turn or max iterations (15)
9. Save conversation (knowledge persistence is agent-driven via save_knowledge tool during execution)
```

**Internal tools** (handled in `internal-tools.ts`): `save_memory`, `recall_memory`, `save_knowledge`, `read_knowledge`, `list_knowledge`, `spawn_agent`, `wait_for_agents`, `save_to_local`, `create_agent`, `update_agent_files`, `submit_plan`, `update_plan`. These execute server-side — they don't route through WebSocket.

**Tool dispatch** happens via WebSocket directly — no MCP layer. The tool registry maps tool names to WS message handlers. Browser tools send an `action_request` to the extension and await the response. Tab management tools (`open_tab`, `close_tab`) route through WS for the swarm.

**Anthropic prompt caching:** System prompts use `cache_control: ephemeral` for ~90% input token cost reduction on multi-turn conversations.

### 3. Autonomous Agent System (Phase 15)

The platform is evolving from a single generic agent to a system of **specialized, self-improving agents** that users create, configure, and that can invoke each other. Inspired by OpenClaw's file-based architecture.

**Core concept:** Each agent is a folder of files in Supabase Storage:
- `AGENT.yaml` — identity, model, tools, domains, triggers, capabilities
- `SOUL.md` — personality and behavioral instructions
- `SKILLS.md` — learned capabilities (agent writes these over time)
- `LEARNINGS.md` — corrections and discoveries from past runs
- `ERRORS.md` — failure patterns to avoid
- `workspace/` — scratch files, templates, exports

**Agent lifecycle:**
- **Create** — user defines agent via dashboard or AGENT.yaml
- **Invoke** — user, scheduler, or another agent triggers a run
- **Execute** — agent runs with its own prompt, tools, model, autonomy level
- **Learn** — post-execution analysis writes to SKILLS.md, LEARNINGS.md, ERRORS.md (with dedup + pruning). Domain knowledge managed by the agent during execution via `save_knowledge` tool (writes KNOWLEDGE.md, WORKFLOWS.md to S3).
- **Sleep** — agent is dormant until next trigger

**Autonomy levels** control how much the agent can do without human approval:
- `supervised` (default) — every write action requires approval, destructive actions blocked
- `trusted` — write actions auto-approve, destructive still blocked, plans auto-approve. Required for scheduled agents.
- `autonomous` — all actions auto-approve including destructive ones

**Domain knowledge** accumulates per-user in S3 (`domains/{userId}/{domain}/`):
- `KNOWLEDGE.md` — facts about the app learned from past sessions
- `WORKFLOWS.md` — proven multi-step workflows extracted from completed plans
- `AGENTS.md` — which agents operate on this domain
- `MEMORY.md` — domain-specific user preferences

**Agent-to-agent invocation:**
- `spawn_agent` targets a specific agent by slug or matches by capability
- Agents have `can_invoke` lists controlling which other agents they can call
- Max invocation depth: 2 (prevents infinite loops)
- Context can be passed from invoker to invoked agent

**Agent scheduler (heartbeat):**
- Agents with cron triggers run on schedule (requires active browser connection)
- Cheap check first (page state), full LLM run only if needed
- Missed runs are skipped, not queued

**Backwards compatible:** Users who never create agents get a `_coordinator` agent that behaves like the current orchestrator.

See `docs/phases/phase15-autonomous-agents.md` for full design.

### 3a. Multi-Agent Swarm (Current)

The existing swarm system powers agent-to-agent invocation:
- The coordinator (strong model, main tab) uses the `spawn_agent` tool to create sub-agents
- Each sub-agent runs in a dedicated background tab (opened via `open_tab` WS action)
- Sub-agents have isolated conversation context but shared memory (read-only)
- The coordinator uses `wait_for_agents` to collect results from all spawned sub-agents

**Constraints:**
- Max 3 concurrent sub-agents per user
- Max 5 iterations per sub-agent
- 60-second timeout per sub-agent
- Tab cleanup: `close_tab` is sent when a sub-agent completes, fails, or times out

### 4. Memory System (Agent-Driven Knowledge Management)

**Conversation memory:** Compresses messages >20 into summaries using the fast model. Token budget guard strips old screenshots from history before each LLM call.

**Agent-driven knowledge (S3):** Agents manage their own domain knowledge via tools — no background LLM extraction. The agent decides what to save during conversations:
- `save_knowledge` — writes facts, workflows, and preferences to S3 (Supabase Storage) at `domains/{userId}/{domain}/`
- `read_knowledge` — reads domain knowledge files from S3 to recall what the agent knows about a domain
- `list_knowledge` — lists available knowledge files for a domain
- Files include KNOWLEDGE.md (facts about the app), WORKFLOWS.md (proven multi-step workflows), AGENTS.md (which agents operate on this domain), and MEMORY.md (domain-specific preferences)

**User memory:** Per-user-per-domain preferences, corrections, terminology, and workflows stored in Postgres. The `recall_memory` tool allows on-demand keyword search during a conversation. `save_memory` persists corrections and preferences in real-time when detected.

### 5. Learning Feedback Loops

**Outcome tracking:** Users rate conversations with thumbs up/down. Conversations store an `outcome` column (success/failure/partial).

**Memory reinforcement:** Successful outcomes boost confidence scores on associated memories. Failed outcomes reduce confidence, so bad advice fades over time.

**Smart extraction:** Conversations where the user corrected the agent trigger extraction with the strong model (instead of fast), ensuring corrections are captured with high fidelity.

### 6. Site Index (The Knowledge Layer)

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
- Synced to Postgres via API

**Why this matters:**
General browser agents (like OpenAI Operator) figure out the UI from scratch every time. Our agents already have a map. They're faster, more reliable, and cheaper (fewer LLM tokens spent figuring out the page).

---

## Auth (JWT-Only)

This repo has zero vendor auth dependencies. Auth is JWT-only throughout.

```
┌──────────────────────────────────────────────────────────────┐
│                        AUTH FLOWS                             │
│                                                               │
│  Self-hosted (default):                                       │
│  ┌──────────────┐    POST /api/auth/login     ┌──────────┐  │
│  │ Dashboard    │ ──────────────────────────► │ API      │  │
│  │ login form   │ ◄────────────────────────── │ returns  │  │
│  │ (email+pass) │         JWT                  │ JWT      │  │
│  └──────────────┘                              └──────────┘  │
│                                                               │
│  Cloud (e.g. Clerk in landing-page/ repo):                   │
│  ┌──────────────┐  verify   ┌──────────┐  POST /api/token/  │
│  │ External     │ ────────► │ Website  │  exchange           │
│  │ auth (Clerk) │           │ backend  │ ───────────────────►│
│  └──────────────┘           └──────────┘  {externalId,email} │
│                                                    │          │
│                                              JWT ◄─┘          │
│                                                               │
│  Enterprise (OIDC):                                           │
│  ┌──────────────┐  callback  ┌──────────┐  POST /api/token/ │
│  │ Company IdP  │ ─────────► │ OIDC     │  exchange          │
│  │ (Okta, etc.) │            │ handler  │ ──────────────────►│
│  └──────────────┘            └──────────┘  {externalId,email}│
│                                                    │          │
│                                              JWT ◄─┘          │
│                                                               │
│  All paths end at the same place: a JWT containing            │
│  { userId, email, orgId?, role? } signed with JWT_SECRET.    │
│  The API and extension only ever see JWTs.                    │
└──────────────────────────────────────────────────────────────┘
```

**For self-hosted:** Dashboard has built-in email/password auth. User creates account, gets JWT, copies it to the extension.

**For cloud:** The `landing-page/` repo has Clerk. After sign-in, users are auto-redirected to the dashboard via `/auth/redirect` → `GET /api/token` → `POST /api/token/exchange` → redirect to dashboard `/auth/callback?token=<jwt>`. The dashboard stores the JWT and does a full page reload. The product API never sees Clerk tokens. Token exchange also handles org info — Clerk organizations are mapped to commandra orgs with role-based membership.

**For enterprise:** Their SSO (Okta, Azure AD, etc.) flows through OIDC. A callback handler exchanges the verified identity for a JWT via the same token exchange endpoint.

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

## Deployment

### Self-Hosted (Default)

```bash
git clone https://github.com/Commandra-HQ/commandra
cp .env.example .env
# Edit .env: set LLM_API_KEY, JWT_SECRET
docker compose up
```

That's it. User opens `localhost:3000`, creates an account, copies the JWT to the extension.

### Cloud

Same product, deployed with cloud infrastructure + the separate `landing-page/` repo:
- JWT auth (same as self-hosted — landing page exchanges Clerk tokens for JWTs via token exchange, auto-redirects to dashboard)
- Organizations for teams (Clerk orgs → commandra orgs via token exchange)
- Managed Postgres (Neon)
- LLM key pooling (our keys, metered per user)

See `docs/BUSINESS_PLAN.md` for the two-mode model.
