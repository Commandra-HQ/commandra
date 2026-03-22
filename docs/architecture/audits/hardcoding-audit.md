# Hardcoding & Non-Agentic Patterns Audit

> Comprehensive audit of everything hardcoded vs what should be dynamic/agentic.

## Critical (actively breaking the product)

### 1. Screenshots are inline base64, not S3 URLs
- Screenshots saved to OS temp dir (`/tmp/commandra-screenshots/`), 1-hour TTL
- Passed to LLM as full base64 in message content (~200KB per image)
- Even with fixed token counting (IMAGE_TOKEN_ESTIMATE=2000), the base64 still wastes bandwidth and memory
- Should: upload to S3, pass URL to LLM via `file_url` (OpenAI) or `source.url` (Anthropic)
- **Files:** `apps/api/src/screenshots/manager.ts`, `apps/api/src/agent/browser-tools.ts`

### 2. No file_url / document support for LLMs
- Anthropic: only `type: 'image'` with `source.type: 'base64'`. No `source.type: 'url'`, no `type: 'document'` for PDFs
- OpenAI: only `input_image` with inline data URI. No `file_url` references
- Should: upload images/files to S3 → get public URL → pass URL to LLM
- **Files:** `apps/api/src/llm/providers/anthropic.ts`, `apps/api/src/llm/providers/openai.ts`

### 3. S3 browsing hardcoded to 3 categories
- `save_knowledge` only accepts `domain`, `agent`, `run` categories
- Agent can't freely browse S3, discover files, or organize by custom paths
- Should: accept full path, add `browse_storage` tool
- **Files:** `apps/api/src/agent/tool-definitions.ts`, `apps/api/src/agent/internal-tools.ts`

## High (limits functionality but doesn't break)

### 4. All constants hardcoded
- Thinking budget: 4000 tokens (orchestrator), 2000 (swarm) — not per-agent
- Max concurrent sub-agents: 3 — not per-agent
- Scheduler retry: [5m, 15m, 60m] 3 attempts — not per-agent
- Self-improve caps: 40/60/30 entries — not per-agent
- Should: move to `AgentConfig` with defaults

### 5. Safety classifier is global regex
- Same rules for all agents on all domains
- Can't say "delete is safe in Gmail but blocked in AWS"
- Should: agent-specific safety overrides, domain-aware classification

### 6. No per-agent LLM config
- No temperature, top_p, model override per agent
- Thinking always on — wasteful for simple navigation
- Should: `agentConfig.llm: { model, temperature, thinking }`

### 7. Sub-agents always use fast model
- Can't spawn a "reasoning" sub-agent with strong model
- Should: `spawn_agent({ model: 'strong' })`

## Medium (nice to have)

### 8. No dynamic tool registration
- Agents can't define custom tools at runtime
- Tool definitions are static code

### 9. Prompt cache always ephemeral
- Anthropic supports `type: 'critical'` for persistent caching
- Could save significant cost on repeated agent runs

### 10. Depth limit hardcoded at 2
- Some workflows legitimately need depth 3+
- Should be per-agent configurable

### 11. No domain-specific autonomy
- Can't say "autonomous on gmail, supervised on stripe"
- Only one autonomy level per agent

## Current state: ~70% hardcoded, ~30% agent-configurable

What IS configurable per agent:
- model (strong/fast), maxIterations, tools allowlist, domains, trigger/cron,
  autonomy level, hooks, alertWebhook

What is NOT configurable:
- thinking budget, max output tokens, temperature, concurrent sub-agents,
  retry policy, safety rules, screenshot TTL, S3 paths, file caps,
  depth limit, prompt caching, sub-agent model
