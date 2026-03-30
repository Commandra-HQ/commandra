# Phase 27 — Fluid Tab Context (like Cursor's @file for browser tabs) [SHIPPED]

## Context

The agent is currently "pinned" to the tab where the first message was sent (`originTabId`). This causes:
- Agent stuck on Gmail tab even after user navigates to GitHub and starts a new chat
- Screenshots taken from wrong tab (extension literally switches to old tab, captures, switches back)
- pageIndex fetched from current tab but actions executed on pinned tab — selector mismatch
- No way for the agent or user to discover/switch between tabs

Cursor handles this by letting you `@mention` files freely and the agent has tools to list/search files. We need the same for browser tabs.

## What Ships

### 27a: Agent Tab Tools (backend + extension)

Three new browser tools the agent can call:

**`list_tabs`** — Returns all open browser tabs
- No parameters
- Returns: `[{ tabId, title, url, active }]`
- WS action: `chrome.tabs.query({ currentWindow: true })`, filter out chrome:// URLs

**`switch_tab`** — Changes the agent's target tab for subsequent actions
- Parameters: `{ tabId: number }`
- Updates the orchestrator's `context.tabId` for the rest of the conversation
- WS action: `chrome.tabs.update(tabId, { active: true })` + return new page state
- The agent calls this when it needs to work on a different tab

**`get_tab_state`** — Gets page state from a specific tab WITHOUT switching
- Parameters: `{ tabId: number }`
- Returns page elements/structure from that tab
- Useful for peeking at another tab's content

### Implementation:

**`apps/api/src/agent/tool-definitions.ts`:**
- Add `listTabsTool`, `switchTabTool`, `getTabStateTool` definitions
- Include in `buildToolList()` return array

**`apps/api/src/agent/internal-tools.ts`:**
- Add to `INTERNAL_TOOL_NAMES` set: `'list_tabs'`, `'switch_tab'`
- `handleListTabs()`: calls `sendActionRequest(connectionId, 'list_tabs', {})`
- `handleSwitchTab()`: calls `sendActionRequest(connectionId, 'switch_tab', { tabId })`, then updates context

**`apps/extension/src/background/action-handler.ts`:**
- Add `list_tabs` handler (before the tab-targeting block):
  ```
  chrome.tabs.query({ currentWindow: true })
  → filter out chrome://, about:, chrome-extension:// URLs
  → return [{ tabId, title, url, active }]
  ```
- Add `switch_tab` handler:
  ```
  chrome.tabs.update(tabId, { active: true })
  → wait 500ms for load
  → get page state from the new tab
  → return { success, pageState }
  ```

**`get_tab_state`** already exists as a browser tool — just needs to accept an explicit `tabId` parameter (currently uses context.tabId). Already handled by the tool registry's `targetTabId` injection.

### 27b: Remove rigid `originTabId` pinning

**`apps/extension/src/sidepanel/tabs/ChatTab.tsx`:**

Current behavior:
```typescript
if (!originTabId && tabId) {
  setOriginTabId(tabId);  // Pins FOREVER
}
const chatTabId = originTabId || tabId;
```

New behavior:
- Remove `originTabId` entirely
- Always send `tabId` (the current active tab) with messages
- The agent uses `list_tabs` and `switch_tab` when it needs a different tab
- Add `conversationTabs` state: tracks all tabs the agent has interacted with during this conversation (for display, not targeting)

Also fix `handleSend()` to always fetch `pageIndex` from the current active tab.

### 27c: Tab context bar in chat UI

**`apps/extension/src/sidepanel/tabs/chat-layout.tsx`:**

Add a small context bar above the chat input showing:
- Current tab: `📄 mastra.ai — Docs` (from current active tab)
- If agent switched tabs during conversation, show: `📄 mail.google.com → 📄 github.com`
- Clicking a tab chip in the context bar could show a tab list popover

This is informational only — the agent controls tab switching via tools.

### 27d: `@tab` mention in chat input

**`apps/extension/src/sidepanel/tabs/chat-layout.tsx`:**

When user types `@` in the chat input:
- Query all open tabs via `chrome.tabs.query()`
- Show a floating dropdown filtered by typing
- On select, insert `@[Tab Title](tabId:123)` into the message
- When sending, parse these mentions and include the referenced tabs' pageIndex in the message context
- Backend receives extra tab context and includes it in the system prompt

This lets the user say: "Compare the pricing on @[Notion — Pricing](tabId:5) with @[Confluence — Plans](tabId:8)"

### 27e: System prompt updates

**`apps/api/src/agent/prompts.ts`:**

Add to RULES_SECTION:
```
## Tab Management
You have access to ALL the user's browser tabs, not just the current one.
- **list_tabs**: See all open tabs (title, URL, tabId)
- **switch_tab**: Change your target tab for subsequent actions
- **get_tab_state**: Peek at another tab's page structure without switching

When the user refers to a different website or tab:
1. Call list_tabs to find the right tab
2. Call switch_tab to move there
3. Continue working on the new tab

You do NOT need to ask the user to switch tabs. Just switch yourself.
When starting a new task, you work on the user's currently active tab by default.
```

### 27f: Conversation tab tracking

**`apps/api/src/agent/orchestrator.ts`:**

Track which tabs the agent has interacted with during this conversation:
- On each tool call, record the `tabId` used
- Emit `tab_context` SSE event with list of active conversation tabs
- Frontend displays this in the context bar

---

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/agent/tool-definitions.ts` | Add list_tabs, switch_tab tool definitions |
| `apps/api/src/agent/internal-tools.ts` | Add handlers for list_tabs, switch_tab |
| `apps/extension/src/background/action-handler.ts` | Add list_tabs, switch_tab WS action handlers |
| `apps/extension/src/sidepanel/tabs/ChatTab.tsx` | Remove originTabId, always use active tab |
| `apps/extension/src/sidepanel/tabs/chat-layout.tsx` | Add tab context bar, @tab mention picker |
| `apps/extension/src/sidepanel/tabs/chat-types.ts` | Add tab-related types |
| `apps/api/src/agent/prompts.ts` | Add tab management instructions |
| `apps/api/src/agent/orchestrator.ts` | Track conversation tabs |

## Implementation Order

1. **27a** — Tab tools (list_tabs, switch_tab) — core functionality
2. **27b** — Remove originTabId pinning — fixes the stuck-tab bug
3. **27e** — System prompt updates — teaches agent to use new tools
4. **27c** — Tab context bar — shows user what tabs agent is using
5. **27d** — @tab mention picker — user-facing tab selection
6. **27f** — Conversation tab tracking — enriches context bar

## Verification

1. Start new chat → agent should target current active tab, not a previous conversation's tab
2. Ask agent to "list all my open tabs" → should return tab list
3. Say "go to the GitHub tab" → agent calls list_tabs, finds GitHub, calls switch_tab, continues there
4. Switch tabs manually and send a new message → agent should work on the NEW current tab
5. Context bar shows which tab the agent is working on
6. @tab mention: type `@` → see tab picker → select a tab → it's included in context
