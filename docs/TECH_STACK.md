# Tech Stack

## Guiding Principles

1. **Minimize providers** — fewer bills, fewer API keys, fewer failure points
2. **Docker-first** — everything must self-host (enterprise requirement)
3. **Provider-agnostic** — never lock into one LLM vendor
4. **Pluggable auth** — product ships with adapters, users pick what fits their setup
5. **Start simple** — no premature infrastructure. Add complexity only when needed.

---

## The Stack

### Chrome Extension

| Choice | Why |
|--------|-----|
| **TypeScript** | Type safety across extension + backend |
| **React 19 + Tailwind + shadcn/ui** | Side panel chat UI, fast to build |
| **Vite + CRXJS** | HMR for extension development (Webpack is painful) |
| **react-markdown** | Renders LLM markdown responses in chat |
| **Chrome Manifest V3** | Required for Chrome Web Store |

### Backend

| Choice | Why |
|--------|-----|
| **Node.js + Hono** | Lightweight HTTP framework, works in Docker |
| **Custom Orchestrator** | Provider-agnostic agentic loop — ~300 lines, no framework deps |
| **LLM Provider Layer** | Adapters for Anthropic, OpenAI (pluggable Google, Bedrock, Ollama) |
| **Drizzle ORM** | Type-safe Postgres access, good migration story |
| **JWT Auth** | JWT-only auth with token exchange bridge for external providers |
| **ws** | WebSocket server for extension ↔ backend communication |
| **jose** | JWT signing/verification for auth tokens |
| **Docker** | Containerized deployment, self-hosted story |

### Dashboard

| Choice | Why |
|--------|-----|
| **Next.js 15** | App router, server components |
| **shadcn/ui + Tailwind** | Consistent design system with extension |
| **AuthProvider context** | JWT-based auth with email/password login (no vendor SDK) |

### Database

| Choice | Why |
|--------|-----|
| **PostgreSQL 16 + pgvector** | Single DB for everything — relational data + vector embeddings |
| **Neon** (cloud) / **pgvector/pgvector:pg16** (self-hosted) | Serverless for cloud, standard Docker image for self-hosted |

### AI

| Choice | Why |
|--------|-----|
| **Anthropic Claude** | Best reasoning + vision + tool use, extended thinking |
| **OpenAI GPT-4.1 / o-series** | Alternative provider, reasoning token streaming |
| — Strong model (Sonnet/GPT-4.1) | Planning, complex reasoning, form logic |
| — Fast model (Haiku/GPT-4.1-mini) | Data reads, navigation, memory extraction |
| **Voyage AI** (default) | Element/flow/memory vector search (Anthropic-recommended) |
| **OpenAI Embeddings** | Alternative embedding provider |
| **Ollama** | Local embeddings + LLM for self-hosted |

### Monorepo

| Choice | Why |
|--------|-----|
| **Turborepo** | Build orchestration |
| **pnpm** | Fast, disk-efficient package manager |
| **Biome** | Linting + formatting (faster than ESLint + Prettier) |

---

## Why These Choices

### Custom Orchestrator Over Agent Frameworks

We built our own agentic loop instead of using Claude Agent SDK, LangChain, or similar:

| We built (~300 lines) | What we'd need from a framework |
|------------------------|-------------------------------|
| Agentic loop (LLM → tool → observe → repeat) | Same, but locked to one provider |
| SSE streaming of thinking + text + tool events | Generic streaming, needs custom adapter |
| Safety classification + approval gates | External middleware, harder to integrate |
| Provider-agnostic (Anthropic, OpenAI, any) | Usually tied to one vendor |

The orchestrator is simpler, debuggable, and fully under our control.

### JWT-Only Auth Over Vendor Lock-in

This repo has zero auth vendor dependencies. Auth resolves to `{ id, email, orgId?, role? }` everywhere.

