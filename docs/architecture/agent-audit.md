# Agent Architecture Audit — Commandra vs Claude Code Best Practices

> Audit of our agent/sub-agent/memory/scheduler system against Claude's official patterns for building production agent systems.

---

## Executive Summary

Our agent system has the right concepts (file-based agents, sub-agents, self-improvement, scheduling) but several implementation gaps compared to Claude's production patterns. The biggest issues:

1. **Sub-agents aren't truly independent** — they're miniature orchestrator runs, not isolated agents with their own identity, tools, and memory
2. **Memory is fragmented** — domain knowledge in S3, user memory in Postgres, agent skills in files, conversation history in messages table. No unified "agent memory" that persists across sessions
3. **No hooks/lifecycle system** — no way to run validation before tool execution, auto-format after edits, or enforce rules deterministically
4. **Chat→Agent conversion is too implicit** — the LLM decides when to create agents with no approval gate and no skill extraction from the teaching conversation

---

## 1. Sub-Agents: Are they truly sub-agents?

### What Claude Code does (the gold standard)

- Each sub-agent runs in **its own context window** with a **custom system prompt**
- Sub-agents have **specific tool access** — you can restrict what tools they can use
- Sub-agents have **independent permissions** — read-only, write-enabled, or bypassed
- Sub-agents have **persistent memory** — they can accumulate learnings across sessions
- Sub-agents **cannot spawn other sub-agents** (prevents infinite nesting)
- Sub-agents can be **resumed** — continue where they left off with full history
- Sub-agents support **hooks** — pre/post tool validation scoped to that agent
- The parent receives only a **summary**, keeping its context clean

### What Commandra does

- Sub-agents run `runSubAgent()` in `swarm.ts` — a stripped-down orchestrator loop
- They get a custom system prompt via `buildSubAgentPrompt()` (SOUL.md + SKILLS.md)
- They share the **same tool set** as the parent (all browser tools, no restrictions)
- They have **no independent memory** — no persistent learning across runs
- They **can** spawn sub-agents up to depth 2 (partially correct)
- They **cannot be resumed** — each spawn is fresh
- They have **no hooks** — no pre/post validation
- Results come back as a `summary` string + `actionsPerformed` list (good)

### Gaps

| Claude Code Pattern | Commandra Status | Impact |
|---|---|---|
| **Per-agent tool restrictions** | Missing | A "reader" agent can still click/type/delete. No way to make a read-only sub-agent |
| **Per-agent permissions** | Missing | All sub-agents inherit parent's autonomy level. Can't have a trusted reader + supervised writer |
| **Persistent sub-agent memory** | Missing | Sub-agents start cold every time. The self-improvement loop writes to the agent's files, but sub-agents don't load these reliably |
| **Sub-agent resumption** | Missing | Can't continue a sub-agent's work. Must re-spawn from scratch |
| **Tool-level hooks** | Missing entirely | No way to validate commands before execution, auto-format after edits, or block dangerous operations deterministically |
| **Scratchpad** | Just added (Phase 20) | Inter-agent data passing via S3 |
| **Tab lifecycle** | Just fixed (Phase 20) | Tabs now close on success |

### Recommended Fixes

1. **Add `tools` allowlist to AgentConfig** — when spawning with `agentSlug`, use the agent's `tools` array to restrict what the sub-agent can access. Already in schema (`agents.tools`), just not enforced in `runSubAgent`.

2. **Add `permissionMode` to AgentConfig** — `'readonly' | 'supervised' | 'trusted' | 'autonomous'`. Sub-agents respect this independently.

3. **Sub-agent memory persistence** — after a sub-agent completes, run `analyzeAndImprove()` on its transcript (already done for non-coordinator agents). But also: load the agent's SKILLS.md + LEARNINGS.md into the sub-agent's system prompt at spawn time (partially done, needs hardening).

4. **Sub-agent resumption** — store sub-agent conversation history in S3 (`agents/{userId}/sessions/{agentId}.jsonl`). Allow `spawn_agent` with `resumeId` to continue from where it left off.

---

## 2. Memory: Fragmented across 4 systems

### What Claude Code does

- **CLAUDE.md** — project-level instructions, loaded every session, version-controlled
- **Auto memory** — Claude writes notes to `~/.claude/projects/{project}/memory/`. MEMORY.md index (200 lines) loaded at start, topic files loaded on demand
- **Subagent memory** — each subagent has its own persistent memory directory
- **Rules** — `.claude/rules/*.md` files with path-scoped instructions

