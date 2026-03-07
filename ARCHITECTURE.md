# Enterprise Browser Agent Platform — Architecture

## Vision

A platform where enterprise employees can deploy AI agents to any internal web application. The agent first crawls and indexes the app (pages, CTAs, forms, navigation flows), then executes multi-step workflows autonomously — like a Puppeteer script with real intelligence.

Think: "Record once, automate forever" — but the agent adapts when the UI changes.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Chrome Extension (Agent Runtime)             │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │  │
│  │  │  Crawler /   │  │  Action      │  │  Safety        │   │  │
│  │  │  Indexer     │  │  Executor    │  │  Guardian      │   │  │
│  │  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘   │  │
│  │         │                │                   │            │  │
│  │  ┌──────┴────────────────┴───────────────────┴────────┐   │  │
│  │  │              Local Agent Orchestrator               │   │  │
│  │  │         (runs entirely in-browser / local)          │   │  │
│  │  └──────────────────────┬─────────────────────────────┘   │  │
│  └─────────────────────────┼─────────────────────────────────┘  │
│                            │ encrypted                          │
└────────────────────────────┼────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │      Edge Proxy / Gateway    │
              │   (TLS, auth, rate limiting) │
              └──────────────┬──────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
   ┌─────┴─────┐    ┌───────┴───────┐   ┌──────┴──────┐
   │  Agent     │    │  Site Index   │   │  Workflow   │
   │  Brain     │    │  Service      │   │  Engine     │
   │  (LLM API) │    │  (Knowledge)  │   │  (DAGs)     │
   └───────────┘    └───────────────┘   └─────────────┘
```

---

## Layer 1: Chrome Extension — The Agent Runtime

This is the most critical piece. Everything happens in the user's browser, which solves the data security problem — we never need credentials to their internal apps.

### 1A. Site Crawler / Indexer

**Purpose:** Map every page of a web application into a structured knowledge graph.

```
SiteIndex {
  pages: [
    {
      url: "/dashboard/reports",
      title: "Monthly Reports",
      elements: [
        {
          selector: "button#generate-report",
          type: "cta",
          label: "Generate Report",
          aria: "Generate monthly financial report",
          position: { x, y, viewport_zone: "top-right" },
          triggers: "modal:report-config"
        },
        {
          selector: "table.report-list",
          type: "data-table",
          columns: ["Name", "Date", "Status", "Actions"],
          row_count: 42,
          pagination: true
        },
        {
          selector: "input#search-reports",
          type: "search",
          placeholder: "Search reports..."
        }
      ],
      navigation: {
        reachable_from: ["/dashboard"],
        leads_to: ["/dashboard/reports/:id"],
        breadcrumb: ["Home", "Dashboard", "Reports"]
      },
      auth_required: true,
      load_time_ms: 1200
    }
  ],
  flows: [
    {
      name: "generate_monthly_report",
      steps: [
        { action: "navigate", target: "/dashboard/reports" },
        { action: "click", target: "button#generate-report" },
        { action: "select", target: "#month-picker", value: "dynamic" },
        { action: "click", target: "button.confirm" },
        { action: "wait", condition: "toast.success visible" }
      ]
    }
  ]
}
```

**How crawling works:**

1. User clicks "Index this app" in the extension
2. Extension injects a lightweight DOM walker that:
   - Extracts all interactive elements (buttons, links, forms, inputs)
   - Captures ARIA labels, data attributes, visible text
   - Maps navigation structure (which links go where)
   - Identifies page "type" (dashboard, form, table, detail view)
3. For SPAs: hooks into router (React Router, Vue Router, etc.) to detect route changes
4. Builds a **Site Graph** — nodes are pages, edges are navigation paths
5. Stores index locally (IndexedDB) + syncs encrypted summary to backend

**Key technical decisions:**
- Use MutationObserver to detect dynamic content loading
- Shadow DOM penetration for web components
- iframe detection and recursive indexing
- Debounced re-indexing when DOM changes significantly

### 1B. Action Executor

**Purpose:** Translate high-level agent instructions into precise browser actions.

```typescript
interface ActionExecutor {
  // Atomic actions
  click(selector: string, options?: { waitAfter?: number }): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  navigate(url: string): Promise<void>;
  scroll(direction: 'up' | 'down', amount: number): Promise<void>;

