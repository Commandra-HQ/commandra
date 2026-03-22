# Agent Architecture Audit — Commandra vs Claude Code Best Practices

> Audit of our agent/sub-agent/memory/scheduler system against Claude's official patterns for building production agent systems.
> Updated post Phase 23 — most items resolved.

---

## Executive Summary

Audit conducted against Claude Code's sub-agent, agent teams, hooks, and memory docs. Phases 19-23 addressed the critical and high-priority items. The system is now ~85% aligned with Claude Code's patterns.

### Fixed (Phases 19-23)

- Per-agent tool restrictions — agents respect `tools` allowlist
- Approval gate on agent creation — same pattern as plan approval
- Auto-extract SKILLS.md on creation — fast model generates skills from purpose
- Unified agent MEMORY.md — 200-line index loaded into prompt, written by self-improve
- Run dashboard — agent card shows recent runs with status/duration/errors
- Inter-agent data passing — scratchpad tools for sub-agents
- Screenshot tab targeting — captures correct tab when user switches
- Plan continuity — existing plans loaded into system prompt on follow-up messages
- OpenAI vision — images extracted from tool results, S3 URLs used
- Scheduler resilience — dedup, retry 3x, alerts, offline queue, jitter
- Hooks system — PreToolUse (block), PostToolUse (log), OnComplete (LLM verify)
- Self-improvement for ALL conversations — coordinator included (Phase 23a)
- Screenshots to S3 — signed URLs, no inline base64 (Phase 23b)
- Auto domain agent suggestions — AGENT_HINT.md after 3+ interactions (Phase 23c)
- S3 browsing tool — agents freely discover their files (Phase 23d)
- file_url support — both Anthropic and OpenAI use S3 URLs (Phase 23e)
- Configurable constants — thinking budget, depth, concurrency, LLM config all per-agent
- Domain-specific autonomy — different autonomy per domain
- Context-aware planning — agents gather knowledge before planning

### Remaining (deferred — low priority)

1. Sub-agent resumption — can't continue, must re-spawn fresh
2. Agent export/import to disk — for version control/sharing
3. Memory scoping (user/project/local) — all global to user
4. Dynamic tool registration — agents can't define custom tools
5. Prompt cache strategy — always ephemeral

---

## 1. Sub-Agents

### What Claude Code does

- Own context window + custom system prompt
- Per-agent tool restrictions + independent permissions
- Persistent memory across sessions
- Cannot spawn other sub-agents (depth gated)
- Resumable — continue where left off
- Lifecycle hooks scoped to agent

### What Commandra does (post Phase 23)

- Own context window + custom system prompt (SOUL + SKILLS + LEARNINGS + ERRORS + MEMORY)
- **Tool restrictions** — `getToolDefinitions(agentConfig?.tools)` filters per agent
- **Scratchpad** — `write_scratchpad`/`read_scratchpad` for structured data passing
- **MEMORY.md** — loaded into prompt, written by self-improve
- **Configurable depth** — `agentConfig.limits?.maxDepth` (default 2)
- **Configurable concurrency** — `agentConfig.limits?.maxConcurrentSubAgents`
- **Domain autonomy** — `agentConfig.domainAutonomy` per domain
- **Hooks** — PreToolUse/PostToolUse/OnComplete evaluated for sub-agents
- Tabs close on success, stay open on failure
- Cannot be resumed — each spawn is fresh

| Claude Code Pattern         | Status                    |
| --------------------------- | ------------------------- |
| Per-agent tool restrictions | **Done**                  |
| Per-agent permissions       | **Done** (domainAutonomy) |
| Persistent sub-agent memory | **Done** (MEMORY.md)      |
| Sub-agent resumption        | Not done                  |
| Tool-level hooks            | **Done** (Phase 22)       |
| Inter-agent data            | **Done** (scratchpad)     |
| Tab lifecycle               | **Done**                  |

---

## 2. Memory

### What Commandra has (post Phase 23)

| System                   | Storage                                      | Loaded when                | Written by                         |
| ------------------------ | -------------------------------------------- | -------------------------- | ---------------------------------- |
| **Domain knowledge**     | S3: `domains/{userId}/{domain}/`             | Chat route                 | Agent tools + self-improve         |
| **User memory**          | Postgres `user_memory`                       | Chat route                 | Agent `save_memory` tool           |
| **Agent files**          | S3: `{userId}/{slug}/` (incl. \_coordinator) | Agent registry             | Self-improve loop (ALL agents now) |
| **Agent MEMORY.md**      | S3: `{userId}/{slug}/MEMORY.md`              | Agent registry (200 lines) | Self-improve loop                  |
| **Conversation history** | Postgres `messages` + `tool_data`            | Chat route                 | Orchestrator                       |
| **Plans**                | S3: `{userId}/plans/{convId}/PLAN.md`        | Chat route                 | Plan tools                         |
| **Screenshots**          | S3: `{userId}/screenshots/{id}.jpg`          | N/A (URL reference)        | Screenshot tool                    |
| **Scratchpad**           | S3: `{userId}/scratchpad/{convId}/`          | Agent tools                | Scratchpad tools                   |