Key insight: **one memory system per scope**, with a clear index file and on-demand loading.

### What Commandra does

We have **5 separate memory systems** that don't talk to each other:

| System | Storage | Loaded when | Written by |
|---|---|---|---|
| **Domain knowledge** | S3: `domains/{userId}/{domain}/KNOWLEDGE.md`, `WORKFLOWS.md`, `MEMORY.md` | Chat route loads for the current domain | Agent via `save_knowledge` tool |
| **User memory** | Postgres `user_memory` table | Chat route loads matching memories | Agent via `save_memory` tool |
| **Agent files** | S3: `{userId}/{agentSlug}/SOUL.md`, `SKILLS.md`, `LEARNINGS.md`, `ERRORS.md` | Agent registry hydrates on resolve | Self-improvement loop (post-run) |
| **Conversation history** | Postgres `messages` table + `messages.tool_data` | Chat route loads for conversationId | Orchestrator saves after each turn |
| **Plans** | S3: `{userId}/plans/{convId}/PLAN.md` | Chat route loads (just added Phase 19) | `submit_plan` / `update_plan` tools |

### Gaps

| Claude Code Pattern | Commandra Status | Impact |
|---|---|---|
| **Unified MEMORY.md index** | Missing | No single place where all knowledge is indexed. Agent has to call `list_knowledge` + `recall_memory` to find things |
| **On-demand loading** | Partially done | Domain knowledge is loaded for the current domain only. But agent skills from OTHER agents aren't accessible |
| **Memory scoping** (user/project/local) | Missing | All memory is global to the user. No way to scope knowledge to a project or team |
| **Auto-memory** (Claude writes its own notes) | Partially done | `save_memory` and `save_knowledge` exist, but the agent doesn't proactively curate or prune its memory index |
| **Memory size management** | Partially done | Self-improvement has SOFT_CAP/HARD_CAP for SKILLS.md pruning, but no overall memory budget |

### Recommended Fixes

1. **Create an agent-level MEMORY.md** — for each agent, maintain a `{userId}/{agentSlug}/MEMORY.md` index that summarizes what the agent knows. Load the first 200 lines into system prompt. Agent updates this file as it learns. This mirrors Claude Code's auto-memory pattern.

2. **Cross-agent knowledge access** — when the coordinator invokes a sub-agent, include not just that agent's files but also domain knowledge for the target domain. Already partially done in `buildSubAgentPrompt` (lines 618-623), but should be more thorough.

