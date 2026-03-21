# Phase 19 — Reliability & Intelligence Improvements

> Fix screenshot targeting, plan continuity, OpenAI vision, modular codebase, and storage cleanup.

## Why

After real-world testing (multi-tab Gmail + GitHub workflows), several reliability gaps surfaced:

1. **Screenshots capture the wrong tab** — `captureVisibleTab()` grabs whatever the user is looking at, not the tab the agent is working on. If the user switches to Supabase while an agent works on Gmail, screenshots show Supabase.

2. **Agent forgets plans on follow-up messages** — Plans are persisted in S3 but never loaded back into the system prompt. When the user sends a follow-up, the agent has no idea a plan exists and starts from scratch.

3. **OpenAI can't see screenshots** — Screenshot tool results contain `[TextBlock, ImageBlock]` arrays. Anthropic natively supports images in tool results. OpenAI's `function_call_output` only accepts strings — the image gets `JSON.stringify`'d into a massive base64 blob the model can't interpret visually.

4. **Monolithic files** — 5 files over 600 LOC made the codebase hard to navigate and modify.

5. **Unused storage buckets** — `domains` and `runs` buckets were created but empty. All data actually lives in the `agents` bucket under prefixed paths.

---

## What Shipped

### 19a. Screenshot Tab Targeting

**Problem:** `chrome.tabs.captureVisibleTab()` captures the user's current tab, not the agent's target tab.

**Fix (`apps/extension/src/background/action-handler.ts`):**

- Before taking a screenshot, compare `tab.id` (agent's target) against the user's currently active tab
- If they differ, temporarily switch to the target tab, capture, then switch back
- Generalizes the existing sub-agent tab-switch logic to work for all tab-pinned conversations

### 19b. Plan Continuity Across Messages

**Problem:** Plans stored in S3 are never loaded into the system prompt on follow-up messages. The agent forgets the plan exists.

**Fix (3 files):**

- `apps/api/src/routes/chat.ts` — Load plan from S3 via `loadPlan()` when conversation has a `conversationId`
- `apps/api/src/agent/orchestrator.ts` — Accept `existingPlan: StoredPlan | null` param, forward to `buildSystemPrompt()`
- `apps/api/src/agent/prompts.ts` — Inject "Active Plan" section into system prompt showing each step with status (done/in_progress/pending/failed) and instructions to continue executing rather than starting over

Also shipped: plans are restored in the frontend when loading old conversations (`GET /api/conversations/:id` now returns the full plan from S3).

### 19c. OpenAI Vision for Tool Results

**Problem:** OpenAI's Responses API `function_call_output` only accepts string output. Screenshot tool results with `[TextBlock, ImageBlock]` arrays get `JSON.stringify`'d — the model receives a base64 blob as text, not an actual image.

**Fix (`apps/api/src/llm/providers/openai.ts`):**

- When processing tool results with array content, extract text and images separately
- Text goes into `function_call_output` as the string output
- Images are emitted as a follow-up `user` message with `input_image` type
- OpenAI models now actually _see_ the screenshot instead of getting serialized base64

### 19d. Codebase Modularization

Split 5 large files into 15 focused modules:

| Original          | Lines | →   | New Modules                                                                                                                        |
| ----------------- | ----- | --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator.ts` | 1978  | →   | `orchestrator.ts` (595), `tool-definitions.ts` (334), `internal-tools.ts` (684), `browser-tools.ts` (355), `token-budget.ts` (151) |
| `ChatTab.tsx`     | 1964  | →   | `ChatTab.tsx` (519), `chat-types.ts` (201), `chat-layout.tsx` (312), `message-blocks.tsx` (658), `use-chat-stream.ts` (379)        |
| `ws-client.ts`    | 1415  | →   | `ws-client.ts` (279), `page-scripts.ts` (781), `action-handler.ts` (390)                                                           |
| `agents/page.tsx` | 601   | →   | `page.tsx` (235), `agent-card.tsx` (279), `agent-form.tsx` (144)                                                                   |

### 19e. Storage Cleanup

- Deleted empty `domains` and `runs` Supabase Storage buckets (never contained files)
- Removed leftover `test/` folder from `agents` bucket
- Single `agents` bucket with clean path hierarchy:
  ```
  agents/
    {userId}/{agentSlug}/SOUL.md, SKILLS.md, ...   # Agent files
    {userId}/plans/{convId}/PLAN.md                  # Plans
    domains/{userId}/{domain}/KNOWLEDGE.md, ...      # Domain knowledge
    runs/{userId}/{date}/filename.md                 # Run logs
  ```

### 19f. Plan UI Improvements

- Redesigned plan header button with circular progress ring, animated spinner, completion icons
- Redesigned collapsible plan panel with progress bar, colored step highlighting, running/failed indicators
- Matching inline plan block in message stream
- Plans restored when opening old conversations from history

---

## Files Changed

### Backend

- `apps/api/src/agent/orchestrator.ts` — Slim main loop, accepts `existingPlan`
- `apps/api/src/agent/tool-definitions.ts` — New: internal tool schemas
- `apps/api/src/agent/internal-tools.ts` — New: server-side tool handlers
- `apps/api/src/agent/browser-tools.ts` — New: browser tool execution + safety
- `apps/api/src/agent/token-budget.ts` — New: context window management
- `apps/api/src/agent/prompts.ts` — Inject existing plan into system prompt
- `apps/api/src/routes/chat.ts` — Load plan from S3 on follow-up messages
- `apps/api/src/routes/conversations.ts` — Return plan in GET /:id response
- `apps/api/src/llm/providers/openai.ts` — Extract images from tool results for vision

### Extension

- `apps/extension/src/background/action-handler.ts` — New: action dispatch + screenshot tab fix
- `apps/extension/src/background/page-scripts.ts` — New: injectable page functions
- `apps/extension/src/background/ws-client.ts` — Slim connection management
- `apps/extension/src/sidepanel/tabs/ChatTab.tsx` — Slim main component + plan restore
- `apps/extension/src/sidepanel/tabs/chat-types.ts` — New: types + constants
- `apps/extension/src/sidepanel/tabs/chat-layout.tsx` — New: context bar + plan panel + input
- `apps/extension/src/sidepanel/tabs/message-blocks.tsx` — New: message rendering components
- `apps/extension/src/sidepanel/tabs/use-chat-stream.ts` — New: SSE streaming hook

### Dashboard

- `apps/web/app/(dashboard)/agents/page.tsx` — Slim page
- `apps/web/app/(dashboard)/agents/agent-card.tsx` — New: agent detail card
- `apps/web/app/(dashboard)/agents/agent-form.tsx` — New: agent creation form
