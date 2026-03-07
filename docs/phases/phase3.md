# Phase 3 — Chat (Single Page)

## Goal

User can chat with the agent about the current page. The agent receives the page's structural index (elements, navigation, page type) and responds intelligently — answering questions, describing what it sees, and suggesting plans. No browser actions yet — the agent talks, it doesn't act.

This is the first time the LLM touches the product.

## How It Works

```
User types: "What can I do on this page?"

Extension                          Backend (API)
────────                          ─────────────
1. Get current page index    →
   from content script
2. POST /api/chat             →   3. Receive message + page index
   { message, pageIndex,          4. Build system prompt with page context
     conversationId }              5. Call Claude (Anthropic SDK)
                              ←   6. Stream response back
7. Render streamed response
   in Chat tab
```

### What the agent knows (sent with each message)

- Page title, URL, page type (dashboard/form/table/etc.)
- All interactive elements: type, label, selector
- Navigation links on the page
- Element counts by type
- Conversation history

### What the agent does NOT know (never sent)

- Actual text content, data values, PII
- Screenshots (not in this phase)
- User credentials or cookies
- Other tabs or browser history

## What Ships

### Extension — Chat Tab UI

- Chat input at the bottom of the Chat tab (below the page index view)
- Message bubbles: user messages + agent responses
- Streaming response display (tokens appear as they arrive)
- Conversation persists in Dexie while on the same domain
- "New conversation" button
- Loading state while agent is thinking
- Page context indicator: shows which page/site the agent is looking at

### Backend — Chat Endpoint

- `POST /api/chat` — receives message, page index, conversation history
  - Authenticates via Clerk token (same as `/api/auth/me`)
  - Builds a system prompt injecting the page structure
  - Calls Claude via `@anthropic-ai/sdk` (streaming)
  - Returns streamed response (SSE or chunked)
  - Stores conversation + messages in Postgres

### Backend — Agent System Prompt

- Describes the agent's role: "You're an assistant that helps users interact with web applications"
- Injects the page index as structured context
- Instructs the agent to reference elements by label and type
- Tells the agent it can suggest actions but cannot execute them yet
- Keeps it concise — page structure only, no raw HTML

### Database

- Conversations created per user + domain
- Messages stored with role (user/assistant) and content
- Conversation linked to user via auth

## Technical Decisions

- **HTTP streaming (SSE), not WebSocket** — for chat. WebSocket is reserved for Phase 4 (browser actions) where we need bidirectional communication. Chat is request/response with streaming, SSE fits perfectly.
- **Anthropic SDK directly, not Agent SDK** — Phase 3 is simple chat, no tool use. The Agent SDK's agentic loop and MCP tools aren't needed until Phase 4. Using the raw SDK keeps it simple.
- **Conversation stored server-side** — Postgres, not just Dexie. The backend needs conversation history to maintain context across messages. Dexie caches the latest for fast UI rendering.
- **Page index sent per-message** — the page might change between messages. Always send current state so the agent has fresh context.
- **Haiku for simple queries, Sonnet for reasoning** — start with Sonnet for everything, optimize model selection later.

## Out of Scope

- Browser actions / tool use (Phase 4)
- MCP browser-bridge (Phase 4)
- WebSocket for agent ↔ extension (Phase 4)
- Safety classification (Phase 5)
- Screenshots / vision (later)
- Multi-page context (Phase 8)

## Implementation Order

1. **System prompt** — craft the prompt that injects page structure
2. **Chat endpoint** — `POST /api/chat` with auth, Claude call, streaming response
3. **Conversation storage** — save to Postgres (conversations + messages tables already exist)
4. **Extension chat UI** — input, message bubbles, streaming display
5. **Wire it up** — extension sends page index + message to API, renders streamed response
6. **Test** — chat about GitHub, localhost:3000, any real page

## How to Verify

1. `make dev` — start everything
2. Navigate to any site, open side panel
3. Index the page (or site)
4. Type a message like "What elements are on this page?"
5. See the agent respond with accurate description of the page structure
6. Ask "How would I create a new issue?" (on GitHub) — agent suggests steps using actual element labels
7. Messages persist — close and reopen panel, conversation is still there
8. Navigate to a different page — agent context updates
