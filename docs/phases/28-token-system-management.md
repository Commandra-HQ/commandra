# Phase 28 — Token System Management

> Real token tracking from providers, per-model output budgets, cost analytics, smarter context management, live context indicators, and manual compaction. Replaces estimation-only system with actual usage data.

## Why

The token system ran on character-based estimation (`chars / 4`) and never captured real usage from provider responses:
1. **`agent_runs.tokensUsed` always 0** — no cost tracking per conversation, agent, or user
2. **Same output budget (8K) for all models** — wasteful for fast models, too small for reasoning models
3. **No pre-flight budget checks** — wasted tokens on `context_length_exceeded` errors
4. **Compaction race condition** — multiple iterations could trigger `autoCompact()` simultaneously
5. **Phase 3 trim dropped critical context** — "keep first + last 4" erased the core of long conversations
6. **No cost visibility** — users had zero insight into token spend
7. **No manual compaction** — users couldn't compact on demand, only auto at 80%
8. **Coordinator chats not tracked** — only named agents recorded usage in `agent_runs`

## What Shipped

### 28a. Real Token Usage from Providers
- `TokenUsage` interface + `emptyTokenUsage()` helper + `usage` event in `StreamEvent` union
- **Anthropic**: captures `input_tokens` + `cache_read/write` from `message_start`, `output_tokens` from `message_delta`
- **OpenAI**: captures usage from `response.completed` event including `input_tokens_details.cached_tokens`
- Orchestrator accumulates usage across all iterations via `accumulatedUsage`, returns in `OrchestratorResult`
- `collectStream()` also captures and returns `usage` in `ChatResponse`

### 28b. Per-Model Output Budgets
- `ModelCapabilities` interface with `contextWindow`, `maxOutputTokens`, `defaultOutputBudget`, `supportsThinking`, `defaultThinkingBudget`, `costPer1kInput`, `costPer1kOutput`, `charsPerToken`
- `ANTHROPIC_MODEL_CAPABILITIES`: 6 entries (haiku, sonnet, opus + full model IDs)
- `OPENAI_MODEL_CAPABILITIES`: 10 entries (gpt-4o, gpt-4.1, gpt-5, o3, o4-mini, etc.)
- `getModelCapabilities(provider, model)` with `DEFAULT_CAPABILITIES` fallback
- Orchestrator uses `capabilities.defaultOutputBudget` instead of hardcoded `8000`, `capabilities.defaultThinkingBudget` instead of `4000`, `capabilities.contextWindow * 0.8` instead of `if/else` provider checks
- Models that don't support thinking get `undefined` instead of a budget (prevents sending thinking params to non-thinking models)

