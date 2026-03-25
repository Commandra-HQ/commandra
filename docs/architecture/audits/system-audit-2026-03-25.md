# System Audit — 2026-03-25

> Comprehensive audit of the Commandra codebase after Phases 1–28. Previous audit files (agent-audit, hardcoding-audit, s3-storage-audit, token-system-audit) were fully resolved and deleted.

## Previous Audit Resolution Summary

All 4 prior audits are closed:

| Audit | Resolution |
|-------|-----------|
| **Token System** | Real usage from providers, per-model budgets, cost tracking, pre-flight counting, importance-weighted trimming — all P0/P1 items fixed |
| **Agent Architecture** | ~92% aligned with Claude Code patterns. Sub-agent resumption and export/import intentionally deferred |
| **Hardcoding** | ~88% configurable. ModelCapabilities + AgentConfig overrides. Dynamic tool registration and prompt cache strategy intentionally static |
| **S3 Storage** | 100% resolved. Coordinator self-improves, screenshots on S3, run logs, compaction transcripts all verified |

---

## Open Issues

### CRITICAL

#### 1. No Rate Limiting
- **Files**: All routes in `apps/api/src/routes/`
- **Issue**: No rate limiting middleware on any endpoint. Chat, agent creation, token exchange, usage queries — all unprotected.
- **Impact**: DoS risk, unlimited agent/conversation creation, token exchange abuse.
- **Fix**: Add `hono-rate-limit` middleware. Per-user limits: 60 req/min for reads, 20 req/min for mutations, 10 req/min for LLM calls.

#### 2. Site Domain Query Before Auth Check
- **File**: `apps/api/src/routes/sites.ts` ~line 69
- **Issue**: GET site detail queries by domain without org/user scope, then checks auth after. Attacker can brute-force domains to discover which exist.
- **Fix**: Include `getOrgOrUserScope()` in the initial WHERE clause.

#### 3. Sub-Agent Tabs Leak on Crash
- **File**: `apps/api/src/agent/swarm.ts` ~lines 127-137
- **Issue**: If `runSubAgent()` rejects or the orchestrator crashes, background tabs stay open forever. No cleanup mechanism.
- **Fix**: Wrap with guaranteed cleanup in `finally` block. Track open tabs and close on orchestrator exit.

#### 4. Orphaned Conversations on Agent Delete
- **File**: `apps/api/src/db/schema.ts` ~line 66
- **Issue**: `conversations.agentId` FK has no cascade. Deleting an agent leaves conversations with a dangling reference.
- **Fix**: Add `onDelete: 'set null'` to conversations.agentId FK. Migration required.

---

### HIGH

#### 5. Missing Database Indices
- **File**: `apps/api/src/db/schema.ts`
- **Columns needing indices**:
  - `messages.conversationId` — queried on every chat load
  - `agent_runs.conversationId` — queried by usage API
  - `agent_runs.userId` — queried by usage API
  - `pages.siteId` — queried on site detail
  - `sites.domain` — queried on chat init
- **Fix**: Single migration adding 5 indices.

#### 6. No LLM Provider Retry
- **File**: `apps/api/src/agent/orchestrator.ts` ~line 226
- **Issue**: `provider.chat()` called without retry. If Anthropic/OpenAI has a transient failure (502, timeout), the entire conversation fails.
- **Fix**: Exponential backoff retry (3 attempts: 1s → 3s → 10s) around the provider.chat() call. Already have `context_length_exceeded` recovery — extend pattern.

#### 7. SSE Stream Continues After Client Disconnect
- **File**: `apps/api/src/routes/chat.ts` ~line 240
- **Issue**: Tool execution continues even after client disconnects mid-stream. `signal.aborted` only checked before writeSSE, not before expensive tool calls.
- **Impact**: Browser tools execute without user visibility, wasted LLM calls.
- **Fix**: Check `signal.aborted` before each tool dispatch in the orchestrator loop.

#### 8. Unbounded Sub-Agent Token Cost
- **File**: `apps/api/src/agent/swarm.ts`
- **Issue**: 3 parallel sub-agents × full context windows = 3x coordinator cost with no budget cap.
- **Fix**: Add `tokenBudget` to swarm config. Track per-sub-agent usage via the new `accumulatedUsage` from Phase 28.

#### 9. JWT Not Re-Verified on Long-Lived WebSocket
- **File**: `apps/api/src/ws/handler.ts` ~line 42
- **Issue**: JWT verified on WS connect only. A 6-hour session with an expired JWT stays authenticated.
- **Fix**: Re-verify JWT every 5 minutes on WS heartbeat. Disconnect if expired.

#### 10. Org Member Invite Race Condition
- **File**: `apps/api/src/routes/orgs.ts` ~line 86
- **Issue**: Concurrent invites for same email can create duplicate memberships. No unique constraint on (orgId, userId).
- **Fix**: Add unique constraint on `org_members(org_id, user_id)`. Use `onConflictDoNothing()`.

---

### MEDIUM

#### 11. Unbounded Conversation Message Load
- **File**: `apps/api/src/routes/conversations.ts` ~line 84
- **Issue**: Loads ALL messages for a conversation without LIMIT. Long conversations (100+ messages) cause slow responses.
- **Fix**: Add pagination or cap at 200 messages with a "load more" option.

#### 12. Scheduler Dedup Is In-Memory Only
- **File**: `apps/api/src/agent/scheduler.ts` ~line 34
- **Issue**: `runningAgents` Set and `lastRun` Map are in-memory. Multiple API instances = duplicate scheduled runs.
- **Fix**: Move dedup to Postgres advisory locks or a `scheduler_locks` table. (Not needed for single-instance self-hosted, but blocks horizontal scaling.)