```
Self-hosted:  Dashboard login form → POST /api/auth/login → JWT
Cloud:        External auth (Clerk) → POST /api/token/exchange → JWT (with org info)
Enterprise:   Company SSO (OIDC) → POST /api/token/exchange → JWT (with org info)
```

The `landing-page/` repo (not open source) has Clerk for cloud users. After sign-in, users are auto-redirected to the dashboard via `/auth/redirect` → `GET /api/token` → `POST /api/token/exchange` → redirect to dashboard `/auth/callback?token=<jwt>`. The product never sees Clerk tokens. Token exchange also handles org info — Clerk organizations are mapped to commandra orgs with role-based membership. Enterprise users integrate their SSO via the same token exchange endpoint.

### Docker Over Cloudflare Workers

Long-running agent processes (agents can run for minutes). Workers have 30-second CPU limits. Docker is also required for the self-hosted story.

### Postgres Over Separate Vector DB

pgvector handles our embedding search needs. One fewer provider to manage. We're not at a scale where a dedicated vector DB (Pinecone, etc.) adds value.

---

## Provider Summary

Self-hosted needs only an LLM provider key + Postgres. Everything else is optional.

| Provider | Purpose | Required? |
|----------|---------|-----------|
| **Anthropic or OpenAI** | LLM (strong + fast models) | Yes (pick one) |
| **Voyage AI, OpenAI, or Ollama** | Embeddings (configurable via `EMBEDDING_PROVIDER`) | Yes (pick one) |
| **Clerk** | Auth (cloud — lives in landing-page/ repo) | Cloud only |
| **Neon** | Managed Postgres (cloud) | Cloud only |

---

## Project Structure

```
commandra/                      # Parent folder
├── commandra/                  # THIS REPO — the open-source product
│   ├── apps/
│   │   ├── extension/          # Chrome Extension (thin client)
│   │   │   ├── src/
│   │   │   │   ├── background/ # Service worker (WS client, action router)
│   │   │   │   ├── content/    # Content scripts (indexer, selector, executor)
│   │   │   │   ├── sidepanel/  # Chat UI (React), flows, teach mode
│   │   │   │   └── styles.css  # Tailwind + typography
│   │   │   ├── manifest.json
│   │   │   └── vite.config.ts
│   │   │
│   │   ├── api/                # Backend
│   │   │   ├── src/
│   │   │   │   ├── server.ts   # Hono HTTP + WS
│   │   │   │   ├── agent/      # Orchestrator, planner, recorder, prompts
│   │   │   │   ├── llm/        # Provider layer + adapters (Anthropic, OpenAI)
│   │   │   │   ├── memory/     # Domain memory + user memory
│   │   │   │   ├── safety/     # Classifier + audit logging
│   │   │   │   ├── tools/      # Tool registry (11 browser tools)
│   │   │   │   ├── routes/     # API endpoints (auth, orgs, sites, flows, etc.)
│   │   │   │   ├── ws/         # WebSocket handler
│   │   │   │   ├── db/         # Drizzle schema + migrations + scope helper
│   │   │   │   └── middleware/ # Auth middleware (JWT → { id, email, orgId?, role? })
│   │   │   └── Dockerfile
│   │   │
│   │   └── web/                # Dashboard (Next.js)
│   │       ├── app/
│   │       │   ├── login/       # Email/password auth
│   │       │   ├── auth/callback/ # Cloud auth redirect callback
│   │       │   └── (dashboard)/ # Stats, history, audit, sites, memory, org settings
│   │       └── components/      # shadcn/ui components
│   │
│   ├── packages/
│   │   └── shared/             # Shared types (SSE events, actions, elements)
│   │
│   ├── docs/                   # Architecture, features, business plan, phases
│   ├── docker-compose.yml
│   ├── turbo.json
│   ├── pnpm-workspace.yaml
│   └── .env.example
│
└── landing-page/               # SEPARATE PROJECT — landing page + Clerk auth (not open source)
```
