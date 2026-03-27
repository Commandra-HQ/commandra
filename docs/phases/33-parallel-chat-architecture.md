# Phase 33 — Parallel Chat Architecture

> Fix conversation isolation so users can run multiple chats simultaneously without cross-contamination. Replace shared component state with a per-conversation Zustand store. Fix server-side connection routing to be conversation-aware.

## Why

The extension's chat state is shared across all conversations via React refs that persist when switching tabs. The server routes WS actions by `userId` (not conversation), so multiple concurrent chats route actions to the wrong tab. The result: messages leak between chats, kill switch kills the wrong conversation, browser actions execute on the wrong page, and HITL approvals go to the wrong stream.

**Root causes:**
1. `useChatStream` hook uses 7 shared refs (`abortRef`, `assistantMsgIdRef`, `blocksRef`, `textAccumRef`, `thinkingAccumRef`, `rafRef`, `conversationIdRef`) that persist across conversation switches because `ChatTab` never unmounts
2. `getConnectionByUser(userId)` returns an arbitrary WS connection — with multiple tabs/conversations, actions route to the wrong one
3. `getRunByUser(userId)` returns an arbitrary run — kill/pause/resume affect the wrong conversation

---

## 33a. Client: Zustand Conversation Store

### New file: `apps/extension/src/sidepanel/stores/conversation-store.ts`

Replace all per-conversation state in `ChatTab` + `useChatStream` with a single Zustand store keyed by `conversationId`.

```typescript
interface ConversationSlice {
  messages: ChatMessage[]
  blocks: MessageBlock[]        // current assistant message's blocks (live)
  textAccum: string             // text accumulator for streaming
  thinkingAccum: string         // thinking accumulator
  assistantMsgId: string        // current streaming assistant message ID
  isActive: boolean             // is this conversation streaming?
  contextStatus: ContextStatus | null
  usageTotal: UsageTotal | null
  planState: PlanState | null
  showPlanPanel: boolean
  pendingApprovals: ApprovalRequest[]
  sseController: AbortController | null  // per-conversation abort
}

interface ConversationStore {
  conversations: Map<string, ConversationSlice>
  activeConvId: string | null

  // Actions
  setActiveConv: (convId: string | null) => void
  getOrCreate: (convId: string) => ConversationSlice
  updateConv: (convId: string, partial: Partial<ConversationSlice>) => void
  appendBlock: (convId: string, block: MessageBlock) => void
  appendMessage: (convId: string, msg: ChatMessage) => void
  setMessages: (convId: string, msgs: ChatMessage[]) => void
  clearConv: (convId: string) => void
  removeConv: (convId: string) => void

  // Streaming actions (scoped to convId)
  startStream: (convId: string) => void
  stopStream: (convId: string) => void
  flushBlocks: (convId: string) => void
}
```

**Key design decisions:**
- State is a `Map<convId, ConversationSlice>` — each conversation is fully isolated
- `activeConvId` controls which conversation the UI renders — switching is instant (no DB reload needed if data is in the store)
- `sseController` per conversation — aborting Conv A's stream doesn't touch Conv B
- Blocks/accumulators are per-conversation — no shared refs

### Migration path

1. Create the store
2. Refactor `useChatStream` → `useConversationStream(convId)` — all refs replaced by store reads/writes scoped to `convId`
3. Refactor `ChatTab` — reads from `store.conversations.get(activeConvId)`, no local state for messages/plan/context
4. `processSSEEvent` takes `convId` parameter — writes to the correct conversation's slice
5. `sendMessage(convId, text)` — scoped, can't contaminate other conversations
6. `subscribeToRun(convId)` — scoped, independent abort controller

### What ChatTab becomes

