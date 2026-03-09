CREATE TABLE "domain_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"known_pages" jsonb DEFAULT '[]'::jsonb,
	"element_notes" jsonb DEFAULT '[]'::jsonb,
	"workflows" jsonb DEFAULT '[]'::jsonb,
	"app_notes" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_memory_domain_unique" UNIQUE("domain")
);
