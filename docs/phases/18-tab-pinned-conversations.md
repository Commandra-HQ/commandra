# Phase 18 — Tab-Pinned Conversations & Background Execution

> Conversations stay bound to their originating tab. Tasks run in the background without interruption when the user switches tabs. Multi-agent swarms open and manage their own tabs independently.

## Why

Today the extension assumes "1 active tab = 1 conversation." This breaks in three ways:

1. **Chat clears on tab switch** — Switch from Gmail to Netflix mid-task → chat messages wiped, task lost. The `updateCurrentTab` handler detects a new domain and calls `setChatMessages([])`.

2. **Tool calls go to the wrong tab** — The WS action handler routes commands to the active tab. If the user switches to Netflix while a Gmail task runs, `click_element` fires on Netflix and fails with "element not found."

3. **User is blocked during long tasks** — A 2-minute multi-step plan on Gmail means the user can't browse anything else without killing the task. No parallel browsing.

The fix: conversations are pinned to tabs, not domains. Tool calls route to the pinned tab. The user can switch tabs freely while tasks run in the background.

---

## What Ships

### 18a. Tab-Pinned Conversations

**Problem:** Domain change clears chat. User loses context when switching tabs.

**Extension changes:**

1. **Track `originTabId` per conversation:**
   - When a chat starts (first message sent), capture `tabId` as `originTabId`
   - Store in conversation state: `{ conversationId, originTabId, domain }`
   - When user switches tabs, DON'T clear chat — keep the conversation visible
   - Show a subtle indicator: "Running on: Gmail (Tab 3)" in the header

2. **Remove domain-change chat clearing:**
   - Delete the `setChatMessages([])` call in `setDomain` handler
   - Instead, when domain changes and no conversation is active, show the new domain context
   - When domain changes and a conversation IS active, show a banner: "Task running on gmail.com — switch back or start a new chat here"

3. **Domain context follows the conversation, not the tab:**
   - `pageIndex` sent with messages comes from `originTabId`, not the active tab
   - Site data (pages, elements) loaded for the conversation's domain, not current domain

**Files:** `ChatTab.tsx`, `use-chat-stream.ts`

### 18b. Tab-Aware Tool Dispatch

**Problem:** WS actions execute on whatever tab is currently active.

**Backend changes (`ws/handler.ts`):**

1. **Route actions to a specific tab:**
   - `action_request` messages already include a `tabId` field in some cases (swarm uses it)
   - Extend ALL action requests to include `targetTabId`
   - The extension's background script routes to the correct tab via `chrome.scripting.executeScript({ target: { tabId } })`

2. **Orchestrator passes `originTabId`:**
   - `OrchestratorParams` gets a `tabId` field
   - `chat.ts` passes the `tabId` from the request body (extension sends it)
   - All tool executions include `tabId` in the WS message

**Extension changes (`background/ws-client.ts`):**

1. **Action router uses target tab:**
   - Currently: `chrome.scripting.executeScript` uses the active tab
   - Change: use `targetTabId` from the action request
   - Fallback: if `targetTabId` is missing or tab is closed, use active tab

2. **Extension sends `tabId` with chat requests:**
   - The side panel captures the active tab ID when starting a chat
   - Sends it in the POST /api/chat body alongside `message`, `pageIndex`, etc.

**Files:** `ws/handler.ts`, `orchestrator.ts`, `chat.ts`, `background/ws-client.ts`, `ChatTab.tsx`

### 18c. Background Task Indicator

**Problem:** User doesn't know a task is running when they switch tabs.

**Extension changes:**

1. **Badge on extension icon:**
   - When a task is running: show a colored badge (e.g., blue dot) on the extension icon
   - `chrome.action.setBadgeText({ text: '●' })` / `chrome.action.setBadgeBackgroundColor`
   - Clear badge when task completes or fails

2. **Side panel header shows background tasks:**
   - When viewing a different tab than the running task: show a persistent bar
   - "Task running on gmail.com — [View] [Stop]"
   - "View" switches back to the conversation
   - "Stop" sends the kill signal

3. **Notifications on completion:**
   - When a background task completes: `chrome.notifications.create()` with summary
   - Only if the user isn't looking at the conversation tab

**Files:** `ChatTab.tsx`, `background/ws-client.ts`, `background/index.ts`

### 18d. Multi-Conversation Support

**Problem:** Only one conversation can be active at a time.

**Extension changes:**

1. **Conversation registry:**
   - Track multiple active conversations: `Map<conversationId, { tabId, domain, status }>`
   - Side panel can show a list of active tasks
   - User can switch between conversations without losing state

2. **Parallel browsing:**
   - User starts a task on Gmail → switches to GitHub → starts a new task on GitHub
   - Both run in parallel, each pinned to its own tab
   - The side panel shows whichever conversation matches the current tab (or the most recent)

3. **Tab lifecycle:**
   - If the user closes the pinned tab: warn if task is active, offer to cancel or let it finish
   - If the tab navigates away (gmail.com → google.com): tool calls may fail, but the conversation continues — the agent should handle navigation back

**Files:** `ChatTab.tsx`, `use-chat-stream.ts`, `contexts/active-chats.ts`

### 18e. Swarm Tab Management Improvements

**Problem:** Sub-agents open tabs but they interfere with the user's browsing.

**Backend changes:**

1. **Background tab creation:**
   - `open_tab` already creates tabs, but they steal focus
   - Add `active: false` to `chrome.tabs.create` so tabs open in background
   - Group swarm tabs: `chrome.tabs.group()` to keep them organized

