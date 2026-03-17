# Cleanup: What Was Removed and Why

## Flow System — Complete Removal

The flow system was an incomplete "record and replay" feature that was:
1. **Never shipped** — FlowsTab literally showed "Coming soon"
2. **Over-engineered** — ~1,237 lines of flow-specific code across 7+ files
3. **Tightly coupled** — Recording hooks embedded deep in the orchestrator and WS handler
4. **Strategically replaced** — Agents are a better abstraction for reusable automation

### Files Deleted (7 files, ~1,300 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `apps/api/src/agent/flow-executor.ts` | 480 | Flow execution engine |
| `apps/api/src/agent/recorder.ts` | 168 | Flow recording during chat |
| `apps/api/src/routes/flows.ts` | 345 | Flow REST API |
| `apps/api/src/inngest/functions/embed-flow.ts` | 53 | Background flow embedding job |
| `apps/extension/src/sidepanel/tabs/FlowsTab.tsx` | 15 | "Coming soon" placeholder |
| `apps/extension/src/content/recorder.ts` | 173 | Page-level action recorder |
| `packages/shared/src/types/flows.ts` | 61 | Flow type definitions |

### Code Removed from Modified Files

| File | What was removed |
|------|-----------------|
| `apps/api/src/server.ts` | flowRoutes import + registration, embedFlow inngest function |
| `apps/api/src/db/schema.ts` | flows, flowRuns, flowEmbeddings table definitions |
| `apps/api/src/agent/orchestrator.ts` | isRecording/recordStep import, recording integration block |
| `apps/api/src/routes/chat.ts` | Recording routes (/record/*), searchFlows, flow context enrichment |
| `apps/api/src/db/vector-search.ts` | FlowSearchResult interface, searchFlows() function |
| `apps/api/src/ws/handler.ts` | manual_action handler for recording |
| `apps/extension/src/sidepanel/App.tsx` | FlowsTab import + tab |
| `apps/extension/src/sidepanel/tabs/ChatTab.tsx` | Recording state, recording UI, save flow dialog, record button, flow SSE event handlers |
| `apps/extension/src/background/ws-client.ts` | flow_step_recorded message forwarding |
| `packages/shared/src/types/sse.ts` | 7 flow-related SSE event types |
| `packages/shared/src/index.ts` | flows.ts re-export |
| `apps/api/src/inngest/index.ts` | embedFlow export |
| `apps/api/src/scripts/backfill-embeddings.ts` | Flow backfill logic |

### Database Tables Dropped

- `flows` — Saved automation workflows
- `flow_runs` — Flow execution history
- `flow_embeddings` — pgvector embeddings of flow descriptions

## Orchestrator Split

The monolithic `orchestrator.ts` (1,183 lines) was split into 4 focused modules:

| New File | Lines | Extracted From |
|----------|-------|----------------|
| `orchestrator.ts` | ~300 | Main loop, streaming, iteration management |
| `internal-tools.ts` | ~280 | Tool definitions + handlers (save_memory, recall_memory, spawn_agent, wait_for_agents, save_to_local) |
| `token-budget.ts` | ~150 | estimateMessageChars(), trimMessagesForTokenBudget() |
| `tool-executor.ts` | ~280 | executeToolBlock(), handleToolCall(), partitionToolsBySafety() |

**Why split?** The orchestrator was approaching maintenance-breaking size. The split follows clear responsibility boundaries and makes each piece independently testable. The new orchestrator.ts also accepts agent context (instructions + tool filter), which was the main functional addition.
