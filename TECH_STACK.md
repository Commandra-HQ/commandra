# Tech Stack — Revised & Consolidated

## Key Decisions After Research

### 1. YES — Use Claude Agent SDK as the Backend Brain

The Agent SDK is essentially "Claude Code as a library." It gives us:

- **Built-in agentic loop** — plan → act → observe → replan, already implemented
- **Subagents with context isolation** — each subagent gets its own conversation, only returns results to parent. This IS our swarm architecture, built-in.
- **Tool permissions & safety** — allowedTools, permission modes, hooks (PreToolUse, PostToolUse) map directly to our safety layer
- **MCP support** — connect to any external system (databases, Slack, etc.) via standard protocol
- **Sessions** — resume agents across runs, maintain context
- **Hooks** — run custom code before/after every tool call (our audit logging)

**BUT** — the Agent SDK runs server-side (Node.js/Python), not in a browser extension. So the architecture becomes:

```
┌─────────────────────────────────────────────────────────┐
│  CHROME EXTENSION                                        │
│  (Thin client — UI, element selection, DOM extraction)   │
│                                                          │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Chat UI   │  │ Element      │  │ Action Executor  │  │
│  │ (React)   │  │ Selector     │  │ (executes in DOM)│  │
│  └─────┬─────┘  └──────────────┘  └────────┬─────────┘  │
│        │                                    │            │
│        │ WebSocket                          │ receives   │
│        │ (chat + commands)                  │ commands   │
└────────┼────────────────────────────────────┼────────────┘
         │                                    ▲
         ▼                                    │
┌────────────────────────────────────────────────────────┐
│  BACKEND (Node.js / Docker)                             │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │           CLAUDE AGENT SDK                        │   │
│  │                                                    │   │
│  │  Main Agent (Coordinator)                          │   │
│  │  ├── Subagent: "page-analyzer"                     │   │
│  │  ├── Subagent: "form-filler"                       │   │
│  │  ├── Subagent: "data-extractor"                    │   │
│  │  └── Subagent: "navigator"                         │   │
│  │                                                    │   │
│  │  Custom MCP Server: "browser-bridge"               │   │
│  │  (bridges Agent SDK ←→ Chrome Extension)           │   │
│  │  Tools: click, type, navigate, extract, screenshot │   │
│  │                                                    │   │
│  │  Hooks:                                            │   │
│  │  ├── PreToolUse → safety classification            │   │
│  │  ├── PostToolUse → audit logging                   │   │
│  │  └── Stop → notify user                            │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Flow Engine  │  │ Scheduler    │  │ Audit Log    │  │
│  │ (Inngest)    │  │ (Inngest)    │  │ (Postgres)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└────────────────────────────────────────────────────────┘
```

**The key insight: We build a custom MCP server called "browser-bridge" that exposes browser actions (click, type, navigate, extract) as MCP tools. The Agent SDK calls these tools, and they get forwarded to the Chrome Extension via WebSocket for execution in the real DOM.**

