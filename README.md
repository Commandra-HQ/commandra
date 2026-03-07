# Agents for Everyone

**Cursor for internal dashboards.** Chat with any web application. Automate what you do every day.

Enterprise employees waste hours on repetitive tasks across internal tools — SAP, Salesforce, custom ERPs, HR portals. These sit behind SSO, VPNs, and MFA. No external AI can access them. We can.

## The Problem

A Deloitte consultant opens 4 internal dashboards every morning. Downloads reports. Copies numbers into a spreadsheet. Sends an email summary. Every. Single. Day.

They can't use ChatGPT for this — it can't see their internal apps. They can't write Selenium scripts — they're not engineers. UiPath costs $10K/year and needs IT to set up.

## The Solution

A Chrome extension that lets anyone automate tasks on any web application through natural language.

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

## How It Works

1. **Install** the Chrome extension
2. **Index** — extension maps your web app (pages, buttons, forms, tables)
3. **Chat** — tell the agent what to do in plain English
4. **Select** — point at elements for precise control ("this table → export as CSV")
5. **Save** — promote one-time tasks to reusable flows
6. **Automate** — flows become agents that run on schedule or triggers

## Key Principles

- **Data stays in the browser** — we see page structure, never your actual data
- **Safety first** — destructive actions blocked by default, approval gates on writes
- **Open source** — self-host with Docker, bring your own API key
- **Truly agentic** — powered by Claude Agent SDK with multi-agent coordination

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Docker](https://www.docker.com/) (for Postgres)
- A [Clerk](https://clerk.com/) account (free tier works)
- A Chrome-based browser (Chrome, Brave, Edge, Arc)

### 1. Clone and install

```bash
git clone https://github.com/your-org/agents-for-everyone.git
cd agents-for-everyone
make setup
```

This installs dependencies, starts Postgres (via Docker), and runs database migrations.

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

Required:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — from [Clerk Dashboard](https://dashboard.clerk.com/)
- `CLERK_SECRET_KEY` — from Clerk Dashboard

Also create `apps/web/.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

### 3. Start development

```bash
make dev
```

This starts all three apps:
- **Admin Dashboard** — `http://localhost:3000` (Next.js + Clerk)
- **API Server** — `http://localhost:3001` (Hono)
- **Extension Dev Server** — `http://localhost:5173` (Vite + CRXJS)

### 4. Load the Chrome extension

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `apps/extension/dist`
4. Pin the extension to your toolbar

### 5. Connect

1. Open `http://localhost:3000` and sign up
2. Click "Generate Extension Token" and copy it
3. Click the extension icon → side panel opens
4. Paste the token → you're in

### Available commands

| Command | Description |
|---------|-------------|
| `make setup` | First-time setup (install, DB, migrations) |
| `make dev` | Start all apps (API + dashboard + extension) |
| `make dev-api` | Start API server only |
| `make dev-web` | Start admin dashboard only |
| `make dev-ext` | Start extension only |
| `make db-migrate` | Run database migrations |
| `make db-reset` | Drop and recreate database |
| `make build` | Production build all packages |
| `make lint` | Run Biome linter |
| `make stop` | Stop Docker containers |

## Project Structure

```
apps/
  api/          → Hono API server + WebSocket + Agent SDK
  web/          → Next.js admin dashboard (Clerk auth)
  extension/    → Chrome MV3 extension (side panel, content scripts)
packages/
  shared/       → Shared TypeScript types
docs/
  phases/       → Build phases and roadmap
  ARCHITECTURE.md
  FEATURES.md
  TECH_STACK.md
  USER_FLOW.md
```

## Docs

- [Build Phases](./docs/phases/) — incremental roadmap
- [Architecture](./docs/ARCHITECTURE.md) — system design
- [Features](./docs/FEATURES.md) — capabilities and product thinking
- [Tech Stack](./docs/TECH_STACK.md) — technology choices
- [User Flow](./docs/USER_FLOW.md) — onboarding and daily UX

## License

MIT