| Claude Code Pattern     | Status                                      |
| ----------------------- | ------------------------------------------- |
| Unified MEMORY.md index | **Done**                                    |
| On-demand loading       | **Done** (domain + agent files)             |
| Auto-memory             | **Done** (self-improve writes to MEMORY.md) |
| Memory size management  | **Done** (consolidation caps, configurable) |
| Memory scoping          | Not done (all global to user)               |

---

## 3. Hooks — Done (Phase 22)

Three hook types, stored in `agents.hooks` JSONB, per-agent configurable:

- **PreToolUse** — rule-based pattern matching (tool name, label regex, URL regex). Zero latency.
- **PostToolUse** — side effects (logging). Zero latency.
- **OnComplete** — LLM-driven verification. Fast model yes/no check. ~1s latency.

| Claude Code       | Commandra               |
| ----------------- | ----------------------- |
| Shell commands    | Rule-based + LLM-driven |
| 16+ event types   | 3 event types           |
| File-based config | JSONB in agents table   |

---

## 4. Chat → Agent — Done (Phases 21-23)

- **Approval gate** on `create_agent` with UI preview card
- **Auto-extract SKILLS.md** from agent's purpose via fast model
- **Auto-suggest domain agents** after 3+ coordinator interactions (AGENT_HINT.md)
- **Self-improvement for coordinator** — \_coordinator gets SKILLS/LEARNINGS/ERRORS/MEMORY just like named agents

| Claude Code Pattern         | Status                              |
| --------------------------- | ----------------------------------- |
| Deliberate agent creation   | **Done** (approval gate)            |
| Skills preloaded at startup | **Done** (auto-extracted, hydrated) |
| Persistent memory           | **Done** (MEMORY.md)                |
| Agent export/import         | Not done                            |

---

## 5. Scheduler — Done (Phases 20-21)

- Scheduler v2: dedup, retry 3x with backoff, offline queue, jitter, alert webhooks
- Run dashboard in web UI
- Configurable retry policy via `agentConfig.limits`
- OnComplete hooks serve as quality gates

---

## 6. Configuration — Done (Phase 23)

All previously hardcoded constants now configurable per agent:

```typescript
AgentConfig {
  llm?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;    // was hardcoded 8000
    thinkingBudget?: number;     // was hardcoded 4000
    thinkingEnabled?: boolean;   // was always on
  };
  limits?: {
    maxConcurrentSubAgents?: number;  // was hardcoded 3
    maxDepth?: number;                // was hardcoded 2
    maxRetries?: number;              // was hardcoded 3
    retryDelays?: number[];           // was hardcoded [5m, 15m, 60m]
    selfImproveCap?: number;          // was hardcoded 40
  };
  domainAutonomy?: Record<string, AgentAutonomy>;  // per-domain overrides
}
```

---

## Remaining Work (low priority, deferred)

| Item                      | Impact | Effort | Why deferred                                       |
| ------------------------- | ------ | ------ | -------------------------------------------------- |
| Sub-agent resumption      | Medium | High   | Rare use case, 2-min timeout covers most workflows |
| Agent export/import       | Low    | Medium | No marketplace or sharing mechanism yet            |
| Memory scoping            | Low    | Medium | Single-user product, teams not built yet           |
| Dynamic tool registration | Low    | High   | Static tools cover all browser actions             |
| Prompt cache strategy     | Low    | Low    | Cost optimization, not functionality               |

---

## Summary (post Phase 23)

**What we do well (aligned with Claude Code):**

- File-based agent identity (SOUL.md, SKILLS.md, MEMORY.md)
- Self-improvement for ALL conversations (coordinator included)
- Auto-extract SKILLS.md on creation — agents born with skills
- Approval gate on agent creation
- Domain knowledge per-website with CRITICAL enforcement
- Context-aware planning (gather knowledge → plan → execute)
- Plan continuity across messages
- Screenshots in S3 with signed URLs (no inline base64)
- file_url support for both Anthropic and OpenAI
- Hooks system (PreToolUse, PostToolUse, OnComplete)
- Scheduled execution with retry/alerts/queue
- Tab-pinned conversations
- Inter-agent data passing (scratchpad)
- Per-agent tool restrictions + domain-specific autonomy
- Configurable LLM params (thinking, temperature, output tokens)
- Configurable limits (depth, concurrency, retry, self-improve caps)
- Run observability in dashboard
- S3 browsing tool for agents
- Auto domain agent suggestions after repeated use

**What we're missing (low priority):**

- Sub-agent resumption
- Agent export/import to disk
- Memory scoping (user/project/local)
- Dynamic tool registration
- Prompt cache tuning
