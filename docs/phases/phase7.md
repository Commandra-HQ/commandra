# Phase 7 — Agent Core + Vision

This is the foundation phase. Everything after this — data tools, flows, scheduled runs, multi-agent swarm — builds on the agent architecture we establish here.

## What We're Replacing

Currently `apps/api/src/routes/chat.ts` has a hand-rolled `runAgentLoop()` — a while-loop that calls the Anthropic SDK directly, inlines tool definitions, handles safety checks procedurally, and has no planning, memory, or session management. It works for simple "click this button" tasks but can't:

- Plan a 20-step task before executing
- Remember what it learned about an app across conversations
- Use different models for different subtasks (Haiku for reads, Sonnet for reasoning)
- Resume an interrupted run
- Run subagents in parallel
- See the actual page (only DOM structure, no visual layout)

## What Ships

### 1. MCP Browser-Bridge Server

A proper MCP server that exposes browser actions as tools. The Agent SDK connects to this server. Each tool call gets forwarded over WebSocket to the extension.

```
Agent SDK → MCP tool call → browser-bridge → WebSocket → extension → DOM
                                          ← result ←
```

**Tools:**

| Tool | Model | Description |
|------|-------|-------------|
| `click_element` | any | Click an element by CSS selector |
| `type_text` | any | Type into an input field |
| `select_option` | any | Select dropdown option |
| `navigate` | any | Navigate to URL |
| `get_page_state` | any | Get DOM structure (elements, selectors, labels) |
| `screenshot` | any | Capture visible tab as image, return to agent |
| `scroll` | any | Scroll page or element (up/down/to element) |
| `wait_for` | any | Wait for element to appear or condition |
| `read_text` | any | Extract text content from a selector or region |
| `read_table` | any | Extract table data as structured JSON |

The MCP server wraps the existing WS communication. Each tool call:
1. Generates a `requestId`
2. Sends `action_request` over WS to extension
3. Waits for `action_result` with matching ID (timeout: 15s for actions, 30s for screenshots)
4. Returns result to Agent SDK

**Screenshot tool** uses `chrome.tabs.captureVisibleTab()` in the extension, returns the image as base64. The Agent SDK passes this to Claude's vision. This lets the agent see error messages, visual layout, loading states, colors, icons — everything DOM indexing misses.

### 2. Agent Architecture

Replace the while-loop with Claude Agent SDK agents.

```
User message
  → Coordinator Agent (Sonnet 4)
      Understands the task, makes a plan, delegates

      → Browser Agent (Sonnet 4)
          Executes multi-step browser interactions
          Has all MCP tools
          Takes screenshots to verify results

      → Reader Agent (Haiku 4)
          Fast data extraction — read tables, text, page state
          Only has: get_page_state, read_text, read_table, screenshot

      → Navigator Agent (Haiku 4)
          Fast navigation between pages
          Only has: navigate, get_page_state, screenshot

  ← Coordinator synthesizes results
  ← Responds to user
```

**Why subagents matter:**
- The Coordinator can run Reader and Navigator with Haiku (fast, cheap) while reserving Sonnet for complex reasoning
- A 20-step task gets planned FIRST, then each step is delegated to the right agent
- If a step fails, the Coordinator replans (not the execution agent)
- Future: subagents can run in parallel across tabs (Phase 13)

**For Phase 7, we start simple:** one Coordinator + one Browser Agent. The multi-agent routing (Haiku readers, parallel subagents) comes in later phases. But the architecture supports it from day 1.

### 3. Planning

Before executing anything, the agent creates a plan and shows it to the user.

```
User: "Find all overdue invoices and send reminders"

Agent: Here's my plan:
  1. Navigate to the invoices page
  2. Filter by status = overdue
  3. Read the table to get all overdue invoices
  4. For each invoice, click "Send Reminder"
  5. Confirm each send

  [Execute] [Edit]
```

