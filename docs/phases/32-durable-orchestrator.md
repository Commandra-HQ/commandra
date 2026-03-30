# Phase 32 — Durable Orchestrator

> Decouple the orchestrator lifecycle from the SSE connection. Server-side reasoning continues when the user closes the side panel. Browser tool calls pause (not crash) when the extension disconnects. Users can close and reopen the extension and pick up where they left off.

## Why

The orchestrator was tightly coupled to the HTTP request's `AbortSignal`. When a user closed the side panel, `signal.aborted` fired and the orchestrator immediately broke out of its loop — even for pure server-side work (LLM reasoning, planning) that doesn't need the browser. Partial assistant responses were lost because they were only saved to DB after full completion. This made the product unusable for any task longer than the user's attention span.

**Before:**
```
POST /api/chat → streamSSE → runOrchestrator(signal: HTTP abort) → save on completion
HTTP close → signal.aborted → orchestrator dies → partial response lost
```

**After:**
```
POST /api/chat → create Run → launch orchestrator (own AbortController) → SSE subscribes to Run
HTTP close → SSE unsubscribes → orchestrator continues
User presses Stop → Run.abort() → orchestrator stops cleanly
Browser tool needed but extension gone → orchestrator PAUSES → resumes on WS reconnect
```

---

## 32a. Run Registry — `apps/api/src/agent/run-registry.ts`

New module that manages active orchestrator runs independently of SSE connections.

### ActiveRun Interface

Each run tracks:
- **AbortController** — durable signal owned by the run, not the HTTP request. Only fires on explicit user Stop.
- **Event buffer** — all SSE events since run start. Replayed on reconnect.
- **SSE subscribers** — Set of SSE stream writers. Multiple viewers can watch the same run.
- **Pause promise** — blocks the orchestrator when extension disconnects, resolves on WS reconnect.
- **Incremental persistence** — partial response flushed to DB every 10 seconds.
- **Completion promise** — resolves when run finishes. SSE subscribers race this against HTTP disconnect.

### Key Functions

| Function | Purpose |
|----------|---------|
| `createRun()` | Creates run, sets conversation status to `running`, starts periodic flush |
| `getRun()` / `getRunByUser()` | Lookups by conversationId or userId |
| `killRun()` | Fires AbortController, resolves pause promise, sets status `failed` |
| `completeRun()` | Final DB save, resolves completion promise, cleanup after 5s delay |
| `subscribeSSE()` | Adds an SSE writer as subscriber, returns unsubscribe function |
| `createDurableOnEvent()` | Returns an `onEvent` callback that buffers events + fans out to subscribers |
| `pauseForBrowser()` | Returns Promise that blocks until `resumeRun()` is called |
| `resumeRun()` | Resolves pause promise, updates status to `running` |
| `updateConnectionId()` | Updates the run's connectionId after WS reconnect |
| `saveFinalMessage()` | Replaces partial message with final version in DB |
| `resetStaleRuns()` | On server startup, resets stale `running`/`paused` conversations to `idle` |

---

## 32b. SSE as a Viewer — `apps/api/src/routes/chat.ts`

The SSE stream is no longer the orchestrator's owner — it's just a viewport.

### New Flow

1. Check if a run already exists for this conversation (reconnection case)
2. If not, create a new run and launch the orchestrator as a **detached promise**
3. Subscribe the SSE stream to the run's event buffer
4. Replay any buffered events (handles reconnection seamlessly)
5. Wait for either: run completes OR HTTP disconnects
6. On HTTP disconnect: unsubscribe only, do NOT abort the run

### Post-Orchestrator Logic

Moved out of the SSE callback into the detached promise's `.then()` handler:
- Save final assistant message to DB (replaces partial)
- Record agent run
- Trigger self-improvement (`analyzeAndImprove`)
- Extract user memory
- Sync domain knowledge
- Auto-agent suggestion

### New Endpoint: `GET /api/chat/subscribe/:conversationId`

Allows the extension to reconnect to a running conversation's SSE stream:
- Replays all buffered events from the current run
- Subscribes for live events going forward
- Returns `{ status: 'idle' }` JSON if no active run exists

---

## 32c. Pause/Resume at Browser Tool Boundaries

### Orchestrator Pause — `apps/api/src/agent/orchestrator.ts`

Before `processToolCalls`, the orchestrator checks if the extension is connected:
```
if (hasToolUseBlocks && !getConnectionByUser(userId)) → pause
```

The orchestrator blocks at a Promise that resolves when `resumeRun()` is called (triggered by WS reconnect). After resume, it re-checks the abort signal (in case user killed during pause) and gets a fresh `connectionId`.

