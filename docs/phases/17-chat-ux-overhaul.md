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

### 17a. Real-Time Context Window Indicator

**Problem:** Chat dies mid-task when context is exhausted. User has no warning.

**Backend changes (`orchestrator.ts`):**
- Track estimated token usage per iteration (already computed for budget management)
- Emit new SSE event `context_status` after each LLM call:
  ```typescript
  { type: 'context_status', used: number, limit: number, percent: number }
  ```
- `used` = estimated tokens consumed so far (messages + tool results + system prompt)
- `limit` = model's context window (read from provider config)
- `percent` = used/limit as 0-100

**Extension changes (`ChatTab.tsx`):**
- Circular progress indicator in chat header (top-right, next to existing buttons)
- Color coding: green (<60%), yellow (60-80%), red (>80%)
- Tooltip on hover: "Context: 42,000 / 128,000 tokens (33%)"
- At >85%: show inline warning message "Context window nearly full — consider starting a new chat or compacting"

**Files:** `orchestrator.ts`, `sse.ts` (new event type), `ChatTab.tsx`

### 17b. Conversation Compaction + Continuation

**Problem:** When context fills up, the only option is starting over.

**Backend changes:**
- New internal tool `compact_conversation` available to the orchestrator
- When context hits 80%, orchestrator auto-triggers compaction:
  1. Call fast model: "Summarize this conversation so far — what was accomplished, what's in progress, key facts"
  2. Save full conversation as markdown: `{userId}/compactions/{conversationId}/{timestamp}.md` in Supabase Storage
  3. Replace message history with: `[system] Conversation compacted. Summary: {summary}. Full transcript saved to {path}.`
  4. Continue the conversation with fresh context budget

**Extension changes:**
- Show compaction event as a special message block:
  ```
  ── Conversation compacted ──
  Summary: Sent email to jayesh, navigated to GitHub repo...
  Full transcript: agents/{userId}/compactions/{convId}/2026-03-20.md
  ```
- Manual compaction button in header (next to context indicator) — user can trigger early

**Files:** `orchestrator.ts`, `chat.ts`, new `storage/compaction-files.ts`, `ChatTab.tsx`

### 17c. Single Plan Per Chat (Overwrite, Not Multiply)

**Problem:** Agent creates a new plan every time, doesn't track the old one. Multiple PLAN.md files accumulate.

**Backend changes (`plan-files.ts` + `orchestrator.ts`):**
- One plan per conversation — `savePlan` always overwrites the same path
- `submit_plan` checks if a plan already exists:
  - If existing plan is `in_progress` → reject: "A plan is already in progress. Use update_plan to modify it."
  - If existing plan is `completed`/`failed` → overwrite with new plan
  - If existing plan is `pending`/`approved` → overwrite (plan was never started)
- Plan path stays: `{userId}/plans/{conversationId}/PLAN.md`

**No extension changes needed** — the enforcement is server-side.

**Files:** `orchestrator.ts` (submit_plan handler), `plan-files.ts`

### 17d. Plan Always Visible + Checklist Format

**Problem:** Plans disappear after the approval bar is dismissed. No persistent view. Steps aren't checkboxes.

**Backend changes:**
- Plan markdown format changed to checklist:
  ```markdown
  # Plan
  Send email then review GitHub repo

  ## Steps
  - [ ] Open Gmail and compose email
  - [x] Send the email
  - [ ] Navigate to GitHub repo
  - [ ] Inspect api folder
  - [ ] Summarize contents
  ```
- New SSE event `plan_state` emitted whenever plan changes (submit, approve, step update):
  ```typescript
  { type: 'plan_state', plan: { description, steps: { label, status }[] } | null }
  ```

**Extension changes (`ChatTab.tsx`):**
- New button in chat header: clipboard/checklist icon (top-right)
- Clicking opens a slide-out panel (or modal) showing the current plan
- Plan rendered as checklist with status icons:
  - `○` pending (gray)
  - `◉` in progress (blue, animated)
  - `✓` completed (green)
  - `✗` failed (red)
- Steps are read-only — only the AI can mark them complete (via `update_plan` tool)
- Badge on the button shows progress: "3/5"
- Plan panel auto-opens when a new plan is approved
- Plan panel updates in real-time via `plan_state` SSE events

