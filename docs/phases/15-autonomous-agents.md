# Phase 15 — Autonomous Agent System

> Agents as persistent, self-improving entities that users create, configure, invoke, and that can invoke each other. Inspired by OpenClaw's file-based agent architecture, adapted for browser automation.

## Why

Today Commandra has one agent identity — a generic orchestrator that handles every conversation with the same personality, tools, and system prompt. It's reactive (waits for user input), ephemeral (no state between sessions), and flat (coordinator + sub-agents, no specialization).

OpenClaw proved that agents work better when they have:

- **Identity** — each agent has a purpose, personality, and domain expertise
- **Persistence** — agents remember what they've learned across sessions
- **Autonomy** — agents can wake up on a schedule, do work, and go back to sleep
- **Composability** — agents can invoke other agents based on capability matching

This phase transforms Commandra from "one smart agent" to "a system of specialized, self-improving agents."

## Core Concepts

### Agent = Folder in Supabase Storage

Each agent is a folder of files. The agent reads its own files to understand who it is, what it knows, and what it's learned. It writes to those files to get better over time.

```
storage/
└── {userId}/
    └── agents/
        ├── inbox-manager/
        │   ├── AGENT.yaml          # Identity, config, tools, triggers
        │   ├── SOUL.md             # Personality, behavioral instructions
        │   ├── SKILLS.md           # Learned capabilities (agent writes these)
        │   ├── LEARNINGS.md        # What worked, what didn't
        │   ├── ERRORS.md           # Failure patterns to avoid
        │   └── workspace/          # Scratch files, templates, exports
        │       ├── email-templates.md
        │       └── triage-rules.yaml
        │
        ├── data-extractor/
        │   ├── AGENT.yaml
        │   ├── SOUL.md
        │   ├── SKILLS.md
        │   └── workspace/
        │       └── output-formats.yaml
        │
        └── _coordinator/           # Special: default routing agent
            ├── AGENT.yaml
            ├── ROUTING.yaml        # Which agent handles what
            └── SOUL.md
```

### Why Files, Not Database Rows

