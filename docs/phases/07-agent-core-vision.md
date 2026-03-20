# Phase 7 — Agent Core + Vision

This is the foundation phase. Everything after this — data tools, flows, scheduled runs, multi-agent swarm — builds on the agent architecture we establish here.

## Key Decisions

### No Agent SDK — we own the orchestration

Claude Agent SDK locks us into Anthropic. This is an open-source project. Enterprises have existing LLM contracts — some only allow OpenAI, some only Claude, some run open-source models on their own infra. **Users must be able to bring their own keys and choose their provider.**

What we build instead:

- **Provider-agnostic LLM layer** — adapter pattern over multiple providers (Anthropic, OpenAI, Google, Bedrock, local/Ollama)
- **Our own orchestration** — coordinator/subagent pattern, planning loop, tool dispatch
- **Our own memory management** — per-domain context that persists and improves over time
- **Our own safety hooks** — we already have classification, just wire it into the loop properly

What we DON'T need from Agent SDK:

- Tool calling? Every LLM provider supports it now.
- Streaming? Standard across providers.
- Subagents? It's just spawning another LLM call with a different system prompt.
- Sessions? We already have Postgres conversations.

The Agent SDK is a convenience wrapper. The value of this product is in the browser bridge, the safety layer, the memory system, and the orchestration — not in which SDK calls the LLM.

### Proper MCP — for real this time

We never built MCP. We deleted the fake browser-bridge and inlined tools in chat.ts. What we have is just Anthropic function calling.

Real MCP (Model Context Protocol) is a JSON-RPC protocol that lets any LLM client connect to tool servers. If we build a proper MCP browser-bridge:

- Any MCP-compatible client can use our browser tools
- Users could connect Claude Desktop, Cursor, or their own agents to our browser-bridge
- The tool server is provider-agnostic by design

**However** — MCP adds complexity and we need to evaluate whether it's the right abstraction right now vs. a simpler internal tool dispatch. The tools themselves are simple function calls over WebSocket. We can always wrap them in MCP later.

**Decision: Start with a clean internal tool registry.** Each tool is a typed function that sends a WS message and returns a result. Provider adapters translate tool definitions to each LLM's format (Anthropic `tools`, OpenAI `functions`, etc.). If MCP makes sense later, we wrap the registry in an MCP server — the tools don't change.

### Per-Domain Memory — the real moat

This is the product differentiator. The agent gets better at using a specific web app over time.

First visit to SAP: agent fumbles, takes 15 actions to find the right page.
Tenth visit: agent knows SAP's navigation patterns, common workflows, element quirks — goes straight to the right page in 3 actions.

This isn't just conversation history. It's **learned knowledge about how a specific web application works**, stored per-domain, available to all users on that domain.

## Architecture

### Provider Layer

```
apps/api/src/llm/
  types.ts          — Provider-agnostic types (Message, Tool, ToolResult, StreamEvent)
  registry.ts       — Provider registry + factory
  providers/
    anthropic.ts    — Claude adapter (Sonnet, Haiku, Opus)
    openai.ts       — GPT-4o, GPT-4o-mini adapter
    google.ts       — Gemini adapter
    bedrock.ts      — AWS Bedrock adapter (wraps Claude/Titan)
    ollama.ts       — Local models adapter
```

Each provider adapter implements:

```typescript
interface LLMProvider {
  id: string; // 'anthropic', 'openai', etc.
  chat(params: ChatParams): AsyncIterable<StreamEvent>;
  supportsVision: boolean;
  supportsToolUse: boolean;
  models: ModelConfig[]; // available models with capabilities
}

interface ChatParams {
  model: string; // 'sonnet', 'haiku', 'gpt-4o', etc.
  system: string;
  messages: Message[];
  tools?: Tool[];
  maxTokens?: number;
}

// Provider-agnostic types
interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema; // standard JSON Schema, not vendor-specific
}

interface Message {
  role: 'user' | 'assistant' | 'tool_result';
  content: string | ContentBlock[]; // text or multimodal (text + images)
}
```

**Configuration:** Users set their provider + API key in the dashboard settings or via environment variables:

