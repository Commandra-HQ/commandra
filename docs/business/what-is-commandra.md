# Commandra

## AI Employees for Enterprise Internal Dashboards

Every company runs on internal web apps — ERPs, CRMs, HR portals, billing dashboards. Employees spend hours doing repetitive work across these tools. We're building AI agents that do that work for them.

---

## How It Works

A Chrome extension sits in the employee's browser. They tell it what to do in plain English. The agent clicks buttons, fills forms, reads tables, exports data — just like a human would. Across multiple apps if needed.

**"Find all overdue invoices over $5K and export them"** → agent filters the table, reads it, clicks export. Done.

**"Do the monthly close across the ERP, HR portal, and project tracker"** → agent spawns 3 sub-agents in parallel browser tabs, each pulling data from a different app, then combines the results.

The agents learn from every run. They remember your app's layout, your corrections, your preferences. Run 10 is dramatically better than run 1.

---

## Why This Has to Run in the Browser

This is the core insight.

The agent runs inside the employee's **actual Chrome browser** — not a cloud browser, not a server-side bot. This means:

- **Already behind the VPN.** The employee is connected. The agent inherits their access.
- **Already logged in.** SSO, MFA — already handled. We never touch credentials.
- **Data stays local.** Page content never leaves the browser. We only see page structure (what buttons exist, what tables look like) — never the actual data.

Cloud browser agents (OpenAI Operator, Browserbase) can't do this. They need your credentials to log in, can't reach internal networks, and route your data through their servers. Fine for personal Gmail. Not fine for a company's ERP.

---

## Deployment: Self-Hosted or Cloud

**Self-hosted (on-prem):** `docker-compose up`. The entire platform runs on the customer's infrastructure. They bring their own LLM keys (or run local models via Ollama for fully air-gapped). We see nothing — no dashboard data, no credentials, no usage patterns. Open-source (MIT), so their security team can audit every line.

**Cloud:** Same product, we host it. Managed infra, pooled LLM keys, zero setup. Revenue comes from here.

This is the Supabase / GitLab model — open-source core, cloud adds convenience. Enterprise gets the self-hosted version because they'll never let dashboard data touch a third-party server. Everyone else gets the cloud version because they don't want to manage Docker.

---

## Competitive Landscape

|                                   | Approach             | Problem                                          |
| --------------------------------- | -------------------- | ------------------------------------------------ |
| **UiPath / Automation Anywhere**  | Server-side RPA bots | $100K+, brittle scripts, 6-month implementations |
| **OpenAI Operator / Browserbase** | Cloud browser        | Needs credentials, can't access internal apps    |
| **Zapier / Make**                 | API connectors       | Most internal tools don't have APIs              |

**We win because:** natural language (not recorded scripts), runs locally (not cloud browsers), works on any web app (not just ones with APIs), self-improving (not brittle), and self-hostable (not SaaS-only).

---

## What's Built

The platform is functional end-to-end across 23 shipped engineering phases:

- Chrome extension (chat UI, page indexing, action execution)
- Custom AI orchestrator (provider-agnostic — Claude, GPT-4, local models)
- 20+ browser tools (click, type, navigate, read tables, export, screenshots)
- Multi-agent system (parallel agents across browser tabs)
- Self-improving agents (learn skills, remember corrections, avoid past errors)
- Scheduled runs (cron-based)
- Safety engine (every action classified before execution, audit trail)
- Team support (orgs, roles, shared data)
- Dashboard (agent management, history, audit logs)
- Docker deployment + SSO bridge (OIDC/SAML ready)
