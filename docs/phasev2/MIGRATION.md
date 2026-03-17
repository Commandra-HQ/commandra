# Migration Guide: V1 (Flows) → V2 (Agents)

## What Changed

### Removed: Flow System
The entire flow system (record/replay workflows) has been removed:
- No more recording mode
- No more flow execution
- No more FlowsTab in the extension
- All flow-related database tables dropped

### Added: Agent System
Replaced with a full agent marketplace:
- Create agents with custom instructions, tool permissions, and domain scope
- Browse and install public agents from the marketplace
- Fork and customize existing agents
- Rate and review agents

## Database Migration

### Tables Dropped
- `flows`
- `flow_runs`
- `flow_embeddings`

### Tables Added
- `agents` — Agent definitions (instructions, tools, domains, etc.)
- `agent_installs` — Which users installed which agents
- `agent_ratings` — 1-5 star ratings with reviews
- `agent_embeddings` — pgvector embeddings for marketplace search

### Tables Modified
- `conversations` — Added `agent_id` FK to link conversations to agents

### Running Migrations
```bash
# The migrations are in apps/api/drizzle/
# 0012_drop_flows.sql — Drops flow tables
# 0013_agent_system.sql — Creates agent tables + adds agent_id to conversations

# If using Drizzle Kit:
cd apps/api
pnpm drizzle-kit push

# Or run manually against your database:
psql $DATABASE_URL < drizzle/0012_drop_flows.sql
psql $DATABASE_URL < drizzle/0013_agent_system.sql
```

## API Changes

### Removed Routes
- `POST /api/chat/record/start`
- `POST /api/chat/record/stop`
- `POST /api/chat/record/cancel`
- `GET /api/chat/record/status`
- `GET /api/flows`
- `GET /api/flows/:id`
- `POST /api/flows`
- `PUT /api/flows/:id`
- `DELETE /api/flows/:id`
- `POST /api/flows/:id/run`
- All other `/api/flows/*` routes

### Added Routes
- `GET /api/agents` — List user's agents
- `GET /api/agents/:id` — Agent detail
- `POST /api/agents` — Create agent
- `PUT /api/agents/:id` — Update agent
- `DELETE /api/agents/:id` — Delete agent
- `POST /api/agents/:id/publish` — Publish to marketplace
- `POST /api/agents/:id/fork` — Fork agent
- `GET /api/agents/marketplace` — Browse marketplace
- `POST /api/agents/:id/install` — Install agent
- `DELETE /api/agents/:id/install` — Uninstall
- `POST /api/agents/:id/rate` — Rate agent

### Modified Routes
- `POST /api/chat` — Now accepts optional `agentId` in request body

## Extension Changes

- FlowsTab replaced by AgentsTab
- Recording UI removed from ChatTab
- Record button removed from input bar
- `flow_step_recorded` and `recording_*` SSE events removed

## Shared Types Changes

- `packages/shared/src/types/flows.ts` — Deleted
- `packages/shared/src/types/agents.ts` — New (Agent, AgentInstall, AgentCategory types)
- `packages/shared/src/types/sse.ts` — Flow events removed (flow_step_recorded, recording_started, recording_stopped, flow_step_start, flow_step_end, flow_done, flow_adaptation)

## Orchestrator Changes

The orchestrator has been split into focused modules:
- `orchestrator.ts` — Main loop only (~300 lines)
- `internal-tools.ts` — Internal tool definitions + handlers
- `token-budget.ts` — Token budget management
- `tool-executor.ts` — Browser tool execution with safety

The orchestrator now accepts `agentInstructions` and `allowedTools` parameters for agent-aware operation.
