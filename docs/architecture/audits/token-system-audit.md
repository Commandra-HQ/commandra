# Token System & Provider Layer Audit

> Audited 2026-03-22. Covers token budget management, provider abstraction, and comparison against industry best practices.

## Architecture Overview

The token system lives across:
- `apps/api/src/agent/token-budget.ts` — estimation, trimming, budget management
- `apps/api/src/agent/orchestrator.ts` — agentic loop, compaction triggers, context error recovery
- `apps/api/src/llm/providers/anthropic.ts` — Anthropic adapter with prompt caching
- `apps/api/src/llm/providers/openai.ts` — OpenAI adapter (Responses API)
- `apps/api/src/memory/conversation.ts` — conversation history compression
- `apps/api/src/storage/compaction-files.ts` — compaction transcript storage
- `apps/api/src/agent/self-improve.ts` — fast model usage for post-run analysis

---

## Current Token Lifecycle

```
1. USER INITIATES CHAT
   ├─ System prompt built (buildSystemPrompt)
   │  └─ Includes: identity, rules, page index, domain knowledge, agent skills, memory
   │     Size: ~5-15K chars (12-37K tokens)
   ├─ Conversation created in DB
   └─ User message stored

2. ORCHESTRATOR STARTS (runOrchestrator)
   ├─ Set MAX_INPUT_TOKENS based on provider (Anthropic: 800K, OpenAI: 120K, default: 200K)
   ├─ Compress history if >20 messages (via fast model summarization)
   ├─ Build currentMessages from chat history
   └─ Enter agentic loop

3. EACH ITERATION (while iterations < 15)
   ├─ BUDGET CHECK
   │  ├─ trimMessagesForTokenBudget(currentMessages)
   │  │  ├─ Phase 1: Strip old screenshots → keep last image only
   │  │  ├─ Phase 2: Truncate tool results > 2,000 chars
   │  │  └─ Phase 3: Drop old messages (keep first + last 4)
   │  ├─ estimateMessageChars(currentMessages + systemPrompt)
   │  ├─ Calculate contextPercent = usedTokens / MAX_INPUT_TOKENS
   │  ├─ Emit context_status event to client
   │  └─ IF contextPercent >= 80%:
   │     ├─ autoCompact(): summarize via fast model (500 tokens max)
   │     ├─ Save transcript to S3
   │     └─ Replace currentMessages with compacted version
   │
   ├─ LLM CALL
   │  ├─ model: strong or fast
   │  ├─ system: systemPrompt (with ephemeral cache on Anthropic)
   │  ├─ messages: currentMessages (trimmed)
   │  ├─ tools: applicable tools
   │  ├─ maxTokens: 8000 (fixed)
   │  └─ thinking: { budgetTokens: 4000 }
   │
   ├─ HANDLE CONTEXT ERROR
   │  └─ IF context_length_exceeded:
   │     ├─ aggressiveTrim(): keep last 2 messages, remove all images, truncate to 500 chars
   │     └─ Retry
   │
   └─ PROCESS TOOL CALLS → append results → continue loop

4. AFTER ORCHESTRATOR COMPLETES
   ├─ Save response to DB
   ├─ recordAgentRun({ tokensUsed: 0 })  ← NEVER POPULATED
   └─ analyzeAndImprove() via fast model (fire-and-forget)
```

---

## What's Working Well

1. **Multi-phase trimming**: Intelligent reduction (screenshots → results → messages) preserves context progressively
2. **Auto-compaction at 80%**: Prevents OOM by proactively compacting before hitting limits
3. **Provider abstraction**: Clean `LLMProvider` interface, no vendor SDK leakage outside adapter files
4. **Prompt caching**: `cache_control: { type: 'ephemeral' }` on Anthropic system prompt for ~90% input savings
5. **Error recovery**: Catches `context_length_exceeded` and retries with aggressive trim
6. **Fast/strong model split**: Fast model for summaries, self-improvement, skill extraction (~10x cheaper)
7. **Streaming**: Real-time SSE via async generators, provider-native streaming APIs

---

## Critical Issues

### 1. No Actual Token Usage Tracking

**Severity: HIGH**

`agent_runs.tokens_used` is always `0`. The system estimates tokens (~4 chars/token) but never captures real usage from provider responses. This means:
- No cost tracking per conversation/agent/user
- No way to detect estimation drift across providers
- Analytics are completely blind

