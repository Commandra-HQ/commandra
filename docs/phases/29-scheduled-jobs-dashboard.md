# Phase 29 — Scheduled Jobs & Agent Scheduling Tool

> Dashboard for scheduled jobs + `schedule_agent` tool so agents can schedule tasks programmatically. Supports both one-time delayed tasks and recurring cron schedules.

## Why

1. Scheduled jobs existed (Phase 20 scheduler) but were buried in agent cards — no overview, no quick controls
2. Agents had **no tool to schedule tasks**. When asked "send an email in 15 minutes", the agent tried to navigate the dashboard UI to find a scheduling form, which doesn't exist
3. No support for one-time delayed tasks (only recurring cron)

## What Shipped

### `schedule_agent` Internal Tool
- New tool available to all agents: `schedule_agent`
- Parameters: `agentSlug` (required), `task` (required), `runAt` (ISO datetime for one-time), `cron` (expression for recurring)
- **One-time tasks**: creates a row in `scheduled_tasks` table. The scheduler picks it up when `runAt` passes and executes via `runScheduledAgent()`.
- **Recurring**: updates the agent's `trigger` field with the cron expression (enables schedule)
- Validates: agent exists, belongs to user, runAt is in the future, cron is valid
- Returns confirmation with agent name, schedule time, and browser-must-be-open warning

### `scheduled_tasks` Table
- New DB table for one-time delayed tasks
- Columns: `id`, `user_id`, `agent_id`, `task`, `run_at`, `status` (pending/running/completed/failed), `conversation_id`, `error`, `created_at`
- Indices on `run_at` (filtered WHERE pending) and `user_id`
- Crash recovery: tasks stuck in "running" for >5min get reset to "pending"

### Scheduler Integration
- `processScheduledTasks()` runs every 60s in the scheduler tick (before cron evaluation)
- Picks up pending tasks whose `runAt` has passed
- Marks running → executes via `runScheduledAgent()` → marks completed/failed
- Skips if user's browser isn't connected (task stays pending for next tick)

### Dashboard Page: `/schedules`
- Cards for each agent with cron trigger: name, description, cron expression, human-readable schedule
- Active/Paused status badge
- **Run** button for immediate execution
- **Pause/Enable** toggle
- Latest run info: status, time ago, duration, tool count, error preview
- One-time scheduled tasks listed from API response

### "Run Now" API
- `POST /api/agents/:id/run-now` — triggers immediate agent execution
- `runAgentNow()` exported from scheduler — creates conversation, fires agent in background
- Returns `{ conversationId }` on success

### `GET /api/agents/scheduled`
- Returns all agents with cron triggers + their latest run
- Also returns one-time `tasks` from `scheduled_tasks` (last 20)

### Sidebar Nav
- "Schedules" link with Clock icon between Agents and Memory

## Files Modified

| File | Change |
|------|--------|
| `apps/api/src/db/schema.ts` | New `scheduledTasks` table |
| `apps/api/drizzle/0023_scheduled_tasks.sql` | Migration |
| `apps/api/src/agent/tool-definitions.ts` | `schedule_agent` tool definition |
| `apps/api/src/agent/internal-tools.ts` | `handleScheduleAgent` handler |
| `apps/api/src/agent/scheduler.ts` | `processScheduledTasks()` in tick loop |
| `apps/api/src/routes/agents.ts` | `POST /:id/run-now`, `GET /scheduled` with tasks |
| `apps/web/app/(dashboard)/schedules/page.tsx` | New: scheduled jobs page |
| `apps/web/lib/queries/use-agents.ts` | `useScheduledAgentsQuery`, `useRunAgentNowMutation` |
| `apps/web/components/sidebar.tsx` | "Schedules" nav link |
