# Phase 16 — Self-Learning System + Agent Autonomy

> Agents that genuinely learn over time, accumulate domain knowledge in S3, and can operate with configurable levels of human oversight.

## Phase 16b Update: Agent-Driven Knowledge Management

The original Phase 16d design used background LLM extraction (`syncDomainKnowledgeToS3`, `updateDomainMemory`, `extractAndSaveUserMemory`) to automatically extract knowledge after each conversation. This approach was replaced in Phase 16b with **agent-driven knowledge tools**:

- **`save_knowledge`** — the agent writes domain knowledge directly to S3 during a conversation when it learns something worth persisting
- **`read_knowledge`** — the agent reads domain knowledge files from S3 to recall what it knows about a domain
- **`list_knowledge`** — the agent lists available knowledge files for a domain

This shift means the agent itself decides what to save, when to save it, and how to organize it — rather than relying on a background job to extract knowledge after the fact. Background extraction functions (`syncDomainKnowledgeToS3`, `extractAndSaveUserMemory`) are no longer used. The `recall_memory` tool now uses keyword search only (no vector/embedding search).

---

## Why

Phase 15 gave agents identity and persistence. But they don't truly learn — self-improvement files grow unbounded with duplicates, domain knowledge starts cold every time, there's no visibility into what agents did, and the LLM doesn't know what day it is. Agents also can't run autonomously because every write action requires human approval, which times out for scheduled runs.

This phase makes the system genuinely self-learning and configurable for autonomous operation.

**Embeddings removed:** As part of this phase, the entire embedding pipeline was removed (Voyage AI, OpenAI embeddings, Ollama embeddings, element_embeddings, conversation_embeddings, memory_embeddings tables). Domain knowledge now accumulates organically in S3 (KNOWLEDGE.md, WORKFLOWS.md) instead of via vector embeddings. The `recall_memory` tool uses keyword-only search. Pre-seeded domain knowledge (`domain-seeds.ts`) was also removed in favor of organic learning from usage.

---

## What Ships

### 16a. S3 Storage Helpers

New storage modules for domain-level and run-level files in Supabase Storage.

**Domain files** (`apps/api/src/storage/domain-files.ts`):
- Path: `domains/{userId}/{sanitizedDomain}/{filename}`
- Files: KNOWLEDGE.md, WORKFLOWS.md, AGENTS.md, MEMORY.md
- Functions: `uploadDomainFile`, `downloadDomainFile`, `listDomainFiles`, `sanitizeDomain`

**Run files** (`apps/api/src/storage/run-files.ts`):
- Path: `runs/{userId}/{YYYY-MM-DD}/{HH-MM}_{agentSlug}_{conversationId}.md`
- Human-readable markdown with `<!-- data:{JSON} -->` footer
- Functions: `writeRunLog`, `listRunLogs`, `downloadRunLog`

### 16b. Date Context in Prompts

System prompt now includes today's date at the top:
```
**Today:** Thursday, March 20, 2026 (2026-03-20)
```

Also added `domainKnowledge` parameter to `buildSystemPrompt()` — injects a "Domain Knowledge (from past sessions)" section with personal S3-backed knowledge.

### 16c. Self-Improvement Dedup + Pruning

Rewrote `appendToAgentFile` in `self-improve.ts`:

- **Deduplication**: Normalized string comparison + Levenshtein similarity (>0.8 threshold) — skips entries that are exact or near-duplicates of existing ones
- **Soft cap (40)**: Triggers LLM-powered consolidation to 30 entries via the fast model
- **Hard cap (60)**: Force-trims oldest entries if consolidation isn't possible
- **Domain AGENTS.md**: After each agent run, updates `domains/{userId}/{domain}/AGENTS.md` with the agent's slug, name, last run date, and run count

### 16d. Domain Knowledge S3 Layer

New exports in `apps/api/src/memory/domain.ts`:

- **`loadDomainKnowledgeFromS3()`**: Reads KNOWLEDGE.md for a user+domain pair
- **`syncDomainKnowledgeToS3()`**: After each conversation, extracts both knowledge (page structure, app behavior) and preferences (export formats, shortcuts) via the fast model. Writes to KNOWLEDGE.md and MEMORY.md with deduplication.
- **`appendDomainWorkflow()`**: When a plan completes successfully, extracts the workflow steps and appends to WORKFLOWS.md (capped at 30 workflows)

**Strategy**: Postgres `domainMemory` stays as the shared cache layer (fast, all users). S3 KNOWLEDGE.md is per-user, richer, and accumulates over time. Both injected into the prompt.

### 16e. Agent Autonomy Levels

Three levels controlling how much an agent can do without human approval:

| Level | Review Actions | Blocked Actions | Plan Approval |
|-------|---------------|-----------------|---------------|
| `supervised` (default) | Require approval | Rejected | Require approval |
| `trusted` | Auto-approve | Rejected | Auto-approve |
| `autonomous` | Auto-approve | Auto-approve | Auto-approve |

