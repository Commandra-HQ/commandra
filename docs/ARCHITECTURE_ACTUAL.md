# Actual Architecture — What's Really Built

> The original `ARCHITECTURE.md` describes the planned architecture with Claude Agent SDK and MCP. This document describes what's actually implemented as of March 2026.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                             │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   CHROME EXTENSION                          │  │
│  │                                                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ Side Panel   │  │ Element      │  │ Content Script   │  │  │
│  │  │ React Chat   │  │ Selector     │  │ (DOM indexing +  │  │  │
│  │  │ Flows, Teach │  │ Overlay      │  │  action execute) │  │  │
│  │  └──────┬───────┘  └──────────────┘  └────────┬─────────┘  │  │
│  │         │                                      │            │  │
│  │         │ SSE (chat)    ┌──────────────────┐   │            │  │
│  │         └──────────────►│  Background SW   │◄──┘            │  │
│  │                         │  (WS client +    │                │  │
│  │                         │   action router) │                │  │
│  │                         └────────┬─────────┘                │  │
│  └──────────────────────────────────┼──────────────────────────┘  │
│                                     │ WebSocket                    │
└─────────────────────────────────────┼────────────────────────────┘
                                      │
┌─────────────────────────────────────┼────────────────────────────┐
│  BACKEND (Docker)                   │                             │
│                                     ▼                             │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    HONO HTTP SERVER                       │    │
│  │                                                          │    │
│  │  Routes:                                                 │    │
│  │  ├── POST /api/chat       → SSE streaming response       │    │
│  │  ├── POST /api/chat/record/start|stop                    │    │
│  │  ├── GET  /api/conversations                             │    │
│  │  ├── GET  /api/audit                                     │    │
│  │  ├── GET  /api/stats                                     │    │
│  │  ├── GET  /api/sites                                     │    │
│  │  ├── CRUD /api/memory                                    │    │
│  │  ├── CRUD /api/flows                                     │    │
│  │  └── POST /api/index      → page/element indexing        │    │
│  │                                                          │    │
│  │  Middleware: requireAuth (Clerk JWT validation)           │    │
│  └──────────────────┬───────────────────────────────────────┘    │
│                     │                                             │
│  ┌──────────────────▼───────────────────────────────────────┐    │
│  │               ORCHESTRATOR (Custom Agentic Loop)         │    │
│  │                                                          │    │
│  │  while (iterations < maxIterations):                     │    │
│  │    1. Check kill switch + abort signal                   │    │
│  │    2. Call LLM (streaming, with extended thinking)       │    │
│  │    3. Stream thinking + text to client via SSE           │    │
│  │    4. Collect tool calls from response                   │    │
│  │    5. For each tool call:                                │    │
│  │       a. Safety classification (safe/review/blocked)     │    │
│  │       b. Approval gate if review-level                   │    │
│  │       c. Execute tool via WS → extension                 │    │
│  │       d. Audit log to Postgres                           │    │
│  │       e. Record step if in teach mode                    │    │
│  │    6. Feed tool results back to LLM                      │    │
│  │    7. Loop until end_turn or max iterations              │    │
│  └──────────────────┬───────────────────────────────────────┘    │
│                     │                                             │
│  ┌──────────────────▼───────────────────────────────────────┐    │
│  │            LLM PROVIDER LAYER (Provider-Agnostic)        │    │
│  │                                                          │    │
│  │  Interface: LLMProvider { chat() → AsyncIterable<Event> }│    │
│  │                                                          │    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────────┐  │    │
│  │  │ Anthropic   │ │ OpenAI      │ │ (Planned)         │  │    │
│  │  │ Claude 4    │ │ GPT-4.1     │ │ Google, Bedrock,  │  │    │
│  │  │ + Thinking  │ │ o3/o4-mini  │ │ Azure, Ollama     │  │    │
│  │  └─────────────┘ └─────────────┘ └───────────────────┘  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────┐  ┌───────────────────────────────────┐     │
│  │  WebSocket Server │  │  TOOL REGISTRY (11 Browser Tools) │     │
│  │  (ws library)     │  │                                   │     │
│  │                   │  │  click, type, select, navigate,   │     │
│  │  Connections map  │  │  scroll, screenshot, get_state,   │     │
│  │  Action routing   │  │  extract_text, extract_table,     │     │
│  │  Approval flow    │  │  wait, go_back                    │     │
│  │  Kill switch      │  │                                   │     │
│  └──────────────────┘  │  + save_memory (internal tool)     │     │
│                         └───────────────────────────────────┘     │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    POSTGRES + pgvector                    │    │
│  │                                                          │    │
│  │  users, conversations, messages, audit_logs,             │    │
│  │  sites, pages, elements (+ embeddings),                  │    │
│  │  domain_memory, user_memory, flows, flow_steps           │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Custom Orchestrator Over Agent SDK

We built our own agentic loop instead of using Claude Agent SDK or LangChain. Reasons:

- **Provider-agnostic** — works with any LLM, not just Claude
- **Full streaming control** — we stream thinking, text, and tool events as SSE to the extension
- **Safety hooks built in** — classification + approval happen inside the loop, not as external middleware
- **Simpler** — ~300 lines of TypeScript, no framework dependencies

