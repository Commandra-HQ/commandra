# Commandra — OpenClaw Experience Audit

> Generated 2026-03-19. Honest assessment of the autonomous agent experience — what works end-to-end, what's broken, what's missing.

---

## The Vision

Agents that work in your browser, learn from every run, and invoke each other. Users create specialized agents through natural conversation. Agents self-improve, run on schedules, and coordinate as swarms. The extension is the control plane — a hub showing what's running, what's been learned, and what's coming next.

---

## Feature Status

| Feature | Status | Maturity | Notes |
|---------|--------|----------|-------|
| Self-improvement | Working | Production | Silent, fire-and-forget |
| Domain memory | Working | Production | Auto-updated, 5min cache |
| User memory | Working | Production | Scored, top-15 injected |
| Pre-seeded knowledge | Missing | Not started | Cold start on every domain |
| Memory recall tool | Working | Production | Vector search + keyword fallback |
| Multi-agent swarm | Working | Beta | Tabs open, identity inherited |
| Agent scheduling | Working | Beta | Cron-based, invisible to user |
| Agent creation from chat | Working | Production | Seamless mid-conversation |
| Planning | Partial | Design-only | Rendered but not enforced |
| Plan persistence | Missing | Not started | Plans lost on reload |
| Hub / multi-chat | Working | Production | Router-based, real-time |
| Safety classification | Working | Hardcoded | Regex rules, no LLM |
| Element resilience | Working | Production | 4-tier fallback |

---

## 1. Self-Improvement

**Status: Working end-to-end**

After every non-coordinator agent run, two fire-and-forget calls:
1. `recordAgentRun()` — inserts into `agent_runs` (status, tool count, duration, error)
2. `analyzeAndImprove()` — fast model analyzes transcript, returns `{ skills, learnings, errors }`

Results appended as timestamped markdown entries to agent files in Supabase Storage:
- `SKILLS.md` — capabilities the agent has demonstrated
- `LEARNINGS.md` — corrections and discoveries
- `ERRORS.md` — failure patterns to avoid

**Are learned files actually used?** Yes. `prompts.ts` injects last 20 learnings + last 10 errors into the system prompt on every subsequent run.

**Coordinator is excluded** — default `_coordinator` never self-improves. Only user-created agents learn.

**What's missing:**
- No UI showing what an agent has learned (have to check dashboard file editor)
- No way to see self-improvement happening in real-time
- No mechanism to prune bad learnings or correct the self-improvement
- No feedback loop from conversation outcomes to learning quality

---

## 2. Memory System

### Domain Memory — Working
- Loaded at chat start, updated post-conversation (background)
- Stores: known pages, element notes, workflows, app behavior
- 5-minute in-memory cache
- Shared across all users for the same domain
- Injected into system prompt automatically

### User Memory — Working
- Per-user-per-domain learnings
- Categories: `preference`, `correction`, `terminology`, `workflow`
- Scoring: `confidence x recency x reinforcement x category priority`
- Top-15 injected + all corrections always loaded
- Auto-extracted from conversations when correction signals detected
- Explicit saves via `save_memory` tool get 1.2x boost
- Max 50 per domain, auto-prunes stale entries (>90 days)
- Reinforced/flagged by conversation outcome ratings (thumbs up/down)

### Memory Recall Tool — Working
- `recall_memory` tool available to orchestrator
- Vector similarity search with keyword fallback
- Returns top-5 matching memories with confidence scores

### Pre-seeded Domain Knowledge — MISSING
- CLAUDE.md says: "Pre-seeded domain knowledge gives agent baseline understanding of popular apps"
- `domain-seeds.ts` is referenced but **does not exist** (or was removed)
- Every domain starts cold — agent has zero knowledge about Gmail, GitHub, etc. on first use
- This is a significant gap for first-run experience

---

## 3. Multi-Agent Swarm

**Status: Fully wired and operational**

