# Commandra

An open-source platform that lets anyone automate tasks on any web application through natural language. Chrome extension + backend. Show once, automate forever.

## What It Does

- **Chat with any page** — open the extension side panel, ask the agent to do things on the page you're looking at
- **Point and click** — select elements, tell the agent what to do with them
- **Teach mode** — show the agent how to do something once, it learns the steps and can repeat them
- **Saved flows** — turn one-time tasks into reusable automations with parameters
- **Works behind your VPN/SSO** — the agent runs in YOUR browser, not a server-side browser. Your credentials never leave your machine

```
You:    "Go to the invoice dashboard, find all unpaid invoices
         over $5K, and send a reminder to each vendor"

Agent:  "I found 12 unpaid invoices over $5K. Here's my plan:
         1. Filter invoices by status=unpaid, amount>5000
         2. For each one, click 'Send Reminder'
         3. Confirm each send

         [Execute]  [Edit Plan]  [Save as Flow]"
```

The agent understands the app because it has already indexed it — every button, form, table, and navigation path. It doesn't guess. It knows.

## Architecture

```
Chrome Extension (thin client)
    ↕ WebSocket
Backend API (Hono + custom orchestrator)
    ↕
Postgres + pgvector
```

The extension handles UI, DOM indexing, and action execution. The backend handles all LLM reasoning and orchestration. Browser actions flow: Orchestrator → tool call → WebSocket → extension → DOM.

**Key design decisions:**
- Extension is a thin client — no LLM calls, no agent logic
- Custom provider-agnostic orchestrator (~300 lines, no framework deps)
- Agent always runs in the user's browser — core privacy guarantee
- Pre-indexed pages — agent knows the app before you ask (faster + cheaper than screenshot-reading)

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Docker](https://www.docker.com/) (for Postgres)
- An LLM API key (Anthropic or OpenAI)
- A Chrome-based browser

### Setup

```bash
git clone https://github.com/Commandra-HQ/commandra.git
cd commandra
cp .env.example .env
# Edit .env: set LLM_API_KEY and JWT_SECRET (openssl rand -base64 32)
pnpm install
pnpm docker:up           # Start Postgres
pnpm db:migrate          # Run migrations
pnpm dev                 # Start API (:3001) + Dashboard (:3000)
```

### Load the extension

```bash
cd apps/extension && pnpm dev
```

1. Go to `chrome://extensions` → enable Developer mode
2. Click "Load unpacked" → select `apps/extension/dist`
3. Pin the extension to your toolbar

### Connect

1. Open `http://localhost:3000` → create an account (email + password)
2. Click "Reveal Extension Token" → copy it
3. Click the extension icon → side panel opens → paste the token
4. Navigate to any web app and start chatting

## Project Structure

```
commandra/
├── apps/
│   ├── extension/       # Chrome Extension (thin client)
│   │   └── src/
│   │       ├── background/   # Service worker (WS client, action router)
│   │       ├── content/      # Content scripts (DOM indexer, selector, executor)
│   │       └── sidepanel/    # Chat UI (React), flows, teach mode
│   │
│   ├── api/             # Backend (Hono + orchestrator)
│   │   └── src/
│   │       ├── agent/        # Orchestrator, planner, recorder, prompts
│   │       ├── llm/          # Provider layer + adapters (Anthropic, OpenAI)
│   │       ├── memory/       # Domain memory + user memory
│   │       ├── safety/       # Action classifier + audit logging
│   │       ├── tools/        # Tool registry (11 browser tools)
│   │       ├── routes/       # API endpoints (auth, chat, sites, memory, etc.)
│   │       ├── ws/           # WebSocket handler
│   │       └── db/           # Drizzle schema + migrations
│   │
│   └── web/             # Dashboard (Next.js)
│       ├── app/
│       │   ├── login/        # Email/password auth
│       │   └── (dashboard)/  # Stats, history, audit, sites, memory, settings
│       └── lib/
│           ├── auth-context.tsx  # AuthProvider (JWT-based)
│           └── api.ts            # API client with auth headers
│
├── packages/shared/     # Shared TypeScript types
├── docs/                # Architecture, features, business plan
├── docker-compose.yml
└── .env.example
```

## Auth

This repo is **JWT-only**. No Clerk, no vendor auth SDK.

| Deployment | How users log in | How the extension authenticates |
|---|---|---|
| **Self-hosted** | Dashboard login form (email + password) | Copy JWT from dashboard |
| **Cloud** | External auth (e.g. Clerk) → token exchange → JWT | Same JWT |
| **Enterprise** | Company SSO (OIDC) → token exchange → JWT | Same JWT |

The API exposes `POST /api/token/exchange` as a bridge for external auth providers. They verify their own tokens and pass `{ externalId, email }` to get a JWT back. The API and extension never know what auth provider was used.

## LLM Providers

Bring your own key. Set `LLM_PROVIDER` and `LLM_API_KEY` in `.env`.

| Provider | Strong Model | Fast Model | Status |
|----------|-------------|------------|--------|
| Anthropic | Claude Sonnet/Opus | Claude Haiku | Supported |
| OpenAI | GPT-4o / o3 | GPT-4o-mini | Supported |
| Google | Gemini Pro | Gemini Flash | Planned |
| Ollama | Any local model | Any local model | Planned |

## Safety

Every browser action is classified before execution:

- **Safe** (auto-approved): navigate, read, search, filter, scroll, extract
- **Review** (needs approval): form submit, create, update, send
- **Blocked** (never auto-approved): delete, bulk operations, permission changes

Kill switch: press Escape to halt all agent activity immediately.

## Tech Stack

- **TypeScript** everywhere
- **Hono** for HTTP, **ws** for WebSocket
- **Drizzle ORM** + Postgres + pgvector
- **React 19** + Tailwind + shadcn/ui (extension + dashboard)
- **Vite + CRXJS** for extension dev
- **pnpm** + **Turborepo** monorepo
- **Biome** for linting/formatting
- **Docker** for deployment

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm docker:up` | Start Postgres via Docker |
| `pnpm db:migrate` | Run database migrations |
| `pnpm dev` | Start all apps (API + dashboard) |
| `pnpm build` | Production build |
| `pnpm lint` | Run Biome linter |
| `pnpm test` | Run tests |

## Docs

- [Architecture](docs/ARCHITECTURE.md) — system design, data flow, deployment
- [Features](docs/FEATURES.md) — user flows, feature tiers, safety model
- [Tech Stack](docs/TECH_STACK.md) — why we chose what we chose
- [Business Plan](docs/BUSINESS_PLAN.md) — cloud vs OSS, competitive landscape

## License

MIT
