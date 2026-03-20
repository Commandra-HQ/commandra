# Phase 10c: Adaptive Agent Memory

> The agent gets smarter with every interaction — learning each user's preferences, corrections, and patterns.

## Why This Phase

Today the agent has **domain memory** (shared knowledge about each web app) and **conversation compression** (keeping context manageable). But it doesn't learn about the *user*. Every session starts fresh with no knowledge of:

- User corrections ("no, that's the wrong button — use the one in the sidebar")
- Preferences ("I always want data exported as CSV, not JSON")
- Workflow habits ("when I say 'run the report', I mean the weekly sales report")
- Navigation shortcuts ("I always start from the Analytics page")

Claude Code solves this with **auto-memory**: notes the AI writes for itself based on corrections and patterns, loaded into every future session. We adapt this pattern for browser automation.

## Architecture: Two Memory Layers

```
┌─────────────────────────────────────────────────┐
│                 System Prompt                     │
│                                                   │
│  ## What You Know About This App                  │
│  (domain_memory — shared, all users)              │
│  - Known pages, workflows, element quirks         │
│                                                   │
│  ## What You Know About This User                 │
│  (user_memory — personal, per user per domain)    │
│  - Preferences, corrections, habits, shortcuts    │
│                                                   │
└─────────────────────────────────────────────────┘
```

| Layer | Scope | Who writes it | What it contains |
|-------|-------|---------------|------------------|
| **Domain memory** (exists) | Per domain, shared | Agent (post-task extraction) | App structure, workflows, element notes |
| **User memory** (new) | Per user per domain | Agent (auto-learn) + user (explicit) | Preferences, corrections, habits, terminology |

## What Gets Stored in User Memory

### Categories

1. **Preferences** — How the user likes things done
   - "Export as CSV, not JSON"
   - "Always use the compact view"
   - "Prefers keyboard shortcuts over clicking"

2. **Corrections** — Things the user corrected the agent on
   - "The 'Submit' button is at the bottom of the form, not the top"
   - "Don't click 'Save Draft' — use 'Publish' instead"
   - "'Clients' in this app means the same as 'Customers'"

3. **Terminology** — User's shorthand and domain language
   - "When I say 'the report', I mean the Weekly Sales Report"
   - "'QBR deck' means Quarterly Business Review presentation"
   - "'Push to prod' means click Deploy > Production > Confirm"

4. **Workflow habits** — Repeated patterns
   - "User always filters by date range before exporting"
   - "User prefers to navigate via search bar, not sidebar"
   - "After creating an invoice, user always sends it immediately"

## How Memory Gets Written

### 1. Auto-learning from conversations (primary)

After each conversation (same place domain memory updates happen), a second extraction pass runs for user-specific learnings:

```
Fast model prompt:
"Analyze this conversation for USER-SPECIFIC patterns. What did you learn about
how THIS USER prefers to work? Look for:
- Corrections (user said 'no, not that' or redirected you)
- Stated preferences ('I always want...', 'use X instead of Y')
- Terminology ('when I say X, I mean Y')
- Repeated patterns (user consistently does things a certain way)

Only include concrete, specific observations. Do not guess."
```

This runs in the background, non-blocking, same as domain memory updates.

### 2. Explicit "remember this" (secondary)

User says: "Remember that I always want invoices sorted by date"
→ Agent detects the intent to save a preference
→ Stores it directly without needing the post-conversation extraction

The agent has a `save_memory` tool call that writes to user memory. This is NOT a browser action tool — it's an internal agent tool that doesn't go through WebSocket.

### 3. Memory deduplication & conflict resolution