Implementation:
- The Coordinator's system prompt instructs it to PLAN before ACTING
- Plans are returned as structured output (JSON array of steps)
- Frontend renders the plan with Execute/Edit buttons
- On Execute, the Coordinator delegates steps to the Browser Agent
- On Edit, user modifies steps, Coordinator adapts
- During execution, each step's status updates in the activity feed

### 4. Memory

Three levels of memory:

**Conversation memory (per conversation):**
- As conversations get long, summarize older messages
- Keep the last N messages verbatim + a summary of everything before
- Prevents context window overflow on long multi-step tasks
- Stored in Postgres `messages` table (already exists)

**Task memory (per task execution):**
- What the agent has learned during this specific task run
- "The invoices page has pagination, need to click Next to see all results"
- "The date filter uses MM/DD/YYYY format"
- Stored in the agent session, lost when task completes

**App knowledge (per domain, persistent):**
- Patterns the agent learns about a specific web app across conversations
- "SAP invoice page: filter button is in the toolbar, not the sidebar"
- "This app uses React — after clicking, wait 500ms for state update"
- Stored in Postgres, keyed by domain
- Injected into system prompt for future conversations about the same app

For Phase 7, we implement conversation memory and task memory. App knowledge comes in Phase 12 with embeddings.

### 5. Sessions

Agent sessions persist in Postgres so interrupted runs can resume.

- Each conversation maps to a session
- Session stores: agent state, current plan, completed steps, page context
- If the user closes the browser and comes back, the agent can resume from where it left off
- Kill switch creates a "stopped" session that can be resumed or discarded

### 6. Safety Hooks (Agent SDK)

Replace the procedural safety checks in chat.ts with proper Agent SDK hooks.

**PreToolUse hook:**
```
Every tool call → classify(action, args, elementLabel) → safe | review | blocked
  - safe: proceed
  - review: pause, send approval_request to extension, wait for response
  - blocked: reject with explanation, agent replans
```

**PostToolUse hook:**
```
Every tool result → logAction(userId, action, result, safetyLevel, approved)
  - Append-only audit log in Postgres
  - Status update broadcast to activity feed
```

This is the same three-tier classification we already have, just wired through the SDK's hook system instead of inline in the while-loop.

### 7. Streaming to UI

The agent's thinking process streams to the side panel in real-time:

- **Plan:** Displayed as a step list when the agent plans
- **Thought:** The agent's reasoning shown as light italic text (optional, can be toggled)
- **Action:** Tool calls shown in activity feed (already working)
- **Result:** Tool results update activity items (already working)
- **Screenshot:** If agent takes a screenshot, thumbnail shown in activity feed

## File Structure

```
apps/api/src/
  agent/
    coordinator.ts     — Coordinator agent definition + system prompt
    browser-agent.ts   — Browser execution agent
    prompts.ts         — System prompts for each agent role
    memory.ts          — Conversation summarization + app knowledge
    sessions.ts        — Session persistence (Postgres)
  mcp/
    browser-bridge.ts  — MCP server exposing browser tools
    tools/
      click.ts
      type.ts
      navigate.ts
      screenshot.ts
      read-text.ts
      read-table.ts
      scroll.ts
      wait.ts
  routes/
    chat.ts            — Simplified: receives message, delegates to coordinator
  safety/
    classifier.ts      — Same classification logic (unchanged)
    audit.ts           — Same audit logging (unchanged)
    hooks.ts           — PreToolUse + PostToolUse hook implementations

apps/extension/src/
  background/
    ws-client.ts       — Add screenshot handler (chrome.tabs.captureVisibleTab)
    index.ts           — Add SCREENSHOT message handler
```

## What Changes in the Extension

Minimal. The extension is still a thin client. Two additions:

1. **Screenshot tool handler** in ws-client.ts:
   ```
   action === 'screenshot' → chrome.tabs.captureVisibleTab(format: 'jpeg', quality: 75)
   → return base64 image
   ```

2. **Plan UI** in ChatTab.tsx:
   - Render plan steps when agent returns a plan
   - Execute/Edit buttons
   - Step-by-step progress during execution

## Implementation Order

