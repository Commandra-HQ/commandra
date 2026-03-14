# Phase 13 — Agentic System Overhaul

> Parallel tool calling, intelligent memory, multi-agent swarm, embedding improvements, learning feedback loops, and speed optimizations.

## Why

The orchestrator works but is slow (sequential tool execution), memory is a blunt instrument (dump everything into the system prompt), embeddings are underutilized (last-resort fallback only), and the agent doesn't learn from outcomes. This phase fixes all of that.

## What Ships

### 13a. Parallel Tool Calling ✅
### 13b. Intelligent Memory System ✅
### 13c. Multi-Agent Swarm ✅
### 13d. Embedding Improvements ✅
### 13e. Learning Feedback Loops ✅
### 13f. Re-Indexing Improvements ✅
### 13g. Speed Optimizations ✅

---

## 13a. Parallel Tool Calling

**Problem:** All tool calls execute sequentially. If the LLM returns 4 tool calls in one turn, we wait for each to complete before starting the next. This adds 2+ seconds of unnecessary latency per multi-tool turn.

**Solution:** Partition tool calls by safety level, execute safe tools in parallel.

### Implementation

1. **Partition tool calls by safety classification:**
   - `safe` tools (read_text, screenshot, get_page_state, scroll, wait_for_element, export_data, go_back, refresh_page_state) → execute in parallel via `Promise.all`
   - `review` tools (click_element, type_text, select_option with write context) → execute sequentially with approval gates
   - `blocked` tools → reject immediately

2. **Ordering guarantees:**
   - Within a single LLM turn, tools are independent by definition (the LLM chose to emit them together)
   - Order-dependent actions are emitted across separate turns (LLM waits for result before deciding next action)
   - If a `review` tool and a `safe` tool are in the same turn, run safe tools in parallel first, then sequential review tools

3. **Result aggregation:**
   - All tool results must be returned in the same order as the original tool calls (LLM expects this)
   - Use `Promise.allSettled` for safe tools to handle partial failures gracefully

### Files to modify
- `apps/api/src/agent/orchestrator.ts` — Replace sequential `for` loop with parallel execution
- `apps/api/src/safety/classifier.ts` — Export a batch classification function

### Acceptance criteria
- [ ] Safe tools within a single LLM turn execute concurrently
- [ ] Review tools still go through approval gates sequentially
- [ ] Tool results returned to LLM in original order
- [ ] Audit logging still captures every action
- [ ] No change to single-tool-call behavior

---

## 13b. Intelligent Memory System

**Problem:** All memories are pre-loaded into the system prompt. No relevance filtering, no on-demand retrieval, no structured types. After many conversations, the prompt bloats with stale context.

### Current state
- Domain memory: single JSON blob per domain, entire thing injected
- User memory: all rows (up to 50) injected grouped by category
- No vector search for memory retrieval
- Memory extraction happens post-conversation only (misses real-time corrections)

### Target state (inspired by Claude Code's memory architecture)

**Memory types (expanded):**
| Type | Priority | When loaded | Examples |
|------|----------|-------------|----------|
| `correction` | Critical | Always in system prompt | "Submit button is at bottom, not header" |
| `preference` | High | Always in system prompt (top 10) | "Always export as CSV" |
| `terminology` | High | Always in system prompt | "When I say 'report', I mean Weekly Sales Report" |
| `workflow` | Medium | On-demand via vector search | "To export invoices: filter → select all → export" |
| `domain_knowledge` | Medium | On-demand via vector search | "Session expires after 30 min idle" |
| `reference` | Low | On-demand via vector search | "Bug tracker is at linear.app/project/INGEST" |

