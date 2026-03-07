# Phase 4 — Browser Actions

## Goal

The agent can execute real browser actions — clicking buttons, typing text, navigating pages. User sends a natural language instruction, the Agent SDK plans and executes steps using MCP tools that forward actions to the Chrome extension via WebSocket. An activity feed shows what the agent is doing in real-time.

This is where the agent goes from talking to doing.

## How It Works

```
User types: "Click the New Issue button and type 'Bug Fix' in the title"

Extension                          Backend (API)
--------                          -------------
1. WebSocket connected
                                   2. Receive chat message
                                   3. Agent SDK creates plan:
                                      - click_element("#new-issue-btn")
                                      - type_text("#title-input", "Bug Fix")
                                   4. MCP browser-bridge sends action
                                      over WebSocket
5. Receive action_request     <-
6. Execute DOM action
7. Send action_result         ->   8. Agent observes result
                                   9. Decides next step (agentic loop)
                                   10. Streams status + response to client
11. Activity feed updates
    in real-time
```

### The Agentic Loop

Unlike Phase 3 (single request/response), the agent now runs a loop:
1. **Plan** — decide what action to take
2. **Act** — call an MCP tool (which executes in the browser)
3. **Observe** — get the result back
4. **Replan** — decide if done or what to do next

This loop runs until the task is complete or the agent decides it can't proceed.

## What Ships

### Backend — Agent SDK Integration

- Replace raw `Anthropic.messages.create()` with Agent SDK for action conversations
- Simple chat (no tools needed) still uses raw SDK for speed
- Agent has access to MCP browser-bridge tools
- Agentic loop: plan -> tool_use -> observe -> replan

### Backend — MCP Browser Bridge (Real)

- MCP server exposing browser actions as tools:
  - `click_element` — click by selector
  - `type_text` — type into an input field
  - `navigate` — go to a URL
  - `select_option` — select a dropdown option
  - `get_page_state` — get current page structure
- Each tool call serialized over WebSocket to the extension
- Promise-based: tool call blocks until extension returns result (10s timeout)

### Backend — WebSocket Handler (Upgraded)

- Request/response pattern with correlation IDs
- Send `action_request` with unique ID, await matching `action_result`
- Auth: verify extension JWT on WS connection
- Track which connection belongs to which user

### Extension — WebSocket Client

- Connects to `ws://localhost:3002` on extension startup
- Auto-reconnects on disconnect
- Sends auth token on connect
- Handles `action_request` messages

### Extension — Action Executor

- Receives action requests from WebSocket
- Executes DOM operations:
  - click: `element.click()`
  - type: `element.focus()` + set value + dispatch input events
  - navigate: `window.location.href = url`
  - select: set `<select>` value + dispatch change event
  - get_page_state: run indexer, return result
- Returns success/failure + any extracted data

### Extension — Activity Feed

- New section in side panel showing agent actions in real-time
- Each action shows: type, target element label, status (pending/done/failed)
- Appended as actions happen via WebSocket messages
- Simple list, scrolls to latest

## Technical Decisions

- **Agent SDK for action conversations, raw SDK for simple chat** — the agentic loop overhead isn't worth it for "What's on this page?" questions. Detect intent: if the user asks to DO something, use Agent SDK. If they ask to KNOW something, use raw SDK.
- **Promise-based WS with correlation IDs** — each action gets a unique requestId. The bridge returns a Promise that resolves when the extension sends back `action_result` with the matching requestId. 10s timeout.
- **No safety gates yet (Phase 5)** — we classify actions but auto-approve everything in dev mode. Phase 5 adds the approval UI and kill switch.
- **Content script executes actions, not background** — the content script has direct DOM access. Action requests route through background -> content script -> DOM.
- **Activity feed via WS broadcast** — the same WebSocket that carries action requests also broadcasts status updates to the side panel.

## Out of Scope

- Safety approval UI / kill switch (Phase 5)
- Element selector / hover-to-highlight (Phase 6)
- Screenshots / vision (later)
- Multi-page navigation planning (Phase 8)
- Subagent dispatch (Phase 13)

## Implementation Order

1. **WebSocket client in extension** — connect on startup, auto-reconnect
2. **Action executor in extension** — handle action_request, execute DOM ops, return result
3. **Promise-based WS handler on backend** — correlation IDs, request/response
4. **MCP browser-bridge with real tools** — tool definitions, WS forwarding
5. **Agent SDK integration** — agentic loop with MCP tools
6. **Upgrade chat endpoint** — detect intent, route to Agent SDK or raw SDK
7. **Activity feed UI** — real-time action display in side panel
8. **Test end-to-end** — "Click the Sign In button" -> agent clicks it

## How to Verify

1. `make dev` — start everything
2. Navigate to any site, open side panel, index the page
3. Open browser console — should see "WebSocket connected"
4. Type "Click the [some button] button"
5. Watch the activity feed show the action being executed
6. See the button actually get clicked on the page
7. Agent confirms the action was completed
8. Try a multi-step: "Type 'hello' in the search box and press Enter"