- **Human-readable** — users can open and edit agent configs directly
- **Agent-writable** — agents write markdown/yaml naturally (it's what LLMs are good at)
- **Composable** — copy a folder to clone an agent, zip it to share
- **Diffable** — track what changed in an agent's knowledge over time
- **No schema migrations** — agents can invent new file types as needed

### Supabase Storage as the Agent Workspace

Supabase Storage provides the file layer. Every read/write to an agent's files goes through Supabase Storage API. This gives us:

- Per-user isolation via storage policies (RLS)
- File versioning (optional, via bucket policies)
- Works in both self-hosted (local Supabase) and cloud deployments
- The agent's "desk" — a place to store working files, outputs, templates

---

## What Ships

### 15a. Supabase Storage Integration

### 15b. Agent Definition & Registry

### 15c. Dynamic Prompt Building from Agent Files

### 15d. Agent-to-Agent Invocation

### 15e. Self-Improvement Loop

### 15f. Agent Scheduler (Heartbeat)

### 15g. Dashboard Agent Management UI

---

## 15a. Supabase Storage Integration

**Problem:** No file storage layer. Agent configs, skills, and learnings need a home that's readable/writable by both agents and users.

### Implementation

1. **Supabase client setup:**
   - Add `@supabase/supabase-js` to `apps/api`
   - Initialize client with `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` env vars
   - Singleton export from `apps/api/src/storage/supabase.ts`

2. **Storage bucket: `agent-files`**
   - One bucket for all agent files
   - Path structure: `{userId}/agents/{agentSlug}/{filename}`
   - RLS policies: users can only read/write their own agent files
   - Org members can read (not write) org-shared agents: `{orgId}/agents/{agentSlug}/`

3. **Agent file helpers: `apps/api/src/storage/agent-files.ts`**

   ```typescript
   // Core file operations
   readAgentFile(userId: string, agentSlug: string, path: string): Promise<string | null>
   writeAgentFile(userId: string, agentSlug: string, path: string, content: string): Promise<void>
   listAgentFiles(userId: string, agentSlug: string, prefix?: string): Promise<string[]>
   deleteAgentFile(userId: string, agentSlug: string, path: string): Promise<void>

   // Typed helpers
   readAgentConfig(userId: string, agentSlug: string): Promise<AgentConfig>
   writeAgentConfig(userId: string, agentSlug: string, config: AgentConfig): Promise<void>
   readAgentSkills(userId: string, agentSlug: string): Promise<string>
   appendToLearnings(userId: string, agentSlug: string, entry: LearningEntry): Promise<void>
   appendToErrors(userId: string, agentSlug: string, entry: ErrorEntry): Promise<void>
   ```

4. **Internal tools for agent file access:**
   - `save_to_workspace` — agent writes a file to its own workspace folder
   - `read_from_workspace` — agent reads a file from its workspace
   - `list_workspace` — agent lists files in its workspace
   - These replace the current `save_to_local` tool with a more structured approach

### Files to create/modify

- `apps/api/src/storage/supabase.ts` — New: Supabase client singleton
- `apps/api/src/storage/agent-files.ts` — New: agent file CRUD helpers
- `apps/api/src/tools/registry.ts` — Register workspace tools
- `apps/api/package.json` — Add `@supabase/supabase-js`
- `.env.example` — Add `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

### Acceptance criteria

- [ ] Supabase client initializes on API startup
- [ ] Agent files can be read/written via helper functions
- [ ] RLS policies enforce per-user isolation
- [ ] Workspace tools available to orchestrator
- [ ] Works with both local Supabase (Docker) and hosted Supabase

---

## 15b. Agent Definition & Registry

**Problem:** No concept of distinct agents. The orchestrator is a monolith.

### AGENT.yaml Schema

```yaml
# Required fields
name: inbox-manager
slug: inbox-manager # folder name, URL-safe
description: Manages email triage across Gmail and Outlook
version: 1 # bumped on config changes

# Model configuration
model: strong # strong | fast | specific model ID
thinking: true # enable extended thinking
max_iterations: 10 # override default 15

# Domain restrictions
domains:
  - mail.google.com
  - outlook.office.com
  # Empty = agent works on any domain

# Tool configuration
tools:
  allowed: all # 'all' or explicit list
  # allowed: [click_element, type_text, navigate, read_text, screenshot]
  blocked: [export_data] # always blocked for this agent
  internal: [save_memory, recall_memory, save_to_workspace, read_from_workspace]

# Safety overrides
safety:
  default_level: review # safe | review | blocked
  auto_approve: [navigate, read_text, screenshot, scroll]
  always_review: [click_element, type_text, select_option]

# Trigger configuration
triggers:
  - type: user # user explicitly invokes
  - type: invocation # another agent calls this one
  - type: schedule
    cron: '0 9 * * 1-5' # weekdays at 9am
    task: 'Check inbox for urgent emails and summarize'
  - type: webhook
    path: /agents/inbox-manager/trigger

# Capabilities (used for agent resolution)
capabilities:
  - email_triage
  - draft_replies
  - label_management
  - inbox_zero

# Relationships
reports_to: _coordinator # escalation chain
can_invoke: # which agents this one can call
  - data-extractor
  - task-tracker
```

### SOUL.md — Agent Personality

```markdown
# Inbox Manager

You are a focused email triage agent. Your job is to help the user
achieve inbox zero efficiently.

## Behaviors

- Always categorize emails before taking action
- Never delete emails — archive or label instead
- Flag anything from the user's manager as urgent
- Summarize long email threads in 2-3 sentences

## Tone

- Brief, efficient, no fluff
- Use bullet points for summaries
- Ask before sending any reply

## Domain Knowledge

- Gmail: archive = remove from inbox, not delete
- Outlook: focused inbox vs other inbox distinction matters
```

### Agent Registry: `apps/api/src/agent/agent-registry.ts`

```typescript
interface AgentConfig {
  name: string;
  slug: string;
  description: string;
  version: number;
  model: 'strong' | 'fast' | string;
  thinking: boolean;
  maxIterations: number;
  domains: string[];
  tools: { allowed: string[] | 'all'; blocked: string[]; internal: string[] };
  safety: { defaultLevel: string; autoApprove: string[]; alwaysReview: string[] };
  triggers: AgentTrigger[];
  capabilities: string[];
  reportsTo?: string;
  canInvoke: string[];
}

// Registry functions
loadAgent(userId: string, agentSlug: string): Promise<LoadedAgent>
  // Reads AGENT.yaml + SOUL.md + SKILLS.md + LEARNINGS.md
  // Returns fully hydrated agent ready for orchestrator

listAgents(userId: string): Promise<AgentSummary[]>
  // Lists all agent folders, reads AGENT.yaml from each
  // Returns array of summaries (no skills/learnings loaded)

resolveAgent(userId: string, task: string, currentDomain?: string): Promise<string | null>
  // 1. Filter agents by domain match (if currentDomain provided)
  // 2. Embed task description
  // 3. Compare against agent capability embeddings
  // 4. Return best-fit agentSlug (or null if no good match)

createAgent(userId: string, config: AgentConfig, soul?: string): Promise<void>
  // Creates agent folder in Supabase Storage
  // Writes AGENT.yaml, SOUL.md, empty SKILLS.md, empty LEARNINGS.md

updateAgent(userId: string, agentSlug: string, config: Partial<AgentConfig>): Promise<void>
  // Updates AGENT.yaml, bumps version

deleteAgent(userId: string, agentSlug: string): Promise<void>
  // Removes agent folder from storage
  // Cleans up DB records (agent_runs, embeddings)

cloneAgent(userId: string, sourceSlug: string, newSlug: string): Promise<void>
  // Copies entire agent folder
  // Resets LEARNINGS.md and ERRORS.md (fresh start)
  // Preserves SKILLS.md (learned capabilities transfer)
```

### Database: Agent metadata (for queries, not config)

```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  org_id UUID REFERENCES organizations(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | paused | archived
  capabilities TEXT[],                     -- denormalized for search
  domains TEXT[],                          -- denormalized for filtering
  last_run_at TIMESTAMPTZ,
  total_runs INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, slug)
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),
  trigger TEXT NOT NULL,                   -- user | schedule | invocation | webhook
  invoked_by_agent_id UUID REFERENCES agents(id),
  task TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed | timeout
  result JSONB,
  tools_used JSONB,
  iterations INTEGER,
  tokens_used INTEGER,
  learnings_generated JSONB,               -- what the agent learned this run
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE agent_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  text TEXT NOT NULL,                      -- capability description
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Default Agent: `_coordinator`

