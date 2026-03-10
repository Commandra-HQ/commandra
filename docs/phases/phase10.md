# Phase 10 — Flows + Teach Mode

Flows are saved playbooks — not rigid scripts. The AI uses a recorded flow as a guide, executing each step with its own judgment. If the DOM changed, the AI adapts. If a value needs to differ, the user passes parameters. If something unexpected happens, the AI handles it.

This is not RPA. There are no fragile selector chains. Every step goes through the LLM, which means every step can adapt, branch, or recover.

## Core Concepts

### What is a Flow?

A **Flow** is a named sequence of steps recorded by a user on a specific site. Each step captures:

- **Intent**: What the user wanted to do ("Click the Export button")
- **Action**: The tool that was called (`click_element`)
- **Args**: The arguments used (`{ selector: "#export-btn" }`)
- **Page context**: URL pattern, page type, surrounding elements
- **Result**: What happened after the action

A flow is a **guide**, not a contract. The AI reads the steps, understands the goal, and executes — adapting to whatever it finds on the page.

### Recording Modes (Two inputs, same output)

**AI-Assisted Recording** (primary):
User tells the AI what to do in chat. The AI executes actions. Each action becomes a flow step automatically.

> "Go to invoices, filter by overdue, click export, choose CSV"
> → 4 steps recorded

**Manual Recording** (secondary):
User clicks a "Record" button, then manually performs actions on the page. Extension intercepts DOM events (click, type, select) and captures each as a step.

Both produce the same `FlowStep[]` structure.

### Replay (Always AI-Guided)

When a user executes a flow:

1. AI receives the flow steps as context in its system prompt
2. User optionally provides parameter values ("invoice number: 12345")
3. AI executes step-by-step, using recorded selectors as hints
4. If a selector fails, AI uses page index to find the equivalent element
5. Safety classification applies to every step (no auto-approval just because it was recorded)
6. AI can skip unnecessary steps, add waits, or handle unexpected modals

### Parameters

Since every step is an LLM call, parameterization is natural:

- During recording, any input value is a potential parameter
- User names parameters after recording ("invoice_number", "date_range", "export_format")
- During execution, user fills in parameter values
- AI substitutes values intelligently — not string replacement, but understanding

## Data Model

### Flow Step Structure

```typescript
interface FlowStep {
  index: number;
  intent: string; // Human-readable: "Click the Export button"
  toolName: string; // "click_element", "type_text", etc.
  args: Record<string, unknown>; // { selector: "#export", text: "hello" }
  urlPattern: string; // "/invoices/:id" — expected page
  pageType: string; // "table", "form", etc.
  result?: {
    // What happened
    success: boolean;
    data?: unknown;
  };
}

interface FlowParameter {
  name: string; // "invoice_number"
  stepIndex: number; // Which step uses this
  argField: string; // "text" (the arg key to substitute)
  defaultValue?: string;
  description?: string; // "The invoice number to search for"
}
```

### Database Changes

**Modify existing `flows` table** (steps/parameters columns already exist as JSONB):

- `steps` → `FlowStep[]`
- `parameters` → `FlowParameter[]`
- Add `status` column: `draft | ready | archived`
- Add `lastRunAt` column

**New `flow_runs` table**:

```typescript
export const flowRuns = pgTable('flow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  flowId: uuid('flow_id')
    .references(() => flows.id)
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  parameterValues: jsonb('parameter_values')
    .$type<Record<string, string>>()
    .default({}),
  stepResults: jsonb('step_results').$type<StepResult[]>().default([]),
  status: text('status').notNull(), // 'running' | 'completed' | 'failed' | 'stopped'
  stepsCompleted: integer('steps_completed').default(0),
  totalSteps: integer('total_steps').notNull(),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});
```

## User Experience

### Recording (in Extension Sidebar)

1. User is on a site they want to automate
2. Opens extension → Chat tab
3. Types: "I want to teach you how to export overdue invoices"
4. AI responds: "I'll start recording. Tell me what to do step by step, or just perform the actions yourself."
5. **Recording banner** appears at top of sidebar: "Recording... 0 steps" with Stop button
6. User either:
   - **Tells AI**: "Click the Invoices tab" → AI executes, step recorded
   - **Does it manually**: Clicks the Invoices tab → extension captures, step recorded
