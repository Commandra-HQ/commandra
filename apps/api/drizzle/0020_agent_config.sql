-- Phase 23: Configurable agent constants (LLM config, limits, domain autonomy)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "llm_config" jsonb;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "limits" jsonb;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "domain_autonomy" jsonb;
