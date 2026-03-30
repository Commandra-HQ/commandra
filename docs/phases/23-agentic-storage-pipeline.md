# Phase 23 — Agentic Storage Pipeline

> Activate the entire learning pipeline. Every conversation teaches the system. Screenshots persist in S3. The coordinator learns.

## Why

S3 has 6 files after hours of usage. The entire self-improvement infrastructure (Phases 15-22) is unused because:
1. The default `_coordinator` skips self-improvement (`chat.ts` line 291)
2. Screenshots are in `/tmp/` with 1-hour TTL, not in S3
3. No auto-creation of domain agents — users stay on the dumb coordinator forever
4. S3 browsing is hardcoded to 3 categories (`domain/agent/run`)

## What Ships

### 23a. Enable self-improvement for ALL conversations
Remove the `_coordinator` gate. Write skills/learnings/errors to **domain-scoped paths** when no named agent is active. Every conversation teaches the system.

### 23b. Screenshots to S3 + signed URLs
Upload screenshots to S3 bucket → generate signed URLs → pass URLs to LLM. Eliminates inline base64, enables persistent screenshot history.

### 23c. Auto-create domain agents
After the coordinator works on a domain 3+ times, auto-propose a domain agent (e.g., `gmail-helper`). The agent inherits all accumulated domain knowledge and gets the full self-improvement pipeline.

### 23d. S3 browsing tool
Replace hardcoded `domain/agent/run` categories with a `browse_storage` tool. Agents can freely discover, organize, and reference their S3 files.

### 23e. file_url support for LLM providers
Pass S3 URLs to Anthropic/OpenAI instead of inline base64. Support `source.type: 'url'` (Anthropic) and `file_url` (OpenAI).

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/routes/chat.ts` | Remove `_coordinator` gate on self-improvement |
| `apps/api/src/agent/self-improve.ts` | Write to domain paths when no agent slug |
| `apps/api/src/screenshots/manager.ts` | Add `uploadScreenshotToS3()` returning signed URL |
| `apps/api/src/agent/browser-tools.ts` | Use S3 URL in screenshot tool result |
| `apps/api/src/llm/types.ts` | Add `url` field to ImageBlock |
| `apps/api/src/llm/providers/anthropic.ts` | Support `source.type: 'url'` |
| `apps/api/src/llm/providers/openai.ts` | Support `file_url` for images |
| `apps/api/src/agent/tool-definitions.ts` | Add `browse_storage` tool |
| `apps/api/src/agent/internal-tools.ts` | Handle `browse_storage` |
| `apps/api/src/agent/prompts.ts` | Add auto-agent-creation guidance |