**How it works:**
1. Orchestrator calls `spawn_agent` tool with task + optional target agent slug
2. `swarm.ts` opens a dedicated browser tab via `open_tab` WS action
3. Sub-agent runs its own orchestrator loop with target agent's config (SOUL, SKILLS, model, tools)
4. Max 3 concurrent sub-agents, 10 iterations each, 2-minute timeout
5. `wait_for_agents` tool blocks until all sub-agents complete
6. Results aggregated and returned to parent

**Identity inheritance:** Sub-agents get the target agent's personality (SOUL.md), learned skills/errors, model preference, and tool allowlist. They run as that agent, not as the coordinator.

**Depth limiting:** At depth >= 2, `spawn_agent` and `wait_for_agents` are excluded from the tool list. Prevents infinite nesting.

**Extension UX:**
- Sub-agents render as collapsible blocks in the chat message
- Each shows: task, target URL, action list with screenshots, final summary
- Sub-agent tabs persist after completion (user can inspect)
- No automatic cleanup of sub-agent tabs

**What triggers spawning:** The LLM decides — `chat.ts` detects multi-site intent via regex patterns (2+ different domains mentioned), but actual spawning is LLM-initiated via tool call, not auto-triggered.

---

## 4. Agent Scheduling

**Status: Working but invisible**

**Startup:** `startScheduler()` called on server boot. Stopped on SIGTERM/SIGINT.

**Tick loop (every 60s):**
1. Query agents with cron triggers
2. Check user has active WS connection (offline users skipped)
3. 5-field cron match (minute, hour, day-of-month, month, day-of-week)
4. "Cheap check" with fast model — YES/NO decision before full run
5. If YES: open background tab, create conversation, run orchestrator
6. Fire-and-forget: `recordAgentRun()` + `analyzeAndImprove()`

**Extension notification:** `scheduled_agent_start` and `scheduled_agent_end` events forwarded to sidepanel. Hub shows running agents with elapsed timer.

**What's missing:**
- No scheduled run history visible anywhere (not in extension, not in dashboard)
- No way to pause/resume from UI (have to edit agent trigger via API)
- No run logs per agent in dashboard
- Conversation title is `[Scheduled] AgentName` — but user has to find it manually in history
- If user isn't online (no WS connection), scheduled runs silently skip

---

## 5. Agent Creation from Chat

**Status: Fully wired, production-quality**

Two tools available to the orchestrator:
- `create_agent` — slug, name, description, soul, domains (optional), cron (optional)
- `update_agent_files` — agentSlug, filename, content

**Flow:** LLM detects repeatable workflow or explicit user request → creates agent in DB + uploads SOUL.md to Supabase Storage → returns confirmation to user.

**Prompt guidance tells LLM when to trigger:** repeatable workflows, scheduled tasks, "remember how to do this", explicit "create an agent" requests.

**What's good:** Agents emerge from usage. User never needs to visit dashboard to create one.

**What's missing:** No confirmation dialog — LLM just creates the agent. User has to go to dashboard to edit or delete.

---

## 6. Planning

**Status: Rendered but not enforced**

**What works:**
- System prompt includes comprehensive planning instructions (70+ lines in `planner.ts`)
- For 3+ step tasks, LLM generates plan as `<!--plan:{"steps":[...],"description":"..."}-->`
- Extension parses and renders plan as block with step list + per-step status tracking
- Steps update status as tools execute (pending → running → done/error)

**What's broken:**
- **Plan approval is advisory only** — instructions say "WAIT for user to approve" but there's no execution gate
- `isPlanApproval()` function exists in `planner.ts` but is never called
- LLM can (and does) ignore the "wait" instruction and execute immediately
- No "Approve Plan" button in UI — user just types naturally

**What's missing:**
- **Plans are not persisted** — lost on page reload, not stored anywhere
- No plan history or versioning
- No way to edit a plan before execution
- Can't resume a partially-completed plan after disconnection

---

## 7. Hub / Multi-Chat

**Status: Working with router + context**

**Current architecture (post-refactor):**
- `App.tsx` uses `react-router-dom` with routes: `/` (hub), `/chat`, `/chat/:conversationId`, `/settings`
- `HubLayout` wraps hub with header + settings gear
- `useActiveChats` context tracks in-progress conversations
- `useAuth` context handles token + user state