```
LLM_PROVIDER=anthropic          # or openai, google, bedrock, ollama
LLM_API_KEY=sk-...
LLM_MODEL_STRONG=sonnet         # for planning, complex reasoning
LLM_MODEL_FAST=haiku            # for data reads, navigation, simple tasks
```

Adapters handle the translation: our `Tool` → Anthropic's `Anthropic.Tool` or OpenAI's `ChatCompletionTool`. Our `Message` → each provider's message format. Streaming events normalized to a common interface.

### Tool Registry

```
apps/api/src/tools/
  registry.ts       — Tool registry (register, lookup, execute)
  types.ts          — Tool definition types
  browser/
    click.ts        — click_element
    type.ts         — type_text
    select.ts       — select_option
    navigate.ts     — navigate
    page-state.ts   — get_page_state
    screenshot.ts   — screenshot (captures visible tab as image)
    scroll.ts       — scroll page or to element
    wait.ts         — wait for element/condition
    read-text.ts    — extract text content from selector
    read-table.ts   — extract table as structured JSON
```

Each tool:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult>;
}

interface ToolContext {
  connectionId: string; // which browser to target
  userId: string;
  tabId?: number;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  screenshot?: string; // base64 image if tool returns visual
}
```

The registry translates tool definitions to each LLM provider's format on demand. Tools themselves are provider-agnostic — they just send WS messages and return results.

### Agent Orchestration

```
apps/api/src/agent/
  orchestrator.ts   — Main agent loop (replaces runAgentLoop in chat.ts)
  planner.ts        — Plan generation + plan-then-execute flow
  executor.ts       — Executes individual tool calls with safety checks
  prompts.ts        — System prompts for different agent roles
```

**The orchestrator is a simple loop** — not a framework, not a library, just clear TypeScript:

```
1. Receive user message + context (page state, selected elements, domain memory)
2. Build system prompt (page context + domain memory + safety rules)
3. Call LLM (strong model) with tools
4. If LLM returns text → stream to user
5. If LLM returns tool_use:
   a. Pre-execution: classify safety (safe/review/blocked)
   b. If blocked → return error to LLM, let it replan
   c. If review → send approval request, wait
   d. Execute tool, get result
   e. Post-execution: audit log, status broadcast
   f. Feed result back to LLM
6. Repeat until LLM stops calling tools or max iterations
7. Store conversation, update domain memory
```

This is what we already have in `runAgentLoop` — just cleaner, decoupled from the HTTP handler, with proper provider abstraction and memory.

**For complex tasks, the orchestrator plans first:**

```
User: "Find all overdue invoices and send reminders"

Orchestrator (strong model):
  → Generates plan: [navigate, filter, read_table, loop(click_reminder)]
  → Returns plan to user: "Here's what I'll do: ..."
  → User approves (or edits)
  → Orchestrator executes plan step by step
  → After each step: screenshot to verify, replan if something unexpected
```

### Subagent Pattern (designed for, minimal implementation now)

The orchestrator CAN delegate to subagents — smaller, focused LLM calls with limited tool access:

| Agent Role  | Model  | Tools                                             | Use Case                                    |
| ----------- | ------ | ------------------------------------------------- | ------------------------------------------- |
| Coordinator | strong | all                                               | Planning, complex reasoning, error recovery |
| Reader      | fast   | get_page_state, read_text, read_table, screenshot | Data extraction                             |
| Navigator   | fast   | navigate, get_page_state, screenshot              | Page-to-page movement                       |
| Writer      | strong | click, type, select                               | Form filling, actions that modify state     |

**Phase 7 implementation: just the Coordinator (one agent, strong model).** The subagent split happens when we need it — the architecture supports it because each "subagent" is just an orchestrator call with a different system prompt and tool subset.

### Memory System

```
apps/api/src/memory/
  conversation.ts   — Conversation memory (summarize long histories)
  domain.ts         — Per-domain app knowledge (persistent, shared)
  types.ts          — Memory types