### 28c. Cost Tracking & Analytics
- 8 new columns on `agent_runs`: `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `thinking_tokens`, `estimated_cost_usd` (numeric 10,6), `model`, `provider`
- `agent_runs.agentId` made nullable — coordinator chats record usage with `agentId: null`
- All chats (including coordinator) now insert `agent_runs` rows with full token breakdown
- `calculateCost()` utility: input cost + cache read (10%) + cache write (125%) + output cost
- 3 usage API endpoints on `/api/usage`:
  - `GET /summary` — total tokens + cost, filterable by date range + agent
  - `GET /by-agent` — per-agent breakdown, coordinator shown as "Coordinator"
  - `GET /by-conversation/:id` — per-conversation run detail
- Dashboard usage page: summary cards (runs, input tokens, output tokens, cost) + per-agent table
- "Usage" nav link in sidebar with Activity icon

### 28d. Compaction Safety
- Module-level `compactionLocks` Set prevents concurrent compaction per conversation
- `compactedThisRun` flag prevents repeated compaction in same orchestrator run
- Lock acquired before compact, always released in `finally` block

### 28e. Importance-Weighted Context Trimming
- `scoreMessageImportance()`: tool calls score 4, user messages 3, plain text 1, compaction summaries 0
- First message + last 4 always protected (score 10)
- Messages dropped lowest-score-first until under budget
- Placeholder inserted: `[Trimmed: N messages — last action was {toolName}]`

### 28f. Pre-flight Token Counting
- `countTokens()` added to `LLMProvider` interface (optional)
- Anthropic implements via free `/v1/messages/count_tokens` endpoint
- Orchestrator calls pre-flight when estimated context >60%; if actual >95%, trims before sending
- `CHARS_PER_TOKEN` now settable per-provider: 4.2 for Anthropic, 3.5 for OpenAI

### 28g. Live Context Indicator in Extension
- `usage_total` SSE event emitted at end of every orchestrator run with full `TokenUsage` + `estimatedCostUsd`
- **ContextSquare component**: square SVG progress indicator, fills clockwise from 12 o'clock, `text-foreground` color
- **Tooltip component**: portal-rendered to `document.body`, hover-triggered (150ms delay), opaque background via inline HSL
- Context bar in ChatTab: square indicator + `XK / YK` + info icon with detailed tooltip (input/output/cached/cost) + cost display
- Context estimated from loaded messages on history open (shows immediately without active orchestrator)

### 28h. Manual Compaction
- "Compact chat" in tab context menu (right-click tab → Minimize2 icon)
- `POST /api/chat/compact`: loads conversation messages, summarizes via fast model, saves transcript to S3 via `saveCompaction()`, deletes old messages, inserts compacted summary
- Extension: shows "*Compacting conversation...*" assistant message, replaces with styled summary on success, shows error on failure
- Context indicator updates after compaction

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/llm/types.ts` | `TokenUsage`, `ModelCapabilities`, `DEFAULT_CAPABILITIES`, `usage` StreamEvent, `countTokens` on LLMProvider |
| `apps/api/src/llm/index.ts` | Export new types, `getModelCapabilities()` |
| `apps/api/src/llm/providers/anthropic.ts` | `ANTHROPIC_MODEL_CAPABILITIES`, usage from `message_start`/`message_delta`, `countTokens()` |
| `apps/api/src/llm/providers/openai.ts` | `OPENAI_MODEL_CAPABILITIES`, usage from `response.completed` |
| `apps/api/src/agent/orchestrator.ts` | Per-model budgets, usage accumulation, compaction lock, pre-flight, `usage_total` SSE |
| `apps/api/src/agent/token-budget.ts` | `setCharsPerToken()`, importance-weighted Phase 3 |
| `apps/api/src/agent/self-improve.ts` | `calculateCost()`, extended `recordAgentRun()` with token breakdown + nullable agentId |
| `apps/api/src/agent/scheduler.ts` | Null guard for nullable `agentId` |
| `apps/api/src/db/schema.ts` | 8 new columns on `agentRuns`, nullable `agentId`, `numeric` import |
| `apps/api/src/routes/chat.ts` | Record usage for all chats, `POST /compact` endpoint |
| `apps/api/src/routes/usage.ts` | New: 3 usage API endpoints |
| `apps/api/src/server.ts` | Register `/api/usage` routes |
| `packages/shared/src/types/sse.ts` | `usage_total` SSE event type |
| `apps/extension/src/sidepanel/components/ContextSquare.tsx` | New: square progress indicator |
| `apps/extension/src/sidepanel/components/Tooltip.tsx` | New: portal-rendered tooltip |
| `apps/extension/src/sidepanel/tabs/ChatTab.tsx` | Context bar, tooltip, manual compact, history estimation |
| `apps/extension/src/sidepanel/tabs/use-chat-stream.ts` | `UsageTotal` type, `usage_total` handler |
| `apps/extension/src/sidepanel/layouts/HubLayout.tsx` | "Compact chat" in tab menu |
| `apps/web/app/(dashboard)/usage/page.tsx` | New: usage dashboard page |
| `apps/web/lib/queries/use-usage.ts` | New: TanStack Query hooks |
| `apps/web/components/sidebar.tsx` | "Usage" nav link |
| `apps/api/drizzle/0021_token_tracking.sql` | Migration: token columns |
| `apps/api/drizzle/0022_agent_runs_nullable.sql` | Migration: nullable agentId |

## Migration Notes

- Run `pnpm db:migrate` in `apps/api` to apply migrations 0021 + 0022
- Existing `agent_runs` rows retain `0` for new token columns — only new runs populate real data
- Coordinator runs now insert rows with `agentId: null`