### Dynamic connectionId — `apps/api/src/agent/browser-tools.ts`

After pause/resume, the WS connection ID changes (new connection). `executeToolBlock` now looks up fresh `connectionId` from the run registry before routing to browser tools:
```ts
const freshConnectionId = getRun(conversationId)?.connectionId || getConnectionByUser(userId) || connectionId;
```

### WS Handler Resume — `apps/api/src/ws/handler.ts`

After successful WS authentication:
1. Check if this user has a paused run via `getRunByUser()`
2. If so, call `updateConnectionId()` then `resumeRun()` — the orchestrator unblocks
3. On `kill` message, also call `killRun()` to fire the durable AbortController

---

## 32d. Incremental Persistence

### Periodic Flush

Every 10 seconds while a run is active, the registry flushes the current partial response to the `messages` table:
- First flush: INSERT a new assistant message with `toolData: { partial: true }`
- Subsequent flushes: UPDATE the same row with accumulated content
- On completion: `saveFinalMessage()` replaces the partial with the final version (removes `partial` flag)

This ensures that if the server crashes or the orchestrator is interrupted, the partial response survives in the DB.

---

## 32e. Extension Reconnect

### `subscribeToRun()` — `apps/extension/src/sidepanel/tabs/use-chat-stream.ts`

New function returned by the `useChatStream` hook:
1. Fetches `GET /api/chat/subscribe/:convId`
2. If JSON response (no active run), silently exits
3. If SSE stream, processes events using the same `processSSEEvent` as `sendMessage`
4. Shows badge, handles cleanup on stream end

### Auto-Subscribe on Load — `apps/extension/src/sidepanel/tabs/ChatTab.tsx`

In `loadConversation()`, after loading messages from DB, checks `conversation.status`:
```ts
if (status === 'running' || status === 'paused') {
  subscribeToRun(convId);
}
```

### New SSE Events — `packages/shared/src/types/sse.ts`

| Event | Purpose |
|-------|---------|
| `paused` | Orchestrator waiting for browser reconnection. Shows status message in chat. |
| `resumed` | Browser reconnected, orchestrator continuing. |

---

## 32f. Schema Change

**Table:** `conversations`
**New column:** `status text NOT NULL DEFAULT 'idle'`
**Values:** `idle` | `running` | `paused` | `completed` | `failed`
**Migration:** `apps/api/drizzle/0025_durable_orchestrator.sql`

Exposed in:
- `GET /api/conversations` (list) — includes `status` in response
- `GET /api/conversations/:id` (detail) — already returns all columns

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/agent/run-registry.ts` | **NEW** — Run registry, event buffer, pause/resume, incremental persistence |
| `apps/api/src/routes/chat.ts` | Decouple orchestrator from HTTP, add subscribe endpoint |
| `apps/api/src/agent/orchestrator.ts` | Pause check before browser tools, fresh connectionId |
| `apps/api/src/agent/browser-tools.ts` | Dynamic connectionId from run registry |
| `apps/api/src/ws/handler.ts` | Resume paused runs on reconnect, kill via registry |
| `apps/api/src/server.ts` | Call `resetStaleRuns()` on startup |
| `apps/api/src/db/schema.ts` | Add `status` column to conversations |
| `apps/api/drizzle/0025_durable_orchestrator.sql` | Migration |
| `packages/shared/src/types/sse.ts` | Add `paused`/`resumed` event types |
| `apps/api/src/routes/conversations.ts` | Return `status` in list endpoint |
| `apps/extension/src/sidepanel/tabs/use-chat-stream.ts` | Add `subscribeToRun`, handle paused/resumed events |
| `apps/extension/src/sidepanel/tabs/ChatTab.tsx` | Auto-subscribe to running conversations |

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User closes side panel mid-stream | SSE unsubscribes, orchestrator continues. LLM reasoning keeps going. |
| User reopens side panel | `loadConversation` sees `status: running`, calls `subscribeToRun`, replays buffered events |
| Orchestrator finishes while user disconnected | Final message saved to DB. User reopens, loads from DB normally. |
| Browser tool needed, extension gone | Orchestrator pauses. Emits `paused` event. Resumes when WS reconnects. |
| User presses Escape/Stop | WS `kill` → `killRun()` → AbortController fires → orchestrator exits cleanly |
| Server restart | `resetStaleRuns()` resets stale `running`/`paused` to `idle`. Partial response in DB. |
| Multiple browser windows | Multiple SSE subscribers supported. All see the same events. |
| New message to paused conversation | Orchestrator has active run — new message creates a new run (after current completes) |
