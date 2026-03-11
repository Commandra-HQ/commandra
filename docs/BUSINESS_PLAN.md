# Business Plan — Agents for Everyone

## The Product

A browser extension + backend platform that lets anyone automate tasks on any web application through natural language. The agent runs in the user's own browser — no screen scraping, no credential sharing, no server-side browsers.

---

## Two Deployment Models

### 1. Cloud (Hosted by Us)

We run the backend. Users install the extension, sign up, and start automating.

```
User's Browser                    Our Infrastructure
┌─────────────────┐              ┌──────────────────────┐
│ Chrome Extension │◄────────────►│ API Server (Hono)    │
│ (thin client)    │   WebSocket  │ Orchestrator         │
│                  │              │ Postgres + pgvector   │
│ DOM interaction  │              │ LLM Provider Layer    │
│ stays local      │              │ (Anthropic/OpenAI/etc)│
└─────────────────┘              └──────────────────────┘
```

**What we manage:** API servers, database, LLM API keys (pooled), auth, billing, updates.
**What stays local:** All DOM interaction, page content, credentials, screenshots (configurable).

### 2. On-Prem / Self-Hosted (Customer's Infrastructure)

Customer runs everything in their own environment. We provide Docker images + docs.

```
Customer's Network
┌──────────────────────────────────────────────┐
│                                              │
│  User's Browser         Customer's Servers   │
│  ┌──────────────┐      ┌──────────────────┐  │
│  │ Extension    │◄────►│ Docker Stack      │  │
│  │              │      │ ├─ API Server     │  │
│  └──────────────┘      │ ├─ Postgres       │  │
│                        │ └─ (optional LLM) │  │
│                        └──────────────────┘  │
│                                              │
│  LLM Options:                                │
│  ├─ Customer's Anthropic/OpenAI key          │
│  ├─ AWS Bedrock (in their VPC)               │
│  ├─ Azure OpenAI (in their tenant)           │
│  └─ Self-hosted (Ollama, vLLM)               │
└──────────────────────────────────────────────┘
```

**What we provide:** Docker images, Helm charts, setup docs, migration scripts, support.
**What customer manages:** Infrastructure, LLM keys/hosting, database backups, updates.
**Zero data leaves their network** — this is the enterprise selling point.

---

## Pricing

### Cloud Tiers

| Tier           | Price                     | Target           | Includes                                                 |
| -------------- | ------------------------- | ---------------- | -------------------------------------------------------- |
| **Free**       | $0                        | Individual users | 50 agent actions/month, 1 user, bring your own LLM key   |
| **Pro**        | $29/user/month            | Power users      | Unlimited actions, saved flows, scheduling, our LLM pool |
| **Team**       | $19/user/month (5+ seats) | Departments      | Shared flows, team admin, audit logs, priority support   |
| **Enterprise** | Custom                    | Large orgs       | SSO/SAML, dedicated infra, SLA, compliance reports       |

### Self-Hosted Tiers

| Tier                | Price        | Includes                                                                |
| ------------------- | ------------ | ----------------------------------------------------------------------- |
| **Community (OSS)** | Free forever | Full platform, MIT license, community support                           |
| **Business**        | $499/month   | Priority support, private Slack, update notifications, Helm charts      |
| **Enterprise**      | Custom       | Dedicated support engineer, SLA, custom integrations, on-prem LLM setup |

### Unit Economics (Cloud)

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

## What We Need to Support Both Models

### Already Built (Works for Both)

| Capability                                                 | Status |
| ---------------------------------------------------------- | ------ |
| Provider-agnostic LLM layer (Anthropic, OpenAI, pluggable) | Done   |
| Docker-ready API server (Hono + WS)                        | Done   |
| Postgres + pgvector (works in Docker or Neon)              | Done   |
| Extension as thin client (no server-side browser)          | Done   |
| Safety classification + audit logging                      | Done   |
| Env-based configuration (API keys, DB URL, etc.)           | Done   |

### Needed for Cloud Launch

| Capability                                        | Priority | Effort                        |
| ------------------------------------------------- | -------- | ----------------------------- |
| **Fix dashboard auth** (stats show 0)             | P0       | 1 hour                        |
| **Fix recording step events** (teach mode broken) | P0       | 2 hours                       |
| **Markdown rendering in chat**                    | P0       | 2 hours                       |
| **OpenAI reasoning streaming**                    | P1       | 4 hours                       |
| **Billing integration** (Stripe)                  | P1       | 1 week                        |
| **Usage metering** (action counts per user)       | P1       | 3 days                        |
| **Rate limiting per tier**                        | P1       | 2 days                        |
| **LLM key pooling** (our keys for Pro+ users)     | P1       | 2 days                        |
| **Multi-tenant isolation**                        | P1       | Already done (userId scoping) |
| **Chrome Web Store listing**                      | P1       | 2 days                        |
| **Landing page + docs site**                      | P1       | 1 week                        |

