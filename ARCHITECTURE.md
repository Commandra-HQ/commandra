# Agents for Everyone — Platform Architecture v2

## Vision

**Cursor / Claude Code, but for any web application.**

An employee opens our extension, chats with it like they'd chat with a coworker: "Go to the invoice dashboard, find all unpaid invoices over $5K, and send a reminder email to each vendor." The agent understands the app, selects the right elements, executes the task — or asks clarifying questions when it's unsure.

Chats become agents. One-time tasks become repeatable flows. Flows compose into swarms.

---

## Core Concepts

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   CHAT ──────> TASK ──────> FLOW ──────> AGENT          │
│                                                          │
│   "Do X"      One-time      Repeatable    Autonomous     │
│   in natural   execution    workflow      + scheduled    │
│   language     with agent   with params   + triggered    │
│                                                          │
│   ──────────────────────────────────────────────────>     │
│   increasing autonomy                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Chat** — User talks to the agent in natural language. Agent executes immediately.
**Task** — A single chat-initiated execution. Logged, auditable, one-time.
**Flow** — A task that the user promotes to a reusable template with parameters.
**Agent** — A flow that runs autonomously on triggers (schedule, webhook, event).

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                            USER'S BROWSER                                  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    CHROME EXTENSION                                   │  │
│  │                                                                      │  │
│  │  ┌─────────────────────────────────────────────────────────────┐     │  │
│  │  │                    CHAT INTERFACE                            │     │  │
│  │  │  ┌─────────────────────────────────────────────────────┐    │     │  │
│  │  │  │ User: "Go to invoices, find unpaid ones over $5K,   │    │     │  │
│  │  │  │        send reminders to each vendor"                │    │     │  │
│  │  │  │                                                      │    │     │  │
│  │  │  │ Agent: "I'll do this in 4 steps:                     │    │     │  │
│  │  │  │  1. Navigate to /invoices                            │    │     │  │
│  │  │  │  2. Filter: status=unpaid, amount>5000               │    │     │  │
│  │  │  │  3. For each result, click 'Send Reminder'           │    │     │  │
│  │  │  │  4. Confirm each send                                │    │     │  │
│  │  │  │                                                      │    │     │  │
│  │  │  │ [Execute] [Edit Plan] [Save as Flow]                 │    │     │  │
│  │  │  └─────────────────────────────────────────────────────┘    │     │  │
│  │  └─────────────────────────────────────────────────────────────┘     │  │
│  │                                                                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐ │  │
│  │  │  Element     │  │  Page        │  │  Action      │  │  Safety  │ │  │
│  │  │  Selector    │  │  Indexer     │  │  Runtime     │  │  Layer   │ │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  └──────────┘ │  │
│  │                                                                      │  │
│  │  ┌──────────────────────────────────────────────────────────────┐    │  │
│  │  │              LOCAL AGENT ORCHESTRATOR                         │    │  │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐               │    │  │
│  │  │  │  Agent #1  │ │  Agent #2  │ │  Agent #3  │  ... (swarm)  │    │  │
│  │  │  │  Invoices  │ │  Reports   │ │  Email     │               │    │  │
│  │  │  └────────────┘ └────────────┘ └────────────┘               │    │  │
│  │  └──────────────────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                         │                                  │
└─────────────────────────────────────────┼──────────────────────────────────┘
                                          │ encrypted (structure only)
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    │            PLATFORM BACKEND                │
                    │                                            │
                    │  ┌──────────┐ ┌───────────┐ ┌──────────┐ │
                    │  │ Swarm    │ │ Agent     │ │ Flow     │ │
                    │  │ Coord.   │ │ Brain     │ │ Registry │ │
                    │  └──────────┘ └───────────┘ └──────────┘ │
                    │  ┌──────────┐ ┌───────────┐ ┌──────────┐ │
                    │  │ Site     │ │ Safety    │ │ Audit    │ │
                    │  │ Memory   │ │ Engine    │ │ Service  │ │
                    │  └──────────┘ └───────────┘ └──────────┘ │
                    └──────────────────────────────────────────┘
```

---

## Part 1: The Chat Interface — "Talk to Any Website"

The extension opens as a side panel (Chrome Side Panel API). The user sees a chat interface overlaid on whatever website they're on. This is the primary interaction model.

### Chat Modes

**1. Direct Command Mode**
```
User: "Click the 'New Invoice' button"
Agent: [clicks it immediately]
Agent: "Done. I'm now on the New Invoice form. What should I fill in?"
```

**2. Task Mode**
```
User: "Download all Q4 reports as PDFs"
Agent: "I see 12 reports in the Q4 section. I'll:
  1. Click each report
  2. Click the PDF export button
  3. Wait for download
  Should I proceed with all 12?"
User: "Yes"
Agent: [executes, shows progress: "3/12 done..."]
```

**3. Teach Mode**
```
User: "Let me show you how to submit an expense"
Agent: "I'm watching. Go ahead and do it once — I'll learn the steps."
[User performs the task manually]
Agent: "Got it. I recorded 6 steps:
  1. Navigate to /expenses/new
  2. Fill 'Amount' field
  3. Select category from dropdown
  4. Upload receipt image
  5. Add description
  6. Click 'Submit'
  Want me to save this as a reusable flow?"
