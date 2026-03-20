# Build Phases

Each phase is self-contained and shippable. Complete one before starting the next.

## Foundation (Done)

| Phase | Name             | What Shipped                                                                                                         | Status  |
| ----- | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| 1     | Auth + Shell UI  | JWT-only auth, token exchange for external providers, auth callback redirect flow, shell with tabs, user in Postgres | ✅ Done |
| 2     | Site Indexing    | Background tab crawler indexes full site, Dexie storage, site map UI in side panel                                   | ✅ Done |
| 3     | Chat             | User chats about current page, Claude responds with page context, streaming responses                                | ✅ Done |
| 4     | Browser Actions  | Agentic loop executes DOM actions via WS, activity feed, navigate/click/type/select/read tools                       | ✅ Done |
| 5     | Safety Layer     | Three-tier classification (safe/review/blocked), approval gates, kill switch, audit logging                          | ✅ Done |
| 6     | Element Selector | DevTools-style hover highlight, click-to-select, drag-to-select area, element chips in chat                          | ✅ Done |

## Intelligence (Next)

| Phase | Name                    | What Ships                                                                                | Status   |
| ----- | ----------------------- | ----------------------------------------------------------------------------------------- | -------- |
| 7     | **Agent Core + Vision** | Agent SDK, MCP browser-bridge, screenshot tool, planning, memory, sessions, model routing | ✅ Done  |
| 8     | Data Tools              | scroll, wait, read_text, read_table tools. export_data (CSV/JSON). Block-based chat UI    | ✅ ,Done |
| 9     | Dashboard               | shadcn dashboard shell, conversation history, audit log, site management, LLM settings    | ✅ Done  |

## Automation

| Phase | Name                      | What Ships                                                                                            | Status  |
| ----- | ------------------------- | ----------------------------------------------------------------------------------------------------- | ------- |
| 10    | [Removed]                 | Previously Flows & Teach Mode — project pivoted to agentic chat + autonomous agents                   |         |
| 12    | Backend Indexing + Search | Kill IndexedDB, sync pages to Postgres, selector resilience, incremental re-indexing                  | ✅ Done |
| 12b   | ~~Vector Embeddings~~     | Removed — embedding pipeline replaced by S3 domain knowledge (KNOWLEDGE.md, WORKFLOWS.md) in Phase 16 | Removed |
| 10c   | Adaptive Memory           | Per-user learning from corrections/preferences, memory management UI, save_memory tool                | ✅ Done |

## Scale

| Phase | Name                    | What Ships                                                                                        | Status  |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------------- | ------- |
| 13    | Agentic System Overhaul | Parallel tool calling, intelligent memory, multi-agent swarm, learning loops, speed optimizations | ✅ Done |
| 14    | Teams + Sharing         | Org schema + API, member management, org-scoped data, data scoping helper                         | ✅ Done |

## Autonomous Agents

| Phase | Name                                               | What Ships                                                                                                                    | Status  |
| ----- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| 15    | [Autonomous Agent System](15-autonomous-agents.md) | Agents as persistent entities in Supabase Storage (SOUL.md, SKILLS.md).                                                       | ✅ Done |
|       |                                                    | Agent registry with domain-based resolution. Agent-to-agent invocation. Self-improvement loop. Agent scheduler. Dashboard UI. |         |
| 16    | [Self-Learning + Autonomy](16-self-learning.md)    | Domain knowledge S3 layer, self-improvement dedup/pruning, agent autonomy levels (supervised/trusted/autonomous),             |         |
|       |                                                    | run logging to S3, date context in prompts, domain workflows extraction, embedding removal.                                   |         |
| 17    | [Chat UX Overhaul](17-chat-ux-overhaul.md)         | Real-time context window indicator, conversation compaction to MD, single plan per chat,                                      |         |
|       |                                                    | plan always visible as checklist, inline HITL approval in messages.                                                           |         |

---

## Key Architecture Decision: Agents Run in the Browser

Unlike Puppeteer/Playwright-based solutions, our agents **always execute in the employee's actual browser session**. This means:

- SSO, VPN, MFA — already handled (employee is logged in)
- No credential storage — we never see passwords or session cookies
- No data exfiltration — page data stays in the browser, only structure/screenshots sent to LLM
- No IT provisioning — employee installs extension, done
- Dashboard-triggered tasks execute via WS → extension → background tab in employee's browser

This is a core architectural constraint, not a limitation. It's what makes this enterprise-safe.
