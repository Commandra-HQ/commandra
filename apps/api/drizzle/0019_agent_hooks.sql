-- Phase 22: Agent hooks (PreToolUse, PostToolUse, OnComplete)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "hooks" jsonb;
