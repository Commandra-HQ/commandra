# Phase 30 — Notifications, MCP Integration & Skill Packs

> Make agents something you'd actually hand off and forget: outbound notifications when tasks finish, MCP client so agents can touch any API beyond the browser, MCP server so external AI tools can drive your browser, and pre-built skill packs to eliminate cold-start.

---

## Why

The durable orchestrator (Phase 32) means tasks survive disconnects and run unattended. But there's no way to know when they finish. Scheduled agents run at 2am and you find out in the morning by checking the dashboard. That's not agentic — that's a cron job with extra steps.

Beyond that, agents are currently browser-only. They can extract data from Salesforce but can't file a GitHub issue, post to Slack, or query your own database. Every integration requires the user to navigate to the page manually. This is the ceiling.

Three things will break through it:

1. **Notifications** — you send a task, you walk away, your phone buzzes when it's done
2. **MCP client** — agents connect to external MCP servers (GitHub, Slack, Notion, Postgres) and treat them as tools alongside browser actions
3. **MCP server** — any AI client (Claude Desktop, Cursor, Cline) can drive Commandra's browser automation via the MCP protocol
4. **Skill packs** — pre-built SKILLS.md templates for common apps; new agents aren't born cold

---

## Phase 30a — Outbound Notifications

### What Ships

#### Webhook Notifications (per-agent)
- New field on the `agents` table: `notifications` JSONB
  ```json
  {
    "webhook": "https://hooks.slack.com/...",
    "onComplete": true,
    "onFailure": true,
    "onApprovalRequired": false
  }
  ```
- After every agent run, `notifyAgentRun()` fires (fire-and-forget, never blocks response):
  - Checks `agent.notifications.webhook`
  - POSTs `{ agentSlug, agentName, status, summary, durationMs, toolCalls, error?, conversationId, runAt }` to the webhook URL
  - Timeout: 5s. Failures are logged to `ERRORS.md`, never retried (webhooks are best-effort)
- Works with Slack incoming webhooks, Discord, n8n, Zapier, Make — anything that accepts a POST

#### Browser Push Notifications (extension)
- `chrome.notifications.create()` on run complete/fail
- Title: agent name + status ("Invoice Extractor ✓ Completed" / "Invoice Extractor ✗ Failed")
- Message: one-line summary from the run (first sentence of final assistant message)
- Icon: Commandra logo
- Click → opens side panel focused on that conversation
- Only fires when the task was started from the dashboard (not user-initiated chat — those are visible)

#### Email on Failure (optional, self-hosted)
- New env var: `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- On agent run failure: send plain-text email with agent name, task, error, link to conversation
- Uses `nodemailer` (already common in Node ecosystems). No transactional email vendor required.
- Disabled by default. Opt-in per-agent via `notifications.email: true`

#### Dashboard: Notification Settings per Agent
- New "Notifications" section in the agent form (agent creation + edit)
- Fields: webhook URL (text input), notify on complete (checkbox), notify on failure (checkbox, default on), test button (fires a dummy POST to verify the URL works)

### Files Changed
- `apps/api/src/db/schema.ts` — add `notifications` JSONB to `agents` table
- `apps/api/src/agent/self-improve.ts` — call `notifyAgentRun()` after `recordAgentRun()`
- `apps/api/src/agent/notifications.ts` — new file: `notifyAgentRun()`, `sendWebhook()`, `sendFailureEmail()`
- `apps/extension/src/background/action-handler.ts` — push notification on run complete/fail message from WS
- `apps/web/app/(dashboard)/agents/agent-form.tsx` — add notification settings section
- `packages/shared/src/types.ts` — add `AgentNotifications` type

---

## Phase 30b — Fire-and-Forget UX

### What Ships

The durable orchestrator already runs tasks in the background. The problem is the UX pretends they don't exist once you close the side panel.

#### Extension Popup Badge
- Extension popup (the icon click) shows a live badge: "2 running / 1 paused"
- Lists active runs: agent name, elapsed time, last tool call
- Click → opens side panel to that conversation
- Badge on the extension icon itself: `chrome.action.setBadgeText({ text: '2' })` for active runs
- Badge color: blue (running), yellow (paused/approval needed), red (failed)

#### "Run in Background" Toggle in Chat Input
- Toggle button in the chat input bar (alongside the send button)
- When enabled: sends the message, collapses the side panel automatically, shows a toast "Running in background — you'll be notified when done"
- When the run completes: browser push notification fires (30a)
- This is the "fire and forget" flow

#### `/runs` Dashboard Page
- New page at `/runs` in the web dashboard
- Live list of all active + recent runs across all agents
- Columns: agent name, task summary, status (running/paused/completed/failed), started, duration, tool calls, error
- Status auto-refreshes every 5s via polling `GET /api/runs?limit=50`
- Click any row → link to conversation in the extension (deep link via `commandra://conversation/:id`)
- Filter by: all / running / failed / today
- This replaces the scattered run history in individual agent cards

