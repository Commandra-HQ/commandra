# CLAUDE.md — Rules for All LLMs Working on This Project

## What This Project Is

An open-source platform (Chrome extension + backend) that lets anyone automate tasks on any web application through natural language. Think "Cursor for internal dashboards." Show once, automate forever.

## Project Structure (Parent Level)

```
commandra/
├── commandra/                # THIS REPO — the open-source product
│   ├── apps/extension/       # Chrome Extension (thin client)
│   ├── apps/api/             # Backend (Hono + orchestrator)
│   ├── apps/web/             # Dashboard (Next.js)
│   └── packages/shared/      # Shared types
└── landing-page/             # SEPARATE REPO — landing page + Clerk auth (not open source)
```

This monorepo is the product. It's what gets open-sourced. It's what self-hosted users run. The landing page and auth bridge live in a separate project.

## Architecture in One Paragraph

Chrome extension (thin client) handles UI, DOM indexing, element selection, screenshots, and action execution. Backend (Node.js + Hono) runs a custom provider-agnostic orchestrator that handles all reasoning, planning, and agent orchestration — no vendor SDK, just our own agentic loop. Browser actions are exposed through a tool registry — the orchestrator calls tools, they get forwarded to the extension via WebSocket. Agents always execute in the user's browser (never server-side browsers) — this is the core privacy guarantee. Postgres + pgvector stores everything. The whole thing runs in Docker. Auth is JWT-only in this repo — no Clerk dependency. External auth providers (Clerk, OIDC) can exchange tokens for JWTs via the `/api/token/exchange` endpoint.

## Rules

### Code Style
- TypeScript everywhere (extension + backend + shared packages)
- Use Biome for linting and formatting, not ESLint/Prettier
- pnpm as package manager, never npm or yarn
- Drizzle ORM for all database access, never raw SQL in application code
- Hono for HTTP routes, never Express
- Use `ws` library for WebSocket, not Socket.io

### Architecture Rules
- The extension is a THIN CLIENT. No LLM calls from the extension. No agent logic in the extension. It indexes the DOM, executes actions, takes screenshots, and renders UI. That's it.
- All LLM reasoning happens in the backend via our own orchestration layer (NOT a vendor SDK)
- LLM provider is configurable — Anthropic, OpenAI, Google, Bedrock, Ollama. Users bring their own keys.
- Browser actions are exposed through a tool registry. Each tool sends a WS message to the extension and returns the result.
- Every browser action flows: Orchestrator → tool call → WebSocket → extension → DOM
- Never send raw page content (HTML, text values, PII) to the backend. Only send page STRUCTURE (element types, labels, selectors, navigation graph) and screenshots (configurable)
- Never send or store user credentials, session cookies, or auth tokens
- Agents always execute in the user's browser, never server-side browsers

### Auth Rules
- This repo is JWT-only. No Clerk, no vendor auth SDK.
- The auth middleware (`apps/api/src/middleware/auth.ts`) resolves a request to `{ id, email, orgId?, role? }` — that's the contract
- JWTs may contain `orgId` and `role` for cloud team/org users — these are optional
- Dashboard (`apps/web`) has built-in email/password auth via `AuthProvider` context (`apps/web/lib/auth-context.tsx`)
- Dashboard layout (`apps/web/app/(dashboard)/layout.tsx`) redirects to `/login` via `useEffect` (not during render) when unauthenticated
- Dashboard also accepts tokens via `/auth/callback?token=<jwt>` — used by the cloud landing page redirect flow. Callback stores token in localStorage then does a full page reload (`window.location.href`) so `AuthProvider` re-mounts with the token.
- External auth providers (Clerk, OIDC, etc.) integrate via `POST /api/token/exchange`:
  - Required: `{ externalId, email }` — upserts user, returns JWT with Postgres UUID
  - Optional: `{ orgExternalId, orgName, role }` — upserts org + membership, includes in JWT
- For cloud: landing page (Clerk) → `/auth/redirect` → `GET /api/token` → calls `POST /api/token/exchange` → redirects to dashboard `/auth/callback?token=<jwt>`
- For enterprise: their IdP (Okta, Azure AD) → OIDC callback → token exchange → JWT
- Never import Clerk or any auth vendor SDK in this repo

### Organizations
- Organizations are optional — only used for cloud team plans and enterprise deployments
- Schema: `organizations` (id, name, slug, externalId) + `orgMembers` (orgId, userId, role)
- Nullable `orgId` FK on: `sites`, `flows`, `conversations`, `auditLogs`
- Data scoping: `getOrgOrUserScope()` helper (`apps/api/src/db/scope.ts`) returns org-scoped or user-scoped WHERE clause
- When `user.orgId` is set, queries scope by org (shared data). Otherwise, scope by userId (personal data).
- Org API routes: `apps/api/src/routes/orgs.ts` — CRUD for orgs + member management (admin-only)
- Self-hosted RBAC (instance-level roles without orgs) is a future phase

