# Phase 25 — Unified Memory Architecture

> All memory lives in S3 as markdown files. The agent reads and writes its own memory. No more Postgres memory tables. Full agent autonomy over its knowledge.

## Why

Memory was split across Postgres tables (`user_memory`, `domain_memory`) and S3 markdown files, causing:
1. **Duplicate storage**: Same corrections in Postgres rows AND S3 files with different phrasing
2. **Agent can't manage Postgres memory**: Agent tools only reach S3 files — Postgres was controlled by background extractors
3. **Three overlapping knowledge sections** in the system prompt from three different sources
4. **Shared `domain_memory` was wrong**: One user's Gmail quirks polluting another user's context
5. **Three fire-and-forget LLM calls** per conversation doing overlapping work

## What Shipped

### 25a. user_memory → S3 MEMORY.md
- `memory/user.ts` fully rewritten: all functions (load, save, list, delete, edit, clear, prune) now read/write S3 `domains/{userId}/{domain}/MEMORY.md`
- Format: `- [YYYY-MM-DD] [{category}] {content}` with `[reinforced:N]` tags
- Scoring preserved (corrections always first, recency decay, reinforcement bonus)
- Similarity-based dedup still works (uses shared text-similarity utils)
- `extractAndSaveUserMemory()` writes to S3 via the new `saveUserMemory()`
- Zero Postgres dependency in this file

### 25b. domain_memory → deprecated
- `loadDomainMemory()` now returns `null` (stub for backward compat)
- `updateDomainMemory()` removed entirely — was writing to shared Postgres table
- All Postgres imports removed from `memory/domain.ts`
- S3 functions preserved: `loadDomainKnowledgeFromS3()`, `syncDomainKnowledgeToS3()`, `appendDomainWorkflow()`

### 25c. recall_memory → S3 search
- `db/vector-search.ts` rewritten: `searchUserMemories()` reads S3 MEMORY.md, keyword-scores entries
- Same interface (query, userId, domain, limit) — consumers unchanged

### 25d. Consumer updates
- `chat.ts`: removed `loadDomainMemory()` from conversation start — only loads S3 knowledge + user memory
- `scheduler.ts`: same change — loads `loadDomainKnowledgeFromS3()` + `loadUserMemory()`
- `prompts.ts`: deprecated `memorySummary` (was "What You Know About This App" from Postgres), kept two sections: User Memory + Domain Knowledge

### 25e. Post-conversation sync consolidated
- `syncDomainKnowledgeToS3` simplified: extracts knowledge + workflows only (no preferences — those go through `extractAndSaveUserMemory`)
- Two fire-and-forget calls instead of three: `analyzeAndImprove` + `extractAndSaveUserMemory` (both write to S3)

## Memory File Structure (final)
```
domains/{userId}/{domain}/
├── KNOWLEDGE.md    # App facts, selectors, quirks, behavior
├── WORKFLOWS.md    # Proven multi-step procedures
├── MEMORY.md       # User corrections, preferences, terminology (was Postgres)
├── AGENTS.md       # Which agents operate on this domain
└── AGENT_HINT.md   # Auto-agent creation suggestions

{userId}/{agentSlug}/
├── SOUL.md         # Agent identity
├── SKILLS.md       # Learned capabilities
├── LEARNINGS.md    # Corrections/discoveries
├── ERRORS.md       # Failure patterns
└── MEMORY.md       # Agent run summaries
```

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/memory/user.ts` | Full rewrite: S3-backed, no Postgres |
| `apps/api/src/memory/domain.ts` | Remove Postgres functions, keep S3 functions |
| `apps/api/src/db/vector-search.ts` | Rewrite for S3 keyword search |
| `apps/api/src/routes/chat.ts` | Remove loadDomainMemory, S3-only loading |
| `apps/api/src/agent/scheduler.ts` | Remove loadDomainMemory, use S3 |
| `apps/api/src/agent/prompts.ts` | Deprecate Postgres memory section |

## Migration Notes

- Postgres `user_memory` and `domain_memory` tables are NOT dropped — they remain as read-only archives
- New conversations will read/write S3 only
- Existing S3 MEMORY.md files (written by agents) continue to work — the new parser is backward compatible with existing format
- Dashboard Memory page (`/memory`) continues to work through same API routes
