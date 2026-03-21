# CLAUDE.md — Rules for All LLMs Working on This Project

## What This Project Is

An open-source platform (Chrome extension + backend) that lets anyone automate tasks on any web application through natural language. Think "Cursor for internal dashboards." Users create specialized, self-improving agents that work in their browser, learn from every run, and can invoke each other.

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

Chrome extension (thin client) handles UI, DOM indexing, element selection, screenshots, user identity detection, and action execution. Backend (Node.js + Hono) runs a custom provider-agnostic orchestrator that handles all reasoning, planning, and agent orchestration — no vendor SDK, just our own agentic loop. Browser actions are exposed through a tool registry — the orchestrator calls tools, they get forwarded to the extension via WebSocket. Page state auto-refreshes after state-changing actions (click, navigate, type, select). Agents manage their own knowledge via `save_knowledge`/`read_knowledge`/`list_knowledge` tools — the agent decides what to save about each app, writing directly to S3 (KNOWLEDGE.md, WORKFLOWS.md) during conversations. Agents always execute in the user's browser (never server-side browsers) — this is the core privacy guarantee. Postgres stores structured data. Supabase Storage stores agent files (AGENT.yaml, SOUL.md, SKILLS.md, LEARNINGS.md, workspace/) and domain knowledge files. The whole thing runs in Docker. Auth is JWT-only in this repo — no Clerk dependency. External auth providers (Clerk, OIDC) can exchange tokens for JWTs via the `/api/token/exchange` endpoint.

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
- Nullable `orgId` FK on: `sites`, `conversations`, `auditLogs`
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

### Agent System (Phase 15 — Active)
- **Agents are files**: each agent is a folder in Supabase Storage with `SOUL.md` (personality/identity), `SKILLS.md` (learned capabilities), `LEARNINGS.md` (corrections/discoveries), `ERRORS.md` (failure patterns). Metadata (slug, name, model, tools, domains, trigger) lives in Postgres `agents` table.
- **Agent registry**: `apps/api/src/agent/agent-registry.ts` — CRUD, domain-match resolution, hydration (DB row + Storage files). `loadAgentBySlug()` for slug-based lookup.
- **Default agent**: every user gets a `_coordinator` agent (hardcoded, not in DB). Users who never create agents get this automatically. Coordinator does NOT trigger self-improvement.
- **Agent-to-agent invocation**: `spawn_agent` tool accepts optional `agentSlug` parameter to target a specific agent. Sub-agents inherit the target agent's identity (SOUL.md), model, tool allowlist, and learned files. Max invocation depth: 2 — at depth >= 2, spawn_agent/wait_for_agents are excluded from tool list.
- **Self-improvement**: after every non-coordinator agent run, `analyzeAndImprove()` calls the fast model to extract new skills/learnings/errors and appends timestamped entries to the agent's files in Supabase Storage. `recordAgentRun()` inserts a row into `agent_runs` for tracking. Both are fire-and-forget (never block the response).
- **Agent scheduler**: agents with `trigger: { cron, enabled }` run on a 60-second interval. Flow: query scheduled agents → cron match → check active WS connection → cheap LLM check (YES/NO) → full orchestrator run with no-op SSE handler. `startScheduler()` called at server startup, `stopScheduler()` on SIGTERM/SIGINT.
- **Supabase Storage**: Single `agents` bucket for all files. Client at `apps/api/src/storage/supabase.ts`. Paths:
  - Agent files: `{userId}/{agentSlug}/SOUL.md`, `SKILLS.md`, etc.
  - Plans: `{userId}/plans/{conversationId}/PLAN.md`
  - Domain knowledge: `domains/{userId}/{domain}/KNOWLEDGE.md`, `WORKFLOWS.md`, `MEMORY.md`
  - Run logs: `runs/{userId}/{date}/filename.md`