Every user gets a `_coordinator` agent on signup. This is the default agent that handles conversations when no specific agent is matched. It acts as the router:

```yaml
# _coordinator/AGENT.yaml
name: Coordinator
slug: _coordinator
description: Routes tasks to specialized agents or handles them directly
model: strong
max_iterations: 15
domains: [] # works everywhere
tools:
  allowed: all
  blocked: []
  internal: [save_memory, recall_memory, spawn_agent, wait_for_agents]
capabilities:
  - task_routing
  - general_automation
  - multi_site_coordination
can_invoke: all # can invoke any agent
```

```yaml
# _coordinator/ROUTING.yaml
routing:
  - match: 'email|inbox|gmail|outlook|mail'
    agent: inbox-manager
    confidence_threshold: 0.7
  - match: 'extract|export|scrape|data'
    agent: data-extractor
    confidence_threshold: 0.7
  # Fallback: handle directly
```

### Files to create/modify

- `apps/api/src/agent/agent-registry.ts` — New: agent CRUD + resolution
- `apps/api/src/db/schema.ts` — Add `agents`, `agent_runs`, `agent_embeddings` tables
- `apps/api/src/routes/agents.ts` — New: agent management API routes
- `apps/api/src/routes/chat.ts` — Integrate agent resolution into chat flow
- `packages/shared/src/types/agents.ts` — New: agent type definitions
- Migration for new tables

### Acceptance criteria

