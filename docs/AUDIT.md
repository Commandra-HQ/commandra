# Platform Audit — March 2026

Comprehensive audit of what's built, what works, what's broken, and what's next.

---

## Architecture Reality vs Docs

The original docs reference "Claude Agent SDK" and "MCP Browser Bridge." Neither is used. The actual implementation:

- **Custom orchestration layer** (`apps/api/src/agent/orchestrator.ts`) — our own agentic loop with streaming, tool dispatch, safety classification, and multi-turn thinking
- **Provider-agnostic LLM layer** (`apps/api/src/llm/`) — adapters for Anthropic + OpenAI, with pluggable Google/Bedrock/Ollama slots
- **Direct WebSocket tool dispatch** (`apps/api/src/tools/registry.ts`) — tools send WS messages to extension, no MCP layer
- **No subagents yet** — single coordinator agent, no parallel sub-agents

This is actually better for our purposes — simpler, no vendor lock-in, full control over the loop.

---

## What's Built & Working

### Core Chat Loop

| Component                        | Status  | Notes                                                     |
| -------------------------------- | ------- | --------------------------------------------------------- |
| Orchestrator agentic loop        | Working | Multi-turn tool use, plan detection, abort/kill switch    |
| Anthropic provider + streaming   | Working | Extended thinking, signatures, multi-turn                 |
| OpenAI provider + streaming      | Working | Fixed `max_completion_tokens`, no reasoning streaming yet |
| SSE streaming to extension       | Working | Thinking deltas, text deltas, tool events, plans          |
| Block-based chat UI              | Working | Thinking (collapsible), text, tool calls, plans, blocked  |
| Conversation persistence         | Working | Conversations + messages saved to Postgres                |
| Conversation history compression | Working | Auto-summarizes long histories before sending to LLM      |

### Browser Tools (11 tools)

| Tool              | Status  | Notes                                                       |
| ----------------- | ------- | ----------------------------------------------------------- |
| click             | Working | Fixed — inlined findElement for chrome.scripting context    |
| type              | Working | Same fix as click                                           |
| select (dropdown) | Working | Same fix                                                    |
| navigate          | Working |                                                             |
| scroll            | Working |                                                             |
| screenshot        | Working | Vision support for Anthropic, falls back to text for OpenAI |
| get_page_state    | Working | Returns page structure                                      |
| extract_text      | Working |                                                             |
| extract_table     | Working |                                                             |
| wait              | Working |                                                             |
| go_back           | Working |                                                             |

### Safety & Audit

| Component               | Status  | Notes                                            |
| ----------------------- | ------- | ------------------------------------------------ |
| Safety classifier       | Working | safe/review/blocked classification pre-execution |
| Approval gates (review) | Working | WS-based approval request/response               |
| Blocked actions         | Working | Returns error to LLM, emits blocked event        |
| Audit logging           | Working | 99 logs in DB — writes on every tool execution   |
| Kill switch             | Working | Escape key in extension, checked each iteration  |

### Database (Postgres + pgvector)

| Table         | Status  | Data                                   |
| ------------- | ------- | -------------------------------------- |
| users         | Working | User records via Clerk sync            |
| conversations | Working | 30 conversations                       |
| messages      | Working | All chat messages persisted            |
| audit_logs    | Working | 99 entries                             |
| sites         | Working | 12 sites indexed                       |
| pages         | Working | Page structure stored                  |
| elements      | Working | Element data with embeddings           |
| domain_memory | Working | Per-domain learned knowledge           |
| user_memory   | Working | Schema exists, extraction logic exists |
| flows         | Working | Recorded flows persist                 |
| flow_steps    | Working | Steps saved on flow completion         |

### Dashboard (apps/web)

| Page       | Status      | Notes                                                 |
| ---------- | ----------- | ----------------------------------------------------- |
| Home/Stats | BROKEN      | Auth mismatch — sends x-user-id instead of Bearer JWT |
| History    | Should work | Uses proper Clerk auth tokens                         |
| Audit Logs | Should work | Uses proper Clerk auth tokens                         |
| Sites      | Should work | Uses proper Clerk auth tokens                         |
| Memory     | Should work | Uses proper Clerk auth tokens                         |
| Settings   | Working     | Provider config, API keys                             |