### Agent Orchestration
- Provider-agnostic: all LLM calls go through the provider layer (`apps/api/src/llm/`)
- Never import a vendor SDK directly outside the provider adapter files
- Use the strong model for planning and complex reasoning, fast model for data reads and navigation
- Safety classification happens pre-execution in the orchestrator loop
- Audit logging happens post-execution in the orchestrator loop
- **Per-agent config**: orchestrator accepts `AgentConfig` — respects agent's model, tool allowlist, safety overrides, max iterations
- **Parallel tool calling**: safe tools execute in parallel via `Promise.allSettled`, review tools sequential with approval gates, blocked tools rejected immediately
- **Token budget management**: strips old screenshots, truncates long results, catches context_length_exceeded and retries with aggressive trimming
- **Internal tools** (not routed through WS): `save_memory`, `recall_memory`, `save_knowledge`, `read_knowledge`, `list_knowledge`, `spawn_agent`, `wait_for_agents`, `save_to_local`, `create_agent`, `update_agent_files`
- **Agent-driven knowledge**: agents persist domain knowledge during execution via `save_knowledge` (writes to S3), `read_knowledge` (reads from S3), and `list_knowledge` (lists S3 files). No background extraction — the agent decides what to save.
- **Agent creation from chat**: `create_agent` tool lets the LLM create agents mid-conversation when it detects repeatable workflows, scheduled tasks, or explicit user requests. `update_agent_files` writes SOUL.md/SKILLS.md for the new agent. Agents emerge from usage — users don't need to visit the dashboard.
- **Multi-agent swarm**: coordinator spawns sub-agents (with target agent identity) in separate browser tabs via `open_tab` WS action. Max 3 concurrent, 10 iterations each, 2min timeout. Sub-agents use the target agent's model, tool allowlist, and SOUL.md. Tabs persist after completion (user can inspect). `recordAgentRun()` called for non-coordinator sub-agents.
- **Auto page state refresh**: after `click_element`, `navigate`, `type_text`, `select_option` — orchestrator auto-calls `get_page_state` and merges updated DOM into the tool result (500ms delay for SPA transitions)
- **Structured tool call history**: assistant messages stored with `toolData` jsonb (tool names, args, results, success). On conversation resume, tool summaries appended to history for multi-turn action context
- **Site identity detection**: extension indexer detects logged-in user via avatar alt text, profile elements, aria-labels, meta tags. Injected into system prompt as "Logged-in user"

### Memory System
- **Agent-driven knowledge management**: agents manage their own knowledge via tools, no background LLM extraction
- `save_knowledge` tool writes domain knowledge to S3 (Supabase Storage) — the agent decides what facts, workflows, and preferences to persist
- `read_knowledge` tool reads domain knowledge files from S3 for a given domain
- `list_knowledge` tool lists available knowledge files for a domain
- `recall_memory` tool for on-demand memory search mid-conversation — uses keyword search against Postgres user_memory
- `save_memory` used in real-time when corrections/preferences detected (not just post-conversation)
- **Domain knowledge (S3)**: per-user domain knowledge in Supabase Storage (`domains/{userId}/{domain}/KNOWLEDGE.md`, `WORKFLOWS.md`, `MEMORY.md`). Written by the agent during conversations via `save_knowledge`, read back via `read_knowledge`.
- Conversation memory: compresses messages >20 into summaries using the fast model
- Outcome tracking: users rate conversations (success/failure), reinforces/flags memories accordingly

### Prompt Caching
- Anthropic: `cache_control: { type: 'ephemeral' }` on system prompt for ~90% input token cost reduction on multi-turn conversations

### Database & Storage
- Postgres for structured data, Supabase Storage for agent files and domain knowledge
- Use Drizzle migrations, never manual schema changes
- Audit logs are append-only, never update or delete them
- Org-scoped tables have nullable `orgId` — use `getOrgOrUserScope()` for queries
- `messages.tool_data` (jsonb): stores structured tool call records (name, args, result, success) alongside assistant text for multi-turn context
- `agents` table: metadata (slug, name, description, model, maxIterations, tools, domains, trigger). Personality/skills live in Supabase Storage, not DB.
- `agent_runs` table: run history (agentId, userId, conversationId, status, toolCalls, tokensUsed, durationMs, error)
- Agent files (SOUL.md, SKILLS.md, LEARNINGS.md, ERRORS.md) live in Supabase Storage bucket `agents`, path: `{userId}/{agentSlug}/{filename}`

