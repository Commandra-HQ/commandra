# Phase 5 — Safety Layer

## Goal

Every browser action is classified before execution. Safe actions auto-execute (agent stays autonomous). Risky actions pause for user approval. Destructive actions are blocked. An audit log records everything. Escape key kills all agent activity instantly.

## How It Works

```
Agent wants to call click_element({ selector: "#submit-btn" })
       |
  classifyAction("click_element", "#submit-btn", "Submit Order")
       |
       +-- "safe"    → auto-execute, log to audit
       +-- "review"  → send approval_request to extension
       |                user sees: "Click 'Submit Order' — [Approve] [Reject]"
       |                user approves → execute, log
       |                user rejects → tell agent "user rejected", log
       |                60s timeout → auto-reject
       +-- "blocked" → reject immediately, tell agent why, log
```

### Classification Logic

Two layers:

**Layer 1 — Action type defaults** (from shared ACTION_SAFETY map):
- `get_page_state`, `navigate`, `scroll` → safe
- `click`, `type`, `select` → review (default, overridden by Layer 2)

**Layer 2 — Context-aware label analysis** (overrides Layer 1):
- Element label contains safe words (next, back, view, details, show, open, close, cancel, search, filter, sort, page, tab) → safe
- Element label contains risky words (submit, save, send, create, update, edit, confirm, apply, post, publish, upload) → review
- Element label contains dangerous words (delete, remove, destroy, drop, reset, revoke, disable, block, ban, terminate, purge) → blocked
- Navigation to same domain → safe
- Navigation to different domain → review
- Typing in password/payment fields → review (regardless of label)

### What the agent sees

- **safe action executed**: normal tool result
- **review action approved**: normal tool result (agent doesn't know it was gated)
- **review action rejected**: tool result with `{ success: false, error: "User rejected this action. Reason: [optional]" }` — agent replans
- **blocked action**: tool result with `{ success: false, error: "Blocked: clicking 'Delete Account' is a destructive action. Ask the user to confirm explicitly." }` — agent tells user

## What Ships

### Backend — Action Classifier

- `classifyAction(toolName, args, elementLabel?)` returns `safe` | `review` | `blocked`
- Uses ACTION_SAFETY defaults + label-based context analysis
- Lives in `apps/api/src/safety/classifier.ts`

### Backend — Approval Gate

- New WS message types: `approval_request` / `approval_response`
- Promise-based like action_request: send request, await response, 60s timeout
- Integrated into the agentic loop — between Claude's tool_use and actual execution

### Backend — Audit Logger

- Every action logged to `audit_logs` table (already exists in schema)
- Records: userId, action, safetyLevel, approved (bool), metadata (args, result, elementLabel)
- Append-only

### Backend — Kill Switch Handler

- WS `kill` message from extension cancels all pending actions + approvals for that user
- Agentic loop checks a `killed` flag between iterations
- Returns immediately with "Agent stopped by user"

### Extension — Approval UI

- When `approval_request` arrives, show inline in activity feed:
  - Action description: "Click 'Submit Order' button"
  - Two buttons: Approve (green) / Reject (red)
  - Optional: text input for rejection reason
- Sends `approval_response` back over WS with `{ approved: true/false }`
- Auto-rejects after 60s with visual countdown

### Extension — Kill Switch

- Escape key sends `kill` message (already wired in Phase 1)
- Activity feed shows "Agent stopped" banner
- All pending approvals dismissed

## Technical Decisions

- **Classification is server-side** — the backend has page context and element labels. Extension just shows UI.
- **Per-action gating, not per-plan** — each action gates individually. The agent might plan 3 steps, but step 2 could be blocked even if step 1 was safe.
- **Label analysis is keyword-based** — no LLM call for classification. Fast, deterministic, auditable. Can upgrade to LLM-based later if needed.
- **60s approval timeout** — prevents hanging if user walks away. Auto-reject, agent gets "timed out waiting for approval."
- **Blocked actions still return tool results** — the agent sees the block reason and can replan or inform the user. It's not a crash, it's a signal.

## Out of Scope

- LLM-based classification (later — keyword rules are sufficient for now)
- Custom safety rules per site/user (Phase 14)
- Undo/rollback of executed actions
- Screenshot verification before approval

## Implementation Order

1. **Classifier** — `classifyAction()` with label analysis
2. **Audit logger** — `logAction()` writing to audit_logs
3. **Approval WS messages** — approval_request/response types and promise-based handler
4. **Wire into agentic loop** — classify → gate → execute → log
5. **Approval UI** — inline approve/reject in activity feed
6. **Kill switch** — Escape cancels pending, stops loop
7. **Test** — safe auto-executes, review pauses, blocked rejects, kill stops everything

## How to Verify

1. `make dev`, navigate to a site, index, open side panel
2. "Click the Next button" → auto-executes (safe), no approval prompt
3. "Click the Submit button" → approval prompt appears, click Approve → executes
4. "Click the Delete button" → blocked, agent says "this action is blocked"
5. Start a multi-step task, press Escape mid-execution → agent stops
6. Check audit_logs table in Drizzle Studio — all actions logged