**Files:** `orchestrator.ts`, `plan-files.ts` (format), `sse.ts` (new event), `ChatTab.tsx` (new panel + button)

### 17e. Inline HITL Approval (In Messages, Not Header)

**Problem:** Approval requests show as a floating bar at the top. User doesn't know which action triggered it. Feels disconnected.

**Backend changes:**
- No backend changes — approval requests already flow via WS with action details

**Extension changes (`ChatTab.tsx`):**
- Remove the floating approval bars (both tool approval and plan approval)
- Instead, render approval requests **inline as message blocks**:
  - Tool approval: appears after the tool_call block that triggered it
    ```
    🔒 Agent wants to click "Send" on mail.google.com
    Reason: Write action detected
    [Approve] [Reject]
    ```
  - Plan approval: appears as a plan block with approve/reject buttons at the bottom
    ```
    📋 Plan: Send email then review GitHub repo
    1. Open Gmail and compose email
    2. Send the email
    3. Navigate to GitHub repo
    4. Inspect api folder
    [Approve Plan] [Reject Plan]
    ```
- After approval/rejection, the block updates in-place:
  - Approved: "✓ Approved" (green, buttons gone)
  - Rejected: "✗ Rejected: {reason}" (red, buttons gone)
- The approval block stays in the message history (scrollable, contextual)

**Files:** `ChatTab.tsx` (major refactor of approval rendering)

---

## Implementation Order

```
17a: Context window indicator    ── Backend SSE + extension UI
17c: Single plan per chat        ── Backend only (quick fix)
17b: Conversation compaction     ── Backend + extension UI (depends on 17a for trigger)
17d: Plan always visible         ── Backend SSE + extension UI
17e: Inline HITL                 ── Extension UI only (biggest refactor)
```

17a and 17c can be done in parallel.
17b depends on 17a (uses the context percentage to trigger).
17d and 17e can be done in parallel after 17c.

---

## Files Modified/Created Summary

| File | Action | Sub-phase |
|------|--------|-----------|
| `packages/shared/src/types/sse.ts` | MODIFY — add `context_status`, `plan_state` events | 17a, 17d |
| `apps/api/src/agent/orchestrator.ts` | MODIFY — emit context_status, enforce single plan, emit plan_state | 17a, 17c, 17d |
| `apps/api/src/storage/plan-files.ts` | MODIFY — checklist format, single-plan enforcement | 17c, 17d |
| `apps/api/src/storage/compaction-files.ts` | **CREATE** — conversation compaction storage | 17b |
| `apps/api/src/routes/chat.ts` | MODIFY — compaction support | 17b |
| `apps/extension/src/sidepanel/tabs/ChatTab.tsx` | MODIFY — context indicator, compaction block, plan panel, inline HITL | 17a-17e |

**Total: 1 new file, 5 modified files.**

---

## Cross-Chat Learning (How Other Chats Benefit)

Domain knowledge already flows across chats via S3:
1. Chat on `mail.google.com` → after completion, `syncDomainKnowledgeToS3` writes to `domains/{userId}/mail_google_com/KNOWLEDGE.md`
2. Next chat on `mail.google.com` → `loadDomainKnowledgeFromS3` reads KNOWLEDGE.md and injects into system prompt as "Domain Knowledge (from past sessions)"

This works for ALL chats (coordinator included), not just named agents. Fixed in this session — the JSON parsing was failing on markdown-fenced responses, now handled.

Postgres domain memory (shared across all users on the same domain) also flows cross-chat via `updateDomainMemory` + `loadDomainMemory`.

---

## Verification

1. **Context indicator**: Start a long chat — green → yellow → red as context fills
2. **Compaction**: Fill context to 80% — see compaction message, conversation continues
3. **Single plan**: Submit two plans in same chat — second overwrites first
4. **Plan visibility**: Click plan button in header — see checklist with live updates
5. **Inline HITL**: Agent tries to click "Send" — approval appears inline below the tool call
6. **Cross-chat learning**: Chat on gmail.com twice — second chat's prompt includes knowledge from first
