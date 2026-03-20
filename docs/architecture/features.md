# Features & User Flows

## Who Is This For?

**Primary:** Non-technical employees at large companies (consultants, analysts, ops, HR, finance) who repeat tasks across internal web tools daily.

**Secondary:** Power users and ops teams who want to build automations for their department without involving IT.

**Buyer:** Department heads or CTOs looking to reduce manual work without a $500K RPA contract.

---

## Core User Flows

### Flow 1: Chat With Any Page

The primary interaction. User opens the extension side panel and talks to the agent about whatever page they're on.

```
User navigates to internal invoice dashboard
Opens extension side panel

User: "How many invoices are overdue?"
Agent: "I can see 234 invoices in the table. Let me check...
        47 invoices are overdue (status = 'Overdue').
        Total value: $182,400. Want me to export them?"

User: "Yes, export as CSV"
Agent: [clicks Export → CSV, waits for download]
Agent: "Done. Downloaded overdue_invoices.csv (47 rows)"
```

**What makes this work:**
- Extension auto-indexes the current page on load (buttons, forms, tables, nav)
- Agent knows what's on the page before the user even asks
- Agent can read table data, count rows, filter — all from the DOM

### Flow 2: Select & Instruct

User activates selection mode (hotkey or click crosshair icon), points at elements, then tells the agent what to do with them.

```
User activates selection mode
Hovers over a table → blue highlight appears showing "Invoice Table, 234 rows"
Clicks to select it

User: "Filter this to show only 'Pending' status, then
       extract the vendor names and amounts"

Agent: [clicks the Status filter → selects 'Pending']
Agent: "Found 23 pending invoices. Here are the vendors and amounts:
        - Acme Corp: $12,500
        - GlobalTech: $8,200
        - ..."
```

**Selection capabilities:**
- Hover to preview element info (type, label, current value)
- Click to select, click again to deselect
- "Select All Similar" — select all table rows, all buttons of a type, etc.
- Select a form → "Fill this with..."
- Select a button → "Click this every day at 9am"
- Select multiple elements → "Copy these values to my spreadsheet"

### Flow 3: Multi-Step Cross-App Workflows

Agent works across multiple internal applications in sequence.

```
User: "Do the monthly close:
       1. Export financial data from the ERP
       2. Get headcount from the HR portal
       3. Pull utilization from the project tracker
       4. Combine everything into the monthly template"

Agent: "This spans 3 apps. I'll use sub-agents to work in parallel:
        - Agent A: ERP → export financials
        - Agent B: HR portal → get headcount
        - Agent C: Project tracker → utilization
        Then I'll combine the results.

        [Execute]  [Edit Plan]"
```

Sub-agents run in parallel (separate browser tabs), coordinated by a lead agent. Results flow between them.

**Status: Implemented.** Sub-agents get real browser tabs via the extension, execute independently with their own tool access, and results are synthesized by the coordinator agent.

---

## Feature Set

### Tier 1: Core (MVP)

| Feature | Description |
|---------|-------------|
| **Page indexing** | Auto-extract all interactive elements on any page |
| **Chat interface** | Side panel chat, natural language commands |
| **Basic actions** | Click, type, navigate, scroll, extract text/tables |
| **Element selector** | Point-and-click to select elements, then instruct |
| **Safety layer** | Action classification (safe/review/blocked), approval gates |
| **Activity feed** | Real-time view of what the agent is doing |
| **Kill switch** | Escape key or icon click to halt immediately |

### Tier 2: Agentic Intelligence

| Feature | Description |
|---------|-------------|
| **Site crawl** | Index entire web app via background tabs |
| **Self-healing selectors** | Multiple fallback strategies when UI changes |
| **Autonomous task completion** | Agent plans and executes multi-step tasks end-to-end |
| **Contextual awareness** | Agent uses domain memory, user memory, and S3 domain knowledge to improve over time |
| **Conversation continuity** | Resume past conversations with full context recall |

### Tier 3: Autonomous Agents