```

**4. Select & Instruct Mode (KEY DIFFERENTIATOR)**
```
User: [hovers over an element on the page, clicks to select it]
[Extension highlights the element with a blue overlay]
User: "This table — extract all rows where status is 'Pending'"
Agent: "Found 23 pending rows. Want me to export them as CSV or do something with each one?"
```

This is how users get precise control. They can:
- **Point at an element** → "Fill this with today's date"
- **Select a table** → "Sort by amount descending"
- **Select a form** → "Fill this with data from this spreadsheet"
- **Select a button** → "Click this every day at 9am"
- **Select multiple elements** → "These 3 fields — copy them to my Google Sheet"

### Element Selector UI

When the user activates selection mode (hotkey: `Ctrl+Shift+S` or click the crosshair icon):

```
┌─────────────────────────────────────────────────────────────┐
│  SELECTION MODE ACTIVE                              [Exit]  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                                                       │  │
│  │    ┌─── HIGHLIGHTED ELEMENT ─────────────────────┐    │  │
│  │    │                                              │    │  │
│  │    │    Invoice Amount: [$5,000.00]               │    │  │
│  │    │    ▲                                         │    │  │
│  │    │    │ input#invoice-amount                    │    │  │
│  │    │    │ type: text input                        │    │  │
│  │    │    │ current value: "5000.00"                │    │  │
│  │    └──────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │  [Select] [Select Parent] [Select All Similar]        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Selected elements: (2)                                     │
│  ├── input#invoice-amount  "Invoice Amount"                 │
│  └── select#vendor-name    "Vendor"                         │
│                                                             │
│  What do you want to do with these elements?                │
│  ┌─────────────────────────────────────────────────┐        │
│  │ "Fill amount with 7500 and select vendor Acme"  │        │
│  └─────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

**How element selection works technically:**

```typescript
class ElementSelector {
  private overlay: HTMLDivElement;      // highlight overlay
  private selected: Set<ElementRef>;    // currently selected elements
  private inspecting: boolean = false;

  activate() {
    this.inspecting = true;
    // Inject overlay layer on top of page
    document.addEventListener('mousemove', this.onHover);
    document.addEventListener('click', this.onSelect, { capture: true });
    // Prevent default clicks from firing while selecting
  }

  onHover(e: MouseEvent) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    // Draw highlight box around element
    this.overlay.style.top = el.getBoundingClientRect().top + 'px';
    // Show element info tooltip (tag, id, text, type)
    this.showTooltip(el);
  }

  onSelect(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.target as HTMLElement;

    this.selected.add({
      selector: this.generateSelector(el),    // robust CSS selector
      xpath: this.generateXPath(el),          // fallback
      text: el.textContent?.trim(),
      tag: el.tagName,
      type: el.getAttribute('type'),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      boundingBox: el.getBoundingClientRect(),
      // For tables: extract column headers, row count
      // For forms: extract field names, current values
      // For dropdowns: extract all options
      metadata: this.extractMetadata(el)
    });
  }

  // Generate multiple selector strategies for resilience
  generateSelector(el: HTMLElement): SelectorStrategy {
    return {
      id: el.id ? `#${el.id}` : null,
      cssPath: this.computeCSSPath(el),
      dataTestId: el.getAttribute('data-testid'),
      ariaLabel: el.getAttribute('aria-label'),
      textContent: el.textContent?.trim().substring(0, 50),
      nthOfType: this.computeNthOfType(el),
      // Ranked by reliability:
      // 1. data-testid  2. id  3. aria-label  4. CSS path  5. text
    };
  }

  // "Select All Similar" — find elements matching the same pattern
  selectAllSimilar(el: HTMLElement) {
    const pattern = this.inferPattern(el); // same tag, class, structure
    const matches = document.querySelectorAll(pattern);
    matches.forEach(m => this.selected.add(this.buildRef(m)));
  }
}
```

---

## Part 2: The Agent Brain — Multi-Agent Swarm Architecture

This is not a single agent. It's a **swarm** — a coordinator that spawns specialized sub-agents for different parts of a complex task.

### Why Swarm?

Single agent = sequential. One thing at a time. Slow.

Swarm = parallel. Multiple agents working on sub-tasks simultaneously, coordinated by a lead agent.

```
User: "Go through all 50 vendor profiles, check if their compliance
       docs are expired, and send renewal requests to those that are"

                    ┌─────────────────────┐
                    │   COORDINATOR       │
                    │   (Lead Agent)      │
                    │                     │
                    │   Breaks task into: │
                    │   - Scan vendors    │
                    │   - Check dates     │
                    │   - Send emails     │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
        │ Scanner   │  │ Scanner   │  │ Scanner   │
        │ Agent     │  │ Agent     │  │ Agent     │
        │ (pg 1-17) │  │ (pg 18-34)│  │ (pg 35-50)│
        └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
              │               │               │
              └───────┬───────┘               │
                      │                       │
              ┌───────┴───────┐               │
              │  Aggregator   │◄──────────────┘
              │  "12 expired" │
              └───────┬───────┘
                      │
              ┌───────┴───────┐
              │  Email Agent  │
              │  Sends 12     │
              │  renewal reqs │
              └───────────────┘
```

### Swarm Architecture

```typescript
// Core swarm types
interface SwarmCoordinator {
  id: string;
  task: string;
  agents: SubAgent[];
  state: 'planning' | 'executing' | 'paused' | 'completed' | 'failed';
  plan: SwarmPlan;
}

