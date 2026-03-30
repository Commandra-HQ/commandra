# Phase 21 — Agent Intelligence Hardening

> Make sub-agents truly independent, add approval gates, auto-extract skills, unified memory, and run observability.

## Why

From the agent architecture audit against Claude Code's best practices (`docs/architecture/agent-audit.md`), our agents had several gaps:

1. Sub-agents couldn't share structured data with the coordinator
2. Agent creation happened silently — no user confirmation
3. New agents started cold — no SKILLS.md extracted from the teaching conversation
4. Memory was scattered across 5 systems with no unified index per agent
5. Scheduled run history was invisible in the dashboard

## What Shipped

### 21a. Per-Agent Tool Restrictions + Sub-Agent Scratchpad

**Sub-agent tool filtering** was already working — `getToolDefinitions(agentConfig?.tools)` in `swarm.ts` filters browser tools based on the agent's `tools` allowlist in the DB. This was verified and documented.

**New: Scratchpad tools for sub-agents.** Sub-agents now have `write_scratchpad` and `read_scratchpad` tools available. These are handled inline in the sub-agent's tool loop (not through the browser tool registry). Data is stored in S3 at `agents/{userId}/scratchpad/{conversationId}/{key}.json`.

This enables: sub-agent extracts a table → writes to scratchpad → coordinator reads it → pastes into another app.

**Files:** `apps/api/src/agent/swarm.ts`

### 21b. Approval Gate on Agent Creation

Before creating an agent, the system now checks `ctx.autonomy`. If not `autonomous`:
1. Emits `approval_inline` SSE event with `approvalType: 'agent'`
2. Frontend shows a preview card: agent name, slug, description, domains, cron, and SOUL.md preview
3. Calls `sendApprovalRequest()` — user clicks "Create Agent" or "Reject"
4. On rejection, returns feedback to the LLM

Same pattern as plan approval — proven, minimal new code.

**Files:** `apps/api/src/agent/internal-tools.ts`, `apps/extension/src/sidepanel/tabs/message-blocks.tsx`, `packages/shared/src/types/sse.ts`

### 21c. Auto-Extract SKILLS.md on Agent Creation

After `create_agent` succeeds, `extractInitialSkills()` fires in the background:
1. Calls the fast model with the agent's name, description, and SOUL.md
2. Generates concrete, actionable SKILLS.md with workflow steps, selectors, and tips
3. Writes to S3 immediately — agent is born with skills, not cold

Fire-and-forget: doesn't block the response to the user.

**Files:** `apps/api/src/agent/internal-tools.ts`

### 21d. Agent-Level MEMORY.md

Each agent now has a persistent `MEMORY.md` — a unified index of what it knows across sessions.

**Loading:** `hydrateAgent()` in `agent-registry.ts` loads `MEMORY.md` from S3 (first 200 lines, matching Claude Code's auto-memory pattern). Injected into system prompt as "Agent Memory" with guidance on how to update it.

**Writing:** `analyzeAndImprove()` in `self-improve.ts` now appends run summaries to `MEMORY.md` after every meaningful run. Uses the same dedup/consolidation logic as SKILLS.md — prevents unbounded growth.

**Type:** Added `memory?: string` to `AgentConfig` in shared package.

**Files:** `packages/shared/src/types/agents.ts`, `apps/api/src/agent/agent-registry.ts`, `apps/api/src/agent/prompts.ts`, `apps/api/src/agent/self-improve.ts`

### 21e. Run Dashboard in Web UI

The `agent_runs` table already had data and an API endpoint (`GET /api/agents/:id/runs`). Wired it into the dashboard:

- Agent card fetches runs on expand (alongside files)
- "Recent Runs" section shows last 10 runs with: colored status dots (green=completed, red=failed, yellow=queued), timestamp, duration, tool count
- Failed runs show error preview with full error on hover
- Visually distinct backgrounds per status

**Files:** `apps/web/app/(dashboard)/agents/agent-card.tsx`, `apps/web/app/(dashboard)/agents/page.tsx`

## Prompt Engineering Updates

Updated `apps/api/src/agent/prompts.ts` system prompt:
- SKILLS.md creation is now **mandatory** on `create_agent` (not optional)
- Added SKILLS.md template with concrete example (Instamart report workflow)
- Added "Editing Existing Agents" section: read current files → modify → write back
- Added "Inter-Agent Data Sharing" section: scratchpad tools
- Added "Local File Access" section: save/read/list local files
- Agent Memory section injected from MEMORY.md when available