```

#### Conversation Memory

As conversations get long, older messages get summarized to stay within context limits:

```
Messages 1-20: [summarized into 1 paragraph]
Messages 21-30: [summarized into 1 paragraph]
Messages 31-40: [kept verbatim — recent context]
```

The summarization call uses the fast model. Summary stored in the conversation record.

#### Domain Memory (the moat)

Per-domain knowledge that persists across conversations, keyed by domain (e.g., `app.internal-hr.com`):

```typescript
interface DomainMemory {
  domain: string;
  // Navigation patterns
  knownPages: { path: string; description: string; howToReach: string }[];
  // Element quirks
  elementNotes: { selector: string; note: string }[]; // "this dropdown takes 2s to load"
  // Workflow patterns
  workflows: { name: string; steps: string[] }[]; // "to filter invoices: click Filters → ..."
  // App behavior
  appNotes: string[]; // "uses React, needs wait after navigation"
  // Updated by the agent after each successful task
  lastUpdated: number;
}
```

**How it gets populated:**

1. After each successful task, the orchestrator calls the fast model: "What did you learn about this app that would help future tasks?"
2. Response gets merged into the domain's memory record
3. Next conversation on this domain gets the memory injected into the system prompt

**Storage:** Postgres table `domain_memory`, keyed by domain. All users on the same domain share the same knowledge base. This means when Employee A teaches the agent how to navigate SAP, Employee B benefits immediately.

**Future (Phase 12):** Domain memory gets embedded via pgvector for semantic lookup instead of stuffing everything into the prompt.

### Screenshot / Vision

The agent can see the page. This is critical for:

- Verifying actions worked (did the button click actually submit the form?)
- Understanding visual layout (error banners, loading spinners, modals)
- Reading content that's rendered visually but not in the DOM (canvas, SVG charts)
- Navigating unfamiliar pages without relying solely on DOM indexing

**Extension handler:**

```
action === 'screenshot'
  → chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 75 })
  → return base64 image
```

**Provider integration:**

- Claude: native vision (image in message content)
- OpenAI: native vision (GPT-4o supports images)
- Gemini: native vision
- Ollama: depends on model (LLaVA, etc.)
- If provider doesn't support vision: skip screenshot, rely on DOM only

**Privacy controls:**

- Screenshots sent directly to LLM API, never stored on our backend
- Can be disabled per-domain in settings
- JPEG quality 75 (reduces detail + payload size)
- Only captured when agent explicitly calls the screenshot tool

## What Changes in the Extension

Still a thin client. Three additions:

1. **Screenshot handler** in ws-client.ts — `chrome.tabs.captureVisibleTab()`
2. **Plan UI** in ChatTab — render plan steps, Execute/Edit buttons, step-by-step progress
3. **Provider settings** in SettingsTab — select LLM provider + enter API key (stored in chrome.storage, sent to backend)

## Implementation Order

```
Step 1: Provider layer (types + Anthropic adapter)                    ✅ DONE
        ↓ replaces direct Anthropic SDK usage in chat.ts
        → src/llm/types.ts, src/llm/index.ts, src/llm/providers/anthropic.ts