```typescript
function ChatTab() {
  const { conversationId: externalConvId } = useParams()
  const store = useConversationStore()
  const conv = store.conversations.get(externalConvId || '') || EMPTY_CONV

  // Tab switch = just change which slice we read from
  useEffect(() => {
    store.setActiveConv(externalConvId || null)
    if (externalConvId && !store.conversations.has(externalConvId)) {
      loadConversation(externalConvId) // loads into store
    }
  }, [externalConvId])

  // Render from store — pure view
  return (
    <div>
      {conv.messages.map(msg => <Message key={msg.id} msg={msg} />)}
      {conv.isActive && <StreamingIndicator />}
    </div>
  )
}
```

### What SSE processing becomes

```typescript
function processSSEEvent(convId: string, event: SSEEvent) {
  const store = useConversationStore.getState()

  // Events ALWAYS go to the correct conversation, regardless of which tab is active
  switch (event.type) {
    case 'text_delta':
      store.appendText(convId, event.text)
      break
    case 'tool_start':
      store.appendBlock(convId, { type: 'tool_call', ... })
      break
    // ... all events scoped to convId
  }
}
```

**No more race conditions.** Conv A's events go to Conv A's slice. Conv B's events go to Conv B's slice. Even if both are streaming simultaneously.

---

## 33b. Server: Conversation-Scoped Connection Routing

### Problem: `getConnectionByUser()` returns arbitrary connection

Fix: Track which WS connection is associated with which conversation.

### New: Connection-Conversation mapping

**File:** `apps/api/src/ws/handler.ts`

```typescript
// Track which conversations are active on which connections
const connectionConversations = new Map<string, Set<string>>()  // connectionId → Set<convId>
const conversationConnections = new Map<string, string>()        // convId → connectionId

export function registerConversationConnection(convId: string, connectionId: string) {
  conversationConnections.set(convId, connectionId)
  const convs = connectionConversations.get(connectionId) || new Set()
  convs.add(convId)
  connectionConversations.set(connectionId, convs)
}

export function getConnectionForConversation(convId: string): string | null {
  const connId = conversationConnections.get(convId)
  if (!connId) return null
  const conn = connections.get(connId)
  if (!conn || conn.ws.readyState !== conn.ws.OPEN) return null
  return connId
}
```

**Usage in chat.ts:** When a conversation starts, register the connection:
```typescript
registerConversationConnection(convId, connectionId)
```

**Usage in orchestrator.ts:** When executing tools, look up by conversation:
```typescript
const activeConnectionId = getConnectionForConversation(conversationId) || connectionId
```

### Fix: `getRunByUser()` → iterate all runs

**File:** `apps/api/src/agent/run-registry.ts`

```typescript
export function getAllRunsByUser(userId: string): ActiveRun[] {
  const runs: ActiveRun[] = []
  for (const run of activeRuns.values()) {
    if (run.userId === userId && (run.status === 'running' || run.status === 'paused')) {
      runs.push(run)
    }
  }
  return runs
}
```

### Fix: WS reconnect resumes ALL paused runs

**File:** `apps/api/src/ws/handler.ts`

```typescript
// After auth success:
const pausedRuns = getAllRunsByUser(conn.userId)
for (const run of pausedRuns) {
  if (run.status === 'paused') {
    updateConnectionId(run.conversationId, connectionId)
    registerConversationConnection(run.conversationId, connectionId)
    resumeRun(run.conversationId)
  }
}
```

### Fix: Kill switch scoped by conversation

Currently the kill message has no conversation context. Fix: include `conversationId` in the kill message from the extension.

**Extension side:**
```typescript
ws.send(JSON.stringify({ type: 'kill', conversationId: activeConvId }))
```

**Server side:**
```typescript
case 'kill': {
  const targetConvId = message.conversationId
  if (targetConvId) {
    const run = getRun(targetConvId)
    if (run) killRun(targetConvId)
  } else {
    // Legacy: kill all runs for this user
    const runs = getAllRunsByUser(conn.userId)
    for (const run of runs) killRun(run.conversationId)
  }
}
```

### Fix: Clean up on WS disconnect

When a WS connection closes, clean up the conversation-connection mapping:

```typescript
ws.on('close', () => {
  const convs = connectionConversations.get(connectionId) || new Set()
  for (const convId of convs) {
    conversationConnections.delete(convId)
  }
  connectionConversations.delete(connectionId)
  connections.delete(connectionId)
})
```

---

## 33c. SSE Stream Per Conversation (No Shared Fetch)

Currently `sendMessage` and `subscribeToRun` share `abortRef` — aborting one aborts both.

### Fix: Per-conversation SSE management

Each conversation's `sseController` lives in the Zustand store. Starting a stream for Conv B doesn't abort Conv A's stream.

```typescript
function startStream(convId: string, url: string, body?: object) {
  const store = useConversationStore.getState()
  const conv = store.getOrCreate(convId)

  // Abort any existing stream for THIS conversation only
  conv.sseController?.abort()

  const controller = new AbortController()
  store.updateConv(convId, { sseController: controller, isActive: true })

  fetch(url, { ...options, signal: controller.signal })
    .then(res => processStream(convId, res))
    .finally(() => {
      store.updateConv(convId, { sseController: null, isActive: false })
    })
}
```

---

## 33d. Tab Bar Integration

The tab bar already shows running indicators via `activeChats` context. With the Zustand store:

- Green dot: `store.conversations.get(convId)?.isActive`
- Tab switch: `store.setActiveConv(convId)` — instant, no loading
- Close tab: `store.stopStream(convId)` + `store.removeConv(convId)`
- `+ New`: `store.setActiveConv(null)` — shows empty chat

---

## Files Changed

| File | Change |
|------|--------|
| `apps/extension/src/sidepanel/stores/conversation-store.ts` | **NEW** — Zustand store |
| `apps/extension/src/sidepanel/tabs/use-chat-stream.ts` | **REWRITE** → `useConversationStream(convId)` |
| `apps/extension/src/sidepanel/tabs/ChatTab.tsx` | **REFACTOR** — reads from store, no local message state |
| `apps/extension/src/sidepanel/tabs/chat-types.ts` | Add store types |
| `apps/extension/src/sidepanel/layouts/HubLayout.tsx` | Tab actions use store |
| `apps/extension/src/sidepanel/contexts/active-chats.tsx` | May merge into Zustand store |
| `apps/api/src/ws/handler.ts` | Conversation-connection mapping, scoped kill |
| `apps/api/src/agent/run-registry.ts` | `getAllRunsByUser()`, resume all on reconnect |
| `apps/api/src/agent/orchestrator.ts` | Use `getConnectionForConversation()` |
| `apps/api/src/agent/browser-tools.ts` | Use `getConnectionForConversation()` |
| `apps/api/src/routes/chat.ts` | Register conversation-connection on start |

## Implementation Order

1. **Zustand store** — create store, add to provider tree
2. **Refactor `useChatStream`** → per-conversation stream hook that writes to store
3. **Refactor `ChatTab`** — read from store, remove all local conversation state
4. **Server connection mapping** — `registerConversationConnection`, `getConnectionForConversation`
5. **Server fixes** — scoped kill, resume all paused, clean up on disconnect
6. **Orchestrator routing** — use conversation-scoped connection lookup
7. **Tab bar integration** — instant switching from store

## Verification

1. **Isolation test**: Open Conv A, start a task. Open Conv B, start a different task. Switch between tabs — each shows its own state, no leaking.
2. **Concurrent streaming**: Both Conv A and Conv B streaming simultaneously. Events go to the right conversation.
3. **Kill switch**: Kill Conv A from Conv A's tab. Conv B continues unaffected.
4. **Reconnect**: Close extension. Reopen. Both Conv A and Conv B resume from where they left off.
5. **HITL**: Conv A waiting for approval. Switch to Conv B, do work. Switch back to Conv A — approval buttons still work.
6. **Tab switch speed**: Switching between conversations is instant (no DB reload if data is in store).