**Fix:** Capture `usage.input_tokens` + `usage.output_tokens` from provider stream end events. Store in `agent_runs`. Display real vs estimated in UI.

### 2. Hardcoded Constants With No Per-Model Tuning

**Severity: HIGH**

| Constant | Value | Location | Problem |
|----------|-------|----------|---------|
| `maxTokens` (output) | 8,000 | orchestrator.ts:185 | Same for fast model (wasteful) and reasoning models (too small) |
| `thinking.budgetTokens` | 4,000 | orchestrator.ts:187 | Not validated against output budget; combined could exceed maxTokens |
| `IMAGE_TOKEN_ESTIMATE` | 2,000 flat | token-budget.ts:19 | Small screenshots ~200 tokens, large ~1,500 — wastes context budget |
| `CHARS_PER_TOKEN` | 4 | token-budget.ts:20 | Anthropic averages ~4.2, OpenAI varies — ±20% error |
| `MAX_INPUT_TOKENS` | Hardcoded by provider string | orchestrator.ts:100-107 | Should come from provider object, not `if/else` |
| `toolResultTruncation` | 2,000 chars | token-budget.ts:139 | Arbitrary; not tuned to content type |
| `compactionTrigger` | 80% | orchestrator.ts:156 | May be too late for large system prompts |
| `MAX_ITERATIONS` | 15 | orchestrator.ts:95 | Not configurable per agent |

**Fix:** Make output budget per-model (fast: 2K, strong: 8K, reasoning: 16K). Move context limits into provider objects.

### 3. Compaction Race Condition

**Severity: MEDIUM**

Multiple iterations could trigger `autoCompact()` simultaneously. It calls an LLM and saves to S3 — not atomic. If connection drops mid-compaction, transcript is lost with no rollback.

**Fix:** Add a compaction lock (in-memory flag per conversation). Save transcript to S3 before replacing messages.

### 4. Phase 3 Trim Loses Critical Context

**Severity: MEDIUM**

"Keep first + last 4 messages" drops everything in between. For a 15-iteration conversation, this erases the core of the task. No importance weighting.

**Fix:** Preserve messages containing tool calls over plain text. Summarize dropped messages instead of discarding.

### 5. Aggressive Trim Happens Too Late

**Severity: MEDIUM**

`context_length_exceeded` means tokens were already spent on the failed call. The retry works, but the wasted call is expensive.

**Fix:** Use Anthropic's free `/v1/messages/count_tokens` endpoint for pre-flight checks before sending.

### 6. No Prompt Caching for OpenAI

**Severity: LOW**

Anthropic gets ~70% savings on multi-turn via `cache_control`. OpenAI users pay full cost every message. No equivalent mechanism implemented.

---

## Provider Layer Issues

### Abstraction Quality

**Strengths:**
- Clean `LLMProvider` interface with consistent `AsyncIterable<StreamEvent>` contract
- Provider-specific streaming normalized to common event types
- No vendor SDK imports outside adapter files
- Model aliasing via `MODEL_MAP` is flexible

**Leaky spots:**

| Issue | Detail |
|-------|--------|
| OpenAI image splitting | Tool results with images must be manually split into separate messages — Anthropic doesn't need this |
| Thinking block inconsistency | Anthropic thinking signatures vs OpenAI reasoning summaries produce different `ContentBlock` shapes |
| Context limits hardcoded | Set by `if/else` on provider string in orchestrator, not queried from provider |
| Function call ID mapping | OpenAI's `item_id` vs `call_id` quirk embedded in provider code |

### Provider Comparison

| Feature | Anthropic | OpenAI | Impact |
|---------|-----------|--------|--------|
| Prompt Caching | Yes (90% savings) | No equivalent | Anthropic much cheaper for multi-turn |
| Extended Thinking | Native thinking blocks | Reasoning summaries | Different event streams |
| Image Estimation | 2000 tokens flat | 2000 tokens flat | Same overhead |
| Context Limit | 800K (1M available) | 120K (128K available) | Anthropic much larger |
| Function IDs | Simple `id` field | Complex `item_id` + `call_id` | Anthropic cleaner |
| Max Output | 8000 tokens/call | 8000 tokens/call | Same (should differ) |

---