### Needed for Self-Hosted / On-Prem

| Capability                                            | Priority | Effort         |
| ----------------------------------------------------- | -------- | -------------- |
| **docker-compose.yml** (production-ready)             | P0       | Partially done |
| **Helm chart for Kubernetes**                         | P1       | 1 week         |
| **Ollama LLM adapter** (local models)                 | P1       | 3 days         |
| **Bedrock adapter** (AWS enterprise)                  | P1       | 3 days         |
| **Azure OpenAI adapter**                              | P1       | 2 days         |
| **Google Vertex adapter**                             | P2       | 2 days         |
| **Remove Clerk dependency** (self-hosted auth)        | P1       | 1 week         |
| **Setup wizard / CLI**                                | P2       | 3 days         |
| **Backup/restore scripts**                            | P2       | 2 days         |
| **Air-gapped install** (no external calls)            | P2       | 3 days         |
| **Upgrade path** (migration scripts between versions) | P2       | Ongoing        |

### Auth Strategy for Self-Hosted

Current auth uses Clerk. For self-hosted, we need to support:

1. **Clerk (default)** — works for cloud and self-hosted if customer is OK with Clerk
2. **OIDC/SAML** — customer plugs in their identity provider (Okta, Azure AD, etc.)
3. **Simple JWT** — for small self-hosted deployments, basic email/password with bcrypt

Implementation: Auth middleware already extracts `userId` from JWT. We just need to make the JWT issuer configurable:

```
AUTH_PROVIDER=clerk|oidc|local
OIDC_ISSUER=https://login.company.com
OIDC_CLIENT_ID=xxx
```

---

## Go-to-Market

### Phase 1: Open Source Launch (Month 1-2)

- Clean up codebase, fix all broken features
- Polish README, setup docs, demo video
- Launch on GitHub, Hacker News, Product Hunt
- Goal: 500 GitHub stars, 50 active self-hosted users

### Phase 2: Cloud Beta (Month 2-4)

- Deploy hosted version
- Free tier with usage limits
- Collect feedback, iterate on UX
- Goal: 200 cloud users, 20 paying Pro users

### Phase 3: Team Features (Month 4-6)

- Shared flows within organizations
- Team admin dashboard
- Usage analytics
- Goal: 5 paying teams (25+ seats total)

### Phase 4: Enterprise (Month 6-12)

- SSO/SAML integration
- On-prem deployment support
- Compliance features (exportable audit logs)
- Dedicated support
- Goal: 2 enterprise contracts

---

## Competitive Landscape

| Player                                    | Approach                     | Our Advantage                                                                         |
| ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| **UiPath / Automation Anywhere**          | Server-side RPA bots, $100K+ | We're 10x cheaper, no infrastructure, natural language                                |
| **OpenAI Operator / Claude Computer Use** | Cloud browser, general web   | We run in user's browser (no credentials shared), pre-indexed pages (faster, cheaper) |
| **Browserbase / Multion**                 | Cloud browser APIs           | Same advantage — local execution, authenticated sessions                              |
| **Zapier / Make**                         | API-based automation         | We work with any web UI, no API integration needed                                    |
| **Custom scripts / Selenium**             | Code-based automation        | We're no-code, self-healing selectors, natural language                               |

### Key Differentiators

1. **Runs in the user's browser** — no credential sharing, works behind VPN/SSO
2. **Pre-indexed pages** — agent knows the app before you ask, faster + cheaper than screen-reading
3. **Open source** — enterprise security teams can audit everything
4. **Provider-agnostic** — not locked to one LLM vendor
5. **Teach mode** — show once, automate forever (no scripting)

---

## Revenue Projections (Conservative)

| Month | Cloud Users        | Teams                | Enterprise | MRR                  |
| ----- | ------------------ | -------------------- | ---------- | -------------------- |
| 3     | 200 free, 20 pro   | 0                    | 0          | $580                 |
| 6     | 500 free, 80 pro   | 5 teams (25 seats)   | 0          | $2,795               |
| 9     | 1000 free, 200 pro | 15 teams (75 seats)  | 1          | $8,225 + enterprise  |
| 12    | 2000 free, 500 pro | 30 teams (150 seats) | 3          | $17,850 + enterprise |

Enterprise contracts typically $2-5K/month. At 3 contracts by month 12: +$6-15K/month.

---

## Open Source Strategy

**License:** MIT for core platform (extension + API + tools).

**What's open source:**

- Full browser extension
- Backend API server + orchestrator
- All 11 browser tools
- Safety classification engine
- LLM provider adapters
- Database schema + migrations
- Docker deployment

**What's proprietary (cloud only):**

- Multi-tenant infrastructure
- Billing + usage metering
- LLM key pooling / caching layer
- Team management features
- Priority support portal

This follows the Supabase/GitLab model: core is open, cloud adds convenience and team features.
