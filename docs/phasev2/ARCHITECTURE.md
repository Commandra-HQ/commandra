# Phase V2 Architecture

## Overview

Commandra V2 transforms the platform from a chat-based browser automation tool into an **agent marketplace platform**. Users can create, share, install, and run browser automation agents — each with their own personality, instructions, tool permissions, and domain scope.

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Chrome Extension (Thin Client)              │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐                 │
│  │ ChatTab   │  │ AgentsTab │  │ SettingsTab│                 │
│  │ (agent    │  │ (browse/  │  │            │                 │
│  │  picker)  │  │  create)  │  │            │                 │
│  └──────────┘  └───────────┘  └────────────┘                 │
│       │              │                                        │
│       ▼              ▼                                        │
│   WebSocket ◄──────────────────► REST API                     │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Backend (Hono + Node.js)                    │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │ Orchestrator │  │ Agent Routes │  │ Marketplace API  │    │
│  │ (agent-     │  │ (CRUD)       │  │ (search, install │    │
│  │  aware)     │  │              │  │  rate, fork)     │    │
│  └─────────────┘  └──────────────┘  └──────────────────┘    │
│         │                                                     │
│  ┌──────┴──────────────────────────────────────┐             │
│  │ Modular Orchestrator                         │             │
│  │  ├── orchestrator.ts   (main loop, ~300 LOC) │             │
│  │  ├── internal-tools.ts (memory, agents, IO)  │             │
│  │  ├── token-budget.ts   (context management)  │             │
│  │  └── tool-executor.ts  (safety + execution)  │             │
│  └──────────────────────────────────────────────┘             │
│                                                               │
│  ┌──────────────────────────────────────────────┐             │
│  │ Database (Postgres + pgvector)                │             │
│  │  agents, agent_installs, agent_ratings,       │             │
│  │  agent_embeddings, conversations (+agentId),  │             │
│  │  users, sites, pages, messages, memory, etc.  │             │
│  └──────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Dashboard (Next.js)                         │
│  ┌────────────┐  ┌───────────────┐  ┌──────────────────┐    │
│  │ My Agents  │  │ Marketplace   │  │ Agent Detail     │    │
│  │ (create,   │  │ (browse,      │  │ (view, edit,     │    │
│  │  manage)   │  │  install)     │  │  fork, rate)     │    │
│  └────────────┘  └───────────────┘  └──────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Agent-Aware Orchestrator

When a conversation is started with an `agentId`:

1. Agent instructions are **prepended** to the system prompt (before BASE_PROMPT)
2. Tool definitions are **filtered** to only agent-allowed tools (or all if `["*"]`)
3. Safety rules from the agent are merged with defaults (agents can relax review→safe but never blocked→safe)
4. The conversation is linked to the agent via `conversations.agentId`

```
POST /api/chat { message, pageIndex, agentId? }
  → Load agent if agentId
  → Build system prompt: agent.instructions + BASE_PROMPT + page context
  → Filter tools to agent.tools
  → Run orchestrator
  → Store conversation with agentId
```

## Key Design Decisions

- **Agents are instructions, not code.** An agent is a set of instructions + tool permissions + domain scope. No custom code execution.
- **Extension stays thin.** Agent logic (prompt building, tool filtering) happens entirely in the backend.
- **Privacy preserved.** Agents still execute in the user's browser. No server-side browsers.
- **Marketplace is opt-in.** Agents are private by default. Publishing to marketplace is an explicit action.
- **Fork, don't copy.** Forked agents track their lineage via `forkedFrom` FK.

## File Structure

```
apps/api/src/
├── agent/
│   ├── orchestrator.ts        # Main loop (~300 lines, agent-aware)
│   ├── internal-tools.ts      # save_memory, recall_memory, spawn_agent, etc.
│   ├── token-budget.ts        # Context window management
│   ├── tool-executor.ts       # Safety classification + browser tool execution
│   ├── planner.ts             # Plan parsing
│   ├── prompts.ts             # System prompt building
│   └── swarm.ts               # Multi-agent sub-agent management
├── routes/
│   ├── agents.ts              # Agent CRUD + marketplace API
│   ├── chat.ts                # Chat endpoint (agent-aware)
│   └── ...
├── db/
│   ├── schema.ts              # +agents, agent_installs, agent_ratings, agent_embeddings
│   └── vector-search.ts       # Element, conversation, user memory search
└── ...

packages/shared/src/types/
├── agents.ts                  # Agent, AgentInstall, AgentCategory types
├── sse.ts                     # Streaming events (flow events removed)
└── ...

apps/extension/src/sidepanel/tabs/
├── ChatTab.tsx                # Chat with agent picker
├── AgentsTab.tsx              # Agent management
└── SettingsTab.tsx            # Settings

apps/web/app/(dashboard)/
├── agents/
│   ├── page.tsx               # My Agents
│   └── [id]/page.tsx          # Agent Detail
├── marketplace/
│   └── page.tsx               # Agent Marketplace
└── ...
```