### 2. Direct WS Tool Dispatch Over MCP

Tools are dispatched via WebSocket directly to the extension, not through an MCP server. Reasons:

- One fewer abstraction layer
- Real-time bidirectional communication (tool request + approval in same channel)
- Extension is the only tool consumer — MCP's multi-consumer model adds no value here
- Can add MCP later if we need external tool sources

### 3. Extension as Thin Client

The extension does three things: index pages, execute actions, render UI. No LLM calls, no agent logic. This means:

- Extension updates don't require LLM changes
- Agent logic is testable without a browser
- Self-hosted users only need to configure the backend

### 4. SSE for Chat, WS for Tools

Chat responses stream via Server-Sent Events (HTTP). Tool dispatch uses WebSocket. This split exists because:

- SSE is simpler for unidirectional streaming (LLM → client)
- WS is needed for bidirectional tool dispatch (backend → extension → backend)
- Chat can work without WS (simple chat mode, no tool use)

---

## Data Flow: Chat Message

```
1. User types in extension side panel
2. Extension POST /api/chat (SSE stream)
   Headers: Authorization: Bearer <clerk_jwt>
   Body: { message, conversationId?, pageIndex?, selectedElements? }

3. API: Auth middleware extracts userId from JWT
4. API: Get or create conversation in Postgres
5. API: Save user message to messages table
6. API: Load conversation history (+ compress if long)
7. API: Load domain memory + user memory for context
8. API: Build system prompt (page index + selected elements + memories)

9. Orchestrator loop:
   a. Call LLM with system prompt + messages + tools
   b. Stream thinking deltas → SSE → extension (collapsible UI)
   c. Stream text deltas → SSE → extension (rendered as markdown... soon)
   d. Collect tool calls
   e. For each tool: classify → approve → execute via WS → log audit
   f. Feed tool results back to LLM
   g. Repeat until end_turn or max 15 iterations

10. API: Save assistant response to messages table
11. API: Background: extract domain memory + user memory from transcript
12. API: Send 'done' SSE event with conversationId
```

---

## Data Flow: Tool Execution

```
1. LLM returns tool_use block: click({ selector: "#export-btn" })

2. Orchestrator:
   a. Safety classify: "click on export button" → safe (auto-approved)
   b. Emit SSE: tool_start { toolName: "click", label: "export button" }

3. Tool Registry:
   a. Look up "click" handler
   b. Send WS message: { type: "action_request", action: "click", args: {...} }
   c. Wait for WS response from extension

4. Extension (background service worker):
   a. Receive WS action_request
   b. chrome.scripting.executeScript → inject clickInPage into tab
   c. Content script clicks element in DOM
   d. Return result via WS: { success: true }

5. Orchestrator:
   a. Log audit entry to Postgres
   b. Emit SSE: tool_end { toolName: "click", success: true }
   c. If recording: save step to in-memory session
   d. Return tool result to LLM for next iteration
```

---

## LLM Provider Layer

```typescript
// All providers implement this interface
interface LLMProvider {
  id: string;
  chat(params: ChatParams): AsyncIterable<StreamEvent>;
  supportsVision: boolean;
  supportsToolUse: boolean;
}

// Stream events are provider-agnostic
type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_signature'; signature: string } // Anthropic multi-turn
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialJson: string }
  | {
      type: 'tool_use_end';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: 'message_end'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' };
```

**Implemented:** Anthropic (Claude 4 Sonnet/Haiku/Opus + extended thinking), OpenAI (GPT-4.1, o3-mini)
**Planned:** Google Gemini, AWS Bedrock, Azure OpenAI, Ollama (local)

---

## Database Schema (Drizzle ORM)

| Table         | Purpose                          | Key Columns                                     |
| ------------- | -------------------------------- | ----------------------------------------------- |
| users         | User accounts (Clerk sync)       | id, clerkId, email, name                        |
| conversations | Chat sessions                    | userId, siteId, title                           |
| messages      | Chat messages                    | conversationId, role, content                   |
| audit_logs    | Every tool execution             | userId, action, safetyLevel, approved, metadata |
| sites         | Indexed web applications         | userId, domain, totalPages, totalElements       |
| pages         | Page structure                   | siteId, url, title, pageType                    |
| elements      | Interactive elements             | pageId, selector, tag, label, embedding         |
| domain_memory | Per-domain learned knowledge     | domain, knownPages, workflows, appNotes         |
| user_memory   | Per-user preferences/corrections | userId, domain, category, content, source       |
| flows         | Recorded/saved automations       | userId, siteId, name, description               |
| flow_steps    | Steps within a flow              | flowId, index, intent, toolName, args           |

---

## Security Model

1. **No credentials leave the browser** — extension has the authenticated session, backend never sees cookies/tokens
2. **No raw page content sent to backend** — only page structure (element types, labels, selectors)
3. **Screenshots configurable** — can be disabled for sensitive environments
4. **Safety classification pre-execution** — every tool call classified before running
5. **Audit logging post-execution** — every tool call logged with args + result
6. **Kill switch** — Escape key or API call halts all agent activity immediately
7. **User approval gates** — destructive/write actions require explicit approval via WS
