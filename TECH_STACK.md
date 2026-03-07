# Tech Stack

## Guiding Principles

1. **Minimize providers** — fewer bills, fewer API keys, fewer failure points
2. **Docker-first** — everything must self-host (enterprise requirement)
3. **Don't build what exists** — Agent SDK gives us the agentic loop, subagents, hooks, sessions for free
4. **Start simple** — no premature infrastructure. Add complexity only when needed.

---

## The Stack

### Chrome Extension

| Choice | Why |
|--------|-----|
| **TypeScript** | Type safety across extension + backend |
| **React 19 + Tailwind + shadcn/ui** | Side panel chat UI, fast to build |
| **Vite + CRXJS** | HMR for extension development (Webpack is painful) |
| **Dexie.js** | Type-safe IndexedDB wrapper for local storage |
| **Chrome Manifest V3** | Required for Chrome Web Store |

### Backend

| Choice | Why |
|--------|-----|
| **Node.js + Hono** | Lightweight HTTP framework, works in Docker |
| **Claude Agent SDK** | Core brain — agentic loop, subagents, hooks, MCP, sessions |
| **Custom MCP Server (browser-bridge)** | Exposes browser actions as MCP tools for the Agent SDK |
| **Drizzle ORM** | Type-safe Postgres access, good migration story |
| **ws** | WebSocket server for extension ↔ backend communication |
| **Inngest** | Durable workflows for scheduled agents and crawl orchestration |
| **Docker** | Containerized deployment, self-hosted story |

### Database

| Choice | Why |
|--------|-----|
| **PostgreSQL 16 + pgvector** | Single DB for everything — relational data + vector embeddings |
| **Neon** (cloud) / **pgvector/pgvector:pg16** (self-hosted) | Serverless for cloud, standard Docker image for self-hosted |

### AI

| Choice | Why |
|--------|-----|
| **Anthropic Claude API** (via Agent SDK) | Best reasoning + vision + tool use |
| — Sonnet | Planning, complex reasoning, form logic |
| — Haiku | Fast action decisions, data extraction |
| — Vision | Screenshot analysis when selectors fail |
| **Voyage AI** (optional) | Embeddings for semantic element search. Local model fallback for self-hosted |

### Monorepo

| Choice | Why |
|--------|-----|
| **Turborepo** | Build orchestration |
| **pnpm** | Fast, disk-efficient package manager |
| **Biome** | Linting + formatting (faster than ESLint + Prettier) |

---

## Why These Choices

### Agent SDK Over Raw Claude API

The Agent SDK eliminates ~40% of what we'd build custom:

| We get for free | What we'd have built |
|-----------------|---------------------|
| Agentic loop (plan → act → observe → replan) | Custom ReAct implementation |
| Subagents with context isolation | Custom swarm coordinator |
| PreToolUse / PostToolUse hooks | Custom safety middleware |
| Sessions (resume agents) | Custom state persistence |
| MCP tool integration | Custom tool execution engine |
| Permission modes | Custom permission system |

### Docker Over Cloudflare Workers

Agent SDK runs long-running processes (agents can run for minutes). Workers have 30-second CPU limits. Docker is also required for the self-hosted enterprise story.

### Postgres Over Separate Vector DB

pgvector handles our embedding search needs. One fewer provider to manage. We're not at a scale where a dedicated vector DB (Pinecone, etc.) adds value.

### Inngest Over Temporal

Temporal is powerful but overkill — needs its own infrastructure cluster. Inngest is serverless-native, has a generous free tier, and handles everything we need: scheduled runs, retries, fan-out.

### JWT Auth Over Clerk/WorkOS (For Now)

Simple bcrypt + JWT is enough to start. We'll add Clerk or WorkOS when enterprise customers need SAML/SCIM. No point paying for auth infra before we have paying users.

---

## Provider Summary

Only 4 external providers. Everything else is self-hosted.

| Provider | Purpose | Monthly Cost (Early) |
|----------|---------|---------------------|
| **Anthropic** | Claude API (via Agent SDK) | $50-200 |
| **Voyage AI** | Embeddings (optional, local fallback) | <$5 |
| **Neon** | Managed Postgres (cloud version only) | Free → $19 |
| **Inngest** | Workflow scheduling | Free → $25 |

**Total:** ~$75-250/month. Self-hosted version needs only Anthropic ($50+).

---

## Project Structure

```
agents-for-everyone/
├── apps/
│   ├── extension/              # Chrome Extension
│   │   ├── src/
│   │   │   ├── background/     # Service worker
│   │   │   ├── content/        # Content scripts (indexer, selector, executor)
│   │   │   ├── sidepanel/      # Chat UI (React)
│   │   │   └── shared/         # Types, storage
│   │   ├── manifest.json
│   │   └── vite.config.ts
│   │
│   └── api/                    # Backend
│       ├── src/
│       │   ├── server.ts       # Hono HTTP + WS
│       │   ├── agent/          # Agent SDK integration
│       │   ├── mcp/            # Browser bridge MCP server
│       │   ├── routes/         # API endpoints
│       │   ├── db/             # Drizzle schema + migrations
│       │   └── workflows/      # Inngest functions
│       └── Dockerfile
│
├── packages/
│   └── shared/                 # Shared types (actions, elements, messages)
│
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```
