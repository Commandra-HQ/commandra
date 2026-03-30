# Phase 22 — Agent Hooks System

> Deterministic lifecycle hooks for browser agents — validate before tool execution, verify after, and confirm task completion.

## Why

Hooks are the biggest remaining architectural gap. Today, all safety enforcement is hardcoded in the classifier (`safety/classifier.ts`). There's no way for an agent to have custom rules like "never click Delete on this app" or "always verify the email was sent before completing."

Claude Code uses hooks as the enforcement layer — they run deterministically, not at the LLM's discretion. Our agents need the same.

## Design

Since our agents run in browsers (not terminals), hooks are NOT shell commands. They're either:

1. **Rule hooks** — pattern matching on tool name/args. Zero latency. "Block any click where the label contains 'Delete'." Evaluated inline.
2. **LLM hooks** — single fast-model call. "Check if the task was actually completed." ~1s latency. Used sparingly (OnComplete only).

### Hook Types

| Hook | When | Can block? | Use case |
|------|------|-----------|----------|
| `PreToolUse` | Before a browser tool executes | Yes — blocks the action | "Never click Delete", "Don't navigate away from instamart.in" |
| `PostToolUse` | After a browser tool executes | No — tool already ran | "Log every click", "Take a screenshot after form submit" |
| `OnComplete` | When agent finishes (end_turn) | Yes — keeps agent working | "Verify the report was downloaded", "Check that all form fields are filled" |

### Hook Config Schema

Stored in `agents.hooks` JSONB column:

```typescript
interface AgentHooks {
  preToolUse?: HookRule[];
  postToolUse?: HookRule[];
  onComplete?: HookRule[];
}

interface HookRule {
  // What triggers this hook
  match?: {
    tools?: string[];           // Tool names: ["click_element", "navigate"]
    labelPattern?: string;      // Regex on element label: "delete|remove|destroy"
    urlPattern?: string;        // Regex on target URL: ".*\\.google\\.com"
  };
  // What the hook does
  action:
    | { type: 'block'; reason: string }          // PreToolUse: block with reason
    | { type: 'log'; message: string }           // PostToolUse: log a message
    | { type: 'screenshot' }                      // PostToolUse: auto-screenshot
    | { type: 'llm_check'; prompt: string }      // OnComplete: ask fast model yes/no
    | { type: 'require_screenshot' }              // OnComplete: force screenshot before done
    ;
}
```

### Examples

```json
{
  "preToolUse": [
    {
      "match": { "labelPattern": "delete|remove|destroy", "tools": ["click_element"] },
      "action": { "type": "block", "reason": "Destructive actions are blocked for this agent" }
    },
    {
      "match": { "tools": ["navigate"], "urlPattern": "^(?!.*instamart\\.in)" },
      "action": { "type": "block", "reason": "This agent must stay on instamart.in" }
    }
  ],
  "postToolUse": [
    {
      "match": { "tools": ["click_element"] },
      "action": { "type": "screenshot" }
    }
  ],
  "onComplete": [
    {
      "action": { "type": "llm_check", "prompt": "Check: was the sales report actually downloaded? Look at the last tool results for evidence of a successful download." }
    }
  ]
}
```

## What Ships

### Schema + Types
- Add `hooks` JSONB column to `agents` table
- Add `hooks` field to `AgentConfig` in shared types
- Hydrate hooks in `agent-registry.ts`

### Hook Engine
- New file: `apps/api/src/agent/hooks.ts`
- `evaluatePreToolUse(hooks, toolName, toolArgs)` → `{ allowed: boolean; reason?: string }`
- `evaluatePostToolUse(hooks, toolName, toolArgs, result)` → side effects (screenshot, log)
- `evaluateOnComplete(hooks, agentConfig, toolCalls, response)` → `{ done: boolean; reason?: string }`

### Wiring
- `browser-tools.ts` — call `evaluatePreToolUse` before `executeTool()`, `evaluatePostToolUse` after
- `orchestrator.ts` — call `evaluateOnComplete` before breaking on `end_turn`
- `swarm.ts` — same PreToolUse/PostToolUse in sub-agent loop

### Dashboard
- `agent-form.tsx` — hook configuration UI (JSON editor or guided form)
- `agent-card.tsx` — display configured hooks in expanded view

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/db/schema.ts` | Add `hooks` column |
| `packages/shared/src/types/agents.ts` | Add `hooks` to AgentConfig |
| `apps/api/src/agent/agent-registry.ts` | Hydrate hooks from DB |
| `apps/api/src/agent/hooks.ts` | **New** — hook evaluation engine |
| `apps/api/src/agent/browser-tools.ts` | PreToolUse + PostToolUse calls |
| `apps/api/src/agent/orchestrator.ts` | OnComplete call before break |
| `apps/api/src/agent/swarm.ts` | PreToolUse + PostToolUse in sub-agent loop |
| `apps/web/app/(dashboard)/agents/agent-form.tsx` | Hook config in create form |
| `apps/web/app/(dashboard)/agents/agent-card.tsx` | Display hooks |
