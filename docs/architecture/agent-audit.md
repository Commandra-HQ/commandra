# Agent Architecture Audit — Commandra vs Claude Code Best Practices

> Audit of our agent/sub-agent/memory/scheduler system against Claude's official patterns for building production agent systems.

---

## Executive Summary

Audit conducted against Claude Code's sub-agent, agent teams, hooks, and memory docs. Phase 21 addressed the highest-priority items. Remaining gaps are tracked for Phase 22-23.

### Fixed (Phase 19-21)
- Per-agent tool restrictions — already working, verified
- Approval gate on agent creation — same pattern as plan approval
- Auto-extract SKILLS.md on creation — fast model generates skills from purpose
- Unified agent MEMORY.md — 200-line index loaded into prompt, written by self-improve
- Run dashboard — agent card shows recent runs with status/duration/errors
- Inter-agent data passing — scratchpad tools for sub-agents
- Screenshot tab targeting — captures correct tab when user switches
- Plan continuity — existing plans loaded into system prompt on follow-up messages
- OpenAI vision — images extracted from tool results for proper vision processing
- Scheduler resilience — dedup, retry 3x, alerts, offline queue, jitter

### Remaining Gaps (Phase 22-23)
1. **No hooks/lifecycle system** — no way to run deterministic validation before/after tool execution
2. **Sub-agent resumption** — can't continue a sub-agent's work, must re-spawn fresh
3. **Per-agent permissions** — autonomy field exists but sub-agents don't enforce it independently
4. **Agent export/import** — agents live in S3, not version-controllable on disk

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

### What Commandra does (post Phase 21)

- Sub-agents run `runSubAgent()` in `swarm.ts` — own context window with custom system prompt
- Custom system prompt via `buildSubAgentPrompt()` (SOUL.md + SKILLS.md + LEARNINGS.md + ERRORS.md + domain memory)
- **Tool restrictions respected** — `getToolDefinitions(agentConfig?.tools)` filters browser tools per agent
- **Scratchpad tools** — `write_scratchpad`/`read_scratchpad` for inter-agent structured data passing
- **MEMORY.md loaded** — agent's accumulated notes injected into prompt (first 200 lines)
- Depth gated: spawn_agent excluded at depth >= 2
- Cannot be resumed — each spawn is fresh
- No hooks — no pre/post validation
- Tabs close on success, stay open on failure
- Results come back as `summary` + `actionsPerformed` (good)

### Gaps (remaining)

| Claude Code Pattern             | Commandra Status           | Impact                                                                          |
| ------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| **Per-agent tool restrictions** | Done (Phase 21a)           | Agents respect `tools` allowlist from DB                                        |
| **Per-agent permissions**       | Partial                    | `autonomy` field exists but sub-agents don't enforce it independently            |
| **Persistent sub-agent memory** | Done (Phase 21d)           | MEMORY.md loaded + written by self-improve loop                                 |
| **Sub-agent resumption**        | Missing                    | Can't continue a sub-agent's work. Must re-spawn from scratch                   |
| **Tool-level hooks**            | Missing                    | No deterministic pre/post validation on tool use                                |
| **Scratchpad**                  | Done (Phase 20a + 21a)     | Sub-agents have scratchpad tools for data passing                               |
| **Tab lifecycle**               | Done (Phase 20a)           | Tabs close on success, stay open on failure                                     |

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

| System                   | Storage                                                                      | Loaded when                             | Written by                          |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| **Domain knowledge**     | S3: `domains/{userId}/{domain}/KNOWLEDGE.md`, `WORKFLOWS.md`, `MEMORY.md`    | Chat route loads for the current domain | Agent via `save_knowledge` tool     |
| **User memory**          | Postgres `user_memory` table                                                 | Chat route loads matching memories      | Agent via `save_memory` tool        |
| **Agent files**          | S3: `{userId}/{agentSlug}/SOUL.md`, `SKILLS.md`, `LEARNINGS.md`, `ERRORS.md` | Agent registry hydrates on resolve      | Self-improvement loop (post-run)    |
| **Conversation history** | Postgres `messages` table + `messages.tool_data`                             | Chat route loads for conversationId     | Orchestrator saves after each turn  |
| **Plans**                | S3: `{userId}/plans/{convId}/PLAN.md`                                        | Chat route loads (just added Phase 19)  | `submit_plan` / `update_plan` tools |

### Gaps (remaining)

| Claude Code Pattern                           | Commandra Status       | Impact                                                                                     |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| **Unified MEMORY.md index**                   | Done (Phase 21d)       | Each agent has MEMORY.md, first 200 lines loaded into prompt, written by self-improve      |
| **On-demand loading**                         | Partially done         | Domain knowledge loaded for current domain. Cross-agent knowledge not yet accessible       |
| **Memory scoping** (user/project/local)       | Missing                | All memory is global to the user. No project/team scoping                                  |
| **Auto-memory** (Claude writes its own notes) | Done (Phase 21d)       | MEMORY.md updated after every meaningful run via self-improve loop                         |
| **Memory size management**                    | Done                   | SOFT_CAP/HARD_CAP consolidation applies to MEMORY.md (same as SKILLS.md)                  |

### Remaining Fixes

1. **Cross-agent knowledge access** — when the coordinator invokes a sub-agent, include domain knowledge for the target domain. Partially done in `buildSubAgentPrompt`, but could be more thorough.