```typescript
// Backend: Custom MCP server that bridges to the browser extension
// packages/mcp-browser-bridge/src/server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({
  name: "browser-bridge",
  version: "1.0.0",
});

// Each tool maps to a browser action, forwarded to extension via WebSocket
server.tool("click_element", {
  description: "Click an element on the page the user is viewing",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector or element description" },
      reason: { type: "string", description: "Why this click is needed" },
    },
    required: ["selector", "reason"],
  },
  async handler({ selector, reason }) {
    // Forward to Chrome Extension via WebSocket
    const result = await extensionBridge.sendAction({
      type: "click",
      selector,
      reason,
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});

server.tool("type_text", {
  description: "Type text into an input field on the page",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string" },
      text: { type: "string" },
      clear_first: { type: "boolean" },
    },
    required: ["selector", "text"],
  },
  async handler({ selector, text, clear_first }) {
    const result = await extensionBridge.sendAction({
      type: "type",
      selector,
      text,
      clear_first,
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});

server.tool("get_page_state", {
  description: "Get the current page URL, title, and all interactive elements",
  inputSchema: { type: "object", properties: {} },
  async handler() {
    const state = await extensionBridge.sendAction({ type: "get_state" });
    return { content: [{ type: "text", text: JSON.stringify(state) }] };
  },
});

server.tool("extract_table", {
  description: "Extract data from a table on the page",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string" },
    },
    required: ["selector"],
  },
  async handler({ selector }) {
    const data = await extensionBridge.sendAction({
      type: "extract_table",
      selector,
    });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
});

server.tool("navigate", {
  description: "Navigate to a URL in the browser",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
    },
    required: ["url"],
  },
  async handler({ url }) {
    const result = await extensionBridge.sendAction({ type: "navigate", url });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});

server.tool("screenshot", {
  description: "Take a screenshot of the current page for visual analysis",
  inputSchema: { type: "object", properties: {} },
  async handler() {
    const screenshot = await extensionBridge.sendAction({ type: "screenshot" });
    return {
      content: [{ type: "image", data: screenshot.base64, mimeType: "image/png" }],
    };
  },
});

server.tool("select_element", {
  description: "Highlight an element and wait for user to confirm it's the right one",
  inputSchema: {
    type: "object",
    properties: {
      selector: { type: "string" },
      description: { type: "string" },
    },
    required: ["selector"],
  },
  async handler({ selector, description }) {
    const result = await extensionBridge.sendAction({
      type: "highlight",
      selector,
      description,
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});
```

```typescript
// Backend: Main agent using Claude Agent SDK + our custom MCP server
// apps/api/src/agent/runner.ts

import { query, ClaudeAgentOptions, AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

async function runAgentTask(task: string, siteIndex: SiteIndex, sessionId?: string) {
  const options: ClaudeAgentOptions = {
    systemPrompt: `You are an AI agent that controls a web browser to complete tasks.
You have access to browser tools via the browser-bridge MCP server.

Current site index (known pages and elements):
${JSON.stringify(siteIndex, null, 2)}