interface SubAgent {
  id: string;
  role: string;                    // "scanner", "form-filler", "validator"
  assignedSubtask: string;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  context: AgentContext;           // what this agent knows
  capabilities: string[];         // what actions it can perform
  constraints: SafetyConstraint[];
  results: any;                    // output to pass to next agent
}

interface SwarmPlan {
  phases: Phase[];                 // sequential phases
  // Within each phase, agents run in parallel
}

interface Phase {
  name: string;
  agents: SubAgentConfig[];       // agents that run in parallel
  dependencies: string[];         // which phases must complete first
  aggregation?: AggregationRule;  // how to combine results
}

// Example: The vendor compliance task
const vendorCompliancePlan: SwarmPlan = {
  phases: [
    {
      name: "scan",
      agents: [
        { role: "scanner", params: { pages: "1-17" } },
        { role: "scanner", params: { pages: "18-34" } },
        { role: "scanner", params: { pages: "35-50" } },
      ],
      dependencies: [],
      aggregation: { type: "merge_arrays", field: "expired_vendors" }
    },
    {
      name: "notify",
      agents: [
        { role: "emailer", params: { template: "renewal_request" } }
      ],
      dependencies: ["scan"],  // waits for scan phase to complete
    }
  ]
};
```

### How Sub-Agents Work in the Browser

**Problem:** You can't open 3 browser tabs and control them simultaneously from an extension.

**Solution:** Sub-agents are **logical**, not physical. They share one browser tab but take turns, or they work across tabs using the Chrome Extension tabs API.

```typescript
class SwarmRuntime {
  private coordinator: SwarmCoordinator;
  private activeAgent: SubAgent | null = null;
  private tabPool: Map<string, number> = new Map();  // agentId -> tabId

  async execute(plan: SwarmPlan) {
    for (const phase of plan.phases) {
      // Check dependencies
      await this.waitForDependencies(phase.dependencies);

      if (phase.agents.length === 1) {
        // Sequential: run in current tab
        await this.runAgent(phase.agents[0], 'current');
      } else {
        // Parallel: each agent gets its own tab
        // (user can watch agents work across tabs)
        const promises = phase.agents.map(async (agentConfig) => {
          const tabId = await chrome.tabs.create({ active: false });
          this.tabPool.set(agentConfig.id, tabId.id);
          return this.runAgent(agentConfig, tabId.id);
        });
        const results = await Promise.allSettled(promises);

        // Aggregate results
        if (phase.aggregation) {
          this.aggregateResults(phase, results);
        }

        // Clean up tabs
        for (const [agentId, tabId] of this.tabPool) {
          await chrome.tabs.remove(tabId);
        }
      }
    }
  }

  async runAgent(config: SubAgentConfig, tabId: number | 'current') {
    const agent = this.spawnAgent(config);

    while (agent.status !== 'done' && agent.status !== 'error') {
      // 1. Observe current page state
      const state = await this.getPageState(tabId);

      // 2. Ask LLM for next action
      const action = await this.agentBrain.decideNextAction({
        agent: agent,
        pageState: state,
        siteIndex: this.siteIndex,
        remainingSubtask: agent.assignedSubtask,
        completedSteps: agent.history
      });

      // 3. Safety check
      const risk = this.safetyLayer.classify(action);
      if (risk === 'blocked') {
        agent.status = 'error';
        agent.error = `Blocked action: ${action.description}`;
        break;
      }
      if (risk === 'review') {
        const approved = await this.requestHumanApproval(action);
        if (!approved) { agent.status = 'error'; break; }
      }

      // 4. Execute action
      await this.actionRuntime.execute(action, tabId);

      // 5. Record for audit
      this.auditLog.record(agent.id, action, state);
    }

    return agent.results;
  }
}
```

### Agent-to-Agent Communication

Agents within a swarm communicate through a **message bus**:

```typescript
interface AgentMessage {
  from: string;        // agent ID
  to: string;          // agent ID or "coordinator" or "broadcast"
  type: 'result' | 'error' | 'request_help' | 'data_handoff' | 'status';
  payload: any;
}

// Example flow:
// Scanner Agent → Coordinator: "Found 5 expired vendors on pages 1-17"
// Coordinator → Emailer Agent: "Here are 12 total expired vendors, send emails"
// Emailer Agent → Coordinator: "Sent 10/12, 2 failed (no email on file)"
// Coordinator → User: "Done. 10 reminders sent. 2 vendors missing email addresses."
```

---

## Part 3: Chat → Flow → Agent Pipeline

This is how a one-time chat command becomes a permanent, autonomous agent.

### Stage 1: Chat (Ephemeral)

```
User: "Go to the timesheet page, fill in 8 hours for today, project = Phoenix, and submit"
```

The agent executes this immediately. The execution is logged as a **Task**.

### Stage 2: Promote to Flow (Reusable)

```
Agent: "Done! Want to save this as a reusable flow? I can parameterize it so
        you just say 'log my hours' next time."

User: "Yes, save it"

Agent: "I've created a flow called 'Log Timesheet'. It takes these parameters:
        - hours (default: 8)
        - project (default: Phoenix)
        - date (default: today)

        You can run it by saying 'Log my hours' or 'Log 6 hours on Project Atlas'"
