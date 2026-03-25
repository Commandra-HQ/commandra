# Phase 26 — Token System Management

> Real token tracking from providers, per-model output budgets, cost analytics, and smarter context management. Replaces estimation-only system with actual usage data.

## Why

The token system runs on character-based estimation (`chars / 4`) and never captures real usage from provider responses. This means:
1. **`agent_runs.tokensUsed` is always 0** — no cost tracking per conversation, agent, or user
2. **Same output budget (8K) for all models** — wasteful for fast models, too small for reasoning models
3. **No pre-flight budget checks** — wasted tokens on `context_length_exceeded` errors that could be prevented
4. **Compaction race condition** — multiple iterations can trigger `autoCompact()` simultaneously
5. **Phase 3 trim drops critical context** — "keep first + last 4" erases the core of long conversations
6. **No cost visibility** — users and admins have zero insight into token spend

## What Ships

### 26a. Capture Real Token Usage from Providers

**Problem:** Both Anthropic and OpenAI return `usage` data on stream completion (`message_end`), but our streaming loops ignore it.

**Changes:**
- Add `usage` event type to `StreamEvent` in `apps/api/src/llm/types.ts`:
  ```typescript
  { type: 'usage', inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number, thinkingTokens?: number }
  ```
- **Anthropic adapter**: capture `usage` from `message_delta` event (contains `usage.input_tokens`, `output_tokens`). Emit `usage` StreamEvent.
- **OpenAI adapter**: capture `usage` from `response.completed` event. Emit `usage` StreamEvent.
- **Orchestrator**: accumulate usage across iterations. Store totals on conversation completion.
- **`recordAgentRun()`**: pass accumulated `tokensUsed` (input + output) — no longer always 0.

| File | Change |
|------|--------|
| `apps/api/src/llm/types.ts` | Add `usage` to `StreamEvent` union |
| `apps/api/src/llm/providers/anthropic.ts` | Emit `usage` event from `message_delta` |
| `apps/api/src/llm/providers/openai.ts` | Emit `usage` event from `response.completed` |
| `apps/api/src/agent/orchestrator.ts` | Accumulate usage per iteration, pass to `recordAgentRun()` |
| `apps/api/src/agent/self-improve.ts` | Accept and store real `tokensUsed` |

### 26b. Per-Model Output Budgets

**Problem:** `maxTokens: 8000` and `thinking.budgetTokens: 4000` are the same for every model. Fast models waste budget, reasoning models are constrained.

**Changes:**
- Add model capability metadata to provider layer:
  ```typescript
  interface ModelCapabilities {
    contextWindow: number       // e.g., 200_000, 1_000_000
    maxOutputTokens: number     // e.g., 4096, 8192, 64000
    defaultOutputBudget: number // what we request by default
    supportsThinking: boolean
    defaultThinkingBudget: number
    costPer1kInput: number      // USD
    costPer1kOutput: number     // USD
  }
  ```
- Define per-model defaults:
  | Model Class | Output Budget | Thinking Budget | Context Window |
  |-------------|--------------|-----------------|----------------|
  | Fast (Haiku, GPT-4o-mini) | 2,000 | 0 | 200K |
  | Strong (Sonnet, GPT-4o) | 8,000 | 4,000 | 200K |
  | Reasoning (Opus, o3, GPT-5) | 16,000 | 10,000 | 1M |
- Move `MAX_INPUT_TOKENS` from `if/else` in orchestrator to `ModelCapabilities.contextWindow` on the provider
- `AgentConfig.llm` overrides still take precedence (existing behavior preserved)

| File | Change |
|------|--------|
| `apps/api/src/llm/types.ts` | Add `ModelCapabilities` interface |
| `apps/api/src/llm/providers/anthropic.ts` | Export model capabilities map |
| `apps/api/src/llm/providers/openai.ts` | Export model capabilities map |
| `apps/api/src/llm/index.ts` | `getModelCapabilities(provider, model)` helper |
| `apps/api/src/agent/orchestrator.ts` | Use capabilities for output budget + context window |

### 26c. Cost Tracking & Analytics

**Problem:** No way to know how much any conversation, agent, or user costs.

**Changes:**
- New DB columns on `agent_runs`:
  ```sql
  ALTER TABLE agent_runs ADD COLUMN input_tokens integer DEFAULT 0;
  ALTER TABLE agent_runs ADD COLUMN output_tokens integer DEFAULT 0;
  ALTER TABLE agent_runs ADD COLUMN cache_read_tokens integer DEFAULT 0;
  ALTER TABLE agent_runs ADD COLUMN cache_write_tokens integer DEFAULT 0;
  ALTER TABLE agent_runs ADD COLUMN thinking_tokens integer DEFAULT 0;
  ALTER TABLE agent_runs ADD COLUMN estimated_cost_usd numeric(10,6) DEFAULT 0;
  ALTER TABLE agent_runs ADD COLUMN model text;
  ALTER TABLE agent_runs ADD COLUMN provider text;
  ```
