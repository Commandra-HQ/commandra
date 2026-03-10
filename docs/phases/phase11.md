# Phase 11 — Task Triggers + Scheduled Agents

With flows recorded (Phase 10) and element finding reliable (Phase 12), we can now trigger flows from the dashboard and run them on a schedule. The key constraint: **agents always execute in the employee's browser** — the backend tells the extension what to do, the extension does it.

## What Ships

### Dashboard-Triggered Tasks
- User selects a flow from the dashboard, fills in parameters, clicks "Run Now"
- Backend sends the flow execution to the extension via WS
- Extension opens a background tab if needed, executes the flow
- Dashboard shows live progress via SSE

### Scheduled Flows
- User sets a schedule on a flow: daily, weekly, cron expression
- Inngest handles the scheduling
- At trigger time, backend checks if the user's extension is connected
- If connected → execute flow in the extension
- If not connected → queue the task, notify user to open their browser

### Task Queue
- Tasks that can't run immediately (extension offline) go into a queue
- When extension reconnects, queued tasks execute automatically
- Dashboard shows pending/completed/failed tasks

## Architecture

### Execution Path
```
Dashboard/Schedule → Backend → WS → Extension → Browser Tab → DOM
```

This is the same path as chat-based flow execution, just triggered differently.

### Inngest Integration
```
Inngest cron event → Backend function
  → Check: is user's extension connected?
  → Yes → Execute flow via WS (same as POST /api/flows/:id/run)
  → No → Create pending task, send notification
```

## Data Model

### New: `tasks` table
```typescript
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  flowId: uuid('flow_id').references(() => flows.id).notNull(),
  schedule: text('schedule'),           // cron expression or null for one-off
  parameterValues: jsonb('parameter_values').$type<Record<string, string>>().default({}),
  enabled: boolean('enabled').default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const taskQueue = pgTable('task_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  flowId: uuid('flow_id').references(() => flows.id).notNull(),
  parameterValues: jsonb('parameter_values').$type<Record<string, string>>().default({}),
  status: text('status').notNull(),     // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  reason: text('reason'),               // Why it's pending ("Extension offline")
  flowRunId: uuid('flow_run_id'),       // Set once execution starts
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});
```

### Modified: `flows` table
- Add `scheduleEnabled` boolean
- Add `schedule` text (cron expression)

## API Endpoints

```
POST   /api/tasks                Create a scheduled task for a flow
GET    /api/tasks                List user's tasks
PUT    /api/tasks/:id            Update task (schedule, params, enabled)
DELETE /api/tasks/:id            Delete task
POST   /api/tasks/:id/trigger    Run a task immediately (dashboard "Run Now")
GET    /api/tasks/queue          List pending/recent queue items
```

## Dashboard Pages

### Tasks Page (`/tasks`)
- List of scheduled tasks with flow name, schedule, last run, next run, status
- Enable/disable toggle per task
- "Run Now" button
- Create task: select flow → set params → set schedule → save

### Flow Detail Enhancement
- Add "Schedule" section to existing flow detail
- Quick schedule: "Run daily at 9am", "Run every Monday"
- Custom cron for power users

## Extension Changes

### Background Tab Execution
When the extension receives a flow execution request and the user isn't on the right page:
1. Open a new background tab
2. Navigate to the flow's starting URL
3. Execute the flow in that tab
4. Close the tab when done

### Queue Drain on Connect
When the extension authenticates on WS connect:
1. Backend checks for pending tasks for this user
2. Sends them to the extension in order
3. Extension executes each, reports results

### Notification
When a task completes or fails, send a browser notification:
```
chrome.notifications.create({
  type: 'basic',
  title: 'Flow completed: Export invoices',
  message: '7/7 steps completed successfully'
});
```

## Inngest Functions

```typescript
// Scheduled flow execution
inngest.createFunction(
  { id: 'scheduled-flow' },
  { cron: 'TBD' },  // Dynamic per task
  async ({ step }) => {
    // Load all tasks due now
    const dueTasks = await step.run('load-tasks', () => loadDueTasks());

    for (const task of dueTasks) {
      await step.run(`execute-${task.id}`, () => executeOrQueue(task));
    }
  }
);

// Alternative: one Inngest function per task (created dynamically)
// Pro: each task has its own cron
// Con: managing many Inngest functions
```

**Decision: Use a single polling function** that runs every minute and checks for due tasks. Simpler than dynamic cron creation.

## Implementation Order

```
Step 1: Tasks data model + CRUD API
        tasks + task_queue tables + migration
        CRUD routes for /api/tasks
        → Can create/list/manage scheduled tasks

Step 2: Dashboard trigger ("Run Now")
        POST /api/tasks/:id/trigger endpoint
        Reuses flow execution from Phase 10
        Dashboard UI: flow list with "Run Now" button
        → One-off task execution from dashboard

Step 3: Task queue
        Queue tasks when extension is offline
        Drain queue on extension WS connect
        Queue status in dashboard
        → Tasks don't get lost when browser is closed

Step 4: Inngest scheduled execution
        Single polling function (every minute)
        Load due tasks, check extension connectivity
        Execute or queue
        → Flows run on schedule

Step 5: Dashboard tasks page
        Tasks list with schedule/status
        Create task wizard (select flow → params → schedule)
        Enable/disable toggle
        Task history (recent runs)
        → Full dashboard management

Step 6: Extension notifications
        Browser notifications on task complete/fail
        Badge icon for pending tasks
        → User knows what happened
```

## What's NOT in Phase 11

- Multi-user task coordination (Phase 14)
- Webhook triggers (future)
- Email/Slack notifications (future)
- Task chaining (flow A triggers flow B)
- Error retry policies (just fail and notify for now)