```

**What happens under the hood:**

```typescript
interface Flow {
  id: string;
  name: string;
  description: string;           // natural language description
  parameters: FlowParameter[];   // extracted variables
  steps: FlowStep[];             // recorded actions with parameterized values
  site: string;                  // domain this flow works on
  created_from: string;          // task ID that spawned this flow
  version: number;
  safety_level: 'safe' | 'review_required' | 'admin_only';
}

interface FlowParameter {
  name: string;
  type: 'string' | 'number' | 'date' | 'enum' | 'file';
  default?: any;
  required: boolean;
  source?: 'user_input' | 'extracted_from_page' | 'api' | 'previous_step';
  description: string;           // "The project to log hours against"
  enum_values?: string[];        // for dropdowns: ["Phoenix", "Atlas", "Orion"]
}

// How the LLM parameterizes a recorded task:
function parameterizeTask(task: RecordedTask): Flow {
  // LLM analyzes the recorded steps and identifies:
  // 1. Which values are likely to change between runs (→ parameters)
  // 2. Which values are constants (→ hardcoded in flow)
  // 3. Which values come from the page itself (→ extracted at runtime)
  // 4. Natural language aliases ("log hours", "submit timesheet", etc.)
}
```

### Stage 3: Promote to Agent (Autonomous)

```
User: "Run this every weekday at 5pm"

Agent: "I'll set up an agent that runs 'Log Timesheet' every weekday at 5pm.
        Since this submits a form, I'll ask for your confirmation before
        submitting each time. Or do you want full auto?"

User: "Full auto, but notify me after"

Agent: "Done. Agent 'Daily Timesheet' is active.
        - Runs: Mon-Fri at 5:00 PM
        - Auto-submits: Yes
        - Notifications: Slack message after completion
        - Safety: Will pause if it encounters anything unexpected"
```

```typescript
interface Agent {
  id: string;
  name: string;
  flow_id: string;               // which flow it executes
  trigger: AgentTrigger;
  parameter_bindings: Record<string, ParameterBinding>;
  safety_config: SafetyConfig;
  notification_config: NotificationConfig;
  status: 'active' | 'paused' | 'disabled';
  last_run: RunResult | null;
  run_history: RunResult[];
}

type AgentTrigger =
  | { type: 'schedule'; cron: string }                    // "0 17 * * 1-5"
  | { type: 'webhook'; url: string }                      // external trigger
  | { type: 'event'; source: string; condition: string }  // "when email arrives with subject X"
  | { type: 'manual' }                                    // user clicks "Run"
  | { type: 'agent'; agent_id: string; on: 'success' | 'failure' }  // triggered by another agent
  | { type: 'page_change'; url: string; condition: string }  // "when value on page changes"

interface ParameterBinding {
  // Where does this parameter get its value at runtime?
  source: 'static' | 'prompt_user' | 'from_trigger' | 'from_page' | 'from_api' | 'llm_decide';
  value?: any;              // for static
  prompt?: string;          // for prompt_user: "How many hours today?"
  extractor?: string;       // for from_page: CSS selector or description
  api_config?: APIConfig;   // for from_api
}
```

---

## Part 4: Page Indexing & Site Memory

### How Indexing Works (Revised)

The indexer doesn't just crawl once — it builds a **living memory** of the site that updates as the user navigates.

```typescript
class SiteMemory {
  private pages: Map<string, PageSnapshot> = new Map();
  private graph: NavigationGraph = new NavigationGraph();
  private elementIndex: ElementIndex;  // searchable index of all elements

  // Called every time the user navigates to a new page
  async indexCurrentPage(url: string, dom: Document) {
    const snapshot: PageSnapshot = {
      url: this.normalizeUrl(url),
      title: dom.title,
      timestamp: Date.now(),
      type: await this.classifyPage(dom),  // 'dashboard' | 'form' | 'table' | 'detail' | 'list'

      // Interactive elements
      elements: this.extractElements(dom),

      // Page structure
      sections: this.extractSections(dom),     // logical sections (header, sidebar, main, footer)
      modals: this.detectModals(dom),          // hidden modals that might appear
      forms: this.extractForms(dom),           // form fields, validation rules, required fields

      // Data on the page
      tables: this.extractTables(dom),         // column headers, row count, pagination
      lists: this.extractLists(dom),           // repeated item patterns

      // Navigation
      links: this.extractLinks(dom),           // where can you go from here
      breadcrumbs: this.extractBreadcrumbs(dom),
    };

    this.pages.set(snapshot.url, snapshot);
    this.graph.addNode(snapshot.url, snapshot);
    this.elementIndex.addPage(snapshot);
  }

  // Incremental updates via MutationObserver
  async handleDOMChange(mutations: MutationRecord[]) {
    // Only re-index if significant changes (new elements, removed sections)
    // Ignore text-only changes, style changes
    const significant = mutations.filter(m =>
      m.type === 'childList' &&
      (m.addedNodes.length > 0 || m.removedNodes.length > 0)
    );

    if (significant.length > 0) {
      await this.indexCurrentPage(window.location.href, document);
    }
  }

  // Natural language search over the site
  async findElement(description: string): Promise<ElementRef[]> {
    // "the submit button on the expense form"
    // Uses embedding similarity against element descriptions
    return this.elementIndex.search(description);
  }