Step 2: Tool registry (extract tools from chat.ts into typed defs)   ✅ DONE
        ↓ tools are provider-agnostic
        → src/tools/types.ts, src/tools/registry.ts, src/tools/browser/*.ts

Step 3: Orchestrator (extract runAgentLoop into proper module)        ✅ DONE
        ↓ chat.ts becomes thin: receive request → call orchestrator → stream response
        → src/agent/orchestrator.ts, src/agent/prompts.ts

Step 4: Safety hooks (wire classifier into orchestrator pre/post)     ✅ DONE
        ↓ same classification, cleaner integration
        → handleToolCall() in orchestrator.ts

Step 5: Screenshot tool (extension handler + vision in orchestrator) ✅ DONE
        ↓ agent can see the page
        → extension ws-client.ts handler + ImageBlock in tool results

Step 6: Conversation memory (summarization for long conversations)  ✅ DONE
        ↓ agent handles 50+ message conversations
        → src/memory/conversation.ts

Step 7: Domain memory (per-domain knowledge persistence)            ✅ DONE
        ↓ agent gets better at each app over time
        → src/memory/domain.ts + DB schema + migration

Step 8: Planning (structured plan output + UI)                      ✅ DONE
        ↓ agent plans before executing complex tasks
        → src/agent/planner.ts + ChatTab plan UI (Execute/Edit buttons)

Step 9: OpenAI adapter (second provider, proves the abstraction)    ✅ DONE
        ↓ users can choose Claude or GPT-4o
        → src/llm/providers/openai.ts + registry update
```

Steps 1-4 are pure refactoring — move existing code into better structure, no new features, everything still works.
Steps 5-7 are new capabilities.
Steps 8-9 prove the architecture.

## Forward Design: Multi-Agent Swarm (Phase 13)

The orchestrator is the swarm controller. In Phase 7, it runs one agent loop. In Phase 13:

```
User: "Compare pricing across our 3 vendor portals"

Orchestrator:
  → Spawn Reader subagent for vendor1.com (Haiku, background tab 1)
  → Spawn Reader subagent for vendor2.com (Haiku, background tab 2)
  → Spawn Reader subagent for vendor3.com (Haiku, background tab 3)
  → All three run in parallel
  → Orchestrator merges results, presents comparison
```

**What Phase 7 must support:**

- Tool context includes `connectionId` + `tabId` so tools can target specific tabs
- Orchestrator loop is async and can run multiple instances
- Domain memory is shared across subagents on the same domain

## Forward Design: Dashboard-Triggered Agents (Phase 9)

```
Dashboard UI: [Run "Daily Invoice Check"]
  → POST /api/tasks/run { flowId, userId }
  → Backend finds user's active WS connection
  → Sends task_start { taskId, flowId, params }
  → Extension opens background tab
  → Orchestrator executes (same loop, different entry point)
  → Progress streams back via WS → dashboard shows live status
  → Result stored in Postgres
```

**The agent runs in the employee's browser, not on our servers.** This means:

- SSO/VPN/MFA — already handled
- No credential storage needed
- No data leaves the employee's machine
- IT doesn't provision anything — employee installs extension, done

**What Phase 7 must support:**

- Orchestrator is decoupled from HTTP request handler (can be triggered by WS message too)
- Each run has a `taskId` for tracking
- WS protocol supports `task_start` / `task_progress` / `task_complete`

## Forward Design: Scheduled Agents (Phase 11)

```
Inngest cron fires at 9am
  → Backend sends task to user's extension via WS
  → Extension opens background tab, runs agent
  → If browser is closed: task queued, executes on next connect
```

**Requirement:** Employee's browser must be open (can be minimized). This is fine for enterprise — work laptops are on all day.

## Privacy Model

| Data                              | Where It Lives                   | Who Sees It               | Stored?                      |
| --------------------------------- | -------------------------------- | ------------------------- | ---------------------------- |
| Page HTML/content                 | Employee's browser               | Never leaves browser      | No                           |
| DOM structure (selectors, labels) | Sent to LLM API                  | LLM provider              | No (ephemeral)               |
| Screenshots                       | Sent to LLM API                  | LLM provider              | No (ephemeral, configurable) |
| Credentials/cookies               | Employee's browser               | Never sent anywhere       | No                           |
| User messages                     | Postgres                         | User + admins             | Yes                          |
| Conversation history              | Postgres                         | User + admins             | Yes                          |
| Domain memory                     | Postgres                         | All domain users + admins | Yes                          |
| Audit logs                        | Postgres                         | Admins only               | Yes (append-only)            |
| LLM API keys                      | Settings (env or chrome.storage) | Backend only              | Encrypted                    |

**Enterprise deployment:** Self-host with Docker. LLM API calls go directly to the provider (or to an internal endpoint if using Bedrock/Azure OpenAI/on-prem models). We are a passthrough, not a proxy.

## What's NOT in Phase 7

- Multiple providers beyond Anthropic + OpenAI (Phase 7 proves the abstraction with 2)
- Data extraction tools (Phase 8 — just new tool definitions)
- Dashboard triggers (Phase 9 — different entry point, same orchestrator)
- Flows/teach mode (Phase 10)
- Scheduled runs (Phase 11)
- Embeddings/vector search (Phase 12)
- Multi-agent parallelism (Phase 13)
- Team management (Phase 14)