### Safety Rules
- Every browser action MUST be classified before execution: safe / review / blocked
- Destructive actions (delete, bulk operations, permission changes) are BLOCKED by default
- Write actions (form submit, create, update) require user approval by default
- Read actions (navigate, extract, search, filter) are auto-approved
- Always implement a kill switch (Escape key halts all agent activity)
- Never bypass the safety classification system

### Agent Orchestration
- Provider-agnostic: all LLM calls go through the provider layer (`apps/api/src/llm/`)
- Never import a vendor SDK directly outside the provider adapter files
- Use the strong model for planning and complex reasoning, fast model for data reads and navigation
- Safety classification happens pre-execution in the orchestrator loop
- Audit logging happens post-execution in the orchestrator loop
- **Parallel tool calling**: safe tools execute in parallel via `Promise.allSettled`, review tools sequential with approval gates, blocked tools rejected immediately
- **Token budget management**: strips old screenshots, truncates long results, catches context_length_exceeded and retries with aggressive trimming
- **Internal tools** (not routed through WS): `save_memory`, `recall_memory`, `spawn_agent`, `wait_for_agents`
- **Multi-agent swarm**: coordinator (strong model) spawns sub-agents (fast model) in separate browser tabs via `open_tab`/`close_tab` WS actions. Max 3 concurrent, 5 iterations each, 60s timeout. Tabs auto-cleaned on completion.

### Memory System
- 3 layers: conversation memory (summarization), domain memory (shared per-domain), user memory (per-user-per-domain)
- User memory is relevance-scored: confidence × recency × reinforcement × category priority. Top-15 injected into prompt. Corrections always loaded.
- `recall_memory` tool for on-demand memory search mid-conversation
- `save_memory` used in real-time when corrections/preferences detected (not just post-conversation)
- Domain memory cached in-memory with 5-min TTL, invalidated on updates
- Smart extraction: strong model used when correction signals detected in conversation
- Outcome tracking: users rate conversations (success/failure), reinforces/flags memories accordingly
- Conversation embeddings: user messages embedded for "do that thing again" recall

### Prompt Caching
- Anthropic: `cache_control: { type: 'ephemeral' }` on system prompt for ~90% input token cost reduction on multi-turn conversations

### Database
- Postgres + pgvector, single database for everything
- Use Drizzle migrations, never manual schema changes
- Audit logs are append-only, never update or delete them
- Element embeddings use pgvector (1024 dims), no separate vector DB
- Embedding provider is configurable via `EMBEDDING_PROVIDER` env var: `voyage` (default for Anthropic), `openai`, or `ollama`
- Embedding adapters live in `apps/api/src/llm/embeddings.ts` alongside the LLM provider layer
- Org-scoped tables have nullable `orgId` — use `getOrgOrUserScope()` for queries

### File Structure
- Monorepo with Turborepo: `apps/extension`, `apps/api`, `apps/web`, `packages/shared`
- Shared types go in `packages/shared`, never duplicate type definitions
- Extension content scripts go in `apps/extension/src/content/`
- Agent-related code goes in `apps/api/src/agent/`
- Orchestrator: `apps/api/src/agent/orchestrator.ts` (main agentic loop)
- Multi-agent swarm: `apps/api/src/agent/swarm.ts` (sub-agent lifecycle + tab management)
- Memory: `apps/api/src/memory/` (conversation.ts, domain.ts, user.ts)
- LLM provider adapters go in `apps/api/src/llm/providers/`
- Embeddings: `apps/api/src/llm/embeddings.ts`
- Vector search: `apps/api/src/db/vector-search.ts`
- Auth middleware: `apps/api/src/middleware/auth.ts`
- Org + data scoping: `apps/api/src/db/scope.ts`, `apps/api/src/routes/orgs.ts`
- Dashboard (Next.js) goes in `apps/web/`
- Dashboard auth callback: `apps/web/app/auth/callback/page.tsx` (for cloud redirect flow)

### Don't
- Don't add Cloudflare Workers, Vercel, or serverless runtimes — we use Docker
- Don't add Redis — in-memory cache is fine for now
- Don't add a separate vector database — pgvector handles it
- Don't add PostHog, Amplitude, or analytics — console logs + Sentry for now
- Don't add features that aren't being built in the current phase
- Don't over-engineer. If three lines of code work, don't create an abstraction