Rules:
- Always check page state before acting
- Never click delete/remove buttons without explicit user approval
- If an element can't be found, ask the user for help
- Report progress after each major step`,

    // MCP server that bridges to the Chrome Extension
    mcpServers: {
      "browser-bridge": {
        type: "http",
        url: `http://localhost:3001/mcp`,  // our custom MCP server
      },
    },

    // Pre-approve browser read actions, require approval for writes
    allowedTools: [
      "mcp__browser-bridge__get_page_state",
      "mcp__browser-bridge__extract_table",
      "mcp__browser-bridge__screenshot",
      "mcp__browser-bridge__navigate",
      "Task",  // enable subagents
    ],

    // Subagents for different task types
    agents: {
      "data-extractor": {
        description: "Extracts and processes data from tables, lists, and pages. Use when the task involves reading, filtering, or exporting data.",
        prompt: `You extract data from web pages. Use get_page_state to understand the page, then extract_table or read element values. Return structured data.`,
        tools: [
          "mcp__browser-bridge__get_page_state",
          "mcp__browser-bridge__extract_table",
          "mcp__browser-bridge__navigate",
        ],
        model: "haiku",  // fast & cheap for data extraction
      },
      "form-filler": {
        description: "Fills out forms with provided data. Use when the task involves submitting forms, creating records, or entering data.",
        prompt: `You fill out web forms. Use get_page_state to find form fields, then type_text and click_element to fill and submit. Always verify the form was submitted successfully.`,
        tools: [
          "mcp__browser-bridge__get_page_state",
          "mcp__browser-bridge__type_text",
          "mcp__browser-bridge__click_element",
          "mcp__browser-bridge__select_element",
        ],
        model: "sonnet",  // needs reasoning for form logic
      },
      "navigator": {
        description: "Navigates complex multi-page workflows. Use when the task requires visiting multiple pages in sequence.",
        prompt: `You navigate web applications. Plan the optimal path through pages, click navigation elements, and verify you've reached the right page.`,
        tools: [
          "mcp__browser-bridge__get_page_state",
          "mcp__browser-bridge__navigate",
          "mcp__browser-bridge__click_element",
          "mcp__browser-bridge__screenshot",
        ],
        model: "haiku",
      },
    },

    // Safety hooks
    hooks: {
      PreToolUse: [
        {
          matcher: "mcp__browser-bridge__click_element",
          hooks: [async (input) => {
            // Classify risk before any click
            const risk = classifyClickRisk(input.tool_input);
            if (risk === "blocked") {
              return { decision: "block", reason: "Destructive action detected" };
            }
            if (risk === "review") {
              // This will pause and ask user for approval
              return { decision: "ask", message: `Agent wants to click: ${input.tool_input.reason}` };
            }
            return {};
          }],
        },
      ],
      PostToolUse: [
        {
          matcher: "mcp__browser-bridge__*",
          hooks: [async (input, toolUseId) => {
            // Audit log every browser action
            await auditLog.record({
              toolUseId,
              action: input.tool_name,
              input: input.tool_input,
              timestamp: Date.now(),
            });
            return {};
          }],
        },
      ],
    },

    // Resume previous session if provided
    ...(sessionId ? { resume: sessionId } : {}),
  };

  const messages = [];
  for await (const message of query({ prompt: task, options })) {
    messages.push(message);
    // Stream to extension via WebSocket for real-time display
    extensionBridge.sendMessage(message);
  }
  return messages;
}
```

### 2. Embeddings — No Anthropic Offering, Use Voyage AI

Anthropic explicitly does NOT have an embeddings model. They recommend Voyage AI (which they've invested in — it's basically their ecosystem partner).

**Options ranked by simplicity:**

| Option | Provider Count | Cost | Quality |
|--------|---------------|------|---------|
| **Voyage AI** | +1 provider but Anthropic-affiliated | $0.06/1M tokens (voyage-3.5-lite) | Best |
| **OpenAI ada-002** | +1 provider | $0.10/1M tokens | Good |
| **Local model (e.g., gte-small via Transformers.js)** | +0 providers | Free (compute only) | Decent |
| **pgvector + pg_embedding** | +0 providers | Free (uses Postgres) | Basic |

**Recommendation: Voyage AI.** It's one extra bill but:
- Anthropic recommends it (they're closely aligned)
- Best quality embeddings for our use case
- Cheap ($0.06/1M tokens for lite, we'll spend <$5/month early on)
- Can run on AWS Marketplace (consolidated billing if we're on AWS)

For the open-source/self-hosted version, we bundle a local embedding model (gte-small or similar) so enterprises don't need any external embedding API.

### 3. Consolidated Provider Strategy — Minimize Bills

**Problem:** Too many SaaS providers = too many bills, too many API keys, too many failure points.

**Consolidated stack:**

```
PROVIDER           | WHAT WE USE IT FOR                  | MONTHLY COST (EARLY)
─────────────────────────────────────────────────────────────────────────────
Anthropic          | Claude API (Agent SDK uses this)     | $50-200
                   | Planning, reasoning, vision          |
                   | Haiku for fast actions               |
─────────────────────────────────────────────────────────────────────────────
Voyage AI          | Embeddings for element search        | <$5
(Anthropic ecosystem)                                     |
─────────────────────────────────────────────────────────────────────────────
Neon               | Postgres + pgvector                  | Free → $19
                   | All persistent data                  |
─────────────────────────────────────────────────────────────────────────────
Inngest            | Durable workflows, scheduling        | Free → $25
                   | Crawl orchestration, agent triggers  |
─────────────────────────────────────────────────────────────────────────────
                                                TOTAL:     ~$75-250/month