- [ ] Agents definable via AGENT.yaml in Supabase Storage
- [ ] Agent registry loads, lists, resolves agents
- [ ] `_coordinator` agent created on user signup
- [ ] Agent metadata synced to Postgres for queries
- [ ] Agent capability embeddings enable semantic resolution
- [ ] CRUD API routes for agent management
- [ ] Agents scoped per user (or per org)

---

## 15c. Dynamic Prompt Building from Agent Files

**Problem:** System prompt is hardcoded in `prompts.ts`. Agents need their own prompts built from their files.

### Implementation

1. **Refactor `buildSystemPrompt()` to accept an `AgentContext`:**

   ```typescript
   interface AgentContext {
     agent: LoadedAgent;          // AGENT.yaml + SOUL.md parsed
     skills: string;              // SKILLS.md content
     learnings: string;           // LEARNINGS.md content (recent entries only)
     errors: string;              // ERRORS.md content (active errors only)
     domainMemory: string;        // existing domain memory
     userMemory: string;          // existing user memory
     pageContext: PageContext;     // current page elements
     priorContext: string;        // embedding-powered context enrichment
   }

   buildAgentPrompt(ctx: AgentContext): string
   ```

2. **Prompt assembly order:**

   ```
   1. Agent identity (from SOUL.md)
      "You are {agent.name}. {soul.md content}"

   2. Agent capabilities & restrictions (from AGENT.yaml)
      "You have access to these tools: ..."
      "You are restricted to these domains: ..."
      "Safety rules: ..."

   3. Agent skills (from SKILLS.md) — selective injection
      Only inject skills relevant to the current task
      Use keyword matching or embedding similarity

   4. Agent learnings (from LEARNINGS.md) — recent only
      Last 10 entries, or entries matching current domain

   5. Known errors (from ERRORS.md) — active only
      Errors marked as unresolved for current domain

   6. Domain memory (existing)
   7. User memory (existing)
   8. Current page context (existing)
   9. Prior context from embeddings (existing)

   10. Agent-specific instructions
       If agent has can_invoke: list available agents
       If agent has reports_to: escalation instructions
   ```