  // Find how to get from page A to page B
  async findPath(from: string, to: string): Promise<NavigationStep[]> {
    return this.graph.shortestPath(from, to);
  }
}
```

### What Gets Indexed Per Element

```typescript
interface IndexedElement {
  // Identity (multiple strategies for resilience)
  selectors: {
    primary: string;           // most reliable selector
    id: string | null;
    dataTestId: string | null;
    ariaLabel: string | null;
    cssPath: string;
    xpath: string;
    textContent: string;       // visible text (truncated)
  };

  // Semantics
  type: 'button' | 'link' | 'input' | 'select' | 'checkbox' | 'radio'
      | 'textarea' | 'table' | 'form' | 'modal' | 'tab' | 'menu'
      | 'dropdown' | 'toggle' | 'slider' | 'file-upload' | 'date-picker'
      | 'search' | 'pagination' | 'unknown';

  role: string;                 // semantic role: "submit", "cancel", "navigate", "filter"
  label: string;                // human-readable label
  description: string;          // LLM-generated description of what this element does

  // State
  visible: boolean;
  enabled: boolean;
  required: boolean;            // for form fields
  currentValue: string | null;
  validValues: string[] | null; // for selects/dropdowns

  // Position (for visual fallback)
  boundingBox: DOMRect;
  section: string;              // "header" | "sidebar" | "main-content" | "footer" | "modal"

  // Relationships
  belongsToForm: string | null;
  triggersModal: string | null;
  navigatesTo: string | null;

  // Interaction history
  lastInteracted: number | null;
  interactionCount: number;
}
```

---

## Part 5: Action Runtime — Executing in the Browser

### Action Primitives

Every agent action decomposes into these primitives:

```typescript
type BrowserAction =
  // Navigation
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'refresh' }

  // Interaction
  | { type: 'click'; target: ElementRef; clickType?: 'single' | 'double' | 'right' }
  | { type: 'type'; target: ElementRef; text: string; clear?: boolean }
  | { type: 'select'; target: ElementRef; value: string }
  | { type: 'check'; target: ElementRef; checked: boolean }
  | { type: 'upload'; target: ElementRef; file: FileRef }
  | { type: 'drag'; from: ElementRef; to: ElementRef }

  // Scrolling
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount: number }
  | { type: 'scrollTo'; target: ElementRef }

  // Keyboard
  | { type: 'keypress'; key: string; modifiers?: string[] }
  | { type: 'hotkey'; combo: string }  // "Ctrl+S", "Cmd+Enter"

  // Wait
  | { type: 'wait'; condition: WaitCondition; timeout: number }
  | { type: 'waitForNavigation'; timeout: number }

  // Data extraction
  | { type: 'extract'; target: ElementRef; extractType: 'text' | 'value' | 'html' | 'table' | 'screenshot' }

  // Clipboard
  | { type: 'copy'; target: ElementRef }
  | { type: 'paste'; target: ElementRef }

  // Tab management (for swarm)
  | { type: 'openTab'; url: string }
  | { type: 'switchTab'; tabId: number }
  | { type: 'closeTab'; tabId: number };

type WaitCondition =
  | { type: 'element_visible'; selector: string }
  | { type: 'element_hidden'; selector: string }
  | { type: 'text_appears'; text: string }
  | { type: 'url_matches'; pattern: string }
  | { type: 'network_idle' }
  | { type: 'custom'; description: string };  // LLM evaluates: "loading spinner disappears"
```

### Self-Healing Element Resolution

When the agent needs to interact with an element, it doesn't rely on a single selector:

```typescript
class ElementResolver {
  // Try multiple strategies in order of reliability
  async resolve(ref: ElementRef): Promise<HTMLElement | null> {
    const strategies: Array<() => HTMLElement | null> = [
      // 1. data-testid (most stable, set by developers)
      () => ref.selectors.dataTestId
        ? document.querySelector(`[data-testid="${ref.selectors.dataTestId}"]`)
        : null,

      // 2. ID
      () => ref.selectors.id
        ? document.getElementById(ref.selectors.id)
        : null,

      // 3. ARIA label
      () => ref.selectors.ariaLabel
        ? document.querySelector(`[aria-label="${ref.selectors.ariaLabel}"]`)
        : null,

      // 4. CSS path
      () => document.querySelector(ref.selectors.cssPath),

      // 5. Text content matching
      () => this.findByText(ref.selectors.textContent, ref.type),

      // 6. XPath
      () => this.evaluateXPath(ref.selectors.xpath),

      // 7. Structural similarity (same position in DOM tree)
      () => this.findByStructure(ref),

      // 8. Visual similarity (last resort — uses screenshot + LLM vision)
      () => this.findByVision(ref),
    ];

    for (const strategy of strategies) {
      const element = strategy();
      if (element && this.isViableMatch(element, ref)) {
        return element;
      }
    }

    return null; // Could not resolve — agent should ask user
  }