  // Smart actions (use the site index)
  findAndClick(description: string): Promise<void>;  // "click the submit button"
  fillForm(data: Record<string, string>): Promise<void>;
  extractTableData(tableSelector: string): Promise<any[]>;
  waitForCondition(description: string, timeout: number): Promise<boolean>;

  // Observation
  screenshot(): Promise<string>;  // base64 for vision model
  getVisibleText(): Promise<string>;
  getPageState(): Promise<PageState>;
}
```

**The smart part:** When a selector breaks (UI updated), the executor:
1. Falls back to text content matching
2. Falls back to ARIA label matching
3. Falls back to visual similarity (position + appearance)
4. Falls back to asking the LLM with a screenshot: "Where is the submit button now?"

### 1C. Safety Guardian

**This is our moat and enterprise selling point.**

```typescript
interface SafetyGuardian {
  // Classify every action before execution
  classifyRisk(action: AgentAction): 'safe' | 'review' | 'blocked';

  // Rules engine
  rules: SafetyRule[];

  // Human-in-the-loop
  requestApproval(action: AgentAction, reason: string): Promise<boolean>;
}

// Risk classification
const RISK_LEVELS = {
  safe: [
    'navigate', 'read', 'search', 'filter', 'sort',
    'export/download', 'copy to clipboard'
  ],
  review: [
    'submit form', 'send message', 'create record',
    'update record', 'approve/reject workflow'
  ],
  blocked: [
    'delete', 'bulk delete', 'drop', 'admin actions',
    'permission changes', 'anything matching custom blocklist'
  ]
};
```

**Safety mechanisms:**

| Mechanism | How it works |
|-----------|-------------|
| **Action classification** | Every DOM action is classified by risk before execution |
| **Dry-run mode** | Agent plans all steps, shows them to user, executes only after approval |
| **Undo stack** | For reversible actions, maintain an undo log |
| **Rate limiting** | Max N actions per minute, max N records affected per run |
| **Scope locking** | Agent can only operate on pre-approved URLs/domains |
| **Anomaly detection** | If page state diverges from expected, pause and alert |
| **Audit trail** | Every action logged with before/after screenshots |
| **Kill switch** | User can hit Escape or click extension icon to immediately halt |

---

## Layer 2: Backend Services

### 2A. Agent Brain (LLM Orchestration)

This is the intelligence layer. We do NOT send raw page HTML to the LLM. We send the **structured site index** + **current page state** + **task description**.

```
┌─────────────────────────────────────────────┐
│              Agent Brain                     │
│                                             │
│  Task: "Generate the March 2026 report      │
│         and email it to finance team"        │
│                                             │
│  ┌─────────────┐    ┌───────────────────┐   │
│  │   Planner   │───>│   Step Executor   │   │
│  │   (LLM)     │    │   (LLM + tools)   │   │
│  └─────────────┘    └───────────────────┘   │
│        │                     │              │
│        v                     v              │
│  ┌─────────────┐    ┌───────────────────┐   │
│  │  Plan:      │    │  Observe:         │   │
│  │  1. Go to   │    │  - Current page   │   │
│  │     reports │    │  - Elements vis.  │   │
│  │  2. Click   │    │  - Expected state │   │
│  │     generate│    │  vs actual state  │   │
│  │  3. Select  │    │                   │   │
│  │     March   │    │  Decide: next     │   │
│  │  4. Confirm │    │  action or replan │   │
│  │  5. Wait    │    │                   │   │
│  │  6. Download│    └───────────────────┘   │
│  │  7. Email   │                            │
│  └─────────────┘                            │
└─────────────────────────────────────────────┘
```

**Architecture pattern: Plan → Act → Observe → Replan (ReAct loop)**

```typescript
async function executeTask(task: string, siteIndex: SiteIndex) {
  // 1. Plan
  const plan = await llm.plan({
    task,
    availablePages: siteIndex.pages,
    knownFlows: siteIndex.flows,
    currentPage: await extension.getPageState()
  });

  // 2. Execute step by step
  for (const step of plan.steps) {
    // Safety check
    const risk = safetyGuardian.classifyRisk(step);
    if (risk === 'blocked') throw new BlockedActionError(step);
    if (risk === 'review') {
      const approved = await safetyGuardian.requestApproval(step);
      if (!approved) throw new UserDeniedError(step);
    }

    // Execute
    const result = await actionExecutor.execute(step);

    // Observe
    const newState = await extension.getPageState();
    const expected = step.expectedOutcome;

    // Replan if needed
    if (!matchesExpectation(newState, expected)) {
      const newPlan = await llm.replan({
        originalTask: task,
        completedSteps: plan.steps.slice(0, i),
        failedStep: step,
        currentState: newState,
        error: result.error
      });
      plan.steps = newPlan.steps;
    }
  }
}
```

**LLM selection strategy:**
- Planning: Claude Opus/Sonnet (complex reasoning)
- Step execution: Claude Haiku (fast, cheap, good enough for "click this button")
- Visual verification: Claude with vision (screenshot comparison)
- Fallback element finding: Claude with vision (when selectors break)

### 2B. Site Index Service

Stores and serves the indexed site knowledge.

```
PostgreSQL (metadata, user accounts, org config)
    │
    ├── sites (id, org_id, domain, name, last_indexed)
    ├── pages (id, site_id, url, title, page_type, elements JSONB)
    ├── flows (id, site_id, name, steps JSONB, created_by)
    ├── agent_configs (id, org_id, name, trigger, workflow_id, safety_rules)
    └── audit_logs (id, agent_id, action, risk_level, approved_by, timestamp,
                    screenshot_before, screenshot_after)