7. Step counter increments. Each step shows as a mini card in the chat.
8. User clicks Stop or says "done recording"
9. **Flow editor** appears:
   - Name the flow ("Export overdue invoices")
   - Review steps (reorder, delete, add description)
   - Mark parameters (tap a step's input value → name it as a parameter)
   - Save

### Flow Library (in Extension Sidebar)

The existing **Flows tab** becomes the flow library:

- List of saved flows grouped by site/domain
- Each card: flow name, step count, last run, domain
- Tap flow → detail view:
  - Step list with icons
  - Parameter inputs (if any)
  - "Run" button
  - "Edit" / "Delete" options
  - Run history (last 5 runs with status)

### Execution (in Extension Sidebar)

1. User opens Flows tab → selects a flow
2. If flow has parameters, fills them in
3. Clicks "Run"
4. Switches to a **live execution view** (like chat but focused):
   - Each step shows: intent, status (pending/running/done/failed)
   - AI commentary if it adapts ("Export button moved, using the new location")
   - Safety approvals inline (same as chat)
   - Progress bar: "Step 3 of 7"
5. On completion: summary card with results
6. Run is saved to flow_runs table

## Architecture

### Recording Flow

```
User action (chat or manual)
    ↓
Extension captures action
    ↓
Send to backend: { action, selector, args, pageContext }
    ↓
Backend builds FlowStep (LLM generates intent description)
    ↓
Append to in-progress flow
    ↓
Send SSE event: flow_step_recorded { step }
    ↓
Extension updates recording UI
```

### Manual Recording (Extension-Side)

```
User clicks "Record" in sidebar
    ↓
Extension activates event listeners on page:
  - click → capture target element selector + label
  - input/change → capture selector + typed value
  - navigation → capture new URL
    ↓
For each captured action:
  - Build ActionPayload (same shape as tool args)
  - Send WS message: manual_action { action, args, url }
    ↓
Backend receives, wraps as FlowStep
  - LLM generates intent from action + element label
  - Appends to in-progress recording
    ↓
SSE back to extension: flow_step_recorded
```

### Execution Flow

```
User selects flow + params → POST /api/flows/:id/execute
    ↓
Backend loads flow + steps
    ↓
Build system prompt with flow context:
  "You are executing a saved flow. Here are the steps:
   1. Navigate to /invoices
   2. Click the 'Overdue' filter tab
   3. Click 'Export' button
   4. Select 'CSV' format
   Parameters: { date_range: 'last 30 days' }
   Follow these steps using the current page state.
   Adapt if the UI has changed."
    ↓
Run orchestrator loop (same as chat, but with flow guidance)
    ↓
Each step: classify safety → execute → log to flow_run
    ↓
SSE events stream to extension (same protocol)
    ↓
On complete: update flow_runs status
```

### New WS Message Types

```typescript
// Extension → Backend
| { type: 'manual_action'; action: string; args: Record<string, unknown>; url: string; pageContext: { urlPattern: string; pageType: string } }
| { type: 'recording_start'; domain: string }
| { type: 'recording_stop' }

// Backend → Extension (via SSE, same as chat)
| { type: 'flow_step_recorded'; step: FlowStep; stepCount: number }
| { type: 'recording_started' }
| { type: 'recording_stopped'; flowId: string; stepCount: number }
```

### New API Endpoints

```
GET    /api/flows                List user's flows (with optional ?domain= filter)
POST   /api/flows                Create flow from recorded steps
GET    /api/flows/:id            Get flow with steps + parameters
PUT    /api/flows/:id            Update flow (name, steps, parameters)
DELETE /api/flows/:id            Delete flow
POST   /api/flows/:id/run        Execute flow (SSE stream, like /api/chat)
GET    /api/flows/:id/runs       List run history
```

## Implementation Order

```
Step 1: Flow data model + CRUD API
        Update flows table (add status, lastRunAt)
        Add flow_runs table + migration
        Flow CRUD routes (/api/flows)
        → Can create/list/edit/delete flows from API

Step 2: AI-assisted recording
        Recording state management in orchestrator
        "Teach mode" prompt that captures steps
        flow_step_recorded SSE event
        LLM generates intent for each step
        Save flow on recording_stop
        → Chat can record flows

Step 3: Recording UI in extension
        Recording banner in ChatTab
        Step cards during recording
        Stop recording button
        Flow editor (name, review steps, mark parameters)
        → User can record through chat

Step 4: Flow library UI in extension
        FlowsTab: list flows grouped by domain
        Flow detail view with steps + params
        Delete flow
        → User can browse saved flows

Step 5: Flow execution
        POST /api/flows/:id/run endpoint
        Execution orchestrator (flow steps as system prompt context)
        Parameter substitution
        Step-by-step progress SSE events
        flow_runs logging
        → User can replay flows

Step 6: Execution UI in extension
        Run button in flow detail
        Parameter input form
        Live execution view (step progress, approvals)
        Completion summary
        Run history list
        → Full record → replay loop

Step 7: Manual recording (stretch)
        DOM event interception in extension
        manual_action WS message
        Convert DOM events to FlowSteps
        → User can record by clicking
```

## What's NOT in Phase 10

- Conditional branching logic (AI handles this naturally, no explicit if/else)
- Scheduled execution (Phase 11 — Task Triggers)
- Flow sharing between users (Phase 14 — Teams)
- Flow versioning / diff
- Dashboard flow management (extension-only for now)
- Flow templates / marketplace