#### `GET /api/runs` Endpoint
- Returns recent `agent_runs` joined with agent name + conversation status
- Supports `?status=running&limit=50&offset=0`
- Returns `{ data: AgentRun[], total: number }`

### Files Changed
- `apps/extension/src/background/ws-client.ts` — track active runs, update badge
- `apps/extension/src/sidepanel/tabs/chat-layout.tsx` — background toggle in input bar
- `apps/api/src/routes/runs.ts` — new route file: `GET /api/runs`
- `apps/api/index.ts` — register runs routes
- `apps/web/app/(dashboard)/runs/page.tsx` — new runs dashboard page
- `apps/web/lib/queries/use-runs.ts` — TanStack Query hook
- `apps/web/components/ui/` — RunsTable component (TanStack Table)

---

## Phase 30c — MCP Client (Agents Consume External MCP Servers)

### What

Agents can connect to external MCP servers during runs. An agent browsing Salesforce can simultaneously read GitHub issues, post to Slack, query Postgres, or write to Notion — treated as first-class tools alongside `click_element` and `navigate`.

### Why This Is the Big One

Every browser automation tool is browser-only. Agents that can reach any MCP server in a single workflow are categorically different. A single Commandra agent could:
- Extract invoice data from NetSuite
- Match it against GitHub issues for disputed amounts
- Update the Slack channel with a summary
- Write results to a Notion database

No stitching tools together. One agent, one run.

### What Ships

#### MCP Server Registry (per-user)
- New table: `mcp_servers`
  ```sql
  id, user_id, name, url, transport (stdio | sse | streamable-http),
  auth_type (none | bearer | header), auth_value (encrypted),
  enabled, created_at
  ```
- Dashboard page: `/integrations` — add/edit/remove MCP servers, test connection, see available tools
- `GET /api/mcp` — list user's configured MCP servers
- `POST /api/mcp` — add server (validates connection on creation)
- `DELETE /api/mcp/:id` — remove server

#### MCP Client Layer
- New file: `apps/api/src/mcp/client.ts`
- `connectMcpServer(server: McpServer): Promise<McpConnection>` — connects via SSE or streamable-HTTP transport
- `listMcpTools(connection): McpTool[]` — returns tools in Commandra's provider-agnostic schema format
- `callMcpTool(connection, toolName, args): Promise<any>` — calls tool, returns result
- `disconnectMcpServer(connection)` — cleanup
- Per-run connection pool: connections opened at run start, closed at run end
- Timeout: 30s per tool call. Failures surface as tool errors (agent decides how to recover)

#### Dynamic Tool Injection
- `buildToolList()` in `tool-definitions.ts` accepts optional `mcpTools: McpTool[]`
- MCP tools injected alongside built-in tools under the prefix `mcp__<serverName>__<toolName>`
  - e.g. `mcp__github__create_issue`, `mcp__slack__post_message`, `mcp__postgres__query`
- Tool descriptions include the MCP server name so the agent understands the context
- MCP tools go through safety classification the same as any other tool:
  - Read-only operations → safe
  - Write/create operations → review (approval gate)
  - Destructive operations → blocked

#### Orchestrator Integration
- `apps/api/src/agent/orchestrator.ts`:
  - At run start: `connectUserMcpServers(userId)` — load enabled servers, connect, build tool list
  - Pass `mcpTools` to `buildToolList()`
  - Route `mcp__*` tool calls to `handleMcpToolCall()` in `internal-tools.ts`
  - At run end: disconnect all MCP connections

#### Per-Agent MCP Restrictions
- `agents.mcpServers` JSONB: optional allowlist of MCP server IDs for this agent
- If null → agent gets all user's enabled MCP servers
- If set → agent only gets those specific servers
- Configured per-agent in the dashboard