### File Structure
- Monorepo with Turborepo: `apps/extension`, `apps/api`, `apps/web`, `packages/shared`
- Shared types go in `packages/shared`, never duplicate type definitions
- Extension content scripts go in `apps/extension/src/content/`
- **Backend agent modules** (`apps/api/src/agent/`):
  - `orchestrator.ts` — main agentic loop (LLM streaming, tool dispatch, compaction)
  - `tool-definitions.ts` — internal tool schemas (memory, knowledge, agents, plans)
  - `internal-tools.ts` — server-side tool execution handlers (not routed through WS)
  - `browser-tools.ts` — browser tool execution with safety classification + approval gates
  - `token-budget.ts` — context window estimation and trimming
  - `agent-registry.ts` — agent CRUD, domain-match resolution, file hydration
  - `swarm.ts` — multi-agent sub-agent lifecycle + tab management
  - `self-improve.ts` — post-execution analysis (SKILLS.md, LEARNINGS.md, ERRORS.md)
  - `scheduler.ts` — cron evaluation, run dispatch
  - `planner.ts` — plan parsing, approval, workflow templates
  - `prompts.ts` — system prompt construction
- **Extension background** (`apps/extension/src/background/`):
  - `ws-client.ts` — WebSocket connection management + message routing
  - `action-handler.ts` — action dispatch (click, type, navigate, screenshot, etc.)
  - `page-scripts.ts` — injectable page functions (run in DOM context via executeScript)
- **Extension side panel** (`apps/extension/src/sidepanel/tabs/`):
  - `ChatTab.tsx` — main chat component (state, handlers, layout composition)
  - `chat-types.ts` — types, constants, formatters, SSE parser
  - `chat-layout.tsx` — context bar, plan panel, chat input area
  - `message-blocks.tsx` — message block rendering (thinking, text, tool calls, approvals, plans, sub-agents)
  - `use-chat-stream.ts` — SSE streaming hook (block accumulation, rAF flushing)
- Memory: `apps/api/src/memory/` (conversation.ts, domain.ts, user.ts)
- Storage: `apps/api/src/storage/` (supabase.ts, agent-files.ts, domain-files.ts, run-files.ts)
- LLM provider adapters go in `apps/api/src/llm/providers/`
- Auth middleware: `apps/api/src/middleware/auth.ts`
- Org + data scoping: `apps/api/src/db/scope.ts`, `apps/api/src/routes/orgs.ts`
- Agent routes: `apps/api/src/routes/agents.ts` (agent CRUD, files, runs)
- Dashboard (Next.js) goes in `apps/web/`
- Dashboard auth callback: `apps/web/app/auth/callback/page.tsx` (for cloud redirect flow)
- **Dashboard agent pages** (`apps/web/app/(dashboard)/agents/`):
  - `page.tsx` — agent list page, state management, API calls
  - `agent-card.tsx` — expandable agent detail card with file editor
  - `agent-form.tsx` — agent creation form

### Don't
- Don't add Cloudflare Workers, Vercel, or serverless runtimes — we use Docker
- Don't add Redis — in-memory cache is fine for now
- Don't add a separate vector database — not needed
- Don't add PostHog, Amplitude, or analytics — console logs + Sentry for now
- Don't add features that aren't being built in the current phase
- Don't over-engineer. If three lines of code work, don't create an abstraction
- Don't store agent config in Postgres — AGENT.yaml, SOUL.md, SKILLS.md live in Supabase Storage. Only metadata/stats in Postgres.
- Don't build an agent marketplace or cross-user agent sharing yet
- Don't allow nested agent spawning beyond depth 2
