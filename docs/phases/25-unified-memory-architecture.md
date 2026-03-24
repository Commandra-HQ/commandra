# Phase 25 — Unified Memory Architecture

> All memory lives in S3 as markdown files. The agent reads and writes its own memory. No more Postgres memory tables. Full agent autonomy over its knowledge — like OpenClaw.

## Why

Memory is currently split across three systems with overlapping responsibilities:

| System | Storage | What It Stores | Who Writes |
|--------|---------|----------------|------------|
| `user_memory` table (Postgres) | Per-user, per-domain rows | Corrections, preferences, terminology, workflows | Background LLM extractor + explicit `save_memory` tool |
| `domain_memory` table (Postgres) | Per-domain rows (shared across users) | Known pages, element notes, workflows, app notes | Background LLM extractor |
| S3 domain files | Per-user, per-domain `.md` files | KNOWLEDGE.md, WORKFLOWS.md, MEMORY.md | Agent via `save_knowledge` tool |

**Problems:**
1. **Duplicate storage**: The same correction about Gmail's compose fields exists in `user_memory` rows AND in S3 KNOWLEDGE.md — with different phrasing, different update timestamps, sometimes contradicting each other
2. **Agent can't manage Postgres memory**: The agent can read/write S3 files via `save_knowledge`/`read_knowledge`, but Postgres memory is controlled by background extractors the agent never sees
3. **No single source of truth**: The system prompt injects both Postgres memories AND S3 knowledge files — the agent sees overlapping information from two systems
4. **Shared domain_memory is wrong**: `domain_memory` is shared across ALL users on a domain. One user's Gmail quirks pollute another user's experience
5. **Three background LLM calls per conversation**: `analyzeAndImprove` + `extractAndSaveUserMemory` + `syncDomainKnowledgeToS3` all run fire-and-forget, each making an LLM call. Wasteful.

## What Ships

### 25a. Migrate user_memory to S3 MEMORY.md
- Move per-user-per-domain memories from Postgres `user_memory` table to S3 `domains/{userId}/{domain}/MEMORY.md`
- One-time migration script: read all `user_memory` rows, group by user+domain, write to MEMORY.md files in S3
- Format: each entry is `- [{category}] {content}` (e.g., `- [correction] Always verify To field before sending`)
- The `save_memory` tool writes to MEMORY.md via `save_knowledge` (mode: merge) instead of inserting Postgres rows
- `recall_memory` reads from S3 MEMORY.md instead of querying Postgres
- `loadUserMemory` (prompt injection) reads from S3 instead of Postgres

### 25b. Deprecate domain_memory table
- Stop using the shared `domain_memory` Postgres table
- Each user already has their own S3 knowledge: `domains/{userId}/{domain}/KNOWLEDGE.md`
- Remove `updateDomainMemory()` background extractor — the agent manages its own knowledge via tools
- Remove `loadDomainMemory()` from Postgres — replaced by `loadDomainKnowledgeFromS3()`
- Stop injecting shared `domainMemory` into the system prompt; only inject per-user S3 knowledge

### 25c. Consolidate background extractors into one
- Replace three separate fire-and-forget LLM calls with a single `postConversationAnalysis()` function
- One LLM call that extracts: skills, learnings, errors (for agent self-improvement), user memories (corrections/preferences), and domain knowledge — all in one prompt
- Writes results to the appropriate S3 files using `save_knowledge` logic (append + dedup)
- Runs once per conversation, not three separate times

### 25d. Agent-managed memory files
The agent gets full control over its memory:
- `save_memory` → writes to S3 `MEMORY.md` (via save_knowledge with mode: merge)
- `recall_memory` → reads + searches S3 `MEMORY.md` (keyword match on file content)
- `save_knowledge` → writes to any S3 file (existing)
- `read_knowledge` → reads any S3 file (existing)
- No more Postgres for memory. Agent is the authority on what it remembers.

### 25e. Memory file structure (per-user, per-domain)
```
domains/{userId}/{domain}/
├── KNOWLEDGE.md    # How the app works (pages, selectors, quirks, behavior)
├── WORKFLOWS.md    # Proven multi-step procedures
├── MEMORY.md       # User corrections, preferences, terminology (was user_memory table)
├── AGENTS.md       # Which agents operate on this domain
└── AGENT_HINT.md   # Auto-agent creation suggestions

{userId}/{agentSlug}/
├── SOUL.md         # Agent identity (existing)
├── SKILLS.md       # Learned capabilities (existing)
├── LEARNINGS.md    # Corrections/discoveries (existing)
├── ERRORS.md       # Failure patterns (existing)
└── MEMORY.md       # Agent run summaries (existing)
```

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/memory/user.ts` | Rewrite to use S3 instead of Postgres |
| `apps/api/src/memory/domain.ts` | Remove Postgres-based `updateDomainMemory`, `loadDomainMemory` |
| `apps/api/src/agent/internal-tools.ts` | `save_memory` → write to S3 MEMORY.md |
| `apps/api/src/agent/self-improve.ts` | Merge into unified `postConversationAnalysis()` |
| `apps/api/src/routes/chat.ts` | Use S3-only memory loading, single post-conversation analysis |
| `apps/api/src/agent/prompts.ts` | Remove dual memory injection; single S3 knowledge section |
| `apps/api/src/db/schema.ts` | Mark `user_memory` and `domain_memory` as deprecated |
| `scripts/migrate-memory-to-s3.ts` | NEW — one-time migration script |

## Migration Plan

1. Write migration script that reads all `user_memory` rows and writes to S3
2. Deploy 25a-25d with S3 reads/writes
3. Keep Postgres tables as read-only fallback for 1 week
4. Drop tables after verifying S3 memory works correctly

## What NOT to Change

- `conversations`, `messages`, `agents`, `agent_runs` tables stay in Postgres — they're structured relational data, not memory
- Agent file storage paths in S3 don't change
- The `save_knowledge` / `read_knowledge` / `list_knowledge` tool interfaces don't change (25a just routes `save_memory` through them)
