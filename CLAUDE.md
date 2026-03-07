# CLAUDE.md — Rules for All LLMs Working on This Project

## What This Project Is

An open-source platform (Chrome extension + backend) that lets enterprise employees automate tasks on any internal web application through natural language. Think "Cursor for internal dashboards."

## Architecture in One Paragraph

Chrome extension (thin client) handles UI, DOM indexing, element selection, and action execution. Backend (Node.js + Claude Agent SDK) handles all reasoning, planning, and agent orchestration. A custom MCP server called "browser-bridge" exposes browser actions as MCP tools — the Agent SDK calls these tools, they get forwarded to the extension via WebSocket. Postgres + pgvector stores everything. Inngest handles scheduled workflows. The whole thing runs in Docker.

## Rules

### Code Style
- TypeScript everywhere (extension + backend + shared packages)
- Use Biome for linting and formatting, not ESLint/Prettier
- pnpm as package manager, never npm or yarn
- Drizzle ORM for all database access, never raw SQL in application code
- Hono for HTTP routes, never Express
- Use `ws` library for WebSocket, not Socket.io

### Architecture Rules
- The extension is a THIN CLIENT. No LLM calls from the extension. No agent logic in the extension. It indexes the DOM, executes actions, and renders UI. That's it.
- All LLM reasoning happens in the backend via Claude Agent SDK
- Browser actions are exposed as MCP tools through the browser-bridge server
- Every browser action flows: Agent SDK → MCP tool call → WebSocket → extension → DOM
- Never send raw page content (HTML, text values, PII) to the backend. Only send page STRUCTURE (element types, labels, selectors, navigation graph)
- Never send or store user credentials, session cookies, or auth tokens

### Safety Rules
- Every browser action MUST be classified before execution: safe / review / blocked
- Destructive actions (delete, bulk operations, permission changes) are BLOCKED by default
- Write actions (form submit, create, update) require user approval by default
- Read actions (navigate, extract, search, filter) are auto-approved
- Always implement a kill switch (Escape key halts all agent activity)
- Never bypass the safety classification system

### Agent SDK Usage
- Use subagents for parallel or specialized tasks, not one monolithic agent
- Use Haiku for simple/fast tasks (data extraction, navigation), Sonnet for reasoning (form logic, planning)
- Always implement PreToolUse hooks for safety checks
- Always implement PostToolUse hooks for audit logging
- Use sessions to resume interrupted agent runs

### Database
- Postgres + pgvector, single database for everything
- Use Drizzle migrations, never manual schema changes
- Audit logs are append-only, never update or delete them
- Element embeddings use pgvector, no separate vector DB

### File Structure
- Monorepo with Turborepo: `apps/extension`, `apps/api`, `packages/shared`
- Shared types go in `packages/shared`, never duplicate type definitions
- Extension content scripts go in `apps/extension/src/content/`
- Agent-related code goes in `apps/api/src/agent/`
- MCP server code goes in `apps/api/src/mcp/`

### Don't
- Don't add Cloudflare Workers, Vercel, or serverless runtimes — we use Docker
- Don't add Redis — in-memory cache is fine for now
- Don't add a separate vector database — pgvector handles it
- Don't add Auth0 or WorkOS — we use Clerk for auth
- Don't add PostHog, Amplitude, or analytics — console logs + Sentry for now
- Don't add features that aren't being built in the current phase
- Don't over-engineer. If three lines of code work, don't create an abstraction
