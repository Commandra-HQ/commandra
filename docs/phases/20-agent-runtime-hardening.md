# Phase 20 — Agent Runtime Hardening

> Make agents reliable enough to run unsupervised. Fix the gaps between "works in a demo" and "runs 36 times a day without human intervention."

## Why

The agent system works for interactive chat-driven workflows. But when agents need to run on schedules, invoke each other, handle failures, and operate across tabs without human babysitting — the system breaks in predictable ways:

1. **Sub-agent tabs pile up** — tabs never close, browser gets cluttered, memory leaks
2. **Agents can't share data** — agent A downloads a report, agent B can't read it. The only bridge is the coordinator summarizing in natural language (lossy)
3. **Scheduled runs silently fail** — no retry, no alerts, no offline queue. If the browser is closed at 11 AM, the run is simply lost
4. **Agents don't learn from the conversation that created them** — you teach a workflow in chat, but SKILLS.md stays empty unless the LLM explicitly decides to write it
5. **No file I/O** — the agent can't intercept downloads or read files back, which blocks any workflow that involves "download report → process → upload elsewhere"

This phase makes the agent runtime production-grade. After this, building an automation like "download 6 reports from 3 platforms daily and consolidate into OneDrive" is pure configuration — not new code.

---

## 20a. Swarm v2 — Reliable Multi-Agent Orchestration

### Tab Lifecycle

**Problem:** Sub-agent and scheduled tabs never close. `swarm.ts` line 542: `// Don't close the sub-agent's tab — let the user inspect it or close it manually.`

**Fix:**

- Default: close tab on successful completion. Keep open on failure (for debugging)
- Add `keepTab?: boolean` option to `spawn_agent` tool for cases where the user wants to inspect
- Scheduled agent tabs always close on completion (no one is watching)
- Add a `cleanup_tabs` internal tool the coordinator can call to close all sub-agent tabs at once
- Track open tabs per user, enforce a ceiling (e.g., 10 agent tabs max)

**Files:** `apps/api/src/agent/swarm.ts`, `apps/extension/src/background/action-handler.ts`

### Inter-Agent Data Passing

**Problem:** Sub-agents return a natural language `summary` string. The coordinator can't access structured data, downloaded files, or extracted tables from sub-agents.

**Fix:** Shared scratchpad per conversation in S3:

- Path: `agents/{userId}/scratchpad/{conversationId}/{key}.json`
- New tools: `write_scratchpad(key, data)` and `read_scratchpad(key)` — available to both coordinator and sub-agents
- Sub-agent extracts a table → writes to scratchpad → coordinator reads it and pastes into OneDrive
- Scratchpad auto-cleans after conversation ends (or 24h TTL)
- This is NOT memory (long-term). It's ephemeral shared state for a single multi-agent task.

**Files:** New `apps/api/src/storage/scratchpad.ts`, update `apps/api/src/agent/tool-definitions.ts`, `apps/api/src/agent/internal-tools.ts`

### Named Agent Invocation with Full Identity

**Problem:** `spawn_agent` with `agentSlug` loads the target agent's config, but the sub-agent doesn't always fully inherit skills/learnings/domain knowledge.

**Fix:**

- When spawning with `agentSlug`, fully hydrate: SOUL.md + SKILLS.md + LEARNINGS.md + ERRORS.md + domain knowledge for all the target agent's domains
- Pass all of this into the sub-agent's system prompt (currently only SOUL.md is reliably injected)
- Allow the coordinator to pass structured input data (not just a task string): `spawn_agent({ agentSlug: "invoice-parser", task: "...", inputData: { url: "...", dateRange: "..." } })`

**Files:** `apps/api/src/agent/swarm.ts` (lines 237-303 in `runSubAgent`), `apps/api/src/agent/agent-registry.ts`

### Configurable Concurrency

**Problem:** Max 3 concurrent sub-agents, depth 2 — hardcoded constants.

**Fix:**

- Move limits to agent config: `maxConcurrentSubAgents`, `maxDepth` in `agents` table
- Default: 3 concurrent, depth 2 (same as today)
- Power users can increase for their agents via dashboard
- Coordinator agent can override per-spawn: `spawn_agent({ ..., maxIterations: 20 })`

**Files:** `apps/api/src/agent/swarm.ts`, `packages/shared/src/types.ts` (AgentConfig)

---

## 20b. Scheduler v2 — Resilient Scheduled Execution

### Run Deduplication

**Problem:** If a run takes 5 minutes and another tick fires, the agent could double-run. The `lastRun` map only prevents same-minute duplication.

**Fix:**

