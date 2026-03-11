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

### Flow 3: Teach Mode (Record & Replay)

User shows the agent how to do something once. Agent learns the steps and can repeat them.

```
User: "Let me show you how to submit an expense"
Agent: "I'm watching. Go ahead — I'll learn the steps."

User performs the task manually:
  1. Clicks "New Expense"
  2. Fills in amount, category, description
  3. Uploads receipt
  4. Clicks Submit

Agent: "Got it. I recorded 4 steps:
        1. Navigate to /expenses/new
        2. Fill form: Amount, Category, Description
        3. Upload file to receipt field
        4. Click Submit

        Want me to save this as a reusable flow?
        I can parameterize it so next time you just say
        'Submit expense for $45 at Starbucks'"
```

### Flow 4: Chat → Flow → Agent Pipeline

This is how one-time tasks become permanent automations. Each level adds more autonomy.

```
CHAT (one-time)
  "Download the Q4 report and email it to the finance team"
  → Agent does it once, right now

          ↓ User clicks "Save as Flow"

FLOW (reusable)
  "Download Quarterly Report"
  Parameters: quarter, recipient_email
  → User can re-run anytime with different inputs

          ↓ User clicks "Schedule"

AGENT (autonomous)
  Trigger: 1st Monday of each quarter
  Auto-runs the flow, sends notification when done
  → Fully autonomous, human notified after completion
```

### Flow 5: Multi-Step Cross-App Workflows

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

### Tier 2: Workflows

| Feature | Description |
|---------|-------------|
| **Recording mode** | Watch user perform a task, learn the steps |
| **Flow creation** | Save tasks as reusable flows with parameters |
| **Flow library** | Browse and run saved flows |
| **Site crawl** | Index entire web app via background tabs |
| **Self-healing selectors** | Multiple fallback strategies when UI changes |

### Tier 3: Automation

| Feature | Description |
|---------|-------------|
| **Scheduled agents** | Cron triggers (daily, weekly, monthly) |
| **Webhook triggers** | External systems can trigger agent runs |
| **Notifications** | Slack/email/webhook on agent completion |
| **Multi-agent swarm** | Parallel sub-agents for complex tasks |
| **Cross-app workflows** | Chain actions across different web apps |
| **Agent sessions** | Resume interrupted agent runs |

### Tier 4: Teams & Enterprise

| Feature | Description |
|---------|-------------|
| **Team sharing** | Share flows within an organization |
| **Admin dashboard** | Who's running what, audit logs, permissions |
| **Audit trail** | Every action logged with before/after state |
| **Exportable audit** | PDF/CSV reports for compliance teams |
| **SSO** | SAML/SCIM for enterprise identity |
| **Self-hosted** | Docker deployment in customer's infra |
| **On-prem LLM** | Route to customer's own model for zero data leakage |

---

## Safety Model

This is the enterprise selling point. Every action goes through classification before execution.

**Safe (auto-approved):** navigate, read, search, filter, sort, export, copy

**Review (needs user approval):** submit form, send message, create/update record, approve/reject

**Blocked (never allowed without explicit override):** delete, bulk operations, admin/permission changes, anything matching custom blocklist

**Additional safety layers:**
- Scope locking: agent only operates on whitelisted domains/URLs
- Rate limiting: max actions per minute, max records per run
- Anomaly detection: pause if page state diverges from expected
- Undo stack: revert reversible actions
- Dry-run mode: show full plan before executing anything

---

## Data Security

**Core principle: data stays in the browser.**

| Data Type | Where It Lives |
|-----------|---------------|
| Page HTML, screenshots, form data | Local (IndexedDB, never uploaded) |
| Session cookies, auth tokens | Browser only (never touched) |
| Page structure (element types, labels) | Synced to backend (no actual data values) |
| Workflow definitions | Backend (parameterized, no real data) |
| LLM prompts | Structure + labels only, no PII or business data |

**Self-hosted option:** the entire platform runs in a Docker container. For air-gapped environments, customers can use their own LLM — zero data leaves their network.

---

## Business Model

**Two modes:**
- **Open source (MIT):** Full platform, self-host with Docker, bring your own LLM key, pluggable auth. Free forever.
- **Cloud (hosted by us):** Free tier (50 actions/month) → Pro ($29/user) → Team ($19/user, 5+ seats). We manage infra, pool LLM keys, handle auth + billing.

Cloud billing and landing page live in a separate project (`website/`), not in this repo. This repo is the product — clean, self-contained, works with `docker-compose up`.

**Why open source works here:**
- Builds trust with security teams ("audit our code")
- Community contributes LLM adapters and auth integrations
- Free users become advocates inside their companies
- Self-hosted users convert to cloud when they don't want to manage infra