| Feature | Description | Status |
|---------|-------------|--------|
| **Agent definitions** | User-created agents with SOUL.md + SKILLS.md in Supabase Storage | ✅ |
| **Agent registry** | Load, list, resolve agents by domain match | ✅ |
| **Agent-to-agent invocation** | Agents invoke other agents by slug, max depth 2 | ✅ |
| **Self-improvement loop** | Agents write SKILLS.md, LEARNINGS.md, ERRORS.md with dedup + pruning | ✅ |
| **Agent scheduler** | Cron triggers — agents wake up, do work, go back to sleep | ✅ |
| **Multi-agent swarm** | Parallel sub-agents in separate browser tabs, coordinated by lead agent | ✅ |
| **Cross-app workflows** | Chain actions across different web apps via swarm | ✅ |
| **Agent dashboard** | Create, configure, monitor, and manage agents via web UI | ✅ |
| **Agent autonomy levels** | Supervised/trusted/autonomous — configurable approval requirements | ✅ |
| **Domain knowledge (S3)** | Per-user domain knowledge, workflows, preferences accumulated over time | ✅ |
| **Run logging** | Structured markdown run logs in S3 + Postgres, API endpoints | ✅ |
| **Webhook triggers** | External systems can trigger agent runs | |

### Tier 4: Teams & Enterprise

| Feature | Description | Status |
|---------|-------------|--------|
| **Organizations** | Org schema, member management, role-based access (admin/member/viewer) | Done |
| **Team sharing** | Org-scoped sites, conversations shared across team members | Done |
| **Admin dashboard** | Who's running what, audit logs, permissions | Done (basic) |
| **Audit trail** | Every action logged with before/after state | Done |
| **Exportable audit** | PDF/CSV reports for compliance teams | |
| **SSO** | SAML/OIDC for enterprise identity (via token exchange) | Partial |
| **Self-hosted** | Docker deployment in customer's infra | Done |
| **On-prem LLM** | Route to customer's own model for zero data leakage | |

### Tier 5: Intelligence

| Feature | Description | Status |
|---------|-------------|--------|
| **Parallel tool execution** | Safe tools run concurrently, review tools sequential with approval | ✅ |
| **Intelligent memory** | Relevance-scored user memories, always-loaded corrections, on-demand recall | ✅ |
| **Memory recall tool** | Agent can search past memories mid-conversation via recall_memory | ✅ |
| **Real-time memory saving** | Agent saves corrections/preferences immediately, not just post-conversation | ✅ |
| **Outcome tracking** | Users rate conversations (thumbs up/down), reinforces/flags memories | ✅ |
| **Token budget management** | Auto-strips old screenshots, truncates history, recovers from context overflow | ✅ |
| **Prompt caching** | Anthropic cache_control for ~90% input token cost reduction on multi-turn | ✅ |
| **Smart memory extraction** | Strong model used when corrections detected in conversation | ✅ |

---

## Safety Model

This is the enterprise selling point. Every action goes through classification before execution.

**Safe (auto-approved):** navigate, read, search, filter, sort, export, copy

**Review (needs user approval):** submit form, send message, create/update record, approve/reject

**Blocked (never allowed without explicit override):** delete, bulk operations, admin/permission changes, anything matching custom blocklist

**Agent autonomy levels:**
- `supervised` (default): all review/blocked gates active
- `trusted`: review actions auto-approve, blocked still rejected, plans auto-approve. Required for scheduled agents.
- `autonomous`: all actions auto-approve (for fully unattended operation)

**Additional safety layers:**
- Scope locking: agent only operates on whitelisted domains/URLs
- Audit logging: all actions logged regardless of autonomy level
- Kill switch: Escape key halts all agent activity immediately
- Plan approval: multi-step tasks require explicit approval (unless trusted/autonomous)

---

## Data Security

**Core principle: data stays in the browser.**

| Data Type | Where It Lives |
|-----------|---------------|
| Page HTML, screenshots, form data | Local browser. Screenshots sent to LLM (configurable, not stored on backend). Old screenshots auto-stripped from conversation history. |
| Session cookies, auth tokens | Browser only (never touched) |
| Page structure (element types, labels) | Synced to backend (no actual data values) |
| Conversation history | Backend (structured, no raw page data) |
| LLM prompts | Structure + labels only, no PII or business data |

**Self-hosted option:** the entire platform runs in a Docker container. For air-gapped environments, customers can use their own LLM — zero data leaves their network.

---

## Distribution

**Two modes:**
- **Open source (MIT):** Full platform, self-host with Docker, bring your own LLM key, built-in auth. Free forever.
- **Cloud (hosted by us):** We manage infra, pool LLM keys, handle auth. Landing page lives in a separate project (`landing-page/`), not in this repo.

This repo is the product — clean, self-contained, works with `docker-compose up`.

**Why open source works here:**
- Builds trust with security teams ("audit our code")
- Community contributes LLM adapters and auth integrations
- Self-hosted users convert to cloud when they don't want to manage infra
