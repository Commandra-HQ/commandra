-- Create agents table
CREATE TABLE IF NOT EXISTS "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"org_id" uuid REFERENCES "organizations"("id"),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL DEFAULT '',
	"model" text,
	"max_iterations" integer,
	"tools" jsonb,
	"domains" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create agent_runs table
CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
	"conversation_id" uuid REFERENCES "conversations"("id"),
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"status" text NOT NULL,
	"tool_calls" integer DEFAULT 0,
	"tokens_used" integer DEFAULT 0,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Unique slug per user
CREATE UNIQUE INDEX IF NOT EXISTS "agents_user_slug_idx" ON "agents" ("user_id", "slug");
