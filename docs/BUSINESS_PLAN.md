# Business Plan — Commandra

## The Product

A browser extension + backend platform that lets anyone automate tasks on any web application through natural language. Show once, automate forever. The agent runs in the user's own browser — no screen scraping, no credential sharing, no server-side browsers.

---

## Two Modes

### 1. Cloud (The Business)

We host everything. User installs the extension, signs up, starts automating. Zero config.

```
User's Browser                    Our Infrastructure
┌─────────────────┐              ┌──────────────────────┐
│ Chrome Extension │◄────────────►│ API Server (Hono)    │
│ (thin client)    │   WebSocket  │ Orchestrator         │
│                  │              │ Postgres + pgvector   │
│ DOM interaction  │              │ LLM keys (pooled)    │
│ stays local      │              │ Auth (Clerk) + billing │
└─────────────────┘              └──────────────────────┘
```

**We manage:** API servers, database, LLM API keys (pooled), auth, billing, updates.
**Stays local:** All DOM interaction, page content, credentials, cookies. Screenshots are configurable.

### 2. Open Source (The Distribution)

Full codebase on GitHub, MIT license. `docker-compose up` and it works. They bring their own LLM keys and manage their own infra.

```
User's Machine
┌──────────────────────────────────────────────┐
│  Browser              Docker Stack           │
│  ┌──────────────┐    ┌──────────────────┐    │
│  │ Extension    │◄──►│ API Server       │    │
│  └──────────────┘    │ Postgres         │    │
│                      └──────────────────┘    │
│  + their own Anthropic/OpenAI key            │
└──────────────────────────────────────────────┘
```

OSS gets us: GitHub stars, community trust, security audits from the crowd, PRs, and a pipeline into cloud conversions ("I tried self-hosted, it works, but I don't want to maintain Postgres — just give me the hosted version").

No paid self-hosted tiers. No support contracts. No Helm charts. That's stuff we build after 100 paying cloud users, not before.

---

## Cloud Pricing

| Tier     | Price                     | Target           | Includes                                                    |
| -------- | ------------------------- | ---------------- | ----------------------------------------------------------- |
| **Free** | $0                        | Individual users | 50 agent actions/month, our LLM keys, 1 user               |
| **Pro**  | $29/user/month            | Power users      | Unlimited actions, saved flows, scheduling, priority models |
| **Team** | $19/user/month (5+ seats) | Departments      | Shared flows, team admin, audit logs                        |

No "Enterprise" tier yet. We'll add SSO/SAML when someone asks for it with a PO attached.

Free tier uses our pooled keys (not BYOK) — lower friction, better first experience, we control the quality.

### Unit Economics

| Cost Item                     | Per User/Month               |
| ----------------------------- | ---------------------------- |
| LLM tokens (Anthropic/OpenAI) | ~$3-8 (pooled, with caching) |
| Postgres (Neon)               | ~$0.50                       |
| Compute (API server)          | ~$1                          |
| Auth (Clerk)                  | ~$0.50                       |
| **Total COGS**                | **~$5-10**                   |
| **Pro price**                 | **$29**                      |
| **Gross margin**              | **~65-80%**                  |

---

## What the Tech Needs to Support Both Modes

### Already Built

| Capability                                                 | Status |
| ---------------------------------------------------------- | ------ |
| Provider-agnostic LLM layer (Anthropic, OpenAI, pluggable) | Done   |
| Docker-ready API server (Hono + WS)                        | Done   |
| Postgres + pgvector (works in Docker or Neon)              | Done   |
| Extension as thin client (no server-side browser)          | Done   |
| Safety classification + audit logging                      | Done   |
| Env-based configuration (API keys, DB URL, etc.)           | Done   |
| SSE streaming with structured events + abort support       | Done   |
| Extended thinking (Anthropic)                              | Done   |
| Block-based chat UI (thinking, tool calls, plans)          | Done   |
| Teach mode (record flows, replay with parameters)          | Done   |
| Domain memory + user memory (adaptive)                     | Done   |
| Multi-tenant isolation (userId scoping everywhere)         | Done   |