  // Verify the found element is actually the right one
  isViableMatch(element: HTMLElement, ref: ElementRef): boolean {
    // Check type matches (don't click a div thinking it's a button)
    // Check approximate position (shouldn't have moved to opposite side of page)
    // Check visibility (must be in viewport or scrollable to)
    return true;
  }
}
```

---

## Part 6: Safety & Security Architecture

### Defense in Depth

```
┌─────────────────────────────────────────────────────────────────┐
│                     SAFETY LAYERS                               │
│                                                                 │
│  Layer 1: ACTION CLASSIFICATION                                 │
│  ├── Every action tagged: read-only / write / destructive       │
│  ├── Destructive actions ALWAYS blocked without explicit rule   │
│  └── Write actions require approval (configurable per flow)     │
│                                                                 │
│  Layer 2: SCOPE BOUNDARIES                                      │
│  ├── Agent can only operate on whitelisted domains              │
│  ├── Agent can only access whitelisted URL patterns             │
│  ├── Agent cannot navigate away from assigned application       │
│  └── Agent cannot interact with browser chrome (bookmarks etc)  │
│                                                                 │
│  Layer 3: RATE LIMITS & BOUNDS                                  │
│  ├── Max actions per minute (default: 30)                       │
│  ├── Max records affected per run (default: 100)                │
│  ├── Max concurrent agents per user (default: 3)                │
│  ├── Max total cost per run (LLM tokens)                        │
│  └── Timeout per task (default: 10 minutes)                     │
│                                                                 │
│  Layer 4: ANOMALY DETECTION                                     │
│  ├── If page state diverges from expected → pause               │
│  ├── If agent loops (same action 3x) → pause                   │
│  ├── If unexpected modal/alert appears → pause                  │
│  ├── If auth expires mid-task → pause + notify                  │
│  └── If action would affect more items than expected → pause    │
│                                                                 │
│  Layer 5: HUMAN-IN-THE-LOOP                                     │
│  ├── Configurable approval gates per flow step                  │
│  ├── "Dry run" mode: show plan, don't execute                   │
│  ├── Real-time activity feed: user sees what agent is doing     │
│  └── One-click kill switch (Escape key or extension icon)       │
│                                                                 │
│  Layer 6: AUDIT & COMPLIANCE                                    │
│  ├── Every action logged with timestamp + before/after state    │
│  ├── Screenshots at key decision points                         │
│  ├── Full replay capability (play back what agent did)          │
│  ├── Exportable audit trail (PDF/CSV for compliance teams)      │
│  └── Retention policies (configurable per org)                  │
│                                                                 │
│  Layer 7: DATA ISOLATION                                        │
│  ├── Page content NEVER sent to our servers                     │
│  ├── LLM sees structure + labels, not actual data values        │
│  ├── Screenshots stored locally, never uploaded (unless opt-in) │
│  ├── Flows stored with parameterized values, not real data      │
│  └── Self-hosted option: zero data leaves customer network      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Permission Model

```typescript
interface AgentPermissions {
  // What domains can this agent access?
  allowed_domains: string[];        // ["erp.company.com", "hr.company.com"]

  // What URL patterns can it navigate?
  allowed_paths: string[];          // ["/invoices/*", "/reports/*"]
  blocked_paths: string[];          // ["/admin/*", "/settings/*"]

  // What actions can it take?
  allowed_actions: ActionType[];    // ['navigate', 'click', 'type', 'extract']
  blocked_actions: ActionType[];    // ['delete', 'upload']

  // What elements can it interact with?
  element_whitelist?: string[];     // specific selectors it CAN touch
  element_blacklist?: string[];     // specific selectors it CANNOT touch

  // Approval requirements
  auto_approve: ActionType[];       // actions that don't need human approval
  require_approval: ActionType[];   // actions that always need approval
  approval_timeout: number;         // seconds to wait for approval before aborting

  // Resource limits
  max_actions_per_run: number;
  max_duration_seconds: number;
  max_tabs: number;
  max_llm_tokens_per_run: number;
}
```

### Rollback / Undo System

```typescript
class UndoStack {
  private stack: UndoableAction[] = [];

  async recordAction(action: BrowserAction, beforeState: PageState) {
    const undoable = this.computeUndo(action, beforeState);
    if (undoable) {
      this.stack.push(undoable);
    }
  }

  // Not all actions are undoable
  computeUndo(action: BrowserAction, before: PageState): UndoableAction | null {
    switch (action.type) {
      case 'type':
        return { undo: { type: 'type', target: action.target, text: before.value, clear: true } };
      case 'select':
        return { undo: { type: 'select', target: action.target, value: before.value } };
      case 'check':
        return { undo: { type: 'check', target: action.target, checked: !action.checked } };
      case 'navigate':
        return { undo: { type: 'back' } };
      case 'click':
        // Clicks are often not reversible — flag this
        return null;
      default:
        return null;
    }
  }

  async undoLast(n: number = 1) {
    for (let i = 0; i < n && this.stack.length > 0; i++) {
      const action = this.stack.pop()!;
      await this.actionRuntime.execute(action.undo);
    }
  }
}
```

---

## Part 7: Backend Architecture

### Service Topology