1. **MCP browser-bridge** — proper MCP server wrapping existing WS tools
2. **Screenshot tool** — extension handler + MCP tool
3. **Coordinator agent** — Agent SDK replaces runAgentLoop
4. **Safety hooks** — PreToolUse/PostToolUse via SDK
5. **Planning** — structured plan output + UI
6. **Streaming** — thought process + plan status to side panel
7. **Conversation memory** — summarization for long conversations
8. **Sessions** — persist + resume in Postgres

## Forward Design: Multi-Agent Swarm (Phase 13)

Phase 7 architects for this even though we don't build it yet:

**The Coordinator is the swarm controller.** In Phase 7, it delegates to one Browser Agent. In Phase 13, it can:

- Spawn N Browser Agents, each targeting a different tab
- Run them in parallel (Agent SDK supports concurrent subagents)
- Each Browser Agent has its own MCP connection to a specific tab
- Coordinator aggregates results

**Example (Phase 13):**
```
User: "Compare pricing across our 3 vendor portals"

Coordinator:
  → Browser Agent A: navigate to vendor1.com, extract pricing table
  → Browser Agent B: navigate to vendor2.com, extract pricing table
  → Browser Agent C: navigate to vendor3.com, extract pricing table
  (all three run in parallel in separate tabs)
  ← Coordinator: merge results, present comparison
```

**What Phase 7 needs to support this later:**
- MCP connections are per-tab (connectionId already maps to a tab)
- Coordinator uses Agent SDK's subagent API (already supports parallel spawn)
- Tool results include tab/page context so the Coordinator knows which tab responded
- Session model supports multiple concurrent subagent sessions

## Forward Design: Dashboard-Triggered Agents (Phase 9)

Phase 7 architects for this even though we don't build it yet:

**Dashboard sends task → backend → WS → extension executes in background tab.**

The key insight: the agent always runs in the employee's browser. The "dashboard trigger" is just a different entry point — instead of user typing in the side panel, the dashboard sends a pre-defined task.

```
Dashboard UI: [Run "Daily Invoice Check"]
  → POST /api/tasks/run { flowId, userId }
  → Backend finds user's WS connection
  → Sends task_start over WS
  → Extension opens background tab
  → Agent executes (same Coordinator → Browser Agent flow)
  → Progress streams back via WS → dashboard shows live status
  → Result stored in Postgres
```

**What Phase 7 needs to support this later:**
- Agent execution is decoupled from the HTTP request (currently it's inside the POST /api/chat handler)
- Agent runs are identified by a `taskId`, not just a conversation
- The WS protocol supports `task_start` / `task_progress` / `task_complete` messages
- Extension can receive tasks and open background tabs without the side panel being open

## What's NOT in Phase 7

- Multi-agent swarm (Phase 13) — designed for, not implemented
- Dashboard task triggers (Phase 9) — designed for, not implemented
- Data extraction tools (Phase 8) — separate phase, just new MCP tools
- App knowledge persistence (Phase 12) — needs embeddings
- Flow recording (Phase 10) — separate feature
- Scheduled runs (Phase 11) — needs Inngest integration

## Privacy Model

This architecture is enterprise-safe because:

| Data | Where it lives | Who can see it |
|------|----------------|----------------|
| Page HTML/content | Employee's browser only | Never leaves the browser |
| DOM structure (selectors, labels) | Sent to Claude API for reasoning | No PII, just structure |
| Screenshots | Sent to Claude API for vision | Employee's screen only, not stored |
| Credentials/cookies | Employee's browser only | Never sent anywhere |
| Action audit logs | Postgres on company infra | Admins only |
| Conversation history | Postgres on company infra | User + admins |
| App knowledge | Postgres on company infra | All users of that domain |

Screenshots are the most sensitive new addition. They capture what's visible on screen. Mitigations:
- JPEG quality 75 (lower detail, smaller payload)
- Not stored — sent to Claude API, then discarded
- Can be disabled per-domain via settings
- Only captured when agent explicitly calls the screenshot tool (not on every action)