3. **Memory consolidation** — periodic LLM-driven consolidation of MEMORY.md when it grows past 200 lines (same pattern as Claude Code's auto-memory). The self-improvement loop's `consolidate` function already does this for SKILLS.md — extend it to MEMORY.md.

---

## 3. Hooks: Completely Missing

### What Claude Code does

Hooks are **deterministic lifecycle events** that run shell commands at specific points:
- `PreToolUse` — validate/block before a tool executes (e.g., block SQL writes)
- `PostToolUse` — auto-format, lint, or log after a tool executes
- `Stop` — verify all tasks are complete before letting the agent stop
- `SessionStart` — inject context at session start
- `Notification` — alert when Claude needs input
- `SubagentStart`/`SubagentStop` — setup/teardown for sub-agent lifecycle

Hooks are **deterministic**, not LLM-dependent. They always run. This is how you enforce rules.

### What Commandra does

- **Safety classification** is our closest equivalent to `PreToolUse` hooks — classifies actions as safe/review/blocked. But it's hardcoded, not configurable per agent or per project.
- **No post-tool hooks** — no auto-format, no lint, no validation after actions
- **No stop hooks** — the agent decides when it's done, no external verification
- **No notification hooks** — the extension handles this, but there's no webhook system for the backend

### Recommended Fixes

This is a big architectural addition. Recommended approach:

1. **Phase 21: Hook System** — add a `hooks` field to the `agents` table (JSONB). Each agent can define pre/post tool hooks. Start with:
   - `PreToolUse` — validate before browser action execution (e.g., "never click Delete on this app")
   - `PostToolUse` — log, verify, or trigger side effects after actions
   - `OnComplete` — verify task completion (e.g., "check that the email was actually sent")
   - `OnFailure` — alert webhook (already added in Phase 20 scheduler)

2. Hooks execute as **internal tool calls** — not shell commands (since we're in a browser context, not a terminal). They could be LLM-driven (like Claude's agent-based hooks) or rule-based.

---

## 4. Chat→Agent: Too Implicit, No Skill Extraction

### What Claude Code does

- Sub-agents are **defined as Markdown files** with YAML frontmatter — explicit, version-controlled, reviewable
- Creating a sub-agent is a **deliberate act** (via `/agents` command or manually creating a file)
- Sub-agents have **skills** — preloaded knowledge injected at startup
- Sub-agents have **persistent memory** — they accumulate knowledge across sessions

### What Commandra does

- The LLM calls `create_agent` mid-conversation whenever it decides to
- No approval gate (just added guidance in prompts in Phase 20c, but no actual approval flow)
- SOUL.md is written immediately, but **SKILLS.md is not automatically extracted** from the teaching conversation
- Agent files live in S3, not on disk — not version-controllable

### Recommended Fixes

1. **Approval gate on `create_agent`** — before creating, emit an approval event to the frontend. User sees: "Create agent 'invoice-checker'? Here's the SOUL.md preview..." and can approve/reject. Same pattern as plan approval.

2. **Auto-extract SKILLS.md** — after `create_agent` succeeds, immediately call the fast model with the conversation history to extract skills. Write SKILLS.md automatically. The prompt guidance was added in Phase 20c, but it still relies on the LLM deciding to call `update_agent_files`. Make it automatic.

3. **Agent-as-files on disk** — optional export: `commandra export-agent invoice-checker` → writes `invoice-checker/SOUL.md`, `SKILLS.md`, etc. to disk for version control. Import: `commandra import-agent ./invoice-checker/`. This enables the OpenClaw-style "agents are files" pattern for sharing and collaboration.

---

## 5. Scheduler: Good Foundation, Missing Observability

### What Claude Code does (Agent Teams, not scheduler)

- Agent teams have a **shared task list** — agents claim and complete tasks
- Teams have **TeammateIdle** and **TaskCompleted** hooks — enforce quality gates
- Lead agent can **require plan approval** before teammates implement
- Communication is **bidirectional** — teammates message each other

### What Commandra does (Scheduler)

- Cron-based scheduling with 60s tick (works)
- Run deduplication, retry with backoff, offline queue, jitter (just added Phase 20)
- Alert webhooks on permanent failure (just added Phase 20)
- But: **no task list**, **no inter-agent communication during scheduled runs**, **no quality gates**

### Recommended Fixes

1. **Run dashboard** — surface `agent_runs` table in the web dashboard. Show: last 10 runs per agent, status, duration, error, tool calls. Red badge on agents with failed runs.

2. **Run notifications in extension** — when a scheduled run completes/fails, show a toast notification in the side panel. Already partially done (`scheduled_agent_start`/`scheduled_agent_end` events), but the extension UI doesn't surface these prominently.

3. **Quality gates** — after a scheduled run completes, optionally run a verification step (like Claude's `Stop` hook): "Did the agent actually download the report? Check if the file exists."

---

## Priority Ranking

| Fix | Impact | Effort | Phase |
|---|---|---|---|
| Per-agent tool restrictions | High | Low | 21 |
| Approval gate on create_agent | High | Medium | 21 |
| Auto-extract SKILLS.md on creation | High | Medium | 21 |
| Agent-level MEMORY.md | Medium | Medium | 21 |
| Run dashboard in web UI | Medium | Medium | 21 |
| Pre/PostToolUse hooks | High | High | 22 |
| Sub-agent resumption | Medium | High | 22 |
| Per-agent permissions | Medium | Medium | 22 |
| Agent export/import to disk | Low | Medium | 23 |
| Cross-agent knowledge access | Medium | Medium | 23 |
| Memory consolidation | Low | Medium | 23 |

---

## Summary

**What we do well:**
- File-based agent identity (SOUL.md, SKILLS.md) — correct pattern
- Self-improvement loop — agents learn from every run
- Domain knowledge per-website — agents know the apps they work on
- Plan system — agents plan before executing
- Scheduled execution — agents run on cron
- Tab-pinned conversations — agents work on the right tab

**What we're missing:**
- Sub-agents aren't truly isolated (no tool restrictions, no independent memory, no resumption)
- No hook/lifecycle system for deterministic enforcement
- Memory is scattered across 5 systems with no unified index
- Agent creation is too implicit (no approval, no auto skill extraction)
- No observability into scheduled runs from the dashboard

The core architecture is sound. The gaps are about **hardening** — making the system reliable enough that agents can run 36 times a day without human intervention.