```
┌──────────────────────────────────────────────────────────────────┐
│                        API GATEWAY                                │
│                   (Auth, Rate Limiting, TLS)                      │
│                    Cloudflare / Kong / Custom                     │
└───────────────────────────┬──────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
  ┌─────┴──────┐    ┌──────┴──────┐    ┌───────┴──────┐
  │ Agent      │    │ Flow        │    │ Swarm        │
  │ Service    │    │ Service     │    │ Coordinator  │
  │            │    │             │    │              │
  │ - Chat API │    │ - CRUD      │    │ - Plan tasks │
  │ - LLM calls│    │ - Versioning│    │ - Spawn      │
  │ - Session  │    │ - Params    │    │ - Monitor    │
  │   mgmt     │    │ - Sharing   │    │ - Aggregate  │
  └─────┬──────┘    └──────┬──────┘    └───────┬──────┘
        │                  │                   │
        └──────────┬───────┴───────────────────┘
                   │
        ┌──────────┴──────────┐
        │    Core Services     │
        │                      │
        │  ┌────────────────┐  │
        │  │ Site Memory    │  │  ← Stores indexed site structure
        │  │ (Postgres +    │  │    (NOT page content)
        │  │  pgvector)     │  │
        │  └────────────────┘  │
        │  ┌────────────────┐  │
        │  │ Audit Service  │  │  ← Every action logged
        │  │ (Append-only   │  │    Immutable audit trail
        │  │  log)          │  │
        │  └────────────────┘  │
        │  ┌────────────────┐  │
        │  │ Trigger Engine │  │  ← Cron, webhooks, events
        │  │ (Temporal.io)  │  │    Schedules agent runs
        │  └────────────────┘  │
        │  ┌────────────────┐  │
        │  │ Auth & Org     │  │  ← SSO, teams, permissions
        │  │ (WorkOS)       │  │    RBAC for agents
        │  └────────────────┘  │
        │  ┌────────────────┐  │
        │  │ Notification   │  │  ← Slack, email, webhook
        │  │ Service        │  │    Agent status updates
        │  └────────────────┘  │
        └──────────────────────┘
```

### Database Schema

```sql
-- Organizations & Users
CREATE TABLE orgs (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT DEFAULT 'free',        -- free, team, enterprise
  settings JSONB DEFAULT '{}'
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  org_id UUID REFERENCES orgs(id),
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'member'       -- admin, member, viewer
);

-- Sites & Pages (structure only — no content)
CREATE TABLE sites (
  id UUID PRIMARY KEY,
  org_id UUID REFERENCES orgs(id),
  domain TEXT NOT NULL,
  name TEXT,
  last_indexed_at TIMESTAMPTZ,
  page_count INT DEFAULT 0,
  settings JSONB DEFAULT '{}'
);

CREATE TABLE pages (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id),
  url_pattern TEXT NOT NULL,       -- "/invoices/:id" (parameterized)
  title TEXT,
  page_type TEXT,                  -- dashboard, form, table, detail
  elements JSONB NOT NULL,         -- array of IndexedElement (structure only)
  navigation JSONB,                -- links to other pages
  last_seen TIMESTAMPTZ,
  UNIQUE(site_id, url_pattern)
);

-- Element embeddings for semantic search
CREATE TABLE element_embeddings (
  id UUID PRIMARY KEY,
  page_id UUID REFERENCES pages(id),
  element_selector TEXT NOT NULL,
  description TEXT NOT NULL,       -- "Submit button for expense form"
  embedding vector(1536),          -- for semantic search
  element_type TEXT
);
CREATE INDEX ON element_embeddings USING ivfflat (embedding vector_cosine_ops);

-- Flows (reusable workflows)
CREATE TABLE flows (
  id UUID PRIMARY KEY,
  org_id UUID REFERENCES orgs(id),
  created_by UUID REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  site_id UUID REFERENCES sites(id),
  parameters JSONB DEFAULT '[]',   -- FlowParameter[]
  steps JSONB NOT NULL,            -- FlowStep[]
  version INT DEFAULT 1,
  is_template BOOLEAN DEFAULT false,  -- shared in marketplace
  safety_level TEXT DEFAULT 'review_required',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Agents (autonomous flow runners)
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  org_id UUID REFERENCES orgs(id),
  created_by UUID REFERENCES users(id),
  flow_id UUID REFERENCES flows(id),
  name TEXT NOT NULL,
  trigger JSONB NOT NULL,          -- AgentTrigger
  parameter_bindings JSONB DEFAULT '{}',
  permissions JSONB NOT NULL,      -- AgentPermissions
  notification_config JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active',    -- active, paused, disabled
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit log (append-only, immutable)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  agent_id UUID REFERENCES agents(id),
  task_id UUID,                    -- groups actions in one execution
  user_id UUID REFERENCES users(id),
  action_type TEXT NOT NULL,
  action_detail JSONB NOT NULL,
  risk_level TEXT,                 -- safe, review, blocked
  approved_by UUID REFERENCES users(id),
  page_url TEXT,
  element_selector TEXT,
  result TEXT,                     -- success, failed, skipped
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON audit_logs (agent_id, created_at);
CREATE INDEX ON audit_logs (org_id, created_at);

-- Chat sessions (conversation history)
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  site_id UUID REFERENCES sites(id),
  messages JSONB NOT NULL,         -- array of chat messages
  task_ids UUID[],                 -- tasks spawned from this chat
  flow_id UUID REFERENCES flows(id),  -- if promoted to flow
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Part 8: Tech Stack (Final)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Chrome Extension** | TypeScript, Manifest V3 | Standard, secure sandbox |
| **Extension UI** | React 19 + Tailwind + Radix UI | Side panel chat interface |
| **Element Selection** | Custom overlay engine | No dependency, full control |
| **Local Storage** | IndexedDB via Dexie.js | Large capacity, structured |
| **Real-time Comms** | WebSocket (extension ↔ backend) | Streaming agent responses |
| **Backend API** | Node.js + Hono (on Cloudflare Workers) | Edge-first, fast cold starts |
| **Database** | PostgreSQL + pgvector (Neon or Supabase) | Relational + vector search |
| **Workflow Engine** | Temporal.io | Durable execution, retries, scheduling |
| **LLM Provider** | Anthropic Claude API | Best reasoning + vision + tool use |
| **Auth** | WorkOS | Enterprise SSO/SCIM out of the box |
| **Notifications** | Knock or custom | Slack, email, webhook integrations |
| **Monitoring** | PostHog + Sentry | Analytics + error tracking |
| **Queue** | BullMQ (Redis) | Scheduled triggers, async processing |
| **File Storage** | Cloudflare R2 | Audit screenshots (encrypted) |
| **CI/CD** | GitHub Actions | Standard, integrates with everything |

---

## Part 9: How It All Fits Together — User Journey

### Journey 1: First-Time User

```
1. Install Chrome extension
2. Navigate to internal dashboard (e.g., SAP, Salesforce, custom ERP)
3. Click extension icon → Side panel opens with chat
4. Extension auto-indexes the current page in background
5. User types: "What can I do on this page?"
6. Agent responds: "I can see this is an invoice dashboard. I found:
   - 'Create Invoice' button
   - Invoice table with 234 rows (filterable by status, date, vendor)
   - Export button (CSV/PDF)
   - Search bar
   What would you like to do?"