When new memories come in:
- **Same topic, new info**: Replace the old memory (e.g., user changes preference)
- **Contradiction**: New memory wins (user corrected themselves)
- **Duplicate**: Skip (don't store the same thing twice)

The fast model handles dedup by seeing existing memories alongside new candidates.

## Database Schema

```sql
-- New table: per-user-per-domain memory
CREATE TABLE user_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  domain TEXT NOT NULL,
  category TEXT NOT NULL,        -- 'preference' | 'correction' | 'terminology' | 'workflow'
  content TEXT NOT NULL,         -- The actual memory text
  source TEXT NOT NULL,          -- 'auto' | 'explicit' (how it was created)
  confidence REAL DEFAULT 1.0,   -- 0-1, auto-memories start lower
  times_reinforced INT DEFAULT 1, -- Bumped when same pattern seen again
  last_used_at TIMESTAMP,        -- Track when memory was last loaded into prompt
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookup
CREATE INDEX idx_user_memory_lookup ON user_memory(user_id, domain);
```

No embedding needed for user memory — it's loaded in full per user per domain (expected to stay small, <50 entries per user per domain). If it grows too large, we summarize/prune.

## System Prompt Integration

```typescript
// In prompts.ts buildSystemPrompt()

let userMemorySummary = '';
if (userMemory?.length) {
  const grouped = groupBy(userMemory, 'category');
  const sections: string[] = ['## What You Know About This User'];

  if (grouped.preference?.length) {
    sections.push('### Preferences');
    for (const m of grouped.preference) sections.push(`- ${m.content}`);
  }
  if (grouped.correction?.length) {
    sections.push('### Corrections (important — follow these)');
    for (const m of grouped.correction) sections.push(`- ${m.content}`);
  }
  if (grouped.terminology?.length) {
    sections.push('### User Terminology');
    for (const m of grouped.terminology) sections.push(`- ${m.content}`);
  }
  if (grouped.workflow?.length) {
    sections.push('### Workflow Patterns');
    for (const m of grouped.workflow) sections.push(`- ${m.content}`);
  }

  userMemorySummary = '\n\n' + sections.join('\n');
}
```

## Memory Management

### Dashboard UI (apps/web)

New page at `/memory` in the dashboard:

- **Memory viewer**: See all learned memories grouped by domain, then by category
- **Edit/delete**: Click any memory to edit the text or delete it
- **Add manually**: "Add a memory" button to write something explicitly
- **Domain filter**: Switch between domains to see domain-specific memories
- **Bulk actions**: "Clear all memories for this domain"

### Extension side panel

In the Settings tab, add a "Memory" section:
- Show count of memories for current domain
- Link to dashboard memory page
- "Forget everything about this site" button

### Agent tools

One new internal tool (not a browser action):

```typescript
{
  name: 'save_memory',
  description: 'Save something to remember about this user for future sessions',
  parameters: {
    category: 'preference | correction | terminology | workflow',
    content: 'What to remember',
  }
}
```

This tool is available to the orchestrator but doesn't route through WebSocket.

## Memory Lifecycle

```
Session Start
  ├── Load domain memory (existing)
  ├── Load user memory for this user + domain (new)
  └── Inject both into system prompt

During Session
  ├── Agent uses memory to inform decisions
  ├── Agent can call save_memory for explicit requests
  └── User corrections naturally captured in transcript

Session End
  ├── Extract domain learnings (existing)
  ├── Extract user learnings (new) ← same background pass
  ├── Deduplicate against existing memories
  └── Store/update user_memory table

Over Time
  ├── times_reinforced increases for repeated patterns
  ├── Unused memories get pruned (>90 days, never reinforced)
  ├── confidence increases with reinforcement
  └── Agent gets noticeably better for returning users
```

## Pruning & Limits

- Max 50 memories per user per domain (prevents prompt bloat)
- Auto-prune: memories not used in 90 days with times_reinforced=1 get soft-deleted
- If limit reached: lowest confidence memories get removed first
- User can always override by explicitly saving (explicit > auto)

## Implementation Steps

### Step 1: Schema + migration
- Add `user_memory` table to schema.ts
- Generate and run Drizzle migration

### Step 2: Memory CRUD module
- `apps/api/src/memory/user.ts`
- `loadUserMemory(userId, domain)` → formatted string
- `saveUserMemory(userId, domain, category, content, source)`
- `updateUserMemory(entries, newLearnings)` → deduplicated merge
- `pruneUserMemory(userId, domain)` → cleanup old entries
- `deleteUserMemory(id)` / `clearUserMemory(userId, domain)`

### Step 3: Auto-extraction in chat route
- After successful conversation, run user learning extraction alongside domain extraction
- Use fast model with USER_LEARN_PROMPT
- Merge results into user_memory table

### Step 4: System prompt integration
- Extend `buildSystemPrompt()` to accept and render user memory
- Load user memory in chat route alongside domain memory
- Pass to orchestrator

### Step 5: save_memory tool
- Add internal tool to orchestrator (no WS routing)
- Agent can explicitly save memories mid-conversation
- Handles "remember that..." requests

### Step 6: API routes for memory management
- `GET /api/memory/:domain` — list memories for domain
- `GET /api/memory` — list all memories (grouped by domain)
- `PUT /api/memory/:id` — edit a memory
- `DELETE /api/memory/:id` — delete a memory
- `DELETE /api/memory/domain/:domain` — clear all for domain

### Step 7: Dashboard memory page
- Memory viewer with domain grouping
- Edit/delete individual memories
- Add memory manually
- Filter by category

### Step 8: Extension memory indicator
- Memory count badge in Settings tab
- "Forget this site" button
- Link to dashboard memory page

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/db/schema.ts` | Add `userMemory` table |
| `apps/api/src/memory/user.ts` | New — user memory CRUD |
| `apps/api/src/memory/domain.ts` | Minor — share extraction util |
| `apps/api/src/agent/prompts.ts` | Add user memory section to system prompt |
| `apps/api/src/agent/orchestrator.ts` | Add save_memory tool, pass user memory |
| `apps/api/src/routes/chat.ts` | Load user memory, trigger user learning extraction |
| `apps/api/src/routes/memory.ts` | New — memory management API routes |
| `apps/api/src/routes/index.ts` | Mount memory routes |
| `apps/web/src/app/dashboard/memory/page.tsx` | New — dashboard memory page |
| `apps/extension/src/sidepanel/tabs/SettingsTab.tsx` | Memory indicator + forget button |
| `packages/shared/src/types.ts` | UserMemory types |

## What This Enables

1. **Agent gets better with every use** — corrections stick, preferences remembered
2. **Personalized automation** — same app, different users, different behaviors
3. **Reduced friction** — user stops repeating themselves across sessions
4. **Trust building** — user sees the agent learning, feels more confident
5. **Foundation for teams** — in Phase 14, team-shared memories become possible (shared corrections, shared terminology)
