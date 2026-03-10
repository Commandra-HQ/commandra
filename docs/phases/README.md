# Build Phases

Each phase is self-contained and shippable. Complete one before starting the next.

## Foundation (Done)

| Phase | Name             | What Shipped                                                                                   | Status  |
| ----- | ---------------- | ---------------------------------------------------------------------------------------------- | ------- |
| 1     | Auth + Shell UI  | Clerk login via dashboard, token exchange for extension, shell with tabs, user in Postgres     | ✅ Done |
| 2     | Site Indexing    | Background tab crawler indexes full site, Dexie storage, site map UI in side panel             | ✅ Done |
| 3     | Chat             | User chats about current page, Claude responds with page context, streaming responses          | ✅ Done |
| 4     | Browser Actions  | Agentic loop executes DOM actions via WS, activity feed, navigate/click/type/select/read tools | ✅ Done |
| 5     | Safety Layer     | Three-tier classification (safe/review/blocked), approval gates, kill switch, audit logging    | ✅ Done |
| 6     | Element Selector | DevTools-style hover highlight, click-to-select, drag-to-select area, element chips in chat    | ✅ Done |

## Intelligence (Next)

| Phase | Name                    | What Ships                                                                                | Status   |
| ----- | ----------------------- | ----------------------------------------------------------------------------------------- | -------- |
| 7     | **Agent Core + Vision** | Agent SDK, MCP browser-bridge, screenshot tool, planning, memory, sessions, model routing | ✅ Done  |
| 8     | Data Tools              | scroll, wait, read_text, read_table tools. export_data (CSV/JSON). Block-based chat UI    | ✅ ,Done |
| 9     | Dashboard               | shadcn dashboard shell, conversation history, audit log, site management, LLM settings    | ✅ Done  |

## Automation

| Phase | Name                      | What Ships                                                                            | Status |
| ----- | ------------------------- | ------------------------------------------------------------------------------------- | ------ |
| 10    | Flows + Teach Mode        | Record action sequences, parameterize, replay. Flow library UI                        | ✅ Done |
| 12    | Backend Indexing + Search | Kill IndexedDB, sync pages to Postgres, selector resilience, incremental re-indexing  | Next   |
| 11    | Task Triggers             | Dashboard-triggered tasks, Inngest scheduled runs, task queue, execute in browser      |        |

## Scale

| Phase | Name              | What Ships                                                       | Status |
| ----- | ----------------- | ---------------------------------------------------------------- | ------ |
| 13    | Multi-Agent Swarm | Parallel subagents, cross-tab coordination, coordinator dispatch |        |
| 14    | Teams + Sharing   | Shared flows, team management, admin dashboard, RBAC             |        |

---

## Key Architecture Decision: Agents Run in the Browser

Unlike Puppeteer/Playwright-based solutions, our agents **always execute in the employee's actual browser session**. This means:

- SSO, VPN, MFA — already handled (employee is logged in)
- No credential storage — we never see passwords or session cookies
- No data exfiltration — page data stays in the browser, only structure/screenshots sent to LLM
- No IT provisioning — employee installs extension, done
- Dashboard-triggered tasks execute via WS → extension → background tab in employee's browser

This is a core architectural constraint, not a limitation. It's what makes this enterprise-safe.
