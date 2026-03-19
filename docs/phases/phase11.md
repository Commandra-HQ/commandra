# Phase 11 — Task Triggers + Scheduled Agents

With element finding reliable (Phase 12) and the agentic system mature (Phase 13), we can now trigger tasks from the dashboard and run them on a schedule. The key constraint: **agents always execute in the employee's browser** — the backend tells the extension what to do, the extension does it.

## What Ships

### Dashboard-Triggered Tasks
- User describes a task from the dashboard, clicks "Run Now"
- Backend sends the task to the extension via WS
- Extension opens a background tab if needed, executes the task via the agent
- Dashboard shows live progress via SSE

### Scheduled Tasks
- User sets a schedule on a task: daily, weekly, cron expression
- Inngest handles the scheduling
- At trigger time, backend checks if the user's extension is connected
- If connected → execute task in the extension
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

This is the same path as chat-based execution, just triggered differently.

### Inngest Integration
```
Inngest cron event → Backend function
  → Check: is user's extension connected?
  → Yes → Execute task via WS
  → No → Create pending task, send notification
```

## Data Model

### New: `tasks` table
```typescript
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  description: text('description').notNull(),    // Natural language task description
  targetUrl: text('target_url'),                 // Starting URL for the task
  schedule: text('schedule'),                    // cron expression or null for one-off
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
  status: text('status').notNull(),     // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  reason: text('reason'),               // Why it's pending ("Extension offline")
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});
```

## API Endpoints

```
POST   /api/tasks                Create a scheduled task
GET    /api/tasks                List user's tasks
PUT    /api/tasks/:id            Update task (schedule, description, enabled)
DELETE /api/tasks/:id            Delete task
POST   /api/tasks/:id/trigger    Run a task immediately (dashboard "Run Now")
GET    /api/tasks/queue          List pending/recent queue items
```

## Dashboard Pages

### Tasks Page (`/tasks`)
- List of scheduled tasks with description, schedule, last run, next run, status
- Enable/disable toggle per task
- "Run Now" button
- Create task: describe task → set target URL → set schedule → save

## Extension Changes

### Background Tab Execution
When the extension receives a task execution request and the user isn't on the right page:
1. Open a new background tab
2. Navigate to the task's starting URL
3. Execute the task via the agent in that tab
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
  title: 'Task completed: Export invoices',
  message: 'Task completed successfully'
});
```

## Inngest Functions

```typescript
// Scheduled task execution
inngest.createFunction(
  { id: 'scheduled-task' },
  { cron: 'TBD' },  // Dynamic per task
  async ({ step }) => {
    // Load all tasks due now
    const dueTasks = await step.run('load-tasks', () => loadDueTasks());

    for (const task of dueTasks) {
      await step.run(`execute-${task.id}`, () => executeOrQueue(task));
    }
  }
);
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
        Dashboard UI: task list with "Run Now" button
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
        → Tasks run on schedule

Step 5: Dashboard tasks page
        Tasks list with schedule/status
        Create task wizard (describe task → target URL → schedule)
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
- Task chaining (task A triggers task B)
- Error retry policies (just fail and notify for now)
