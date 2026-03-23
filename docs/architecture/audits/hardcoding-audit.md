# Hardcoding & Non-Agentic Patterns Audit

> Comprehensive audit of everything hardcoded vs what should be dynamic/agentic.
> Updated post Phase 23 — most items resolved.

## Critical — RESOLVED

### 1. Screenshots inline base64 → **DONE** (Phase 23b)
Screenshots uploaded to S3, signed URLs passed to LLM. Both Anthropic and OpenAI support URL references.

### 2. No file_url support → **DONE** (Phase 23e)
Anthropic uses `source.type: 'url'`, OpenAI uses `image_url` with S3 URL. Fallback to base64 if S3 fails.

### 3. S3 browsing hardcoded → **DONE** (Phase 23d)
`browse_storage` tool lets agents freely discover S3 files at any path.

## High — RESOLVED

### 4. Constants hardcoded → **DONE** (Phase 23 hardcoding fix)
Added to `AgentConfig`:
- `llm?: AgentLLMConfig` — temperature, topP, maxOutputTokens, thinkingBudget, thinkingEnabled
- `limits?: AgentLimits` — maxConcurrentSubAgents, maxDepth, maxRetries, retryDelays, selfImproveCap
- `domainAutonomy?: Record<string, AgentAutonomy>` — per-domain autonomy overrides

All previously hardcoded values now have defaults that agents can override:
- Orchestrator thinking budget: `agentConfig.llm?.thinkingBudget ?? 4000`
- Orchestrator max output: `agentConfig.llm?.maxOutputTokens ?? 8000`
- Thinking on/off: `agentConfig.llm?.thinkingEnabled === false`
- Depth limit: `agentConfig.limits?.maxDepth ?? 2`
- Self-improve caps: defaults 40/60/30, overrideable
- Sub-agent iterations: `agentConfig.limits?.maxConcurrentSubAgents ?? 10`

### 5. Safety classifier global → **PARTIALLY DONE**
Domain-specific autonomy added (`domainAutonomy` field). Agent can have "autonomous on gmail, supervised on stripe." The regex-based classifier itself is still global but hooks (Phase 22) provide per-agent tool validation.

### 6. No per-agent LLM config → **DONE**
`AgentLLMConfig` supports temperature, topP, maxOutputTokens, thinkingBudget, thinkingEnabled.

### 7. Sub-agents always fast model → **ALREADY WORKED**
Sub-agents respect `agentConfig.model` — if set to 'strong', they use the strong model.

## Medium — STATUS

### 8. No dynamic tool registration → **Not done** (low demand)
### 9. Prompt cache always ephemeral → **Not done** (cost optimization, not functionality)
### 10. Depth limit hardcoded → **DONE** (configurable via `limits.maxDepth`)
### 11. Domain-specific autonomy → **DONE** (via `domainAutonomy` field)

## Current state: ~85% configurable, ~15% hardcoded

What IS configurable per agent:
- model, maxIterations, tools allowlist, domains, trigger/cron, autonomy,
  domainAutonomy, hooks, alertWebhook, llm config (temperature, topP,
  thinkingBudget, thinkingEnabled, maxOutputTokens), limits (maxDepth,
  maxConcurrentSubAgents, maxRetries, retryDelays, selfImproveCap)

What is NOT configurable (intentionally):
- Dynamic tool registration (static code tools)
- Prompt caching strategy (always ephemeral)
- Scheduler interval (60s — system-wide)
