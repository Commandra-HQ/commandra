---
name: Chat lifecycle bugs
description: Known issues with chat message persistence, tab tracking, and conversation continuity as of 2026-03-20
type: project
---

## Chat Lifecycle Bugs (Phase 18 WIP)

### Bug 1: `isActive` is false during tool execution
The `isActive` state tracks SSE stream status. When the first SSE stream completes (`done` event), `isActive` becomes false even though the orchestrator is still executing tools via WS. This means the "task is running" guards don't work between SSE streams.

**Why:** A single user message = 1 SSE stream. The stream ends when the orchestrator returns. But the orchestrator opens WS approval gates that block, and the next user message starts a new SSE stream. Between streams, `isActive` is false.

**Fix needed:** Track "conversation is active" separately from "SSE stream is active". A conversation is active as long as it has pending approvals or the plan status is `in_progress`.

### Bug 2: `done` event replaces live blocks with DB content
When SSE sends `done`, the extension navigates to `/chat/{convId}` which triggers `loadConversation()`. This replaces the live streaming blocks (thinking, tool calls, approval blocks) with whatever was saved to DB (just the final text). Live context is lost.

**Fix needed:** If we're already viewing this conversation (blocks exist), don't reload from DB on `done`. Just mark the stream as complete.

### Bug 3: Follow-up messages create new conversations
After `done` fires and the user sends a follow-up, the extension may create a new conversation instead of continuing the existing one, because the `externalConvId` routing doesn't reliably persist.

### Bug 4: `updateCurrentTab` fires too aggressively
`chrome.tabs.onUpdated` fires on every URL change, loading state change, etc. This causes rapid domain flips ("mail.google.com" → "newtab" → "mail.google.com") which is noisy and can interfere with state.

**Fix needed:** Debounce `updateCurrentTab` and ignore transient states (loading, chrome:// URLs).

### Bug 5: `originTabId` captured too late
The `originTabId` is captured when `handleSend` fires, but by then the active tab may have changed. The `tabId` sent with the chat request comes from the ChatTab's `tabId` state which tracks the current active tab, not the tab the user was on when they started typing.

**How to apply:** These bugs should be addressed in Phase 18 continuation. The tab-pinned architecture is correct but the implementation needs the fixes above.
