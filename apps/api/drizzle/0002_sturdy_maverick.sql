CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"llm_provider" text DEFAULT 'anthropic',
	"llm_api_key" text,
	"llm_model_strong" text DEFAULT 'sonnet',
	"llm_model_fast" text DEFAULT 'haiku',
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;