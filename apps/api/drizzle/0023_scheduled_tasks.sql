-- Phase 29: One-time scheduled tasks for agents
CREATE TABLE IF NOT EXISTS "scheduled_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE CASCADE,
  "task" text NOT NULL,
  "run_at" timestamp NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "conversation_id" uuid,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "scheduled_tasks_run_at_idx" ON "scheduled_tasks" ("run_at") WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "scheduled_tasks_user_idx" ON "scheduled_tasks" ("user_id");