- Cost calculation uses `ModelCapabilities.costPer1kInput/Output` with cache discount (Anthropic cached reads = 10% of input cost)
- New API endpoints:
  - `GET /api/usage/summary` — total tokens + cost for current user (filterable by date range, agent)
  - `GET /api/usage/by-agent` — breakdown per agent
  - `GET /api/usage/by-conversation/:id` — per-conversation detail
- Dashboard usage page showing token spend over time, per agent, per provider

| File | Change |
|------|--------|
| `apps/api/src/db/schema.ts` | Add columns to `agentRuns` |
| `drizzle/migrations/` | New migration |
| `apps/api/src/agent/self-improve.ts` | Populate all token columns + estimated cost |
| `apps/api/src/routes/usage.ts` | New route file for usage endpoints |
| `apps/web/app/(dashboard)/usage/page.tsx` | New dashboard page |
| `apps/web/lib/queries/use-usage.ts` | TanStack Query hooks for usage data |

### 26d. Compaction Safety

**Problem:** Multiple iterations can trigger `autoCompact()` simultaneously. If connection drops mid-compaction, transcript is lost.

**Changes:**
- Add in-memory compaction lock per conversation (simple `Set<string>` of conversation IDs currently compacting)
- Save transcript to S3 **before** replacing messages (already partially done — ensure atomicity)
- Skip compaction if lock is held — next iteration will pick it up
- Add compaction counter to prevent repeated compaction in same orchestrator run

| File | Change |
|------|--------|
| `apps/api/src/agent/orchestrator.ts` | Add compaction lock, save-before-replace |

### 26e. Smarter Context Trimming

**Problem:** Phase 3 trim ("keep first + last 4 messages") drops the middle of conversations, losing critical tool call context.

**Changes:**
- **Importance scoring** for messages during trim:
  - Tool call messages (both request and result): high priority — preserve these
  - User messages: high priority
  - Plain assistant text: lower priority
  - Already-compacted summaries: lowest priority
- When dropping messages, generate a 1-line summary per dropped message (via string truncation, not LLM — keep it fast)
- Insert `[Trimmed: N messages — last action was {toolName} on {target}]` placeholder
- Preserve all messages from current task/plan step (never trim active work)

| File | Change |
|------|--------|
| `apps/api/src/agent/token-budget.ts` | Importance-weighted Phase 3, summary placeholders |

### 26f. Pre-flight Token Estimation Improvement

**Problem:** `context_length_exceeded` wastes tokens on the failed call. Character-based estimation has ±20% error.

**Changes:**
- For **Anthropic**: use the free `/v1/messages/count_tokens` endpoint before sending when estimated context is >60% of limit
  - Only call pre-flight when close to budget — don't add latency to every request
  - Cache the system prompt token count (it doesn't change within a conversation)
- For **OpenAI**: no free counting endpoint — continue with char estimation but use provider-specific `CHARS_PER_TOKEN` (3.5 for OpenAI vs 4.2 for Anthropic)
- Move `CHARS_PER_TOKEN` from global constant to per-provider value in `ModelCapabilities`

| File | Change |
|------|--------|
| `apps/api/src/llm/providers/anthropic.ts` | Add `countTokens()` method using `/v1/messages/count_tokens` |
| `apps/api/src/llm/types.ts` | Add optional `countTokens` to `LLMProvider` interface |
| `apps/api/src/agent/orchestrator.ts` | Pre-flight check when >60% estimated context |
| `apps/api/src/agent/token-budget.ts` | Use per-provider chars-per-token |

## Implementation Order

1. **26a** first — foundation for everything else (usage data flows through the system)
2. **26b** next — per-model budgets use the same provider metadata
3. **26d** + **26e** together — both are orchestrator/trimming improvements
4. **26f** — builds on provider interface changes from 26b
5. **26c** last — requires 26a data flowing + schema migration, plus dashboard UI

## Files Modified (Summary)

| File | Phases |
|------|--------|
| `apps/api/src/llm/types.ts` | 26a, 26b, 26f |
| `apps/api/src/llm/index.ts` | 26b |
| `apps/api/src/llm/providers/anthropic.ts` | 26a, 26b, 26f |
| `apps/api/src/llm/providers/openai.ts` | 26a, 26b |
| `apps/api/src/agent/orchestrator.ts` | 26a, 26b, 26d, 26f |
| `apps/api/src/agent/token-budget.ts` | 26e, 26f |
| `apps/api/src/agent/self-improve.ts` | 26a, 26c |
| `apps/api/src/db/schema.ts` | 26c |
| `apps/api/src/routes/usage.ts` | 26c (new) |
| `apps/web/app/(dashboard)/usage/page.tsx` | 26c (new) |
| `apps/web/lib/queries/use-usage.ts` | 26c (new) |

## What This Does NOT Include

- **OpenAI prompt caching** — OpenAI handles caching automatically on their side, no client-side API needed
- **Per-tool token budgets** — premature; current pool-based approach works fine
- **Provider-specific tokenizers** (tiktoken) — adds dependency weight; pre-flight counting + better estimation covers 90% of the gap
- **Per-tool-execution checkpointing** — LangGraph pattern, significant complexity for marginal crash recovery benefit
- **Reflexion pattern** (feeding ERRORS.md into planning) — valuable but separate concern, not token management
