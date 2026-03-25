-- Phase 26: Token tracking — detailed token breakdown per agent run
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "input_tokens" integer DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "output_tokens" integer DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "cache_read_tokens" integer DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "cache_write_tokens" integer DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "thinking_tokens" integer DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "estimated_cost_usd" numeric(10,6) DEFAULT 0;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "provider" text;