**Hub shows:**
- New Chat button with current domain context
- "Running" section with active chats (elapsed timer, agent name)
- Recent conversations list (title, message count, relative time, agent badge)

**What works:** Click conversation → loads in chat view. Click "New Chat" → empty chat. Back button returns to hub. Active chats update in real-time via WS events.

---

## 8. Safety System

**Status: Deterministic regex rules — no LLM**

**Classification logic (`classifier.ts`):**
- Layer 1: Tool name defaults (read-only tools → safe)
- Layer 2: Label-based regex on element text/selector
- Three levels: safe / review / blocked

**Rules:**
- **Safe:** view, details, show, open, close, cancel, search, filter, sort, next, back...
- **Review:** submit, save, send, create, update, edit, confirm, apply, post, publish...
- **Blocked:** delete, remove, destroy, drop, reset, revoke, disable, ban, terminate, purge...
- **Special:** typing in password/token/SSN/card fields → review

**Execution:**
- Safe tools: parallel (`Promise.allSettled`)
- Review tools: sequential, user approval via WS gate
- Blocked tools: rejected immediately

**What's missing:**
- No contextual understanding ("delete draft" vs "delete account")
- No learning from false positives
- No user-configurable safety levels per agent

---

## 9. Element Resilience

**Status: Production-quality, 4-tier fallback**

1. **Primary selector** — data-testid, aria-label, name, stable ID, class-based, nth-child
2. **Fallback selectors** — up to 3 alternatives generated at index time
3. **Fuzzy label matching** — aria-label, text, placeholder — scored by word overlap (threshold 0.4)
4. **Vector search** — backend embedding search by label + element type (last resort)

Plus automatic 1.5s retry on "not found" for SPA DOM transitions.

**Selector building priority:** `[data-testid]` → `[aria-label]` → `[name]` → stable `#id` (rejects auto-generated) → `[placeholder]` → class-based → nth-child path

---

## Gaps That Matter Most

### 1. Pre-seeded Domain Knowledge (HIGH)
Every domain starts cold. First interaction with Gmail requires the agent to discover everything from scratch. A `domain-seeds.ts` with baseline knowledge for the top 10 apps would dramatically improve first-run experience.

### 2. Plan Persistence + Approval Gate (HIGH)
Plans vanish on reload. No execution gate means the agent can ignore "wait for approval." Storing plans as `PLAN.md` in Supabase Storage per conversation would fix persistence. A proper approval tool call would fix the gate.

### 3. Scheduled Agent Visibility (MEDIUM)
Scheduled runs are invisible. User has no way to see run history, logs, or outcomes without digging through conversation history. Need: agent detail page with run log, or at minimum a "Scheduled Runs" section in hub.

### 4. Self-Improvement Visibility (MEDIUM)
Users can't see what agents have learned. No diff view, no "what changed after this run." The dashboard file editor exists but requires manual navigation. A "Recently Learned" indicator on the hub would surface this.

### 5. Safety Learning (LOW)
Hardcoded regex works but is brittle. "Delete draft" gets blocked same as "Delete account." Eventually needs contextual classification, but current rules are functional for beta.

---

## Proposed: Plan Storage per Conversation

Store plans as `{userId}/conversations/{convId}/PLAN.md` in Supabase Storage.

**Flow:**
1. Orchestrator generates plan → writes `PLAN.md` to storage
2. Each step completion → updates step status in `PLAN.md`
3. Hub can show "Plan: 3/7 steps done" for active chats
4. Conversation resume → load `PLAN.md` and inject into context
5. User can view/edit plan from dashboard conversation detail page

**Schema addition:** Add `planStatus` jsonb to `conversations` table for quick hub queries without reading storage:
```json
{ "totalSteps": 7, "completedSteps": 3, "status": "in_progress" }
```

**Approval gate:** Add a `plan_approval` tool that the orchestrator must call before executing. This tool sends the plan to the extension via SSE and blocks until the user approves/edits/rejects. Unlike the current advisory "wait for approval" instruction, this would be an actual execution gate.

This turns plans from ephemeral chat artifacts into persistent, trackable, resumable workflows — which is the OpenClaw vision.