3. **Selective skill injection:**
   - Don't dump all of SKILLS.md into every prompt (OpenClaw's key insight)
   - Parse SKILLS.md into sections (## headers)
   - Match section titles against current task/domain
   - Only inject relevant sections (max 3-5)
   - Agent can use `recall_memory` to fetch more if needed

4. **Backwards compatibility:**
   - If no agent is resolved (user hasn't created any), fall back to `_coordinator`
   - `_coordinator` prompt ≈ current hardcoded prompt
   - Existing conversations continue to work

### Files to modify

- `apps/api/src/agent/prompts.ts` — Refactor to accept AgentContext, add agent prompt builder
- `apps/api/src/agent/orchestrator.ts` — Pass AgentContext instead of raw strings
- `apps/api/src/routes/chat.ts` — Load agent, build context, pass to orchestrator

### Acceptance criteria

- [ ] System prompt built dynamically from agent files
- [ ] SOUL.md injected as agent identity
- [ ] SKILLS.md selectively injected (not full dump)
- [ ] LEARNINGS.md and ERRORS.md inform agent behavior
- [ ] Backwards compatible with no-agent conversations
- [ ] Prompt caching still works (cache_control on stable sections)

---

## 15d. Agent-to-Agent Invocation

**Problem:** Current swarm is flat — coordinator spawns sub-agents with no identity. Agents can't invoke specific other agents by capability.

### Implementation

1. **Upgrade `spawn_agent` tool:**

   ```typescript
   // Current
   spawn_agent(task: string, targetUrl: string)

   // New
   spawn_agent(
     task: string,
     agent?: string,        // specific agent slug, OR
     capability?: string,   // capability to match (resolveAgent picks)
     targetUrl?: string,    // optional URL to navigate to
     context?: object,      // data to pass to the invoked agent
   )
   ```

   Resolution order:
   1. If `agent` specified → load that agent directly
   2. If `capability` specified → `resolveAgent(userId, capability)` → pick best match
   3. If neither → current behavior (generic sub-agent)

2. **Invoked agent lifecycle:**

   ```
   Invoking agent calls spawn_agent({agent: "data-extractor", task: "..."})
       │
       ▼
   Registry loads data-extractor's AGENT.yaml + SOUL.md + SKILLS.md
       │
       ▼
   Build agent-specific prompt (15c)
       │
       ▼
   Open browser tab (existing WS flow)
       │
       ▼
   Run orchestrator with agent's config:
     - Agent's model (strong/fast)
     - Agent's tool allowlist
     - Agent's safety overrides
     - Agent's max iterations
       │
       ▼
   On completion:
     - Record agent_run in DB
     - Post-execution analysis (15e)
     - Return result to invoking agent
   ```

3. **Invocation permissions:**
   - Agent A can only invoke agents listed in its `can_invoke` field
   - `can_invoke: all` means unrestricted (only for `_coordinator`)
   - Prevents infinite loops: invoked agents cannot re-invoke their invoker
   - Max invocation depth: 2 (agent → agent → no further)

4. **Context passing:**
   - Invoking agent can pass structured data via `context` parameter
   - Context is injected into the invoked agent's prompt as "Context from {invoker}"
   - Results flow back as structured `{ success, data, summary, actionsPerformed }`

5. **Result reporting:**
   - Invoked agent's full tool history logged in `agent_runs.tools_used`
   - SSE events: `agent_invoked`, `agent_completed`, `agent_failed`
   - UI shows nested agent activity (existing sub-agent accordion pattern)

### Files to modify

- `apps/api/src/agent/swarm.ts` — Agent-aware sub-agent spawning
- `apps/api/src/agent/orchestrator.ts` — Accept AgentConfig, respect tool/safety overrides
- `apps/api/src/tools/registry.ts` — Update spawn_agent parameters
- `packages/shared/src/types/sse.ts` — New SSE event types

### Acceptance criteria

- [ ] `spawn_agent` can target a specific agent by slug
- [ ] `spawn_agent` can match by capability (resolveAgent)
- [ ] Invoked agents run with their own config (model, tools, safety)
- [ ] Invocation permissions enforced (can_invoke)
- [ ] Max depth 2 prevents infinite loops
- [ ] Context passed from invoker to invoked agent
- [ ] Agent runs recorded with full metadata

---

## 15e. Self-Improvement Loop

**Problem:** Agents don't learn from their own runs. Same mistakes repeat. Successful patterns aren't captured.

### How It Works

After every agent run (not just user-initiated — scheduled runs too), a post-execution analysis step runs:

```
Agent completes run
    │
    ▼
Post-execution analysis (fast model):
    │
    ├── Did any tools fail?
    │   YES → Write to ERRORS.md:
    │         ## {timestamp} — {tool} failed on {domain}
    │         **Error:** {error message}
    │         **Context:** {what the agent was trying to do}
    │         **Suggested fix:** {fast model's suggestion}
    │
    ├── Did the user correct the agent?
    │   YES → Write to LEARNINGS.md:
    │         ## {timestamp} — Correction: {domain}
    │         **What I did wrong:** {original action}
    │         **What user wanted:** {correction}
    │         **Rule:** {generalized rule for next time}
    │
    ├── Did the agent discover a new pattern?
    │   YES → Append to SKILLS.md:
    │         ## {skill name}
    │         **Domain:** {domain}
    │         **When to use:** {trigger condition}
    │         **Steps:** {step-by-step procedure}
    │         **Selectors:** {key selectors used}
    │         **Notes:** {any gotchas}
    │
    ├── Did a previous error get resolved?
    │   YES → Mark error as resolved in ERRORS.md
    │
    └── Was the outcome positive?
        YES → Boost confidence on memories used this run
        NO  → Flag memories that may have caused failure
```

### SKILLS.md Format

```markdown
# Skills — inbox-manager

## Gmail: Archive and Label

**Domain:** mail.google.com
**When to use:** User wants to archive emails and apply labels
**Steps:**

1. Select email(s) in the list
2. Click archive button (selector: `[data-tooltip="Archive"]`)
3. Click label icon → search for label name → click result
   **Notes:**

- Gmail changed their label picker in Feb 2026, now uses `[role="listbox"]`
- Always wait 500ms after archive before next action, or DOM isn't ready
  **Learned:** 2026-03-15, reinforced 3 times

## Gmail: Bulk Unsubscribe

**Domain:** mail.google.com
**When to use:** User wants to unsubscribe from newsletters
**Steps:**

1. Search for "unsubscribe" in inbox
2. Open each email
3. Look for unsubscribe link (usually at bottom)
4. Click unsubscribe → confirm on external page
5. Go back → archive the email
   **Notes:**

- Some unsubscribe links open new tabs — use open_tab
- Rate limit: max 10 per run to avoid spam filters
  **Learned:** 2026-03-18
```

### LEARNINGS.md Format

```markdown
# Learnings — inbox-manager

## 2026-03-18 — Correction: mail.google.com

**What I did wrong:** Clicked "Delete" instead of "Archive"
**What user wanted:** Archive to remove from inbox, not delete permanently
**Rule:** In Gmail, NEVER use delete. Always archive. User's policy is inbox zero via archive.

## 2026-03-15 — Discovery: mail.google.com

**Observation:** User always applies "Client" label to emails from @acmecorp.com
**Rule:** Auto-suggest "Client" label for emails from @acmecorp.com domains
```

### ERRORS.md Format

```markdown
# Errors — inbox-manager

## 2026-03-18 — click_element failed on mail.google.com [RESOLVED]

**Error:** Element not found: `[data-tooltip="Archive"]`
**Context:** Trying to archive an email from the thread view
**Root cause:** Archive button has different selector in thread view vs list view
**Fix:** In thread view, use `[data-tooltip="Archive"][role="button"]` — more specific

## 2026-03-17 — navigate failed on outlook.office.com [ACTIVE]

**Error:** Navigation timeout after 10s
**Context:** Trying to navigate to calendar view
**Suggested fix:** Outlook SPA transition is slow — increase wait to 5s before get_page_state
```

### Skill Promotion

When a learning or pattern proves reliable (reinforced 3+ times, no failures), it can be **promoted**:

- From LEARNINGS.md → SKILLS.md (becomes a reusable skill)
- From agent-level → domain memory (shared with all agents for that domain)
- From agent-level → user memory (persists even if agent is deleted)

### Files to create/modify

- `apps/api/src/agent/self-improve.ts` — New: post-execution analysis
- `apps/api/src/storage/agent-files.ts` — Add appendToSkills, appendToLearnings, appendToErrors
- `apps/api/src/agent/orchestrator.ts` — Call self-improve after run completes
- `apps/api/src/memory/domain.ts` — Accept promoted learnings

### Acceptance criteria

- [ ] Post-execution analysis runs after every agent run
- [ ] Tool failures written to ERRORS.md with context
- [ ] User corrections written to LEARNINGS.md with generalized rules
- [ ] New patterns discovered and written to SKILLS.md
- [ ] SKILLS.md sections selectively injected into prompt (15c)
- [ ] Errors marked as resolved when fixed
- [ ] Skill promotion from agent-level to domain/user memory
- [ ] Outcome rating reinforces/flags agent memories

---

## 15f. Agent Scheduler (Heartbeat)

**Problem:** Agents are purely reactive. No way to run on a schedule.

### Architecture

```
┌──────────────────────────────────────┐
│          Agent Scheduler              │
│   (Inngest cron, runs in API server)  │
│                                       │
│   Every minute:                       │
│     query agents WHERE:               │
│       status = 'active'               │
│       has schedule trigger            │
│       cron matches current time       │
│                                       │
│     For each matched agent:           │
│       1. Check: is user's extension   │
│          connected? (WS connection)   │
│          NO → skip, log "offline"     │
│                                       │
│       2. Cheap check (optional):      │
│          If agent has a check_url,    │
│          get_page_state first.        │
│          No changes → skip run.       │
│                                       │
│       3. Full run:                    │
│          Load agent config            │
│          Open background tab          │
│          Run orchestrator             │
│          Record agent_run             │
│          Post-execution analysis      │
│          Notify user (SSE/webhook)    │
│                                       │
│       4. Close tab when done          │
└──────────────────────────────────────┘
```

### Key Design Decisions

- **Requires browser connection**: Agents execute in the user's browser. If the extension isn't connected, scheduled runs are skipped (logged as "missed"). This is fundamental — no server-side browsers.
- **Cheap check first**: For scheduled agents, optionally navigate to a URL and check page state before running the full agent. If nothing changed, skip the expensive LLM call.
- **Notification on completion**: Scheduled runs emit results via SSE (if panel is open) or store for later viewing in dashboard.
- **Missed run handling**: If a scheduled run is missed (user offline), it does NOT queue up. Next time the user connects, the scheduler runs the next scheduled occurrence. No backfill.

### Schedule Trigger Config

```yaml
triggers:
  - type: schedule
    cron: '0 9 * * 1-5' # weekdays at 9am
    task: 'Check inbox for urgent emails and flag them'
    check_url: 'https://mail.google.com' # optional: navigate here first
    check_condition: 'Look for unread count > 0' # optional: skip if false
    notify: true # send notification on completion
```

### Files to create/modify

- `apps/api/src/agent/scheduler.ts` — New: cron evaluation, run dispatch
- `apps/api/src/inngest/functions/agent-scheduler.ts` — New: Inngest cron job
- `apps/api/src/ws/handler.ts` — Check user connection status
- `apps/api/src/routes/agents.ts` — Add schedule management endpoints

### Acceptance criteria

- [ ] Agents with schedule triggers run on cron
- [ ] Scheduled runs require active browser connection
- [ ] Cheap check (page state) can gate expensive runs
- [ ] Missed runs are skipped, not queued
- [ ] Run results stored in agent_runs
- [ ] User notified of scheduled run results
- [ ] Scheduler respects agent pause/archive status

---

## 15g. Dashboard Agent Management UI

**Problem:** No way for users to create, configure, or monitor agents.

### Pages

1. **`/agents`** — Agent list
   - Card grid showing all user's agents
   - Each card: name, description, status badge, last run time, total runs
   - Quick actions: pause/resume, run now, delete
   - "Create Agent" button

2. **`/agents/create`** — Agent creation wizard
   - Step 1: Name, description, domains (multi-select)
   - Step 2: Capabilities (tag input), model selection
   - Step 3: Tool permissions (checkboxes grouped by category)
   - Step 4: Triggers (schedule builder, webhook toggle)
   - Step 5: Personality (SOUL.md editor — markdown textarea)
   - Preview of generated AGENT.yaml before saving

3. **`/agents/:slug`** — Agent detail page
   - **Overview tab**: config summary, run stats, status controls
   - **Files tab**: browse and edit agent files (SOUL.md, SKILLS.md, LEARNINGS.md, ERRORS.md, workspace/)
   - **Runs tab**: history of agent runs with expandable details (tools used, tokens, outcome)
   - **Settings tab**: edit AGENT.yaml fields via form UI

4. **`/agents/:slug/files/:path`** — File editor
   - Monaco or CodeMirror editor for markdown/yaml files
   - Save button writes to Supabase Storage
   - Syntax highlighting for yaml and markdown

### API Routes: `apps/api/src/routes/agents.ts`

```
GET    /api/agents                     List all agents for user
POST   /api/agents                     Create agent (writes to Storage + DB)
GET    /api/agents/:slug               Get agent detail (config + stats)
PUT    /api/agents/:slug               Update agent config
DELETE /api/agents/:slug               Delete agent (Storage + DB)
POST   /api/agents/:slug/clone         Clone agent
POST   /api/agents/:slug/run           Trigger manual run

GET    /api/agents/:slug/files         List agent files
GET    /api/agents/:slug/files/*path   Read agent file
PUT    /api/agents/:slug/files/*path   Write agent file

GET    /api/agents/:slug/runs          List agent runs
GET    /api/agents/:slug/runs/:id      Get run detail
```

### Files to create

- `apps/web/app/(dashboard)/agents/page.tsx` — Agent list
- `apps/web/app/(dashboard)/agents/create/page.tsx` — Create wizard
- `apps/web/app/(dashboard)/agents/[slug]/page.tsx` — Agent detail
- `apps/api/src/routes/agents.ts` — Agent API routes

### Acceptance criteria

- [ ] Users can create agents via dashboard wizard
- [ ] Users can browse and edit agent files
- [ ] Users can view agent run history
- [ ] Users can pause/resume/delete agents
- [ ] Users can trigger manual agent runs
- [ ] Agent list shows status, last run, total runs

---

## Implementation Order

| Sub-phase                 | Dependency    | What it unlocks                 |
| ------------------------- | ------------- | ------------------------------- |
| **15a. Supabase Storage** | None          | File layer for everything else  |
| **15b. Agent Registry**   | 15a           | Agent CRUD, resolution, routing |
| **15c. Dynamic Prompts**  | 15b           | Agents have identity and skills |
| **15d. Agent Invocation** | 15b, 15c      | Agents can call other agents    |
| **15e. Self-Improvement** | 15a, 15c      | Agents learn from every run     |
| **15f. Scheduler**        | 15b, 15d      | Agents run autonomously         |
| **15g. Dashboard UI**     | 15b (minimum) | Users manage agents visually    |

**Recommended build order:** 15a → 15b → 15c → 15g (basic) → 15d → 15e → 15f → 15g (full)

Dashboard UI (15g basic) should come after 15b so users can create agents early and test the system incrementally.

---

## What Changes in Existing Code

### Orchestrator (`orchestrator.ts`)

- Accept `AgentConfig` parameter instead of using global config
- Respect per-agent tool allowlists and safety overrides
- Call self-improvement analysis on completion
- Pass agent context to prompt builder

### Swarm (`swarm.ts`)

- `spawnSubAgent` loads target agent's config from registry
- Sub-agent runs with its own prompt, tools, model
- Track invocation chain to prevent loops

### Chat route (`chat.ts`)

- Resolve which agent handles the request (domain match → capability match → coordinator)
- Load agent files from Supabase Storage
- Build agent-specific prompt
- Record agent_run on completion

### Prompts (`prompts.ts`)

- New `buildAgentPrompt(AgentContext)` function
- Existing `buildSystemPrompt` becomes `buildCoordinatorPrompt` (wrapper)
- Selective skill injection from SKILLS.md

### Tool registry (`registry.ts`)

- Filter available tools based on agent config
- Add workspace tools (save_to_workspace, read_from_workspace, list_workspace)
- Update spawn_agent to accept agent slug/capability

---

## What We're NOT Building (Yet)

- **Agent marketplace / sharing**: No public agent registry. Users create their own agents. Community sharing is a future phase.
- **Nested spawning beyond depth 2**: Agent A → Agent B → done. No Agent B → Agent C chains (yet).
- **Cross-user agent invocation**: Agents only invoke other agents owned by the same user/org.
- **Agent-to-agent direct messaging**: Agents communicate via spawn/wait pattern, not a message bus.
- **Visual agent builder**: The dashboard has a form wizard, not a drag-and-drop flow editor.
- **Agent versioning**: No git-like versioning of agent files. Supabase Storage versioning is sufficient for now.

---

## Key Architectural Constraints

- **No new infrastructure.** Supabase Storage + Postgres + pgvector. No Redis, no message queues.
- **Browser-first execution.** Every agent action happens in the user's browser. No server-side browser automation.
- **Provider-agnostic.** Agent configs can specify any LLM provider. Self-improvement works with any model.
- **Extension stays thin.** Agent resolution, prompt building, and self-improvement happen server-side.
- **Backwards compatible.** Users who never create agents get `_coordinator` (≈ current behavior).
- **Files over database for agent state.** Config, skills, and learnings live in Supabase Storage. Only metadata and run history live in Postgres.
