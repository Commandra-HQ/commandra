-- Agent system tables (Phase V2)

CREATE TABLE IF NOT EXISTS "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"org_id" uuid REFERENCES "organizations"("id"),
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"description" text DEFAULT '',
	"instructions" text NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb,
	"tools" jsonb DEFAULT '["*"]'::jsonb,
	"safety_rules" jsonb DEFAULT '{}'::jsonb,
	"icon" text DEFAULT '',
	"category" text DEFAULT 'other',
	"tags" jsonb DEFAULT '[]'::jsonb,
	"is_public" boolean DEFAULT false,
	"version" text DEFAULT '1.0.0',
	"forked_from" uuid,
	"installs" integer DEFAULT 0,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "agent_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"settings" jsonb DEFAULT '{}'::jsonb,
	"installed_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "agent_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"rating" integer NOT NULL,
	"review" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "agent_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
	"text" text NOT NULL,
	"embedding_model" text,
	"embedding" vector(1024),
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Add agent_id to conversations
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "agent_id" uuid REFERENCES "agents"("id");