**Implementation**:
- `AgentAutonomy` type added to `@afe/shared`
- `autonomy` column added to `agents` table (default: `supervised`)
- `partitionToolsBySafety()` respects autonomy — trusted agents skip review gates, autonomous agents skip everything
- `handleToolCall()` respects autonomy — skips `sendApprovalRequest` for trusted/autonomous
- `submit_plan` auto-approves for trusted/autonomous agents
- **Scheduled agents enforced**: `createAgent()` auto-promotes to `trusted` if agent has a cron trigger (scheduled agents have no human to approve)
- Audit logging still records all actions regardless of autonomy level

### 16f. Run Log API Endpoints

New endpoints in `apps/api/src/routes/agents.ts`:

- `GET /agents/:id/runs` — Paginated agent runs from Postgres (limit, offset)
- `GET /agents/runs/:date` — List S3 run logs by date (YYYY-MM-DD)
- `GET /agents/runs/:date/:filename` — Download specific run log markdown

### 16g. Chat Route Integration

`apps/api/src/routes/chat.ts` changes:
- Loads S3 domain knowledge in parallel with existing Postgres memory loads
- Passes `domainKnowledge` to orchestrator
- After execution (fire-and-forget):
  - Syncs knowledge to S3 (`syncDomainKnowledgeToS3`)
  - Writes structured run log for non-coordinator agents (`writeRunLog`)
  - Passes `domain` to `analyzeAndImprove` for domain AGENTS.md updates

---

## S3 Storage Structure

```
agents/{userId}/{agentSlug}/
  SOUL.md              # Identity (existing)
  SKILLS.md            # Capabilities (existing, now with dedup + pruning)
  LEARNINGS.md         # Discoveries (existing, now with dedup + pruning)
  ERRORS.md            # Failure patterns (existing, now with dedup + pruning)

domains/{userId}/{domain}/
  KNOWLEDGE.md         # Accumulated domain knowledge
  WORKFLOWS.md         # Proven multi-step workflows from completed plans
  AGENTS.md            # Which agents operate on this domain
  MEMORY.md            # Domain-specific user preferences

runs/{userId}/{YYYY-MM-DD}/
  {HH-MM}_{agentSlug}_{conversationId}.md  # Per-run structured log
```

---

## Files Modified/Created

| File | Action | Sub-phase |
|------|--------|-----------|
| `apps/api/src/storage/domain-files.ts` | **CREATE** | 16a |
| `apps/api/src/storage/run-files.ts` | **CREATE** | 16a |
| `apps/api/src/agent/prompts.ts` | MODIFY — date + domainKnowledge param | 16b |
| `apps/api/src/agent/self-improve.ts` | MODIFY — dedup, pruning, consolidation, domain AGENTS.md | 16c |
| `apps/api/src/memory/domain.ts` | MODIFY — S3 knowledge read/write + workflow extraction | 16d |
| `packages/shared/src/types/agents.ts` | MODIFY — add AgentAutonomy type | 16e |
| `apps/api/src/db/schema.ts` | MODIFY — add autonomy column to agents | 16e |
| `apps/api/src/agent/agent-registry.ts` | MODIFY — autonomy in CRUD + scheduled agent enforcement | 16e |
| `apps/api/src/agent/orchestrator.ts` | MODIFY — autonomy in safety partition + approval + plans | 16e |
| `apps/api/src/routes/agents.ts` | MODIFY — autonomy in create/update + run log endpoints | 16e, 16f |
| `apps/api/src/routes/chat.ts` | MODIFY — S3 knowledge load + run logs + domain param | 16g |

**Total: 2 new files, 9 modified files.**

---

## DB Migration

```sql
ALTER TABLE agents ADD COLUMN autonomy TEXT DEFAULT 'supervised';
```

---

## Verification

1. **Date context**: Start a conversation, inspect system prompt — should see today's date
2. **Domain knowledge**: Run agent on gmail.com twice — second run's prompt includes KNOWLEDGE.md from first
3. **Dedup**: Run agent 3x on same task — SKILLS.md should NOT have 3 copies of same skill
4. **Consolidation**: Add 45 entries to SKILLS.md, trigger run — file consolidates to ~30
5. **Run logs**: After agent run, check S3 at `runs/{userId}/{today}/` — markdown file exists
6. **Domain AGENTS.md**: After run, `domains/{userId}/{domain}/AGENTS.md` lists the agent
7. **Workflows**: Complete a multi-step plan, check WORKFLOWS.md
8. **Autonomy - supervised**: Default agent requires approval on click "Send"
9. **Autonomy - trusted**: Set agent to trusted — click "Send" auto-approves, click "Delete" still blocked
10. **Autonomy - autonomous**: Set agent to autonomous — all actions auto-approve
11. **Scheduled enforcement**: Create agent with cron trigger — autonomy auto-set to trusted
12. **API**: `GET /agents/:id/runs` returns paginated history
13. **API**: `GET /agents/runs/2026-03-20` returns today's S3 run logs