#### 13. S3 Upload Failures Not Retried
- **File**: `apps/api/src/storage/supabase.ts`
- **Issue**: All S3 uploads are fire-and-forget with `.catch()`. Transient Supabase failures silently lose domain knowledge, run logs, or agent files.
- **Fix**: Add 1-retry with 500ms delay for critical uploads (agent files, domain knowledge). Keep fire-and-forget for run logs.

#### 14. Agent List Loads Files Serially (N+1)
- **File**: `apps/api/src/agent/agent-registry.ts`
- **Issue**: `listAgents()` fetches DB rows then calls `hydrateAgent()` for each (S3 reads for SOUL.md, SKILLS.md, MEMORY.md per agent).
- **Fix**: Batch S3 reads with `Promise.all()`, or defer file loading to single-agent detail view.

#### 15. IMAGE_TOKEN_ESTIMATE Still Flat
- **File**: `apps/api/src/agent/token-budget.ts` line 27
- **Issue**: `IMAGE_TOKEN_ESTIMATE = 2000` for all images regardless of size. Small screenshots ~200 tokens, large ones ~1500.
- **Fix**: Estimate from image dimensions if available: `Math.ceil((width * height) / 750)` capped at 2000.

---

### LOW

#### 16. No Health Check Depth
- **File**: `apps/api/src/routes/health.ts`
- **Issue**: Returns `{ status: 'ok' }` without checking DB, S3, or LLM provider connectivity.
- **Fix**: Add `GET /api/health/deep` that pings Postgres + Supabase Storage.

#### 17. Console.log in Production Code
- **Files**: Throughout `apps/api/src/` (orchestrator, ws handler, scheduler, etc.)
- **Issue**: Debug console.log/warn calls pollute logs. No structured logging.
- **Fix**: Adopt `pino` for structured JSON logging with levels. Low priority — works fine for self-hosted.

#### 18. Token Exchange Input Not Length-Capped
- **File**: `apps/api/src/routes/token.ts` ~line 36
- **Issue**: `orgName` used for slug generation without length limit. Very long names create unwieldy slugs.
- **Fix**: `orgName.slice(0, 100)` before slug generation.

#### 19. Pages FK Missing Cascade
- **File**: `apps/api/src/db/schema.ts` ~line 48
- **Issue**: Pages FK to sites is NOT NULL but no `onDelete: 'cascade'`. Deleting a site would violate the FK constraint.
- **Fix**: Add `onDelete: 'cascade'` to pages.siteId FK.

#### 20. Extension useEffect Missing Dependency
- **File**: `apps/extension/src/sidepanel/tabs/ChatTab.tsx` ~line 284
- **Issue**: Tab action listener `useEffect` has no dependency array — re-registers every render.
- **Fix**: Add `[chatMessages, isActive, contextStatus]` dependency array, or use `useCallback` for handlers.

---

## Prioritized Fix Plan

### Sprint 1 (Quick Wins — 1-2 days)
1. **Database indices** (#5) — single migration, biggest perf win
2. **Missing dependency array** (#20) — one-line fix
3. **Orphaned conversations** (#4) — migration + FK policy
4. **Pages FK cascade** (#19) — migration
5. **Org member unique constraint** (#10) — migration

### Sprint 2 (Security — 2-3 days)
6. **Rate limiting** (#1) — middleware + config
7. **Site domain auth fix** (#2) — one-line WHERE clause change
8. **JWT re-verify on WS** (#9) — heartbeat handler
9. **Token exchange length cap** (#18) — one-line fix

### Sprint 3 (Resilience — 2-3 days)
10. **LLM provider retry** (#6) — wrap provider.chat() with retry
11. **SSE disconnect handling** (#7) — abort checks in orchestrator
12. **Sub-agent tab cleanup** (#3) — finally block in swarm
13. **S3 upload retry** (#13) — retry wrapper for critical uploads

### Sprint 4 (Scale Prep — 3-5 days)
14. **Sub-agent token budget** (#8) — swarm config + tracking
15. **Conversation message pagination** (#11) — API + frontend
16. **Agent list N+1** (#14) — batch S3 reads
17. **Health check depth** (#16) — DB + S3 ping

### Deferred (Not Needed Yet)
- Scheduler distributed dedup (#12) — only matters at horizontal scale
- Structured logging (#17) — works fine with console for self-hosted
- Image token estimation (#15) — 2K flat is safe, just not optimal

---

## Architecture Health Summary

| Area | Health | Notes |
|------|--------|-------|
| **Auth & JWT** | Good | JWT-only, token exchange works. WS re-verify needed. |
| **Agent System** | Excellent | Registry, swarm, self-improvement, hooks, scheduler all solid. |
| **Token Tracking** | Excellent | Real usage from providers, per-model budgets, cost analytics. |
| **Storage (S3)** | Good | All files persisted correctly. Missing retry on transient failures. |
| **Database** | Needs Work | Missing indices, FK policies, no pagination on some queries. |
| **Security** | Needs Work | No rate limiting, domain auth bypass, WS JWT expiry. |
| **Extension** | Good | Clean component architecture. Minor useEffect cleanup needed. |
| **LLM Providers** | Good | Provider-agnostic, real usage tracking. Missing retry logic. |
| **Observability** | Adequate | Console logging works. No structured logs or metrics yet. |

**Overall**: The system is **feature-complete and functional** through Phase 28. The main gaps are **operational hardening** (rate limiting, retries, indices) rather than missing functionality. The codebase is clean, well-organized, and the agent architecture is mature.
