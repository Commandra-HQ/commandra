# Agentic System Audit

**Date:** 2026-03-26
**Scope:** Orchestrator, scheduler, browser tools, LLM providers, extension side panel UI
**Status:** Open — no fixes applied yet

---

## Table of Contents

1. [Scheduled Agent Autonomy](#1-scheduled-agent-autonomy)
2. [Copy Conversation](#2-copy-conversation)
3. [LLM Provider Token Accounting](#3-llm-provider-token-accounting)
4. [Approval Flow Architecture](#4-approval-flow-architecture)
5. [Extension UI Gaps](#5-extension-ui-gaps)
6. [Orchestrator & Tool Execution](#6-orchestrator--tool-execution)
7. [Priority Matrix](#7-priority-matrix)

---

## 1. Scheduled Agent Autonomy

Scheduled agents are designed to run without a human present, but the system has fundamental conflicts between the autonomy model and the approval gate infrastructure.

### 1.1 Automatic Autonomy Escalation

**File:** `apps/api/src/agent/agent-registry.ts:131-135`

```typescript
// Scheduled agents must be at least trusted — there's no human to approve actions
let autonomy = config.autonomy ?? 'supervised';
if (config.trigger?.cron && autonomy === 'supervised') {
  autonomy = 'trusted';
}
```

When an agent has a cron trigger and is set to `supervised` (the default), the system silently escalates it to `trusted`. This means:

- All `review`-level browser actions (form submits, creates, updates) execute without approval
- Multi-step plans auto-approve
- The user who created the agent may not realize their agent runs with elevated permissions

**Impact:** Users expect `supervised` behavior but get `trusted`. There's no UI indication that this escalation happened.

### 1.2 noopEvent Swallows All Events

**File:** `apps/api/src/agent/scheduler.ts:412-429`

```typescript
const noopEvent = async (_event: SSEEvent): Promise<void> => {};

const result = await runOrchestrator({
  userId: agent.userId,
  connectionId,
  messages: [{ role: 'user', content: taskMessage }],
  domainMemory: undefined,
  userMemory: userMem,
  domainKnowledge,
  domain,
  onEvent: noopEvent,
  agentConfig,
  tabId: scheduledTabId,
});
```

The scheduler passes a no-op function as the event handler. This means:

- **Thinking events** — dropped silently, no record of agent reasoning
- **Tool start/end events** — dropped, no streaming visibility into what the agent is doing
- **Error events** — dropped, failures only surface if the entire orchestrator throws
- **Approval events** — dropped, which is fine for `trusted` but catastrophic if an agent creation approval (`autonomous`-only) fires
- **Plan events** — dropped, no record of what plans were submitted/executed

**The gap:** There's no audit trail for scheduled runs. If an agent misbehaves during a cron run, there's no log of its reasoning, tool calls, or decisions. The only record is the final `agent_runs` row (status, tool count, duration, tokens).

### 1.3 Approval Gate Bypass in Browser Tools

**File:** `apps/api/src/agent/browser-tools.ts:46-62`

```typescript
if (effectiveAutonomy === 'autonomous') {
  safe.push(block);
} else if (autonomy === 'trusted') {
  if (classification.level === 'blocked') {
    blocked.push(block);
  } else {
    safe.push(block); // 'review' → treated as 'safe'
  }
} else {
  // Only 'supervised' agents get review queue
  if (classification.level === 'blocked') {
    blocked.push(block);
  } else if (classification.level === 'review') {
    review.push(block);
  } else {
    safe.push(block);
  }
}
```

For `trusted` agents (which all scheduled agents become), every `review`-classified action is reclassified as `safe`. This includes:

- Form submissions
- Record creation/updates
- Email sends
- File uploads
- Any write operation

Only `blocked`-level actions (bulk deletes, permission changes) are stopped. The safety net is thinner than expected.

### 1.4 Inconsistent Approval Logic Across Internal Tools

**File:** `apps/api/src/agent/internal-tools.ts`

| Tool                      | `supervised`      | `trusted`         | `autonomous`      |
| ------------------------- | ----------------- | ----------------- | ----------------- |
| `submit_plan` (line 714)  | Approval required | **Auto-approved** | Auto-approved     |
| `create_agent` (line 547) | Approval required | Approval required | **Auto-approved** |

A `trusted` scheduled agent can auto-approve multi-step plans but cannot create new agents. If `create_agent` fires during a scheduled run, it calls `sendApprovalRequest()` which requires an active WebSocket connection to the extension — which doesn't exist during a cron run. The request will timeout after 60 seconds and fail.

### 1.5 Missing: Post-Hoc Review Mechanism

There's no system for:

- Queueing decisions made during scheduled runs for later human review
- Sending a summary of what the agent did after a cron run completes
- Allowing users to retroactively approve/reject actions taken during scheduled runs
- Logging the agent's reasoning chain for scheduled runs

### 1.6 DB Observations

From querying the local database:

- The 2 scheduled runs (Gmail Sender) recorded **0 tokens** and **no model/provider** — token tracking is broken for scheduled runs
- All 19 agent runs show `completed` status with 0 failures — either the agent is perfect or error reporting isn't working
- The Gmail Sender agent is `supervised` autonomy in DB, confirming the silent escalation to `trusted` at runtime

---

## 2. Copy Conversation

The copy conversation feature captures a small fraction of the actual conversation content.

### 2.1 Full Conversation Copy

**File:** `apps/extension/src/sidepanel/tabs/ChatTab.tsx:280-288`

```typescript
if (action === 'copy-chat') {
  const text = chatMessages
    .map(
      m =>
        `${m.role === 'user' ? 'You' : 'Agent'}: ${m.content || m.blocks?.map(b => ('content' in b ? b.content : '')).join('') || ''}`,
    )
    .join('\n\n');
  navigator.clipboard.writeText(text);
}
```

This handler iterates messages and for each one:

1. Uses `m.content` if available (which is only text blocks, per the final content assignment)
2. Falls back to concatenating `b.content` from blocks — but only blocks that have a `content` property

**What gets copied vs what's lost:**

| Block Type  | Has `content`?                    | Copied?     | Data Lost                                       |
| ----------- | --------------------------------- | ----------- | ----------------------------------------------- |
| `text`      | Yes                               | Yes         | —                                               |
| `thinking`  | Yes                               | Partially\* | Lost if `m.content` exists                      |
| `tool_call` | No (`toolName`, `args`, `result`) | No          | Tool name, arguments, result, error, screenshot |
| `blocked`   | No (`toolName`, `reason`)         | No          | What was blocked and why                        |
| `plan`      | No (`plan` object)                | No          | Plan description, steps, step statuses          |
| `sub_agent` | No (`agentId`, `task`, `actions`) | No          | Sub-agent task, actions, results, summary       |

\*Thinking blocks have `content` but are only reached by the fallback path when `m.content` is empty.

### 2.2 Per-Message Copy

**File:** `apps/extension/src/sidepanel/tabs/message-blocks.tsx:150-161`

```typescript
const copyableText = blocks
  .filter(
    (b): b is Extract<MessageBlock, { type: 'text' }> =>
      b.type === 'text' && !b.content.startsWith('__approval__:'),
  )
  .map(b => b.content)
  .join('\n\n');
```

Per-message copy explicitly filters to only `type: 'text'` blocks and excludes approval markers. Same data loss as full copy, but more intentional.

### 2.3 Final Content Assignment Strips Non-Text

**File:** `apps/extension/src/sidepanel/tabs/use-chat-stream.ts:445-456`

```typescript
const finalText = blocksRef.current
  .filter(b => b.type === 'text')
  .map(b => (b as { content: string }).content)
  .join('\n');
```

When streaming completes, `ChatMessage.content` is set to only the text blocks. This means `m.content` in the copy handler already excludes everything else. The fallback to `m.blocks` in the copy handler is dead code in practice — `m.content` will always be a non-empty string if the agent responded with any text.

### 2.4 What a Complete Copy Should Include

A proper conversation export should serialize every block type:

```
You: Send an email to john@example.com

Agent:
[Thinking] I'll navigate to Gmail and compose a new email...

[Tool: navigate] → https://mail.google.com
  Result: Page loaded successfully

[Tool: click_element] → "Compose" button
  Result: Compose window opened

[Tool: type_text] → "john@example.com" in To field
  Result: Text entered

[Approval Required: click_element] → "Send" button
  Reason: Write action requires confirmation
  Decision: Approved

[Tool: click_element] → "Send" button
  Result: Email sent

[Plan] Send email to John
  1. ✅ Open Gmail
  2. ✅ Click Compose
  3. ✅ Fill in recipient
  4. ✅ Click Send

Done — email sent to john@example.com.
```

---

## 3. LLM Provider Token Accounting

Both the OpenAI and Anthropic providers have broken thinking token tracking.

### 3.1 OpenAI Provider

**File:** `apps/api/src/llm/providers/openai.ts:219-232`

```typescript
const respUsage = (resp as unknown as { usage?: Record<string, unknown> }).usage;
if (respUsage) {
    const inputDetails = respUsage.input_tokens_details as Record<string, number> | undefined;
    yield {
        type: 'usage',
        usage: {
            inputTokens: (respUsage.input_tokens as number) ?? 0,
            outputTokens: (respUsage.output_tokens as number) ?? 0,
            cacheReadTokens: inputDetails?.cached_tokens ?? 0,
            cacheWriteTokens: 0,
            thinkingTokens: 0,  // ← Always 0
        },
    };
}
```

The OpenAI Responses API returns reasoning tokens in the usage object (likely as `output_tokens_details.reasoning_tokens`), but the code ignores them entirely. For models like o3, o4-mini, and gpt-5 where reasoning can consume significant tokens, this means:

- **Cost calculations are wrong** — reasoning tokens are billed but not tracked
- **Token budget management is blind** — the orchestrator's context trimming (`apps/api/src/agent/token-budget.ts`) doesn't account for thinking token spend
- **Usage reporting is misleading** — the `usage_total` SSE event and `agent_runs.tokens_used` undercount actual usage

### 3.2 Anthropic Provider

**File:** `apps/api/src/llm/providers/anthropic.ts:118`

```typescript
const usage: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  thinkingTokens: 0,
};
```

Same issue. Anthropic's API returns thinking tokens in the `message_delta` event's usage block, but they're never extracted.

### 3.3 Thinking Streaming Does Work

**File:** `apps/api/src/llm/providers/openai.ts:148-150`

```typescript
case 'response.reasoning_summary_text.delta':
    yield { type: 'thinking_delta', text: event.delta };
    break;
```

The actual streaming of thinking content is correctly implemented. The flow works end-to-end:

1. OpenAI emits `response.reasoning_summary_text.delta` events
2. Provider maps to `thinking_delta`
3. Orchestrator accumulates and forwards via `onEvent`
4. SSE streams to extension
5. Extension renders in `ThinkingBlock` component

**The issue is purely about token accounting**, not the thinking content itself. If thinking streaming stopped working, it's likely model-specific (e.g., switching to a model that doesn't support `reasoning.summary: 'auto'`).

### 3.4 Model Configuration Gap

**File:** `apps/api/src/llm/providers/openai.ts:121-126`

```typescript
const supportsReasoning = /^(gpt-5|o[34])/.test(resolved);
if (params.thinking && supportsReasoning) {
  createParams.reasoning = {
    effort: 'medium',
    summary: 'auto',
  };
}
```

The reasoning effort is hardcoded to `'medium'`. There's no way for users or agents to request `'high'` effort for complex tasks or `'low'` for simple ones. The agent config has `thinkingBudget` but it only controls token limits, not reasoning effort.

---

## 4. Approval Flow Architecture

The approval system has structural fragility that affects both interactive and scheduled runs.

### 4.1 String-Based Protocol

**File:** `apps/extension/src/sidepanel/tabs/message-blocks.tsx:170-201`

```typescript
if (block.content.startsWith('__approval__:')) {
  const parts = block.content.split(':');
  const approvalType = parts[1]; // 'plan' or 'tool'
  const requestId = parts[2];
  if (approvalType === 'plan') {
    const desc = parts[3];
    const steps = parts[4]?.split('|') || [];
    // ...
  }
  const action = parts[3];
  const label = parts[4];
  const reason = parts[5];
  // ...
}
```

Approval requests are encoded as colon-delimited strings inside text blocks. This is fragile:

- **Field collision:** If `action`, `label`, or `reason` contains `:`, parsing breaks silently. Fields shift positions and the wrong data is displayed.
- **Plan step collision:** Steps are joined with `|`. If a step description contains `|`, it splits into multiple phantom steps.
- **No validation:** Parsed values are used directly — no null checks, no bounds checking on the parts array.
- **No schema:** The format is implicit. Changes to the approval protocol require coordinated updates across backend events and extension parsing.

### 4.2 State Management

Approval state lives in three places simultaneously:

1. **`pendingApprovals` state** in `ChatTab.tsx` — array of approval objects
2. **`pendingPlanApproval` state** in `ChatTab.tsx` — separate state for plan approvals
3. **`responded` local state** in each `InlineApprovalBlock` component

When the user approves:

```typescript
setPendingApprovals(prev => prev.filter(a => a.requestId !== requestId));
if (pendingPlanApproval?.requestId === requestId) {
  setPendingPlanApproval(null);
}
```

But the `InlineApprovalBlock`'s local `responded` state is independent. The component tracks its own responded state, so:

- If the user refreshes mid-approval, all state is lost — the approval request disappears from UI but may still be waiting on the backend (60s timeout)
- If the same approval appears in both `pendingApprovals` and inline text blocks, the user sees two approval UIs for the same request

### 4.3 No Error Handling for Approval POST

**File:** `apps/extension/src/sidepanel/tabs/ChatTab.tsx:340` (handleApproval callback)

When the user clicks Approve/Reject, the response is sent to the backend. If that POST fails:

- No error message shown to the user
- No retry mechanism
- The approval button goes into "responded" state but the backend never got the response
- The backend will timeout after 60 seconds and treat it as a rejection

### 4.4 No Loading/Debounce on Approval Buttons

The Approve/Reject buttons have no loading state and no debounce. If a user double-clicks Approve, two approval responses may be sent. The second one targets a request ID that no longer exists, which may throw an unhandled error on the backend.

---

## 5. Extension UI Gaps

### 5.1 Tool Result Truncation

**File:** `apps/extension/src/sidepanel/tabs/message-blocks.tsx:422-432`

```typescript
{block.result != null && !block.screenshot && (
    <div>
        <span className="text-muted-foreground">Result: </span>
        <code className="text-[10px] text-foreground/70 font-mono break-all">
            {typeof block.result === 'string'
                ? block.result.slice(0, 300)
                : JSON.stringify(block.result).slice(0, 300)}
        </code>
    </div>
)}
```

Tool results are hard-truncated at 300 characters with no "Show more" affordance. For tools like `read_text` or `read_table` that return page content, the user sees a tiny fragment with no way to view the full output. The truncation doesn't even add an ellipsis.

Additionally, if the tool returned a screenshot (`block.screenshot`), the text result is hidden entirely — even though it may contain useful context beyond what's visible in the image.

### 5.2 Context Token Estimation

**File:** `apps/extension/src/sidepanel/tabs/ChatTab.tsx:703-712`

```typescript
const totalChars = (data.messages || []).reduce(
  (sum: number, m: { content?: string }) => sum + (m.content?.length || 0),
  0,
);
const estimatedTokens = Math.round(totalChars / 4);
```

The estimation assumes 1 token ≈ 4 characters. Problems:

- Modern tokenizers (cl100k, o200k) average ~3.5 chars/token for English
- System prompts (which can be 5K+ tokens) aren't counted
- Tool definitions aren't counted
- Thinking tokens aren't counted (see Section 3)
- `m.content` only includes text blocks, not tool calls or their results

The context indicator at 60% may actually mean 80%+ real usage, leading to unexpected context exhaustion.

**File:** `apps/extension/src/sidepanel/tabs/chat-layout.tsx:142-150`

```typescript
{contextStatus && contextStatus.percent > 60 && (
    <span
        className="text-[9px] text-yellow-500 cursor-help"
        title={`Context ${contextStatus.percent}% full...`}
    >
        {contextStatus.percent > 80 ? 'Compacting...' : `${contextStatus.percent}%`}
    </span>
)}
```

At >80% the indicator says "Compacting..." even if compaction hasn't started — it's just a label, not a status. Users may think compaction is in progress when it isn't.

### 5.3 Thinking Block Rendering

**File:** `apps/extension/src/sidepanel/tabs/message-blocks.tsx:226-257`

Issues:

- **Non-last thinking blocks default to collapsed** — users must manually expand each one. In a long conversation with many turns, thinking blocks are effectively invisible.
- **Spinner never stops:** When `isLast` is true and `content` exists, the component still shows `<Loader2 className="animate-spin" />`. The thinking appears to be "still going" even after it completed.
- **Unreadable code:** Thinking content uses `prose-code:text-[10px]` — 10px monospace is extremely small. Code blocks inside thinking content are nearly unreadable.
- **Max height of 200px** with overflow scroll — for complex reasoning, this tiny window forces excessive scrolling.

### 5.4 Lossy Compaction

**File:** `apps/extension/src/sidepanel/tabs/ChatTab.tsx:365-461`

When compaction succeeds:

```typescript
setChatMessages([
  {
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content: data.summary,
    blocks: [
      {
        type: 'text' as const,
        content: `---\n**Conversation compacted**...`,
      },
    ],
  },
]);
```

ALL previous messages in the UI are replaced with a single summary message. This is irreversible — the user loses:

- All tool call history and results
- All thinking blocks
- All sub-agent activity
- All approval decisions and their context
- All plan steps and their statuses
- All screenshots

The transcript is saved to a file (`data.path`), but there's no UI to browse transcripts — the user would need to use the S3 browsing tool or API directly.

### 5.5 SSE Error Display

**File:** `apps/extension/src/sidepanel/tabs/use-chat-stream.ts:351-357`

```typescript
case 'error':
    blocksRef.current.push({
        type: 'text',
        content: event.message,
    });
    scheduleFlush();
    break;
```

Server errors are pushed as plain text blocks — same styling as normal agent output. Users can't distinguish between "the agent said something" and "something went wrong." There's no red styling, no error icon, no retry button.

### 5.6 No Loading State for Conversation History

**File:** `apps/extension/src/sidepanel/tabs/ChatTab.tsx:554-733`

When loading a previous conversation:

- No skeleton placeholders
- No loading spinner
- No "Loading conversation..." message
- If the API call fails, the catch block logs to console but shows nothing to the user — just an empty chat

### 5.7 Sub-Agent Block Reconstruction

**File:** `apps/extension/src/sidepanel/tabs/ChatTab.tsx:618-661`

When loading saved conversations, sub-agent blocks are reconstructed by lookahead scanning through `toolData.streamBlocks`:

```typescript
const remaining = m.toolData!.streamBlocks!;
const startIdx = remaining.indexOf(sb);
for (let j = startIdx + 1; j < remaining.length; j++) {
    const next = remaining[j];
    if (next.type === 'sub_agent_action') {
        actions.push({...});
    } else if (next.type === 'sub_agent_end' && next.toolName === agentId) {
        summary = next.content;
        break;
    }
}
```

This breaks if:

- Stream blocks are out of order (network jitter)
- A sub-agent block is missing its end event (timeout, crash)
- Two sub-agents have interleaved actions (swarm mode)

### 5.8 Missing Accessibility

Across the side panel:

- Expandable blocks (`ThinkingBlock`, `ToolCallBlock`) use `<button>` but no `aria-expanded` attribute
- No `role="alert"` on error messages
- Screenshot images have generic alt text
- No keyboard navigation between blocks
- No focus indicators (hover styles exist, focus rings don't)
- Approval buttons have no `aria-label` describing what's being approved

### 5.9 formatToolArgs — No Generic Fallback

**File:** `apps/extension/src/sidepanel/tabs/chat-types.ts:162-169`

```typescript
export function formatToolArgs(
  toolName: string,
  args?: Record<string, unknown>,
): string | null {
  if (!args) return null;
  if (toolName === 'navigate' && args.url) return String(args.url);
  if (toolName === 'click_element' && args.selector)
    return String(args.selector);
  if (toolName === 'type_text' && args.text)
    return `"${String(args.text).slice(0, 60)}"`;
  if (toolName === 'select_option' && args.value) return String(args.value);
  return null;
}
```

Only 4 tools have preview formatting. All other tools (including internal tools like `save_knowledge`, `spawn_agent`, `recall_memory`) show no argument preview. A generic `key: value` fallback for the first 2-3 args would help.

### 5.10 Race Conditions on Concurrent Operations

No mutex or request deduplication exists. If the user rapidly clicks:

- Reindex → sends DOM re-index request
- Compact → sends compaction request
- Send → sends chat message

All three fire concurrently. The compaction may complete while the chat message is streaming, replacing messages mid-stream. The reindex may return after a page transition, providing stale DOM data.

### 5.11 Plan State Dual Representation

Plans exist in two separate state objects with inconsistent status names:

| Source                                      | Status Values                        |
| ------------------------------------------- | ------------------------------------ |
| SSE events (via `use-chat-stream.ts`)       | `in_progress`, `completed`, `failed` |
| PlanBlock render (via `message-blocks.tsx`) | `running`, `done`, `error`           |

The mapping at `use-chat-stream.ts:206-213`:

```typescript
const statusMap = {
  in_progress: 'running',
  completed: 'done',
  failed: 'error',
};
```

This mapping works for streaming, but if plan state is loaded from the database (where it was stored with the SSE-side names), the mapping isn't applied, leading to plans showing wrong status icons.

---

## 6. Orchestrator & Tool Execution

### 6.1 No Retry on SSE Stream Failure

**File:** `apps/extension/src/sidepanel/tabs/use-chat-stream.ts:431-438`

```typescript
} catch (err) {
    if (!controller.signal.aborted) {
        blocksRef.current.push({
            type: 'text',
            content: 'Failed to get a response. Make sure the API is running.',
        });
    }
}
```

A single network error or 5xx response kills the entire conversation stream. No retry, no reconnection, no partial recovery. The user's message is lost and they must resend.

### 6.2 Blocked Tool Feedback

**File:** `apps/extension/src/sidepanel/tabs/message-blocks.tsx:562-570`

Blocked tool blocks show only the tool name and reason. Missing:

- What safety level triggered the block (policy, classification, hook?)
- How to unblock it (change agent autonomy? modify hooks? request approval?)
- Whether the user can override the block for this specific instance

### 6.3 No Pending Approval Indicator

If the user scrolls past an approval request in the chat, there's no persistent indicator (badge, banner, floating button) showing that an approval is pending. The approval may timeout after 60 seconds while the user doesn't realize it's waiting.

---

## 7. Priority Matrix

### P0 — Critical (Breaks core functionality)

| #   | Issue                                                            | Section | Fix Complexity |
| --- | ---------------------------------------------------------------- | ------- | -------------- |
| 1   | Scheduled agent `noopEvent` drops all events — no audit trail    | 1.2     | Medium         |
| 2   | Copy conversation misses tool calls, thinking, plans, sub-agents | 2.1-2.3 | Low            |
| 3   | Thinking token accounting hardcoded to 0 (both providers)        | 3.1-3.2 | Low            |
| 4   | Approval state lost on page refresh                              | 4.2     | Medium         |

### P1 — High (Significant UX/reliability impact)

| #   | Issue                                                     | Section      | Fix Complexity |
| --- | --------------------------------------------------------- | ------------ | -------------- | ------ |
| 5   | Tool results truncated at 300 chars, no expand            | 5.1          | Low            |
| 6   | No loading/error states for conversation history          | 5.6          | Low            |
| 7   | SSE errors shown as plain text, no styling                | 5.5          | Low            |
| 8   | Approval string protocol fragile (`:` and `               | ` collision) | 4.1            | Medium |
| 9   | Compaction is lossy — no way to recover original messages | 5.4          | Medium         |
| 10  | No SSE retry on network failure                           | 6.1          | Medium         |
| 11  | Scheduled agent token tracking broken (0 tokens recorded) | 1.6          | Low            |

### P2 — Medium (Polish, consistency, edge cases)

| #   | Issue                                                   | Section | Fix Complexity |
| --- | ------------------------------------------------------- | ------- | -------------- |
| 12  | Context token estimation inaccurate (chars/4 heuristic) | 5.2     | Low            |
| 13  | Thinking block spinner never stops, 200px max height    | 5.3     | Low            |
| 14  | Sub-agent reconstruction fragile on conversation load   | 5.7     | Medium         |
| 15  | Plan state dual representation with inconsistent names  | 5.11    | Medium         |
| 16  | Race conditions on rapid concurrent operations          | 5.10    | Medium         |
| 17  | No approval loading state or debounce                   | 4.4     | Low            |
| 18  | formatToolArgs returns null for most tools              | 5.9     | Low            |
| 19  | No pending approval indicator outside message view      | 6.3     | Low            |
| 20  | Reasoning effort hardcoded to 'medium'                  | 3.4     | Low            |

### P3 — Low (Accessibility, nice-to-have)

| #   | Issue                                        | Section | Fix Complexity |
| --- | -------------------------------------------- | ------- | -------------- |
| 21  | Missing ARIA attributes across side panel    | 5.8     | Medium         |
| 22  | Blocked tool blocks not actionable           | 6.2     | Low            |
| 23  | Screenshot viewing UX (no lightbox, no zoom) | 5.1     | Medium         |
| 24  | No conversation search/filter in history     | 5.6     | Medium         |
| 25  | Autonomy escalation not visible to users     | 1.1     | Low            |