2. **Memory scoping** — consider user/project/org scopes for memory, mirroring Claude Code's user/project/local pattern.

---

## 3. Hooks: Implemented (Phase 22)

### What Commandra now has

Hooks system built in Phase 22 with three hook types:

- **PreToolUse** — rule-based pattern matching before tool execution. Blocks actions matching tool name, label regex, or URL regex. Zero latency. Example: "never click anything labeled 'delete' on this app."
- **PostToolUse** — side effects after tool execution. Logging, auto-screenshot triggers. Zero latency.
- **OnComplete** — LLM-driven verification when agent finishes. Fast model checks if task was actually completed. ~1s latency. Example: "verify the report was downloaded."

Hooks are stored in `agents.hooks` JSONB column, per-agent configurable. Evaluated in `apps/api/src/agent/hooks.ts`. Wired into `browser-tools.ts` (pre/post), `orchestrator.ts` (OnComplete), and available to sub-agents.

### Differences from Claude Code

| Claude Code | Commandra |
|---|---|
| Shell commands | Rule-based + LLM-driven (browser context, no shell) |
| 16+ event types | 3 event types (PreToolUse, PostToolUse, OnComplete) |
| File-based config | JSONB in agents table |
| Prompt-based and agent-based hooks | LLM-check (OnComplete only) |

Sufficient for our use case. Additional event types can be added as needed.

---

## 4. Chat→Agent: Too Implicit, No Skill Extraction

### What Claude Code does

- Sub-agents are **defined as Markdown files** with YAML frontmatter — explicit, version-controlled, reviewable
- Creating a sub-agent is a **deliberate act** (via `/agents` command or manually creating a file)
- Sub-agents have **skills** — preloaded knowledge injected at startup
- Sub-agents have **persistent memory** — they accumulate knowledge across sessions

### What Commandra does (post Phase 21)

- `create_agent` tool requires **user approval** (approval_inline event with preview card) unless autonomous
- SOUL.md written immediately, **SKILLS.md auto-extracted** from agent's purpose via fast model (fire-and-forget)
- Agent files live in S3 — not yet version-controllable on disk

### Remaining Fixes

1. **Agent-as-files on disk** — optional export: `commandra export-agent invoice-checker` → writes files to disk for version control. Import: `commandra import-agent ./invoice-checker/`. This enables sharing and collaboration.

---

## 5. Scheduler: Good Foundation, Missing Observability

### What Claude Code does (Agent Teams, not scheduler)

- Agent teams have a **shared task list** — agents claim and complete tasks
- Teams have **TeammateIdle** and **TaskCompleted** hooks — enforce quality gates
- Lead agent can **require plan approval** before teammates implement
- Communication is **bidirectional** — teammates message each other

### What Commandra does (post Phase 20-21)

- Scheduler v2: dedup, retry 3x with backoff, offline queue, jitter, alert webhooks (Phase 20)
- **Run dashboard** — agent card shows last 10 runs with status/duration/tools/errors (Phase 21e)
- Extension notifications for scheduled runs (`scheduled_agent_start`/`scheduled_agent_end` events)

### Remaining Fixes

1. **Quality gates** — after a scheduled run completes, optionally run a verification step (like Claude's `Stop` hook): "Did the agent actually download the report?"

2. **Run notifications in extension** — toast notifications in the side panel could be more prominent.

---

## Remaining Work

| Fix                           | Impact | Effort | Target Phase | Status       |
| ----------------------------- | ------ | ------ | ------------ | ------------ |
| Pre/PostToolUse hooks         | High   | High   | 22           | Done         |
| OnComplete hooks (LLM-driven) | High   | Medium | 22           | Done         |
| Quality gates (Stop hooks)    | Medium | Medium | 22           | Done (OnComplete) |
| Sub-agent resumption          | Medium | High   | 23           | Future       |
| Per-agent permissions         | Medium | Medium | 23           | Future       |
| Agent export/import to disk   | Low    | Medium | 23           | Future       |
| Cross-agent knowledge access  | Medium | Medium | 23           | Future       |
| Memory scoping (user/project) | Low    | Medium | 23           | Future       |

---

## Summary (updated post Phase 19-21)

**What we do well:**

- File-based agent identity (SOUL.md, SKILLS.md, MEMORY.md) — correct pattern, mirrors Claude Code
- Self-improvement loop — agents learn from every run, write to MEMORY.md
- Auto-extract SKILLS.md on creation — agents born with skills, not cold
- Approval gate on agent creation — user confirms before agent is created
- Domain knowledge per-website — agents know the apps they work on
- Plan system with continuity — plans persist across messages, loaded into system prompt
- Scheduled execution with retry/alerts/queue — production-grade scheduler
- Tab-pinned conversations — agents work on the right tab, screenshots capture correct tab
- Inter-agent data passing — scratchpad tools for structured data between coordinator and sub-agents
- Per-agent tool restrictions — agents respect their tool allowlist
- Run observability — dashboard shows run history with status/duration/errors
- OpenAI vision — screenshots properly passed as images, not serialized base64

**What we're missing (Phase 23+):**

- Sub-agents can't be resumed — must re-spawn fresh each time
- Per-agent permissions not enforced independently on sub-agents
- Agents not exportable to disk for version control/sharing
- Memory not scoped to projects/teams (all global to user)