- Track `isRunning` per agent in the scheduler's in-memory map
- Skip agents that are already mid-run
- Log: `[Scheduler] Agent "invoice-checker" still running from 11:00, skipping 11:01 tick`

**Files:** `apps/api/src/agent/scheduler.ts`

### Failure Alerts

**Problem:** If a scheduled run fails, nobody knows. The error is logged to console and `agent_runs` table, but no notification is sent.

**Fix:**

- New `agent` table column: `alertWebhook?: string` (URL to POST on failure)
- On run failure, POST to webhook with: `{ agent, error, runId, timestamp }`
- Supports Slack webhooks, email via Zapier/Make, WhatsApp via Twilio — user configures the URL
- Dashboard shows failed runs prominently (red badge on agent card)
- Optional: built-in email alerting via SMTP config (env vars `SMTP_HOST`, `SMTP_FROM`)

**Files:** `apps/api/src/agent/scheduler.ts`, `apps/api/src/db/schema.ts`, `apps/web/app/(dashboard)/agents/agent-card.tsx`

### Retry with Backoff

**Problem:** Failed runs are not retried. If Instamart is down at 11 AM, the report is simply missed.

**Fix:**

- On failure, schedule retry: 5 min → 15 min → 60 min (3 attempts max)
- Store retry state in memory (not DB — retries are ephemeral)
- After 3 failures, mark run as `permanently_failed` and fire alert webhook
- Agent-level config: `maxRetries` (default 3), `retryBackoff` (default exponential)

**Files:** `apps/api/src/agent/scheduler.ts`

### Offline Run Queue

**Problem:** If the user's browser isn't connected at cron time, the run is silently skipped.

**Fix:**