### Extension UI

| Feature                        | Status    | Notes                                    |
| ------------------------------ | --------- | ---------------------------------------- |
| Chat tab                       | Working   | Block-based rendering, streaming         |
| Thinking streaming (Anthropic) | Working   | Collapsible, auto-expand while streaming |
| Thinking streaming (OpenAI)    | NOT BUILT | OpenAI reasoning tokens not handled      |
| Markdown rendering             | NOT BUILT | Raw text with whitespace-pre-wrap        |
| Element selector               | Working   | Point-and-click overlay                  |
| Flows tab                      | Working   | Lists saved flows, can replay            |
| Settings tab                   | Working   | Auth, memory count, provider config      |
| Plan UI                        | Working   | Expandable plan steps with status        |

---

## What's Broken

### 1. Dashboard Stats Show 0 (Critical)

**Location:** `apps/web/app/(dashboard)/page.tsx:10-11`
**Root cause:** Dashboard home page sends `x-user-id` header instead of `Authorization: Bearer <JWT>`. API's `requireAuth` middleware returns 401. Dashboard silently falls back to 0.
**Fix:** Use Clerk `getToken()` and send as Bearer token, same as other dashboard pages do.

### 2. Recording Shows 0 Steps (Critical)

**Location:** `apps/api/src/routes/chat.ts:35`
**Root cause:** `startRecording()` receives `async () => {}` as `onEvent` callback. Steps DO get recorded in the in-memory `recordings` Map, but `flow_step_recorded` SSE events are never emitted to the extension. The extension's `ChatTab` listens for these events but never receives them.
**Fix:** Pass the actual SSE event emitter as the `onEvent` callback, or emit step events through the existing chat SSE stream.

### 3. Memory Rarely Populates (Medium)

**Location:** `apps/api/src/routes/chat.ts:201-217`, `apps/api/src/memory/user.ts`
**Root cause:** Auto-extraction only fires when `domain && fullResponse.length > 50`. The LLM extraction often returns empty arrays for short conversations. Explicit `save_memory` requires the agent to proactively decide to save (rare without user prompting).
**Fix:** Lower threshold, improve extraction prompt, or trigger extraction more aggressively. Consider saving memories from every conversation that includes tool use.

### 4. Chat Doesn't Render Markdown (UX)

**Location:** `apps/extension/src/sidepanel/tabs/ChatTab.tsx` — text block rendering
**Root cause:** Uses plain `whitespace-pre-wrap` div. No markdown parser.
**Fix:** Add `react-markdown` with appropriate styling.

### 5. OpenAI Reasoning Tokens Not Streamed (Feature Gap)

**Location:** `apps/api/src/llm/providers/openai.ts`
**Root cause:** Provider doesn't handle OpenAI reasoning content in stream responses. Only `content` and `tool_calls` deltas are processed.
**Fix:** Handle reasoning content from o-series and reasoning-enabled models, yield as `thinking_delta` events.

### 6. Outdated Docs (Housekeeping)

**Location:** `docs/ARCHITECTURE.md`, `docs/TECH_STACK.md`
**Root cause:** Docs reference Claude Agent SDK and MCP Browser Bridge. Neither is used. Actual implementation is custom orchestrator + direct WS tool dispatch.
**Fix:** Update docs to reflect actual architecture.

---

## Data in Database (Verified)

```
conversations: 30 rows
audit_logs:    99 rows
sites:         12 rows
user_memory:   0 rows (extraction rarely triggers)
domain_memory: unknown (same issue)
flows:         unknown (recording UI broken, but save might work)
```

The data IS there. The dashboard just can't read it due to auth issues.

---

## What's Next (Priority Order)

1. **Fix dashboard auth** — one-line fix, unlocks all dashboard pages
2. **Fix recording SSE events** — wire up the onEvent callback
3. **Add markdown rendering** — add react-markdown to extension
4. **Stream OpenAI reasoning** — handle reasoning tokens in provider
5. **Improve memory extraction** — lower threshold, better prompts
6. **Update docs** — reflect actual architecture
7. **Phase 11: Tasks + Scheduling** — next major feature phase