#### Well-Known MCP Servers (Quick-Add)
Dashboard `/integrations` page shows a quick-add list of common servers:
- **GitHub** — create issues, list PRs, comment on issues (`github.com/modelcontextprotocol/servers`)
- **Slack** — post messages, list channels (`github.com/modelcontextprotocol/servers`)
- **Notion** — create/update pages, query databases
- **PostgreSQL** — query your own database
- **Filesystem** — read/write local files (self-hosted only)
- **Fetch** — HTTP requests to any URL
- Each has a pre-filled URL + auth instructions

### Files Changed
- `apps/api/src/db/schema.ts` — add `mcp_servers` table
- `apps/api/src/mcp/client.ts` — new file: MCP client layer
- `apps/api/src/mcp/index.ts` — new file: `connectUserMcpServers()`, `disconnectAll()`
- `apps/api/src/agent/tool-definitions.ts` — accept `mcpTools` param in `buildToolList()`
- `apps/api/src/agent/internal-tools.ts` — `handleMcpToolCall()` handler + `INTERNAL_TOOL_NAMES` entries for `mcp__*`
- `apps/api/src/agent/orchestrator.ts` — connect MCP at run start, inject tools, disconnect at end
- `apps/api/src/routes/mcp.ts` — new route file: CRUD for MCP server registry
- `apps/api/index.ts` — register MCP routes
- `apps/web/app/(dashboard)/integrations/page.tsx` — new integrations page
- `apps/web/lib/queries/use-mcp.ts` — TanStack Query hooks
- `packages/shared/src/types.ts` — `McpServer`, `McpTool` types
- DB migration: `mcp_servers` table + `agents.mcp_servers` JSONB column

### Non-Goals
- No building custom MCP servers — users point to existing ones
- No stdio transport (server process management is out of scope for cloud; self-hosted can use a proxy like `mcp-proxy`)
- No MCP sampling or roots — just tools

---

## Phase 30d — MCP Server (Commandra as a Tool Source)

### What

Expose Commandra's browser tool registry as an MCP server. Any MCP-compatible AI client — Claude Desktop, Cursor, Cline, Zed, Continue — can connect to Commandra and use browser automation as tools.

```
Claude Desktop → MCP client → Commandra MCP server → WebSocket → Extension → Browser
```

### Why

Developers who already use Claude Desktop or Cursor can get browser automation without switching to Commandra's UI. This is a distribution channel.

### What Ships

#### MCP Server Endpoint
- New HTTP handler: `GET /api/mcp/server` — SSE-based MCP server (streamable-HTTP transport)
- Implements MCP protocol: `initialize`, `tools/list`, `tools/call`
- Authenticated via API key (new `api_keys` table, user generates in dashboard)
- Tools exposed: all browser tools from the Commandra tool registry (same tool definitions, translated to MCP format)
- Tool calls routed through the full orchestrator (safety classification, approval gates, audit logging — everything still applies)

#### API Key Management
- New table: `api_keys` — `id`, `user_id`, `name`, `key_hash`, `last_used`, `created_at`
- Dashboard: `/settings/api-keys` — generate, name, revoke keys
- Keys are shown once on creation (bcrypt-hashed in DB)
- Auth middleware: `Authorization: Bearer <key>` → look up by hash → resolve user

#### Claude Desktop Config (Documentation)
```json
{
  "mcpServers": {
    "commandra": {
      "url": "https://your-commandra.com/api/mcp/server",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

#### Tool Set Exposed
All browser tools, mapped to MCP tool format:
- `click_element`, `type_text`, `select_option`, `navigate`, `scroll`, `screenshot`
- `get_page_state`, `read_text`, `read_table`, `wait_for_element`, `export_data`
- `list_tabs`, `switch_tab`
- `save_knowledge`, `read_knowledge`, `list_knowledge` (internal tools exposed as MCP)

Not exposed: `spawn_agent`, `create_agent`, `wait_for_agents` (agent management stays in-product)

#### Approval Gates Over MCP
- Review-class actions (form submits, creates, updates) pause and send an `approval_required` notification via the extension before executing
- The MCP tool call blocks until approved or rejected (30s timeout → auto-reject)
- Approval UI: same inline approval widget in the extension side panel
- This is a hard constraint — can't be disabled, ensures the user stays in control even from external clients

### Files Changed
- `apps/api/src/mcp/server.ts` — new file: MCP server protocol handler
- `apps/api/src/db/schema.ts` — add `api_keys` table
- `apps/api/src/middleware/auth.ts` — API key resolution path
- `apps/api/src/routes/api-keys.ts` — new route: key CRUD
- `apps/api/index.ts` — register MCP server endpoint + API key routes
- `apps/web/app/(dashboard)/settings/api-keys/page.tsx` — new settings page
- DB migration: `api_keys` table

---

## Phase 30e — Skill Packs

### What

Pre-built SKILLS.md templates for common enterprise apps. New agents start with real capabilities, not a blank file. Users can also import skill packs from URLs and export their agents' learned skills to share.

### Why

The cold-start problem is the biggest friction in agent creation. An agent for Salesforce should know how to navigate opportunities, run reports, and update records from day one — not after 10 runs. Skill packs solve this.

### What Ships

#### Built-In Skill Pack Library
New directory: `apps/api/src/skills/packs/`

Each file is a `<app-name>.md` with a SKILLS.md-style template:
- `salesforce.md` — opportunities, cases, reports, contact management
- `jira.md` — issue creation, sprint management, board navigation, bulk updates
- `hubspot.md` — deal pipeline, contact properties, sequence enrollment
- `servicenow.md` — incident management, change requests, CMDB lookups
- `netsuite.md` — AP/AR workflows, GL journal entries, expense reports, vendor management
- `sap.md` — common transaction codes, navigation patterns, report execution
- `workday.md` — HR workflows, time off, org chart navigation, headcount reports
- `linear.md` — issue triage, project creation, cycle management
- `github.md` — PR reviews, issue triage, release management
- `notion.md` — database queries, page creation, block manipulation

Format per pack:
```markdown
# Salesforce — Skill Pack v1

