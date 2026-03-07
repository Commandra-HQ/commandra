# Build Phases

Each phase is self-contained and shippable. Complete one before starting the next.

| Phase | Name                   | What Ships                                                                                             | Status  |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| 1     | Auth + Shell UI        | Clerk login via admin dashboard, token exchange for extension, empty shell with tabs, user in Postgres | ✅ Done |
| 2     | Site Indexing          | Background tab crawler indexes full site, Dexie storage, site map UI in side panel                     | ✅ Done |
| 3     | Chat (Single Page)     | User chats about current page, Claude responds with page context, no actions yet                       | ✅ Done |
| 4     | Browser Actions        | Agentic loop executes real DOM actions via WS, activity feed in side panel                             | ✅ Done |
| 5     | Safety Layer           | Action classification, approval gates, kill switch, audit logging                                      |
| 6     | Element Selector       | Hover-to-highlight, click to select, instruct agent about selected elements                            |
| 7     | Data Extraction        | Read tables/text/forms, summarize page data, export CSV                                                |
| 8     | Multi-Page Navigation  | Agent navigates across pages using site index                                                          |
| 9     | Site Sync + Embeddings | Sync site index to backend, pgvector embeddings, incremental re-indexing                               |
| 10    | Flows                  | Save tasks as reusable parameterized flows, flow library UI                                            |
| 11    | Teach Mode             | Record user actions, convert to flow, replay                                                           |
| 12    | Scheduled Agents       | Inngest cron triggers, headless agent runs, completion notifications                                   |
| 13    | Multi-Agent Swarm      | Parallel subagents, cross-app workflows, coordinator dispatch                                          |
| 14    | Teams + Sharing        | Shared flows, admin dashboard, team management                                                         |