## Comparison Against Industry Best Practices

Research sources: Anthropic "Building Effective Agents", OpenAI Agents SDK, LangGraph, CrewAI, AutoGen.

### Where We're Aligned or Ahead

| Area | Our Approach | Status |
|------|-------------|--------|
| File-based agent identity (SOUL.md/SKILLS.md) | Maps to semantic/episodic/procedural memory taxonomy | Ahead — cleaner than most frameworks |
| Safety classification (safe/review/blocked) | Matches read/write/destructive consensus | Industry standard |
| Agent-driven knowledge (agent decides what to save) | Better than background extraction | Trend direction |
| Hot + background memory (save_memory real-time, analyzeAndImprove post-exec) | Matches LangGraph's recommendation | Best practice |
| Orchestrator-workers with max depth 2 | No framework recommends deeper | Best practice |
| Thin client browser with WS tool routing | Stronger privacy than most | Ahead |
| Provider-agnostic abstraction | Clean interface, no SDK leakage | Best practice |
| Prompt caching on Anthropic | 90% input cost reduction | Best practice |
| Multi-phase context trimming | Progressive reduction preserving recency | Best practice |

### Where We're Behind

| Area | What We Do | What Leaders Do | Gap |
|------|-----------|-----------------|-----|
| Token counting | ~4 chars/token estimate | Anthropic: free `/v1/messages/count_tokens`; OpenAI: tiktoken | Use real tokenizers |
| Memory consolidation | Dedup + hard cap at 60 | CrewAI: similarity >0.85 → LLM decides keep/update/delete/insert | Need LLM-driven consolidation |
| Tool output guardrails | PreToolUse hooks only | OpenAI SDK: input + output + tool guardrails (can reject/modify results) | Add PostToolUse validation |
| Checkpointing | Compaction only at 80% | LangGraph: persist state after every tool execution for crash recovery | More granular state saves |
| Cost tracking | None | All production systems track per-conversation costs | Need cost multipliers per provider |
| Cache strategy | Single `cache_control` on system prompt | Anthropic recommends: up to 4 breakpoints at different TTLs | Optimize breakpoints |
| Rate limiting | None for agents | CrewAI: `max_rpm` per agent | Add for scheduled/autonomous agents |
| Error feedback loop | ERRORS.md written but not fed back | Reflexion pattern: last 3 errors as planning context | Feed errors into prompts |

### Missing Entirely

1. **Pre-flight token counting** — Anthropic's `/v1/messages/count_tokens` is free. Use before sending to compact proactively.
2. **Per-tool token budgets** — Large tools share the same pool. No early-exit if a tool would blow the budget.
3. **Quality scoring on learned entries** — Not all skills/learnings are equal. Importance weighting would improve prompt construction.
4. **Reflexion pattern** — ERRORS.md exists but isn't fed back into planning. Validated pattern: use last 3 errors as context.

---

## Prioritized Fixes

### P0 — Quick Wins, High Impact

1. **Capture real token usage** from provider responses → store in `agent_runs.tokens_used`
2. **Use Anthropic's free token counting endpoint** for pre-flight budget checks
3. **Optimize prompt cache breakpoints** — tools (1hr TTL), system prompt (5min), automatic for conversation tail
4. **Make output budget per-model** — fast: 2K, strong: 8K, reasoning: 16K

### P1 — Medium Effort, Fills Critical Gaps

5. **Implement LLM-driven consolidation** for SKILLS.md/LEARNINGS.md (code path exists but only does string dedup)
6. **Add cost tracking** — per-provider pricing multipliers, track per conversation/agent
7. **Wire up S3 cleanup** — delete folders on agent deletion, TTL for run logs, scratchpad cleanup after conversation
8. **Split storage buckets** — `agents` (persistent), `ephemeral` (scratchpad/compactions), `logs` (run logs with retention)

### P2 — Longer Term, Architectural

9. **Per-tool-execution checkpointing** for crash recovery (LangGraph pattern)
10. **PostToolUse output guardrails** that can reject/modify results before reaching the agent
11. **Feed ERRORS.md into planning** (Reflexion pattern — last 3 errors as context)
12. **Provider-specific tokenizers** (tiktoken for OpenAI, Anthropic counting API)
13. **Smart message prioritization** during trimming — preserve tool calls over plain text, use importance scoring