7. User: "Find all overdue invoices and export them as PDF"
8. Agent executes, shows progress, delivers result
9. Agent: "Done! Want to save this as a reusable flow?"
```

### Journey 2: Power User with Swarm

```
1. User has 5 flows saved across 3 internal apps
2. Creates a "Monthly Close" agent that:
   - Runs Flow A on ERP (export financial data)
   - Runs Flow B on HR portal (get headcount)
   - Runs Flow C on project tracker (get utilization)
   - Combines results and fills template in Google Sheets
   - Sends completed sheet to CFO via email
3. This runs automatically on the 1st of every month
4. Uses 3 sub-agents in parallel for the first 3 steps
5. User gets a Slack notification: "Monthly close completed. Sheet sent."
```

### Journey 3: Team Admin

```
1. Admin creates a flow: "Client onboarding checklist"
2. Shares it with the team via flow marketplace
3. Sets permissions: team members can run, only admins can edit
4. New team member joins, installs extension, sees shared flows
5. Runs "Client onboarding" → agent fills 4 different systems
6. Admin sees audit trail of who ran what, when
```

---

## Part 10: Development Roadmap

### Phase 1: "Chat with any page" (Weeks 1-6)
- Chrome extension with side panel chat UI
- Page indexer (auto-index current page on load)
- Element selector (point & click to select elements)
- Basic action runtime (click, type, navigate, extract)
- Connect to Claude API for chat + planning
- ReAct loop: plan → act → observe → respond
- **Demo:** Chat with Hacker News, GitHub, or any public site

### Phase 2: "Record & Replay" (Weeks 7-10)
- Record user actions as they perform tasks
- LLM parameterization (turn recording into reusable flow)
- Flow save/load (local storage first, then backend)
- Self-healing element resolution (multi-strategy selectors)
- Safety layer v1 (action classification, blocked list)
- **Demo:** Record an expense submission, replay it with different values

### Phase 3: "Flows & Agents" (Weeks 11-16)
- Backend services (auth, flow registry, audit)
- Chat → Flow promotion pipeline
- Agent creation with triggers (schedule, manual)
- Notification system (Slack/email on completion)
- Permission model (domain whitelisting, action approval)
- Audit trail with action replay
- **Demo:** Scheduled agent that runs a daily report

### Phase 4: "Swarm" (Weeks 17-22)
- Multi-agent coordinator
- Parallel execution across tabs
- Agent-to-agent data handoff
- Cross-application workflows
- Team sharing / flow marketplace
- Admin dashboard
- **Demo:** Monthly close process across 3 apps with parallel agents

### Phase 5: "Enterprise" (Weeks 23-30)
- Self-hosted deployment option
- SSO/SCIM (WorkOS)
- Role-based access control
- Compliance reporting (exportable audit trails)
- On-prem LLM support (customer's own inference)
- SOC 2 Type II certification process
- **Target:** First enterprise contracts

---

## Competitive Positioning

```
                        High Intelligence
                              ▲
                              │
                   ┌──────────┼──────────┐
                   │          │          │
                   │   US ★   │          │
                   │          │          │
         Internal  │──────────┼──────────│  General
         Apps      │          │          │  Web
         Focus     │          │  OpenAI  │
                   │          │  Operator │
                   │  UiPath  │  Comet   │
                   │          │          │
                   └──────────┼──────────┘
                              │
                              ▼
                        Low Intelligence
                       (Script-based)

  Our unique position: HIGH intelligence + INTERNAL app focus
  - We deeply know the customer's specific apps (site memory)
  - We use LLM reasoning (not brittle scripts)
  - We're built for enterprise security requirements
  - Chat-first UX makes it accessible to non-technical users
```

### Why We Win

| vs. UiPath/Automation Anywhere | vs. OpenAI Operator/Comet | vs. Browser-use/Playwright |
|-------------------------------|--------------------------|---------------------------|
| No heavy desktop install | We know YOUR app deeply | Full product, not a library |
| Non-technical users can build | Enterprise security model | Chat interface, not code |
| AI reasoning, not flowcharts | Internal app focus | Self-healing, not brittle |
| Modern web-first architecture | Multi-agent swarms | Safety + audit built in |
| 10x cheaper | On-prem deployment option | Team collaboration |
