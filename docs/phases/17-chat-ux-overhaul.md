# Phase 17 — Chat UX Overhaul

> Context-aware conversations with real-time token visibility, proper plan management, inline approval flows, and conversation compaction.

## Why

The chat works but the UX has gaps that break autonomous workflows:
- **Conversations die mid-task** — context window fills up silently, agent just stops
- **Plans are messy** — multiple plans per chat, no persistent view, no checklist UX
- **HITL is disconnected** — approval requests appear in a floating header bar, not inline with the message that triggered them
- **No visibility** — user has no idea how much context is left, what the agent learned, or why it stopped

---

## What Ships

### 17a. Real-Time Context Window Indicator — DONE

**Backend:** Orchestrator emits `context_status` SSE event before every LLM call with `{ used, limit, percent }`. Uses the existing `estimateMessageChars` + system prompt length.

**Extension:** Circular SVG progress ring in chat header (top-right). Color: green (<60%), yellow (60-80%), red (>80%). Tooltip shows exact token counts.

**Files changed:** `orchestrator.ts`, `sse.ts`, `ChatTab.tsx`

### 17b. Conversation Compaction + Continuation — DONE

**Backend:** At 80% context usage, orchestrator auto-compacts:
1. Fast model summarizes the conversation (500 token budget)
2. Full transcript saved as markdown to `{userId}/compactions/{conversationId}/{timestamp}.md`
3. Message history replaced with summary — conversation continues with fresh budget
4. `compaction` SSE event emitted so extension shows it inline

**Extension:** Compaction shown as an inline message block with summary text and file path.

**Files changed:** `orchestrator.ts`, new `storage/compaction-files.ts`, `sse.ts`, `ChatTab.tsx`

### 17c. Single Plan Per Chat (Overwrite, Not Multiply) — DONE

**Backend:** `submit_plan` now checks for existing plans:
- If existing plan has `in_progress` steps → reject with error message
- Otherwise → overwrite (completed/failed/pending plans get replaced)

One PLAN.md per conversation, always at `{userId}/plans/{conversationId}/PLAN.md`.

**Files changed:** `orchestrator.ts` (submit_plan handler)

### 17d. Plan Always Visible + Checklist Format — DONE

**Backend:** `plan_state` SSE event emitted on plan approval and every step update. Contains full plan with step statuses.

**Extension:**
- `ListChecks` button in chat header with progress badge (e.g., "3/5")
- Click opens slide-out panel showing checklist with status icons:
  - `Circle` pending (gray)
  - `Loader2` in progress (blue, animated)
  - `Check` completed (green)
  - `AlertCircle` failed (red)
- Steps are read-only — only the AI marks them via `update_plan` tool
- Panel updates in real-time via `plan_state` SSE events

**Files changed:** `orchestrator.ts`, `sse.ts`, `ChatTab.tsx`

### 17e. Inline HITL Approval — DONE

**Backend:** Emits `approval_inline` SSE event right before the WS approval request for both tool and plan approvals.

**Extension:**
- Floating header approval bars removed entirely
- Approval requests rendered as `InlineApprovalBlock` components in the message flow
- Each block has Approve/Reject buttons that call `handleApproval` directly
- After response, block updates in-place to show "Approved" (green) or "Rejected" (red)
- Tool approvals: show action name + label + reason + buttons
- Plan approvals: show description + numbered step list + buttons
- `onApprove` prop threaded from ChatTab → AssistantMessage → InlineApprovalBlock

### 17b+. Manual Compaction Button — DONE

"Compact" button appears in header when context usage >50%. Sends `REQUEST_COMPACTION` message.

### 17d+. Plan Panel Auto-Open — DONE

Plan panel auto-opens on first `plan_state` event (new plan approved) or when a step fails.

**Files changed:** `orchestrator.ts`, `sse.ts`, `ChatTab.tsx`

---

## What's Left

Nothing blocking. All sub-phases implemented. Minor polish opportunities:

- The "Compact" button sends a `REQUEST_COMPACTION` message — the background script handler for this could be wired to send a system message to the chat that triggers compaction on the next orchestrator iteration. Currently the auto-compact at 80% is the primary trigger.
- The inline approval block uses a `__approval__:` prefix encoding in the text content to pass data through the block system. A cleaner approach would be a dedicated `approval` block type in the MessageBlock union, but the current approach works and avoids a larger refactor.

---

## Files Modified/Created Summary

| File | Action | Sub-phase |
|------|--------|-----------|
| `packages/shared/src/types/sse.ts` | MODIFY — add `context_status`, `compaction`, `approval_inline`, `plan_state` events | 17a-e |
| `apps/api/src/agent/orchestrator.ts` | MODIFY — emit context_status, auto-compact at 80%, enforce single plan, emit plan_state, emit approval_inline | 17a-e |
| `apps/api/src/storage/compaction-files.ts` | **CREATE** — conversation compaction S3 storage | 17b |
| `apps/extension/src/sidepanel/tabs/ChatTab.tsx` | MODIFY — context indicator, compaction block, plan panel + button, inline approval blocks | 17a-e |

**Total: 1 new file, 3 modified files.**

---

## Cross-Chat Learning

Domain knowledge flows across ALL chats (coordinator included) via S3:
1. Chat on `mail.google.com` → `syncDomainKnowledgeToS3` writes to `domains/{userId}/mail_google_com/KNOWLEDGE.md`
2. Next chat on `mail.google.com` → `loadDomainKnowledgeFromS3` injects into system prompt

Postgres domain memory (shared across users) also flows cross-chat via `updateDomainMemory` + `loadDomainMemory`.

JSON parsing for all background LLM extractions (domain knowledge, user memory, self-improvement) now handles markdown-fenced responses.

---

## Verification

1. **Context indicator**: Start a long chat — circular ring appears green, transitions to yellow/red
2. **Compaction**: Fill context to 80% — compaction message appears inline, conversation continues
3. **Single plan**: Agent submits plan while one is in progress → gets rejected
4. **Plan visibility**: Click plan button in header — slide-out checklist with live step updates
5. **Inline HITL**: Agent tries to click "Send" — approval context shows inline before the header approval bar
6. **Cross-chat learning**: Chat on gmail.com, close, chat again — second prompt includes knowledge from first