Vector DB (Pinecone / pgvector)
    │
    └── element_embeddings (page context + element description → vector)
        Used for: "find the button that submits expense reports"
```

### 2C. Workflow Engine

Users define reusable workflows that agents execute.

```yaml
# Example: Weekly expense report submission
name: "Submit Weekly Expenses"
trigger:
  schedule: "every Friday at 4pm"
  # OR: manual
  # OR: webhook (from Slack, etc.)
  # OR: condition (when inbox has email with subject "Expense reminder")

site: "internal-erp.company.com"

steps:
  - name: "Open expense portal"
    action: navigate
    target: "/expenses/new"

  - name: "Fill expense form"
    action: fill_form
    data:
      category: "from_email:latest_receipt.category"  # dynamic data source
      amount: "from_email:latest_receipt.amount"
      date: "today"
      description: "from_email:latest_receipt.merchant"

  - name: "Attach receipt"
    action: upload_file
    source: "from_email:latest_receipt.attachment"
    target: "#receipt-upload"

  - name: "Submit"
    action: click
    target: "button:Submit for Approval"
    safety: review  # always ask user before submitting

  - name: "Verify success"
    action: assert
    condition: "toast message contains 'submitted successfully'"
    on_fail: "notify_user"
```

---

## Layer 3: How Users Build Agents (The Product UX)

### Method 1: Record & Replay (Easiest)

1. User clicks "Record" in extension
2. Does the task manually — extension records every click, type, navigation
3. Extension generates a workflow from the recording
4. LLM generalizes the recording: replaces hardcoded values with parameters
5. User names it: "Submit Expense Report"
6. Next time: user says "Submit my expense report for $45.20 at Starbucks" and the agent executes

### Method 2: Natural Language (Most Powerful)

1. User has already indexed their app
2. User types: "Every Monday, go to the HR portal, download the attendance report, and email it to my manager"
3. LLM breaks this into steps using the site index
4. Shows the plan to the user for approval
5. User approves → agent runs on schedule

### Method 3: Flow Builder (Visual, for power users)

```
┌──────────┐     ┌───────────┐     ┌──────────┐     ┌──────────┐
│ Navigate │────>│ Fill Form │────>│ IF/ELSE  │────>│ Click    │
│ /reports │     │ date=today│     │ has data?│     │ Download │
└──────────┘     └───────────┘     └──┬───┬───┘     └──────────┘
                                      │   │
                                    Yes   No
                                      │   │
                                      │   └──> ┌──────────┐
                                      │        │ Notify   │
                                      │        │ "No data"│
                                      │        └──────────┘
                                      v
                                 ┌──────────┐
                                 │ Extract  │
                                 │ Table    │
                                 └──────────┘