## Navigation
- Main navigation: App Launcher (grid icon top-left) → search app name
- Reports: Navigate to /lightning/o/Report/list
...

## Common Workflows
### Create Opportunity
1. Navigate to /lightning/o/Opportunity/new
...

## Known Quirks
- Lightning pages take 1-2s to load dynamic content — always wait_for_element before reading
...
```

#### "Start from Template" in Agent Creation
- Agent creation form: new "Load skill pack" dropdown before SKILLS.md textarea
- Dropdown options: all built-in packs + "Custom URL"
- On select: populates the SKILLS.md field with the pack content (user can edit before saving)
- Multi-select: pick multiple packs (merged with section headers)

#### Import from URL
- In agent file editor (SKILLS.md section): "Import from URL" button
- Paste a GitHub raw URL or any URL returning markdown
- Fetches the content (server-side, via the API — no CORS issues), merges into existing SKILLS.md via `save_knowledge` with `mode: merge`
- Confirmation modal shows a diff preview before applying

#### Export Agent Skills
- In agent card: "Export Skills" button
- Downloads `<agent-slug>-skills.md` — the current SKILLS.md from Supabase Storage
- Users can share these files, contribute them back, or import into other agents

#### `GET /api/skills/packs` Endpoint
- Returns list of available built-in skill packs: `[{ name, slug, description, appUrl }]`
- Used by the frontend dropdown

### Files Changed
- `apps/api/src/skills/packs/*.md` — new skill pack files (10 initial packs)
- `apps/api/src/routes/skills.ts` — new route: `GET /api/skills/packs`, `GET /api/skills/packs/:slug`
- `apps/api/index.ts` — register skills routes
- `apps/web/app/(dashboard)/agents/agent-form.tsx` — skill pack selector + import from URL
- `apps/web/app/(dashboard)/agents/agent-card.tsx` — export skills button
- `apps/web/lib/queries/use-skills.ts` — TanStack Query hook for packs list

---

## Build Order

| Sub-phase | Name | Effort | Unlocks |
|-----------|------|--------|---------|
| **30a** | Outbound Notifications | 1-2 days | Scheduled agents are useful |
| **30b** | Fire-and-Forget UX | 2-3 days | Users can actually walk away |
| **30e** | Skill Packs | 1-2 days | Cold-start solved |
| **30c** | MCP Client | 1 week | Agents reach any API |
| **30d** | MCP Server | 3-4 days | External AI clients get browser tools |

Start with 30a — it's the highest leverage, lowest effort change. Scheduled agents without notifications are half a feature.

---

## Key Constraints

- MCP tool calls go through the full safety layer — no bypassing classification for MCP
- Auth values for MCP servers are stored encrypted (AES-256 using `ENCRYPTION_KEY` env var)
- MCP connections are per-run, not persistent — no long-lived connections to manage
- Skill packs are opinionated starting points, not locked-in configs — agents overwrite them as they learn
- MCP server (30d) requires 30a to be done first (approval gates need notification infrastructure)
- No stdio transport for MCP — SSE and streamable-HTTP only (server process management is out of scope)