2. **Tab cleanup:**
   - Swarm already sends `close_tab` on completion
   - Add a safety net: if a sub-agent times out, ensure its tab is closed
   - Track all swarm-opened tabs and clean up on conversation end

3. **Tab reuse:**
   - If the agent needs to navigate to a URL it already has a tab for, reuse it
   - Reduces tab clutter for multi-step workflows

**Files:** `background/ws-client.ts`, `swarm.ts`

---

## Implementation Order

```
18a: Tab-pinned conversations     ── Extension only (stop clearing, track originTabId)
18b: Tab-aware tool dispatch       ── Extension + backend (route actions to correct tab)
18c: Background task indicator     ── Extension only (badge, banner, notifications)
18d: Multi-conversation support    ── Extension (conversation registry, parallel tasks)
18e: Swarm tab management          ── Extension + backend (background tabs, grouping, cleanup)
```

18a is the critical fix — stop clearing chat on tab switch. Can ship independently.
18b is required for correct behavior — without it, actions go to wrong tab.
18c is polish but high-impact — user needs to know something is running.
18d is the full vision — true parallel execution.
18e improves the existing swarm system.

**Recommended:** Ship 18a + 18b together (minimum viable fix), then 18c, then 18d + 18e.

---

## Architecture: How Tab Routing Works

```
User starts chat on Gmail (Tab 5)
    │
    ├── ChatTab captures: originTabId = 5, domain = "mail.google.com"
    │
    ├── POST /api/chat includes: { message, pageIndex, tabId: 5 }
    │
    ├── Orchestrator stores tabId, passes to tool execution
    │
    ├── Tool call: click_element("Send")
    │   └── WS action_request: { action: "click_element", selector: "...", targetTabId: 5 }
    │       └── Background script: chrome.scripting.executeScript({ target: { tabId: 5 } })
    │
    ├── User switches to Netflix (Tab 7)
    │   ├── Side panel shows: "Task running on Gmail (Tab 5) — [View] [Stop]"
    │   ├── Extension icon: blue badge
    │   └── Tool calls STILL go to Tab 5 (Gmail)
    │
    ├── User starts new chat on Netflix (Tab 7)
    │   ├── New conversation, new originTabId = 7
    │   ├── Gmail task continues in background on Tab 5
    │   └── Side panel shows Netflix conversation (Tab 7 is active)
    │
    ├── Gmail task completes
    │   ├── Notification: "Gmail task completed: Sent email to jayesh..."
    │   ├── Badge cleared (if no other running tasks)
    │   └── Conversation saved, viewable in history
    │
    └── User clicks notification → switches to Gmail conversation
```

---

## Key Design Decisions

1. **Conversations pin to tabs, not domains.** A tab can navigate between pages on the same domain — that's fine. If the tab navigates to a completely different domain, tool calls may fail but the conversation is preserved.

2. **The side panel shows the conversation for the current tab.** If no conversation exists for the current tab, show the empty state. Active background conversations are accessible via a banner or conversation list.

3. **Multiple conversations can be active simultaneously.** Each is independent — own tab, own SSE stream, own orchestrator run. The backend already supports this (each chat request creates its own SSE connection).

4. **Tab closure = task interruption, not destruction.** If the user closes a tab with an active task, the WS connection to that tab is lost. The orchestrator will get "element not found" errors and eventually stop. The conversation is preserved in the database.

5. **No server-side tab management.** The backend doesn't track browser tabs. It sends `targetTabId` in WS messages and the extension handles routing. This keeps the extension-as-thin-client principle.

---

## Files Modified/Created Summary

| File | Action | Sub-phase |
|------|--------|-----------|
| `apps/extension/src/sidepanel/tabs/ChatTab.tsx` | MODIFY — remove domain-change clearing, add originTabId tracking, background task banner | 18a, 18c, 18d |
| `apps/extension/src/sidepanel/tabs/use-chat-stream.ts` | MODIFY — pass tabId with messages | 18a, 18b |
| `apps/extension/src/sidepanel/tabs/chat-types.ts` | MODIFY — add tabId to ChatMessage type | 18a |
| `apps/extension/src/background/ws-client.ts` | MODIFY — route actions to targetTabId, background tab creation | 18b, 18e |
| `apps/extension/src/background/index.ts` | MODIFY — badge management, notifications | 18c |
| `apps/api/src/agent/orchestrator.ts` | MODIFY — accept and pass tabId | 18b |
| `apps/api/src/routes/chat.ts` | MODIFY — accept tabId from request body, pass to orchestrator | 18b |
| `apps/api/src/ws/handler.ts` | MODIFY — include targetTabId in action requests | 18b |
| `apps/api/src/agent/swarm.ts` | MODIFY — background tab creation, tab grouping | 18e |

---

## Verification

1. **No chat clearing:** Start chat on Gmail, switch to Netflix → chat messages still visible
2. **Tab-pinned actions:** Start chat on Gmail, switch to Netflix → Gmail task continues, clicks go to Gmail tab
3. **Background indicator:** Switch away from running task → see badge + banner
4. **Multi-conversation:** Start Gmail task, switch to GitHub, start GitHub task → both run in parallel
5. **Swarm tabs:** Multi-site task opens background tabs → tabs grouped, don't steal focus
6. **Tab close handling:** Close Gmail tab during task → task stops gracefully, conversation preserved
7. **Notification:** Background task completes → desktop notification with summary
