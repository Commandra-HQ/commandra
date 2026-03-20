# Phase 4 — Browser Actions ✅

## Goal

The agent can execute real browser actions — clicking buttons, typing text, navigating pages. User sends a natural language instruction, the backend plans and executes steps using tool_use that forward actions to the Chrome extension via WebSocket. An activity feed shows what the agent is doing in real-time.

This is where the agent goes from talking to doing.

## How It Works

```
User types: "Click the New Issue button and type 'Bug Fix' in the title"

Extension                          Backend (API)
--------                          -------------
1. WebSocket connected + authed
                                   2. Receive chat message
                                   3. Claude (tool_use) creates plan:
                                      - click_element("#new-issue-btn")
                                      - type_text("#title-input", "Bug Fix")
                                   4. sendActionRequest over WebSocket
5. chrome.scripting.executeScript
   runs action in page context
6. Send action_result back    ->   7. Agent observes result
                                   8. Decides next step (agentic loop)
                                   9. Streams thinking + actions to user
10. Activity feed updates
    in real-time
```

### The Agentic Loop

Unlike Phase 3 (single request/response), the agent now runs a loop:
1. **Plan** — decide what action to take
2. **Act** — call a tool (which executes in the browser via WS)
3. **Observe** — get the result back
4. **Replan** — decide if done or what to do next

This loop runs until the task is complete or the agent decides it can't proceed (max 10 iterations).

## What Ships

### Backend — Agentic Loop with Tool Use

- `runAgentLoop` in `chat.ts` — while loop using Anthropic SDK's `tools` parameter
- Claude returns `tool_use` content blocks, backend executes them via WS, sends results back
- Simple chat (no tools needed) still uses `runSimpleChat` with streaming for speed
- Tool detection: if extension WS is connected, tools are available; otherwise chat-only

### Backend — Browser Tool Definitions

- Defined inline in `chat.ts` as Anthropic `Tool[]`:
  - `click_element` — click by CSS selector
  - `type_text` — type into an input field
  - `select_option` — select a dropdown option
  - `navigate` — go to a URL
  - `get_page_state` — get current page structure + elements
- No MCP server needed — plain Anthropic tool_use is sufficient for now

### Backend — WebSocket Handler

- Promise-based request/response with correlation IDs (`requestId`)
- `sendActionRequest()` sends action, returns Promise, resolves on matching `action_result`
- 10s timeout per action
- JWT auth on WS connection (`auth` message with token)
- `getConnectionByUser()` finds active connection for a user
- Status broadcasts (pending/done/failed) forwarded to extension for activity feed

### Extension — WebSocket Client

- Background service worker connects to `ws://localhost:3002` on startup
- Auto-reconnects on disconnect (3s delay)
- `chrome.alarms` keepalive (every 24s) prevents MV3 service worker termination
- Authenticates with stored JWT on connect

### Extension — Action Executor

- Actions execute via `chrome.scripting.executeScript` with inline functions
- Does NOT depend on content script being loaded (major reliability win)
- Each action function runs directly in the page's DOM context:
  - click: `querySelector` + `scrollIntoView` + `click()`
  - type: `focus()` + set value + dispatch input/change events
  - navigate: `chrome.tabs.update()` in background (not content script — avoids page unload)
  - select: set value + dispatch change event
  - get_page_state: lightweight inline indexer (elements, labels, selectors)

### Extension — Activity Feed

- Activity section in side panel above chat messages
- Shows last 5 actions with human-readable labels (Click, Type, Navigate, Read page)
- Status indicators: pending (yellow pulse), done (green check), failed (red X)
- Merges status updates — preserves action name/label when status changes

## Technical Decisions

- **Anthropic tool_use, not Agent SDK or MCP** — the agentic loop is a simple while loop with `tools` parameter. No need for Agent SDK or MCP protocol overhead. Can upgrade later if needed.
- **`chrome.scripting.executeScript`, not content script messaging** — content scripts may not be loaded (page loaded before extension, extension reloaded, etc.). Injecting inline functions via `chrome.scripting.executeScript` is reliable regardless of content script state.
- **Navigate in background, not content script** — `window.location.href` destroys the content script before it can respond. `chrome.tabs.update()` + `waitForTabLoad()` handles navigation cleanly.
- **MV3 keepalive via chrome.alarms** — service workers die after ~30s of inactivity, killing WS connections. A periodic alarm keeps the worker alive and reconnects if needed.
- **Promise-based WS with correlation IDs** — each action gets a unique requestId. The handler returns a Promise that resolves when the extension sends back `action_result` with the matching requestId. 10s timeout prevents hanging.
- **Tool availability = WS connection** — if `getConnectionByUser()` finds an active connection, tools are enabled. Otherwise falls back to chat-only (Phase 3 behavior).
- **No safety gates yet** — Phase 5 adds approval UI, classification, and kill switch. Phase 4 auto-executes all actions.

## Out of Scope

- Safety approval UI / kill switch (Phase 5)
- Element selector / hover-to-highlight (Phase 6)
- Screenshots / vision (later)
- Multi-page navigation planning (Phase 8)
- Subagent dispatch (Phase 13)

## Key Files

- `apps/api/src/routes/chat.ts` — tool definitions, agentic loop, simple chat fallback
- `apps/api/src/ws/handler.ts` — WS connection management, promise-based action requests
- `apps/extension/src/background/ws-client.ts` — WS client, action executor, keepalive
- `apps/extension/src/sidepanel/tabs/ChatTab.tsx` — activity feed UI
- `apps/extension/manifest.json` — added `alarms` permission

## How to Verify

1. `make dev` — start everything
2. Navigate to any site, open side panel, index the page
3. Service worker console should show `[AFE WS] Connected` and `Auth OK`
4. Type "Click the [some button] button"
5. Watch the activity feed show the action with status (pending -> done/failed)
6. See the button actually get clicked on the page
7. Agent confirms the action was completed
8. Try a multi-step: "Type 'hello' in the search box"
