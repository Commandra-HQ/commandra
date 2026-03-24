# Phase 24 — Agent Quality & Context Intelligence

> Fix the critical bugs that prevent agents from reliably learning, remembering, and staying within context limits. Make the entire system actually work as designed.

## Why

After Phases 15-23 shipped the full agent infrastructure, real-world usage revealed:
- Knowledge files getting **destroyed** by save_knowledge overwrites (WORKFLOWS.md rewritten, prior learning lost)
- **15+ near-identical** user_memory entries because dedup used exact string matching
- Sub-agents **never learning** — analyzeAndImprove never called from swarm path (0 LEARNINGS.md files across 4 runs)
- Background extractors (`extractAndSaveUserMemory`, `syncDomainKnowledgeToS3`) were **dead code** — defined but never wired in
- Sub-agents breaking after **3 iterations** due to reading wrong config field (maxConcurrentSubAgents instead of maxIterations)
- Screenshots **filling context too fast** — no expiry after agent "sees" them, verbose page-state data, thinking tokens accumulating

## What Shipped

### 24a. Knowledge Protection — save_knowledge with explicit modes
- `save_knowledge` tool now has a `mode` parameter: `append` (default, safe), `merge` (dedup), `rewrite` (explicit override)
- Server-side read-merge-write logic in `handleSaveKnowledge` — append mode adds content, merge mode deduplicates using Levenshtein similarity, rewrite requires agent intent
- Shared `utils/text-similarity.ts` module with `normalizeEntry`, `levenshteinDistance`, `similarity`, `deduplicateLines`
- Updated tool description and system prompt to guide correct mode usage
- Cap at 500 lines per file

### 24b. Memory Deduplication
- `saveUserMemory` now uses similarity matching (threshold 0.75) instead of exact string match
- Near-duplicate memories reinforce existing entries instead of creating duplicates
- When reinforcing, updates content if the new version is more detailed (longer)

### 24c. Learning Pipeline Fix
- `analyzeAndImprove` now wired into swarm.ts — sub-agents learn from their runs
- `extractAndSaveUserMemory` and `syncDomainKnowledgeToS3` wired into chat.ts post-conversation pipeline
- Both fire-and-forget, gated behind `toolCalls > 0 || response > 100 chars`

### 24d. Sub-Agent Reliability
- Fixed maxIterations bug (was reading `limits.maxConcurrentSubAgents` → 3 instead of `maxIterations` → 10)
- Fixed scratchpad scope collision (was using `domain || agentId` → now uses `conversationId || agentId`)
- Added auto page-state refresh after state-changing actions in sub-agent loop (mirrors main orchestrator)

### 24e. Smart Context Management
- **Screenshot auto-expiry**: Images the agent has already seen and responded to are replaced with `[screenshot: already processed]`
- **Thinking block trimming**: Older messages' thinking blocks truncated to last 500 chars (Phase 1.5)
- **Page-state compression**: Auto-refresh now shows compact summary + top 10 elements instead of full 30+ element lists. Overlays still shown in full.
- **Aggressive older message trimming**: Tool results in messages older than last 4 truncated at 1000 chars (was 2000)
- **Old page-state collapse**: All but the most recent `get_page_state` results collapsed to `{ elementCount, url }` summaries
- **System prompt guidance**: "Screenshots are expensive (~2000 tokens). Prefer read_text/read_table."

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/utils/text-similarity.ts` | NEW — shared similarity utils |
| `apps/api/src/agent/self-improve.ts` | Import from shared utils |
| `apps/api/src/agent/internal-tools.ts` | save_knowledge read-merge-write with modes |
| `apps/api/src/agent/tool-definitions.ts` | save_knowledge mode parameter |
| `apps/api/src/agent/prompts.ts` | Knowledge modes + screenshot guidance |
| `apps/api/src/memory/user.ts` | Similarity-based memory dedup |
| `apps/api/src/agent/swarm.ts` | maxIter fix, scratchpad scope, analyzeAndImprove, page-state refresh |
| `apps/api/src/routes/chat.ts` | Wire extractAndSaveUserMemory + syncDomainKnowledgeToS3 |
| `apps/api/src/agent/token-budget.ts` | 6-phase trimming pipeline |
| `apps/api/src/agent/browser-tools.ts` | Compact page-state enrichment |