```

**That's it. 4 providers.** Everything else runs on our own infra:

- **Backend:** Self-hosted Node.js in Docker (not Cloudflare Workers — see below)
- **WebSocket:** Built into our Node.js server (ws library or Socket.io)
- **File storage:** Local filesystem in Docker volume (screenshots, exports)
- **Cache:** In-memory (Map/LRU) or SQLite — no Redis needed early on
- **Auth:** Start with simple JWT + bcrypt. Add Clerk/WorkOS when we need SSO.
- **Monitoring:** Console logs + Sentry free tier

**Why Docker over Cloudflare Workers now:**
- Agent SDK needs long-running processes (agents can run for minutes)
- Workers have 30-second CPU time limits — won't work for agent loops
- Docker is required anyway for the self-hosted/enterprise story
- Simpler debugging, no edge-runtime quirks
- Can deploy to Railway, Fly.io, or any VPS for $5-20/month

### 4. Open Source + Docker — The Distribution Model

**Open-core model:**

```
┌─────────────────────────────────────────────────────────────┐
│                    OPEN SOURCE (MIT)                          │
│                                                              │
│  Everything needed to run the platform:                      │
│  ├── Chrome extension (full source)                          │
│  ├── Backend server (Node.js + Agent SDK)                    │
│  ├── MCP browser-bridge server                               │
│  ├── Database migrations (Postgres)                          │
│  ├── Docker Compose (one-command setup)                      │
│  ├── Local embedding model (no API key needed)               │
│  └── Documentation                                           │
│                                                              │
│  Users bring their own:                                      │
│  ├── Anthropic API key (required)                            │
│  └── Voyage AI API key (optional, local model fallback)      │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    CLOUD PRODUCT (Paid)                       │
│                                                              │
│  Everything in open source, PLUS:                            │
│  ├── Hosted backend (no Docker setup needed)                 │
│  ├── Team/org management                                     │
│  ├── Shared flow marketplace                                 │
│  ├── Admin dashboard + audit exports                         │
│  ├── SSO/SCIM (enterprise)                                   │
│  ├── Priority support                                        │
│  ├── Usage analytics                                         │
│  └── Managed LLM (no API key needed — we handle billing)     │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    ENTERPRISE (Custom)                        │
│                                                              │
│  Everything in cloud, PLUS:                                  │
│  ├── Self-hosted in customer's infrastructure                │
│  ├── Air-gapped deployment (no external API calls)           │
│  ├── On-prem LLM support (customer's own Claude/Llama)      │
│  ├── SAML/SCIM SSO                                           │
│  ├── Custom SLA                                              │
│  ├── Dedicated support                                       │
│  └── Compliance reports (SOC 2, audit trails)                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Docker Compose for self-hosted:**

```yaml
# docker-compose.yml — one command to run the entire platform
version: "3.9"

services:
  # Main backend + Agent SDK
  api:
    build: ./apps/api
    ports:
      - "3000:3000"   # HTTP API
      - "3001:3001"   # MCP browser-bridge
      - "3002:3002"   # WebSocket (extension ↔ backend)
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/agents
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - VOYAGE_API_KEY=${VOYAGE_API_KEY:-}  # optional
      - JWT_SECRET=${JWT_SECRET:-change-me-in-production}
      - USE_LOCAL_EMBEDDINGS=${USE_LOCAL_EMBEDDINGS:-true}
    depends_on:
      - db

  # Postgres + pgvector
  db:
    image: pgvector/pgvector:pg16
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=agents
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

  # Inngest dev server (workflow engine)
  inngest:
    image: inngest/inngest:latest
    ports:
      - "8288:8288"
    environment:
      - INNGEST_EVENT_KEY=local-dev-key

volumes:
  pgdata:
```

```bash
# One-command setup:
git clone https://github.com/AVIVASHISHTA29/agents-for-everyone.git
cd agents-for-everyone
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
docker compose up
# → Backend running on :3000
# → Install extension from /apps/extension
# → Done.
```

---

## Revised Tech Stack — Final

```
┌─────────────────────────────────────────────────────────────┐
│                     FINAL TECH STACK                         │
│                                                              │
│  EXTENSION (Chrome)                                          │
│  ├── TypeScript                                              │
│  ├── React 19 + Tailwind + shadcn/ui                         │
│  ├── Vite + CRXJS (extension build tool)                     │
│  ├── Dexie.js (IndexedDB — local storage)                    │
│  └── WebSocket client (connect to backend)                   │
│                                                              │
│  BACKEND (Node.js — runs in Docker)                          │
│  ├── @anthropic-ai/claude-agent-sdk  ← THE CORE             │
│  │   ├── Main agent loop (agentic reasoning)                 │
│  │   ├── Subagents (swarm = subagents with Task tool)        │
│  │   ├── Hooks (safety + audit)                              │
│  │   ├── Sessions (resume agents)                            │
│  │   └── MCP (connect to browser + external tools)           │
│  │                                                           │
│  ├── Custom MCP Server: browser-bridge                       │
│  │   └── Exposes: click, type, navigate, extract, screenshot │
│  │       as MCP tools → forwarded to extension via WS        │
│  │                                                           │
│  ├── Hono (HTTP API framework)                               │
│  ├── Drizzle ORM (type-safe Postgres access)                 │
│  ├── ws (WebSocket server)                                   │
│  └── Inngest (durable workflows, scheduling)                 │
│                                                              │
│  DATABASE                                                    │
│  └── PostgreSQL 16 + pgvector (single DB for everything)     │
│      ├── Users, orgs, auth                                   │
│      ├── Sites, pages, elements (site index)                 │
│      ├── Flows, agents, triggers                             │
│      ├── Audit logs                                          │
│      ├── Chat sessions                                       │
│      └── Element embeddings (pgvector)                       │
│                                                              │
│  AI PROVIDERS (only 2)                                       │
│  ├── Anthropic Claude API (via Agent SDK)                    │
│  │   ├── Opus/Sonnet: complex planning                       │
│  │   ├── Haiku: fast action decisions                        │
│  │   └── Vision: screenshot analysis                         │
│  └── Voyage AI (embeddings — optional, local fallback)       │
│                                                              │
│  SELF-HOSTED OPTION                                          │
│  ├── Docker Compose (api + postgres + inngest)               │
│  ├── User provides: Anthropic API key                        │
│  ├── Optional: Voyage API key (or use local embeddings)      │
│  └── Zero other external dependencies                        │
│                                                              │
│  MONOREPO                                                    │
│  ├── Turborepo                                               │
│  ├── pnpm                                                    │
│  └── Biome (lint + format)                                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### What We DON'T Need Anymore

| Removed | Why |
|---------|-----|
| Cloudflare Workers | Agent SDK needs long-running processes; Docker is simpler and required for self-hosted |
| Cloudflare R2/KV/Queues | Replaced by local filesystem + Postgres + Inngest |
| Redis / Upstash | Overkill early on; in-memory cache or SQLite is fine |
| PartyKit | Plain `ws` library is enough; one less dependency |
| Clerk / WorkOS | Start with JWT auth; add SSO providers when needed |
| PostHog | Console logs + Sentry free tier first |
| Separate vector DB | pgvector in Postgres handles it |
| Custom agentic loop | Agent SDK provides this |
| Custom safety engine | Agent SDK hooks provide this |
| Custom subagent system | Agent SDK subagents provide this |

**The Agent SDK eliminates ~40% of what we planned to build custom.** The agentic loop, subagent coordination, safety hooks, session management, and tool execution are all built in. We just need to:

1. Build the Chrome Extension (UI + DOM interaction)
2. Build the MCP browser-bridge (forwarding actions to extension)
3. Build the flow/agent management layer
4. Build the site indexer

---

## Revised Project Structure

```
agents-for-everyone/
├── apps/
│   ├── extension/                    # Chrome Extension
│   │   ├── src/
│   │   │   ├── background/           # Service worker
│   │   │   │   └── index.ts
│   │   │   ├── content/              # Content scripts
│   │   │   │   ├── indexer.ts        # DOM extraction
│   │   │   │   ├── selector.ts       # Element selection overlay
│   │   │   │   ├── executor.ts       # Action execution in DOM
│   │   │   │   └── bridge.ts         # WebSocket to backend
│   │   │   ├── sidepanel/            # Side panel chat UI
│   │   │   │   ├── App.tsx
│   │   │   │   ├── Chat.tsx
│   │   │   │   ├── ElementSelector.tsx
│   │   │   │   ├── FlowManager.tsx
│   │   │   │   └── AgentActivity.tsx
│   │   │   └── shared/
│   │   │       ├── types.ts
│   │   │       └── storage.ts        # Dexie.js IndexedDB
│   │   ├── manifest.json
│   │   └── vite.config.ts
│   │
│   └── api/                          # Backend
│       ├── src/
│       │   ├── server.ts             # Hono HTTP + WebSocket server
│       │   ├── agent/
│       │   │   ├── runner.ts         # Agent SDK integration
│       │   │   ├── agents.ts         # Subagent definitions
│       │   │   └── hooks.ts          # Safety + audit hooks
│       │   ├── mcp/
│       │   │   └── browser-bridge.ts # Custom MCP server
│       │   ├── routes/
│       │   │   ├── chat.ts           # Chat API
│       │   │   ├── flows.ts          # Flow CRUD
│       │   │   ├── agents.ts         # Agent management
│       │   │   ├── sites.ts          # Site index API
│       │   │   └── auth.ts           # Auth endpoints
│       │   ├── db/
│       │   │   ├── schema.ts         # Drizzle schema
│       │   │   └── migrations/
│       │   ├── ws/
│       │   │   └── handler.ts        # WebSocket connection manager
│       │   └── workflows/
│       │       ├── crawl.ts          # Inngest: site crawl workflow
│       │       └── scheduled.ts      # Inngest: scheduled agent runs
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   └── shared/                       # Shared types
│       ├── src/
│       │   ├── types/
│       │   │   ├── actions.ts        # BrowserAction types
│       │   │   ├── elements.ts       # IndexedElement types
│       │   │   ├── flows.ts          # Flow, Agent types
│       │   │   └── messages.ts       # WebSocket message types
│       │   └── index.ts
│       └── package.json
│
├── docker-compose.yml
├── .env.example
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── LICENSE                           # MIT
├── ARCHITECTURE.md
├── PHASES.md
├── TECH_STACK.md
└── README.md
```

---

## Revised Build Phases

### Phase 0: Scaffold + Docker (Week 1)
- [ ] Turborepo + pnpm monorepo
- [ ] Extension skeleton (Vite + CRXJS + Manifest V3)
- [ ] Backend skeleton (Hono + Drizzle + Postgres)
- [ ] Docker Compose (api + postgres + inngest)
- [ ] WebSocket connection between extension and backend
- [ ] Shared types package
- [ ] `docker compose up` works end-to-end

### Phase 1: Site Indexer (Weeks 2-4)
- [ ] DOM walker (extract interactive elements from any page)
- [ ] Auto-index on page load (content script)
- [ ] MutationObserver for dynamic content
- [ ] Store locally in IndexedDB + sync structure to backend
- [ ] Background tab crawling (full site crawl)
- [ ] Inngest workflow for crawl orchestration
- [ ] Side panel shows indexed elements

### Phase 2: Chat + Agent SDK Integration (Weeks 5-7)
- [ ] Chat UI in side panel
- [ ] MCP browser-bridge server (browser actions as MCP tools)
- [ ] Agent SDK integration (main agent + subagents)
- [ ] Agent SDK hooks for safety + audit
- [ ] Streaming responses to extension
- [ ] Basic actions working: click, type, navigate, extract
- [ ] Demo: "Go to HN, find top post, tell me about it"

### Phase 3: Element Selector + Smart Actions (Weeks 8-10)
- [ ] Element selector overlay (hover, click to select)
- [ ] "Select All Similar" feature
- [ ] Selected elements as context in chat
- [ ] Self-healing element resolution
- [ ] Screenshot + vision for visual fallback
- [ ] Demo: Select a table → "Export this as CSV"

### Phase 4: Flows + Agents (Weeks 11-15)
- [ ] Chat → Flow promotion (LLM parameterizes the task)
- [ ] Flow save/load (Postgres)
- [ ] Recording mode (capture user actions)
- [ ] Agent creation with triggers
- [ ] Inngest scheduled agent execution
- [ ] Agent SDK sessions (resume agents)
- [ ] Notifications (email/webhook on completion)

### Phase 5: Swarm + Teams (Weeks 16-20)
- [ ] Multi-subagent coordination (Agent SDK subagents)
- [ ] Cross-application workflows
- [ ] Team/org management
- [ ] Shared flow library
- [ ] Admin dashboard
- [ ] Audit trail with replay

### Phase 6: Enterprise (Weeks 21-26)
- [ ] SSO integration
- [ ] On-prem LLM support
- [ ] Air-gapped deployment guide
- [ ] Compliance documentation
- [ ] SOC 2 preparation
