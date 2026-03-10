# Phase 9 — Dashboard

The web app (`apps/web`) is currently a bare Next.js page with Clerk auth and a token generator. Phase 9 turns it into a proper dashboard — shadcn/ui layout, conversation history, audit logs, site management, and LLM settings. No new backend features, just UI over existing data.

## What Ships

### Dashboard Shell
- shadcn/ui sidebar layout with navigation
- Responsive — sidebar collapses on mobile
- Clerk user button in sidebar footer

### Pages
1. **History** — Browse past conversations, read message threads, see what tools the agent used
2. **Audit Log** — Table of every action the agent took, with safety levels, timestamps, approval status
3. **Sites** — View indexed sites, pages per site, element counts, last indexed time
4. **Settings** — Choose LLM provider, enter API key, pick strong/fast models
5. **Home** — Overview card with stats (total conversations, total actions, sites indexed) + extension install/connect status

### Backend
- **History API** — List conversations + messages (paginated)
- **Audit API** — Query audit logs with filters
- **Settings API** — Per-user LLM config (CRUD)
- **Sites API** — List sites/pages from Postgres (extension syncs index to backend via existing schema)
- **user_settings table** — New Drizzle table for LLM provider config

### Extension
- Start migrating key UI components to shadcn for consistency (Button, Input, Badge, Card)

## Dashboard Layout

```
┌──────────────┬─────────────────────────────────────┐
│              │  History                             │
│  ■ AFE       │─────────────────────────────────────│
│              │                                     │
│  Home        │  Search conversations...            │
│  History     │                                     │
│  Audit Log   │  ┌─────────────────────────────┐    │
│  Sites       │  │ "Export overdue invoices"    │    │
│  Settings    │  │ erp.company.com · 12 msgs   │    │
│              │  │ 2 hours ago                  │    │
│              │  └─────────────────────────────┘    │
│  ──────────  │                                     │
│              │  ┌─────────────────────────────┐    │
│  [User ▼]    │  │ "Find Q4 report and..."     │    │
│              │  │ hr.company.com · 8 msgs     │    │
│              │  │ yesterday                    │    │
│              │  └─────────────────────────────┘    │
│              │                                     │
└──────────────┴─────────────────────────────────────┘
```

## Database

### New table: user_settings

```typescript
export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => users.id),
  llmProvider: text('llm_provider').default('anthropic'),
  llmApiKey: text('llm_api_key'), // encrypted at rest
  llmModelStrong: text('llm_model_strong').default('sonnet'),
  llmModelFast: text('llm_model_fast').default('haiku'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

No other schema changes — conversations, messages, auditLogs, sites, pages tables already exist.

## API Endpoints

```
GET  /api/conversations                List conversations (paginated, sorted by recent)
GET  /api/conversations/:id            Conversation detail with messages

GET  /api/audit                        Audit logs (paginated, filterable by date/action/level)

GET  /api/sites                        List indexed sites
GET  /api/sites/:domain                Site detail with pages

GET  /api/settings                     Get user's LLM settings
PUT  /api/settings                     Update LLM settings
```

All endpoints use existing Clerk auth middleware. Read-only except settings PUT.

## Page Details

### Home (`/`)
- Stats cards: total conversations, total agent actions, sites indexed
- Extension status: "Connected" / "Not connected — open the extension to get started"
- Quick link to install extension (if first visit)
- Recent activity feed (last 5 conversations)

### History (`/history`)
- List view of conversations
- Each row: first user message (truncated), domain, message count, timestamp
- Click → detail view showing full message thread
- Thread view: user messages (right), assistant messages (left) with tool call blocks inline
- Filter by domain

### Audit Log (`/audit`)
- Data table (shadcn DataTable)
- Columns: Time, Action, Element, Safety Level, Approved, Domain
- Safety level badges: green (safe), yellow (review), red (blocked)
- Filters: date range picker, safety level multi-select, action type
- Sort by any column

### Sites (`/sites`)
- Grid of site cards
- Each card: domain, page count, element count, last indexed timestamp
- Click → site detail page: list of indexed pages with their types and element counts
- Each page expandable to show elements grouped by type

### Settings (`/settings`)
- LLM provider radio group (Anthropic, OpenAI, Google)
- API key input (password field, shows masked value if set)
- Model dropdowns for strong/fast (options depend on selected provider)
- Save button
- Note: These settings override the server-side env vars for this user

## Implementation Order

```
Step 1: shadcn setup + layout shell
        npx shadcn@latest init in apps/web
        Sidebar component, nav items, responsive layout
        → Navigable shell with empty pages

Step 2: Settings page + API + DB migration
        user_settings table, GET/PUT /api/settings
        Settings form with provider/key/model config
        → User can configure their LLM

Step 3: History page + API
        GET /api/conversations, GET /api/conversations/:id
        Conversation list + thread viewer
        → User can review past chats

Step 4: Audit page + API
        GET /api/audit with filters
        DataTable with badges and filters
        → User can see every agent action

Step 5: Sites page + API
        GET /api/sites, GET /api/sites/:domain
        Site cards + page list detail
        → User can see what the agent knows about their apps

Step 6: Home page
        Stats from existing tables (count queries)
        Extension connection status check
        Recent activity
        → Landing page with overview

Step 7: Extension shadcn migration (incremental)
        Swap Button, Input, Badge, Card components
        → Visual consistency
```

## What's NOT in Phase 9

- Task triggers from dashboard (move to Phase 10+ with flows)
- Real-time WS connection to dashboard (just REST APIs + page refresh)
- Conversation search (basic list + filter is enough for now)
- Data export from dashboard (audit CSV export, etc.) — future
- Admin/team views (Phase 14)
