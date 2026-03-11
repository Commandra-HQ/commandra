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
| **Pluggable Auth** | `AuthProvider` interface with Clerk and JWT adapters |
| **ws** | WebSocket server for extension ↔ backend communication |
| **jose** | JWT signing/verification for auth tokens |
| **Docker** | Containerized deployment, self-hosted story |

### Dashboard

| Choice | Why |
|--------|-----|
| **Next.js 15** | Server components + API routes |
| **shadcn/ui + Tailwind** | Consistent design system with extension |
| **Clerk React** (cloud default) | Auth UI components for cloud deployment |

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
| **OpenAI Embeddings** | Element/flow/memory vector search |
| **Ollama** (planned) | Local embeddings + LLM for self-hosted |

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

### Pluggable Auth Over Hard Clerk Dependency

Auth is behind an interface. The product doesn't import Clerk directly — it imports the auth middleware, which delegates to whichever adapter is configured.

```
AUTH_PROVIDER=clerk   →  Clerk JWT verification (cloud default)
AUTH_PROVIDER=jwt     →  Simple JWT with jose (self-hosted default)
```

Both resolve to `{ id, email }`. Everything downstream only sees that. Self-hosted users can also write their own adapter (OIDC, SAML, API key, whatever).

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
| **OpenAI** | Embeddings (text-embedding-3-small) | Optional (can use Ollama) |
| **Clerk** | Auth (cloud deployment) | Cloud only |
| **Neon** | Managed Postgres (cloud) | Cloud only |

---

## Project Structure

```
agents-for-everyone/            # Parent folder
├── browser-agent-platform/     # THIS REPO — the open-source product
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
│   │   │   │   ├── routes/     # API endpoints
│   │   │   │   ├── ws/         # WebSocket handler
│   │   │   │   ├── db/         # Drizzle schema + migrations
│   │   │   │   └── middleware/ # Auth middleware + adapters
│   │   │   └── Dockerfile
│   │   │
│   │   └── web/                # Dashboard (Next.js)
│   │       ├── app/
│   │       │   ├── (dashboard)/ # Main pages (stats, history, audit, sites, memory, settings)
│   │       │   └── api/         # Token exchange route
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
└── website/                    # SEPARATE PROJECT — landing page + Stripe (not open source)
```
