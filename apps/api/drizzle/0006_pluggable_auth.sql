ALTER TABLE "users" RENAME COLUMN "clerk_id" TO "external_id";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "external_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;