- When cron matches but user is offline, queue the run in `agent_runs` table with status `queued`
- On WebSocket reconnection, check for queued runs and execute them
- Max queue depth: 5 per agent (don't accumulate a week of missed runs)
- Queue expires after 24 hours (stale runs aren't useful)

**Files:** `apps/api/src/agent/scheduler.ts`, `apps/api/src/ws/handler.ts` (on connect)

### Jitter

**Problem:** All agents scheduled at `0 9 * * *` fire at exactly 09:00:00. With 36 agents, this causes a thundering herd.

**Fix:**

- Add random jitter of 0-30 seconds per agent on each tick
- Stagger execution: `setTimeout(runScheduledAgent, Math.random() * 30000)`

**Files:** `apps/api/src/agent/scheduler.ts`

---

## 20c. Agent Lifecycle — From Chat to Production Agent

### Auto-Capture Skills from Teaching Conversations

**Problem:** User teaches the agent a workflow in chat. The workflow is in the conversation history but not in SKILLS.md. Next time the agent runs, it starts cold.

**Fix:**

- After a `create_agent` call, look at the conversation history for the teaching context
- Auto-generate SKILLS.md from the conversation: extract the steps the user demonstrated, the corrections they made, the selectors that worked
- Use the fast model (same as self-improve) to extract: `"Based on this conversation, what skills should this agent have?"`
- Write to SKILLS.md immediately, not as a fire-and-forget post-run

**Files:** `apps/api/src/agent/internal-tools.ts` (handleCreateAgent), `apps/api/src/agent/self-improve.ts`

### Approval Gate on Agent Creation

**Problem:** Agent gets created silently mid-conversation. User might not realize an agent was created, or might want to review the SOUL.md before it's saved.

**Fix:**

- Before creating, emit an `approval_inline` SSE event (same pattern as plan approval)
- Show the user: "Create agent 'invoice-checker'? SOUL: You are an invoice specialist..." with Approve/Reject buttons
- On approval, proceed with creation
- On rejection, return feedback to LLM so it can adjust
- Skip approval for `autonomous` agents (they don't need human confirmation)

**Files:** `apps/api/src/agent/internal-tools.ts` (handleCreateAgent), `apps/extension/src/sidepanel/tabs/message-blocks.tsx` (new approval block type)

### Edit Agent from Chat

**Problem:** "Update my gmail agent to also check drafts" — user expects this to modify the agent's SOUL.md or SKILLS.md. Today the LLM has to figure out to call `update_agent_files` on its own.

**Fix:**

- In the system prompt, when the user mentions an existing agent by name/slug, inject that agent's current files as context
- Add prompt guidance: "If the user asks to change an agent's behavior, read the agent's current SOUL.md, modify it, and write it back via update_agent_files"
- The `update_agent_files` tool already exists — this is mostly a prompt engineering fix

**Files:** `apps/api/src/agent/prompts.ts`, `apps/api/src/routes/chat.ts` (detect agent mentions, load agent files)

---

## 20d. File I/O Tools — Browser-Native File Access

These are generic platform capabilities, not use-case-specific.

### `wait_for_download`

**Problem:** When the agent clicks "Download Report", the file goes to the user's Downloads folder. The agent has no way to know when it finishes or where it landed.

**Fix:**

- New browser tool: `wait_for_download({ timeout?: number })`
- Extension handler listens to `chrome.downloads.onChanged` for completion events
- Returns: `{ filename, path, size, mimeType }`
- Timeout default: 30 seconds
- The agent can then reference this file in subsequent actions

**Files:** New tool in `apps/api/src/tools/browser/`, handler in `apps/extension/src/background/action-handler.ts`

### `read_local_file`

**Problem:** Agent can write to `~/.commandra/` but can't read files back. Can't read downloaded files either.

**Fix:**

- New internal tool: `read_local_file({ path: string, maxBytes?: number })`
- For security: only allow reading from `~/.commandra/` and the user's Downloads folder
- Returns file content as string (text files) or base64 (binary)
- For images/screenshots: return as ImageBlock so the LLM can see them
- For XLSX/CSV: return as text — the LLM can parse tabular data. Or use OpenAI's `file_input` for binary files.

**Files:** Update `apps/api/src/storage/local.ts`, new tool definition, new internal tool handler

### `clipboard_write` / `clipboard_read`

**Problem:** Agent extracts data from one tab but needs to paste it into another. Today the only way is to type character by character.

**Fix:**

- New browser tools: `clipboard_write({ text })` and `clipboard_read()`
- Extension handler uses `navigator.clipboard` API (requires `clipboardRead`/`clipboardWrite` permissions)
- Enables: read table from Instamart tab → copy → switch to OneDrive tab → paste
- Much faster and more reliable than typing long strings character by character

**Files:** New tools, extension manifest permissions update

---

## Implementation Order

```
Phase 20a (Swarm v2)
├── Tab lifecycle (close on success)           — 1 day
├── Inter-agent scratchpad                     — 2 days
├── Full identity hydration on named invoke    — 1 day
└── Configurable concurrency                   — 0.5 day

Phase 20b (Scheduler v2)
├── Run deduplication (isRunning guard)        — 0.5 day
├── Failure alerts (webhook)                   — 1 day
├── Retry with backoff                         — 1 day
├── Offline run queue                          — 1.5 days
└── Jitter                                     — 0.5 day

Phase 20c (Agent Lifecycle)
├── Auto-capture skills from teaching chat     — 1.5 days
├── Approval gate on create_agent              — 1 day
└── Edit agent from chat (prompt engineering)  — 0.5 day

Phase 20d (File I/O)
├── wait_for_download                          — 1.5 days
├── read_local_file                            — 1 day
└── clipboard_write / clipboard_read           — 1 day
```

**Recommended build order:** 20b (scheduler) → 20a (swarm) → 20d (file I/O) → 20c (lifecycle)

Scheduler resilience is the highest-value fix — it makes existing agents reliable. Swarm fixes unblock multi-agent workflows. File I/O enables the class of "download → process → upload" automations. Lifecycle improvements make agent creation smoother but aren't blockers.

---

## What This Enables

After Phase 20, the Raghav use case becomes:

```
1. User creates 6 agents via chat:
   "Create an agent called instamart-sales that logs into Instamart
    every day at 11am, downloads the sales report, and pastes the
    data into my OneDrive spreadsheet"

2. Each agent has:
   - SOUL.md: "You are a report downloader for Instamart..."
   - SKILLS.md: auto-captured from the teaching conversation
   - trigger: { cron: "0 11 * * 1-5", enabled: true }
   - domains: ["partner.instamart.in"]
   - alertWebhook: "https://hooks.slack.com/..."

3. Every day at 11 AM (with jitter):
   - Scheduler picks up the agent
   - Opens background tab → navigates to Instamart
   - Follows learned workflow (SKILLS.md)
   - Downloads report (wait_for_download)
   - Reads data (read_local_file or LLM file_input)
   - Opens OneDrive in another tab (spawn_agent or navigate)
   - Pastes data (clipboard_write or type_text)
   - Closes tabs, records run
   - If failure → retry 3x → alert Slack

4. Agent improves over time:
   - Learns from corrections (LEARNINGS.md)
   - Adapts to UI changes (SKILLS.md updated by self-improve)
   - Records error patterns (ERRORS.md)
```

No Playwright. No Puppeteer. No API integrations. Just agents that use the browser like a human would — but faster, more reliable, and learning from every run.
