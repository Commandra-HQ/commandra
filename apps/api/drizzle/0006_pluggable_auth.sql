-- Rename clerk_id to external_id and make it nullable for pluggable auth
ALTER TABLE "users" RENAME COLUMN "clerk_id" TO "external_id";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "external_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "users_clerk_id_unique" TO "users_external_id_unique";--> statement-breakpoint
-- Add password_hash column for credentials-based auth (self-hosted)
ALTER TABLE "users" ADD COLUMN "password_hash" text;