```

A drag-and-drop canvas (like n8n / Retool) where users wire up:
- Browser actions (navigate, click, type, extract)
- Logic nodes (if/else, loops, wait)
- Data nodes (parse email, read spreadsheet, call API)
- Output nodes (send email, post to Slack, save to Drive)

---

## Data Security Architecture

This is the #1 concern for enterprise. Here's how we handle it:

```
┌─────────────────────────────────────────────────────────────┐
│                    SECURITY MODEL                           │
│                                                             │
│  Principle: Data stays in the browser. We see structure,    │
│  never content.                                             │
│                                                             │
│  What stays LOCAL (IndexedDB / extension storage):          │
│  ├── Raw page HTML                                          │
│  ├── Screenshots                                            │
│  ├── Form data / credentials                                │
│  ├── Extracted table data                                   │
│  └── Session cookies / auth tokens                          │
│                                                             │
│  What goes to OUR BACKEND (encrypted, anonymized):          │
│  ├── Site structure (page URLs, element types, labels)      │
│  ├── Workflow definitions (step types, not data values)     │
│  ├── Anonymized action logs (for debugging)                 │
│  └── LLM prompts (contain structure, not business data)     │
│                                                             │
│  What goes to LLM API:                                      │
│  ├── Task description (user-provided)                       │
│  ├── Page structure (sanitized — no PII, no actual values)  │
│  ├── Element descriptions (button labels, form field names) │
│  └── Screenshots ONLY if user opts in (for vision fallback) │
│                                                             │
│  NEVER leaves the browser:                                  │
│  ├── Passwords, SSO tokens                                  │
│  ├── Actual data values from tables/forms                   │
│  └── Internal URLs (can be hashed before sending)           │
└─────────────────────────────────────────────────────────────┘
```

**Enterprise deployment option:** Self-hosted LLM inference (customer runs their own Claude/Llama instance) so zero data leaves their network.

---

## Tech Stack Recommendation

| Component | Technology | Why |
|-----------|-----------|-----|
| Chrome Extension | TypeScript + Chrome Extension Manifest V3 | Standard, secure, sandboxed |
| Extension UI | React + Tailwind | Fast to build, component library |
| DOM Interaction | Custom engine (not Puppeteer — we're IN the browser) | Direct DOM access, no overhead |
| Local Storage | IndexedDB (via Dexie.js) | Large storage, structured, fast |
| Backend API | Node.js (Hono on Cloudflare Workers) OR Go | Edge-first, low latency |
| Database | PostgreSQL + pgvector | Relational + vector search |
| Workflow Engine | Temporal.io | Battle-tested for long-running workflows |
| LLM | Claude API (Anthropic) | Best reasoning, vision, tool use |
| Auth | Clerk or WorkOS | Enterprise SSO out of the box |
| Flow Builder UI | React Flow | Proven library for node-based editors |
| Real-time sync | WebSockets (Partykit or Soketi) | Extension <-> backend communication |
| Monitoring | PostHog + Sentry | Usage analytics + error tracking |
| Queue | BullMQ (Redis) or Cloudflare Queues | Scheduled triggers, async jobs |

---

## Scaling Strategy

### Phase 1: Chrome Extension + Cloud Backend (MVP)
- Extension does crawling + action execution
- Backend handles LLM calls + workflow storage
- 1 agent per user, manual triggers only
- **Target:** 10 design partners from consulting/finance firms

### Phase 2: Multi-Agent + Scheduling
- Scheduled triggers (cron-based)
- Workflow marketplace (share flows within org)
- Team-level agent management
- Admin dashboard (who's running what, audit logs)
- **Target:** 100 paying companies

### Phase 3: Enterprise Platform
- Self-hosted deployment option (air-gapped networks)
- SSO/SCIM integration
- Role-based access control on agents
- Cross-application workflows (Agent moves data between 3 different apps)
- Agent-to-agent communication (one agent triggers another)
- **Target:** Enterprise contracts

### Phase 4: Agent Intelligence
- Agents learn from user corrections (reinforcement)
- Agents suggest automations ("I noticed you do this every Tuesday")
- Predictive execution (start task before user asks)
- Natural language monitoring ("alert me if any invoice over $10K gets approved")

---

## What Makes This Different from Existing Tools

| Competitor | Their approach | Our advantage |
|-----------|---------------|--------------|
| Selenium/Puppeteer | Headless, brittle selectors, no intelligence | We run in-browser, self-heal, use LLM reasoning |
| UiPath/Automation Anywhere | Heavy desktop install, needs dev to build | Lightweight extension, anyone can record a flow |
| OpenAI Operator / Comet | General web browsing, no enterprise focus | We index YOUR specific app, faster + more reliable |
| Browser-use / AgentQ | Open source libs, no product around it | Full platform: safety, audit, scheduling, team mgmt |

**Our moat:** The site index. Once we've deeply indexed an enterprise app, our agents are 10x more reliable than general-purpose browser agents because they don't need to "figure out" the UI every time — they already know it.

---

## Immediate Next Steps (Week 1-4)

### Week 1-2: Chrome Extension Skeleton
- [ ] Manifest V3 setup with content script + service worker
- [ ] Basic DOM walker that extracts interactive elements from current page
- [ ] Store results in IndexedDB
- [ ] Simple popup UI showing indexed elements

### Week 3-4: First Agent Loop
- [ ] Connect to Claude API from extension (via backend proxy)
- [ ] Implement basic action executor (click, type, navigate)
- [ ] Build the ReAct loop: plan → act → observe
- [ ] Demo: "Go to Hacker News, find the top post, and copy its title"

### Week 5-6: Recording + Safety
- [ ] Record user actions (click listener, input listener, navigation listener)
- [ ] Replay recorded actions
- [ ] Safety guardian v1 (classify actions, block deletes)
- [ ] Audit log with screenshots

### Week 7-8: Product Shell
- [ ] Auth + user accounts
- [ ] Workflow save/load
- [ ] Basic scheduling (run workflow every X hours)
- [ ] Landing page + waitlist

---

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Sites detect and block automation** | We run as real user actions in real browser — indistinguishable from human |
| **LLM hallucinations cause wrong actions** | Safety guardian + dry-run mode + undo stack |
| **Enterprise security teams block extension** | Self-hosted option, SOC2 compliance, admin-managed deployment via Chrome Enterprise |
| **UI changes break workflows** | Self-healing selectors (text → ARIA → visual fallback) + LLM re-planning |
| **Latency (LLM calls per action)** | Cache common plans, use fast model (Haiku) for execution, pre-plan entire workflow |
| **Data leakage fears** | Architecture ensures data stays in browser; structure-only goes to backend |