**Memory index:** Each domain gets a concise memory summary (like Claude Code's `MEMORY.md`). Only the index is loaded into the system prompt. Detailed memories are fetched on-demand.

### Implementation

1. **Add memory relevance scoring:**
   - Score = `confidence * recency_weight * reinforcement_bonus`
   - `recency_weight` = 1.0 if used in last 7 days, decays to 0.3 after 90 days
   - `reinforcement_bonus` = 1 + (0.1 * timesReinforced), capped at 2.0
   - Only inject top-K memories (K=15) into system prompt, sorted by score

2. **Vector-search user memories at query time:**
   - Embed user's current message
   - Search `userMemory` embeddings for top 5 relevant memories
   - Inject only those into system prompt alongside always-loaded corrections/preferences
   - Add `userMemoryEmbeddings` or reuse `memoryEmbeddings` table with a `memoryType` discriminator

3. **Real-time memory saving:**
   - Update system prompt instructions to tell the agent: "When the user corrects you or expresses a preference, use `save_memory` immediately — don't wait"
   - Add `correction` as highest-priority category that's always loaded
   - Detect correction patterns in user messages (negation, "no", "actually", "not that") and prompt the agent to save

4. **Memory index per domain:**
   - After memory changes, regenerate a concise index (10-20 lines) summarizing what the agent knows
   - Store as `memoryIndex` column on `domainMemory` or separate table
   - Load only the index into system prompt; agent uses `recall_memory` tool for details

5. **Add `recall_memory` tool:**
   - Input: `{ query: string }` — natural language description of what to remember
   - Executes vector search across user + domain memories
   - Returns top 5 results with content and metadata
   - Agent calls this when it needs specific context not in the prompt

### Files to modify
- `apps/api/src/memory/user.ts` — Add relevance scoring, selective loading
- `apps/api/src/memory/domain.ts` — Add memory index generation
- `apps/api/src/agent/prompts.ts` — Selective memory injection, recall instructions
- `apps/api/src/tools/registry.ts` — Register `recall_memory` tool
- `apps/api/src/db/vector-search.ts` — Add user memory vector search
- `apps/api/src/db/schema.ts` — Add embedding columns/tables if needed
- `apps/api/src/llm/embeddings.ts` — Embed user memories in background

### Acceptance criteria
- [ ] Only top-K relevant memories injected into system prompt
- [ ] Corrections and preferences always loaded (high priority)
- [ ] Workflow and domain knowledge memories retrieved on-demand via vector search
- [ ] `recall_memory` tool available to the agent
- [ ] `save_memory` used in real-time during conversations (not just post-hoc)
- [ ] Memory index generated per domain, loaded instead of full memory dump
- [ ] System prompt token usage reduced by ~30%

---

## 13c. Multi-Agent Swarm

**Problem:** One orchestrator, one conversation, one tab. Can't parallelize across pages or apps.

### Architecture

```
Coordinator Agent (strong model, main tab)
  ├── Sub-Agent 1 (fast model, tab 2) → "Read invoice data from page A"
  ├── Sub-Agent 2 (fast model, tab 3) → "Find customer record on page B"
  └── Sub-Agent 3 (fast model, tab 4) → "Check inventory on page C"
```

### Implementation

1. **Extend WebSocket addressing to support multiple tabs:**
   - Current: `connectionId` → one extension instance
   - New: `connectionId` + `tabId` → specific tab within an extension
   - Extension opens background tabs for sub-agents, reports `tabId` per tab
   - `sendActionRequest(connectionId, tabId, action, args)`

2. **Add `spawn_agent` tool:**
   ```typescript
   {
     name: 'spawn_agent',
     description: 'Spawn a sub-agent to perform a task in a separate browser tab',
     parameters: {
       task: string,        // Natural language task description
       targetUrl: string,   // URL to navigate to
       timeout?: number,    // Max execution time (default 60s)
     }
   }
   ```
   - Creates a child orchestrator with:
     - Its own conversation context (isolated)
     - Shared domain + user memory (read-only)
     - Fast model (cost/speed optimization)
     - Max 5 iterations (sub-tasks should be small)
   - Returns structured result to coordinator

3. **Add `wait_for_agents` tool:**
   - Input: `{ agentIds: string[] }` — wait for specific sub-agents
   - Returns all results when complete (or errors on timeout)
   - Coordinator synthesizes results into final response

4. **Concurrency limits:**
   - Max 3 concurrent sub-agents per user
   - Max 5 iterations per sub-agent
   - 60-second timeout per sub-agent
   - Sub-agents cannot spawn their own sub-agents (no recursion)

5. **Result reporting:**
   - Sub-agent returns `{ success, data, error, actionsPerformed[] }`
   - Coordinator receives results, continues its own reasoning
   - All sub-agent actions logged in audit trail with `parentAgentId`

### Files to modify
- `apps/api/src/agent/orchestrator.ts` — Support sub-agent mode (reduced capabilities)
- `apps/api/src/agent/swarm.ts` — New: coordinator logic, sub-agent lifecycle
- `apps/api/src/tools/registry.ts` — Register `spawn_agent`, `wait_for_agents`
- `apps/api/src/ws/handler.ts` — Multi-tab addressing
- `packages/shared/src/types/messages.ts` — Add `tabId` to action messages

### Acceptance criteria
- [ ] Coordinator can spawn sub-agents via `spawn_agent` tool
- [ ] Sub-agents execute in separate browser tabs
- [ ] Sub-agents use fast model with reduced iteration limit
- [ ] Results aggregated and returned to coordinator
- [ ] Max 3 concurrent sub-agents enforced
- [ ] All sub-agent actions appear in audit log
- [ ] Sub-agents cannot spawn further sub-agents

---

## 13d. Embedding Improvements

**Problem:** Embeddings are a last-resort fallback for broken selectors. User memories aren't embedded. Conversation history isn't searchable. Provider switching breaks all embeddings.

### Implementation

1. **Embed user memories:**
   - On `save_memory` or post-conversation extraction, embed the memory content
   - Store in `memoryEmbeddings` table with `memoryType: 'user'` and `userId`
   - Use for on-demand retrieval in 13b

2. **Embed conversation messages for recall:**
   - New table: `conversationEmbeddings` (conversationId, messageId, embedding, createdAt)
   - Embed user messages (not assistant responses — those are derivative)
   - Background Inngest job: `message/created` → embed user message
   - New search function: `searchConversations(query, userId, limit)` → returns past conversation snippets
   - Powers "do that thing from last week" queries

3. **Proactive element validation via embeddings:**
   - Before executing a tool on a selector, quick-check: embed the LLM's intended label, compare with the element's stored embedding
   - If similarity < 0.7, warn the agent: "The element at this selector might not be what you expect"
   - Prevents wrong-element clicks without waiting for failure

4. **Provider migration on switch:**
   - Track `embeddingModel` per row (already done)
   - On startup, if configured model ≠ stored model, mark stale
   - Background job re-embeds stale entries in batches
   - Stale embeddings still usable (cosine similarity is model-dependent but better than nothing)

### Files to modify
- `apps/api/src/db/schema.ts` — Add `conversationEmbeddings` table
- `apps/api/src/db/vector-search.ts` — Add `searchConversations`, `searchUserMemories`
- `apps/api/src/llm/embeddings.ts` — Add stale detection, migration helper
- `apps/api/src/agent/orchestrator.ts` — Add element validation before execution
- Background jobs for embedding user memories and conversation messages

### Acceptance criteria
- [ ] User memories are embedded on save
- [ ] User messages embedded in background
- [ ] `searchConversations` returns relevant past conversations
- [ ] Element validation warns on low-similarity selector matches
- [ ] Provider switch triggers background re-embedding

---

## 13e. Learning Feedback Loops

**Problem:** The agent doesn't know if tasks succeeded. Flows don't self-repair. Memory extraction uses the cheap model and misses nuance. No cross-conversation pattern detection.

### Implementation

1. **Outcome tracking (thumbs up/down):**
   - Add `outcome` field to conversations: `success | failure | partial | null`
   - Extension UI: after agent finishes, show thumbs up/down
   - API endpoint: `POST /api/conversations/:id/outcome`
   - Associate outcome with memories extracted from that conversation
   - Reinforce memories from successful conversations, flag memories from failures

2. **Flow auto-repair:**
   - When a flow run adapts (different selectors, skipped steps, alternate navigation) and succeeds:
     - Diff the executed steps vs. recorded steps
     - If >1 step changed, prompt: "This flow adapted to work. Update the saved flow?"
     - On approval, update `flow.steps` with the new working version
   - Track `adaptations[]` on `flowRuns` for visibility

3. **Smart memory extraction:**
   - For conversations with corrections or failures: use strong model for extraction
   - For routine successful conversations: use fast model (current behavior)
   - Detection: scan user messages for correction signals ("no", "wrong", "actually", "not that", "instead")
   - Cost impact: minimal (<5% of conversations trigger strong model)

4. **Cross-conversation insights (batch job):**
   - Weekly Inngest job per domain: review last 20 conversations + outcomes
   - Extract high-level patterns: "Users frequently ask about X", "Y workflow fails often"
   - Store as `domain_knowledge` memories with high confidence
   - Prune domain memories that contradict new insights

### Files to modify
- `apps/api/src/db/schema.ts` — Add `outcome` to conversations, `adaptations` to flowRuns
- `apps/api/src/routes/conversations.ts` — Add outcome endpoint
- `apps/api/src/memory/user.ts` — Outcome-aware reinforcement
- `apps/api/src/agent/flow-executor.ts` — Track adaptations, offer auto-repair
- `apps/api/src/memory/domain.ts` — Cross-conversation batch insights

### Acceptance criteria
- [ ] Users can rate conversation outcomes (thumbs up/down)
- [ ] Outcome stored and associated with extracted memories
- [ ] Successful memories reinforced, failed memories flagged
- [ ] Flow adaptations tracked and auto-repair offered
- [ ] Strong model used for memory extraction on correction-heavy conversations
- [ ] Weekly batch job extracts cross-conversation domain insights

---

## 13f. Re-Indexing Improvements

**Problem:** No staleness detection, no scheduled re-indexing, re-indexing is all-or-nothing per page.

### Implementation

1. **Staleness check at conversation start:**
   - If `page.lastIndexedAt` > 24 hours, emit a `stale_index` SSE event
   - Agent's system prompt includes: "Page index may be outdated (last indexed X hours ago). Consider using `refresh_page_state` if elements seem wrong."
   - Don't force re-index (user may be on a page that rarely changes)

2. **Diff-based re-indexing:**
   - When extension sends `page_indexed`, compare new elements with stored elements
   - Only re-embed elements whose `labelHash` changed or are new
   - Delete embeddings for elements no longer on the page (already done)
   - Skip unchanged elements entirely

3. **Scheduled re-crawl (optional):**
   - Inngest cron job: weekly per site (configurable)
   - Sends WS message to extension: `{ type: 'recrawl', siteId }`
   - Extension re-crawls in background tabs (existing crawl logic)
   - Only runs if user has extension connected

### Files to modify
- `apps/api/src/routes/chat.ts` — Add staleness check
- `apps/api/src/agent/prompts.ts` — Include staleness warning
- `apps/api/src/ws/handler.ts` — Handle `page_indexed` with diff logic

### Acceptance criteria
- [ ] Stale index warning emitted when page index > 24 hours old
- [ ] Only changed elements re-embedded on re-index
- [ ] Optional scheduled re-crawl via Inngest

---

## 13g. Speed Optimizations

**Problem:** Unnecessary latency from token-heavy prompts, uncached provider instances, no prompt caching.

### Implementation

1. **Anthropic prompt caching:**
   - System prompt is largely static per domain session (same page context, same memories)
   - Add `cache_control: { type: 'ephemeral' }` to system prompt content blocks
   - First request pays full cost; subsequent requests within 5 min use cache
   - ~90% reduction in input token cost for multi-turn conversations

2. **In-memory domain memory cache:**
   - Cache `domainMemory` and `userMemory` query results in-process
   - TTL: 5 minutes (memory updates are background jobs, slight staleness is fine)
   - Invalidate on explicit `save_memory` calls
   - Saves 2 DB queries per conversation start

3. **Reduce system prompt size:**
   - Cap elements at 20 per type (currently 30)
   - Cap navigation links at 15 (currently 20)
   - Cap site pages at 10 most relevant (currently all pages)
   - With selective memory injection from 13b, further reduction

4. **Stream tool results incrementally:**
   - Currently: wait for all tools in a turn, then send results to LLM
   - New: as each tool completes, emit `tool_end` event to client immediately
   - Client sees progress in real-time even during parallel execution

### Files to modify
- `apps/api/src/llm/providers/anthropic.ts` — Add cache_control to system prompt
- `apps/api/src/routes/chat.ts` — Add in-memory caches
- `apps/api/src/agent/prompts.ts` — Reduce caps
- `apps/api/src/agent/orchestrator.ts` — Incremental tool result streaming

### Acceptance criteria
- [ ] Anthropic prompt caching enabled for system prompt
- [ ] Domain + user memory cached in-memory with 5 min TTL
- [ ] System prompt element/page caps reduced
- [ ] Tool results streamed as they complete

---

## Implementation Order

| Sub-phase | Dependency | Estimated effort |
|-----------|------------|------------------|
| 13a. Parallel Tool Calling | None | 1-2 days |
| 13g. Speed Optimizations | None | 1-2 days |
| 13b. Intelligent Memory | 13g (prompt size reduction) | 3-4 days |
| 13d. Embedding Improvements | 13b (user memory embeddings) | 2-3 days |
| 13e. Learning Feedback Loops | 13b (memory scoring) | 2-3 days |
| 13f. Re-Indexing Improvements | None | 1 day |
| 13c. Multi-Agent Swarm | 13a (parallel execution patterns) | 4-5 days |

Total: ~2-3 weeks

---

## Key Architectural Constraints

- **No new infrastructure.** Everything stays in Postgres + pgvector. No Redis, no separate vector DB.
- **Provider-agnostic.** All improvements must work across Anthropic, OpenAI, and Ollama.
- **Extension stays thin.** Sub-agent tab management happens in extension but reasoning stays on backend.
- **Backwards compatible.** Existing conversations, memories, flows, and embeddings continue to work.
- **No breaking API changes.** New SSE events are additive. New tools are additive.