### Needed for Product (Both Modes)

| Capability                                                | Priority |
| --------------------------------------------------------- | -------- |
| **JWT-only auth** (email/password + token exchange bridge) | Done     |
| **Fix dashboard auth** (stats show 0 — 401 bug)          | P0       |
| **Fix recording step events** (SSE wiring)                | P0       |

### Needed for Cloud Launch (Separate `website/` Project)

| Capability                                        | Priority |
| ------------------------------------------------- | -------- |
| **Landing page** (Next.js + shadcn)               | P1       |
| **Stripe billing** (Checkout + usage metering)    | P1       |
| **LLM key pooling** (our keys for all cloud users)| P1       |
| **Rate limiting per tier** (free = 50/month)      | P1       |
| **Chrome Web Store listing**                      | P1       |

### Nice for OSS (Community Can Contribute)

| Capability                                  | Notes                                  |
| ------------------------------------------- | -------------------------------------- |
| Ollama adapter (local models)               | Provider layer is pluggable            |
| Bedrock / Azure OpenAI adapters             | Same pattern as Anthropic/OpenAI       |
| OIDC / SAML auth adapter                    | AuthProvider interface is pluggable    |
| Helm chart for Kubernetes                   | docker-compose works for now           |

### Repo Split

```
commandra/
├── commandra/                # Open source (MIT) — the product
│   ├── apps/extension/       # Chrome Extension
│   ├── apps/api/             # Backend API
│   ├── apps/web/             # Dashboard
│   └── packages/shared/      # Shared types
└── landing-page/             # Not open source — landing page + Stripe
```

The product repo has no Stripe, no landing page, no cloud billing logic. It's a clean open-source project that works out of the box with `docker-compose up`. The cloud wrapper (landing-page/) adds billing, LLM key pooling, and managed auth on top.

---

## Competitive Landscape

| Player                                    | Approach                     | Our Advantage                                                         |
| ----------------------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| **UiPath / Automation Anywhere**          | Server-side RPA bots, $100K+ | 10x cheaper, no infrastructure, natural language                      |
| **OpenAI Operator / Claude Computer Use** | Cloud browser, general web   | Local execution (no credentials shared), pre-indexed (faster/cheaper) |
| **Browserbase / Multion**                 | Cloud browser APIs           | Same — local execution, works behind VPN/SSO                          |
| **Zapier / Make**                         | API-based automation         | Works with any web UI, no API integration needed                      |
| **Custom scripts / Selenium**             | Code-based automation        | No-code, self-healing selectors, natural language                     |

### Why We Win

1. **Show once, automate forever** — teach mode is the value prop. Record a workflow, replay it with different parameters. No scripting.
2. **Runs in the user's browser** — no credential sharing, works behind VPN/SSO, compliant by default. This is the trust enabler that lets enterprises say yes.
3. **Open source** — security teams can audit everything. Community builds adapters and integrations.
4. **Provider-agnostic** — not locked to one LLM vendor. Use whatever model works best.
5. **Pre-indexed pages** — agent knows the app before you ask. Faster and cheaper than screenshot-reading on every action.

---

## Open Source Strategy

**License:** MIT for the full platform.

**Everything is open source:**
- Chrome extension (thin client)
- Backend API server + orchestrator
- All browser tools + safety engine
- LLM provider adapters
- Database schema + migrations
- Docker deployment

**Cloud adds convenience, not features:**
- Hosted infra (no Docker to manage)
- Pooled LLM keys (no API key setup)
- Managed auth (Clerk in landing-page/ → JWT exchange, no config for users)
- Billing + usage dashboard
- Automatic updates

This follows the Supabase/GitLab model: core is open, cloud adds convenience. The product is the same — cloud just removes the ops burden.
