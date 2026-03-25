# Phase 29 — Scheduled Jobs Dashboard

> Dedicated dashboard page for viewing and managing scheduled agent jobs. Backend already complete (Phase 20) — this is a UI-only phase.

## Why

Scheduled jobs exist (Phase 20 scheduler) but are buried inside agent cards. Users can't:

1. See all schedules at a glance
2. See recent run history with success/failure status
3. Enable/disable schedules quickly
4. Trigger a manual "run now"
5. See when the next run will fire

## What Ships

### Dashboard Page: `/schedules`

- Table of all agents with `trigger.cron` set
- Columns: Agent name, Cron expression, Human-readable schedule, Status (enabled/disabled), Last run (time + status), Next run (estimated)
- Quick actions: Enable/Disable toggle, Run Now button
- Expandable row showing recent run history (last 10 runs with status, duration, error)

### "Run Now" API

- `POST /api/agents/:id/run-now` — triggers an immediate scheduled agent run outside the cron schedule
- Uses the same `runScheduledAgent()` logic from scheduler.ts
- Returns the conversation ID so the user can watch it

### Sidebar Nav

- "Schedules" link with Clock icon, between Agents and Memory

## Existing Backend (No Changes Needed)

- `GET /api/agents` — returns agents with `trigger` field
- `PATCH /api/agents/:id` — update trigger (enable/disable)
- `GET /api/agents/:id/runs` — paginated run history
- `scheduler.ts` — full scheduler with cron matching, dedup, retry, offline queue

## Files to Create/Modify

| File                                          | Change                           |
| --------------------------------------------- | -------------------------------- |
| `apps/api/src/routes/agents.ts`               | Add `POST /:id/run-now` endpoint |
| `apps/web/app/(dashboard)/schedules/page.tsx` | New: scheduled jobs page         |
| `apps/web/lib/queries/use-agents.ts`          | Add `useRunAgentNow` mutation    |
| `apps/web/components/sidebar.tsx`             | Add "Schedules" nav link         |
