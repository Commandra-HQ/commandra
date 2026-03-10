CREATE TABLE "flow_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"text" text NOT NULL,
	"embedding_model" text,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"memory_key" text NOT NULL,
	"memory_text" text NOT NULL,
	"embedding_model" text,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "element_embeddings" DROP CONSTRAINT "element_embeddings_page_id_pages_id_fk";
--> statement-breakpoint
ALTER TABLE "element_embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "element_embeddings" ADD COLUMN "label_hash" text;--> statement-breakpoint
ALTER TABLE "element_embeddings" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "element_embeddings" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_embeddings" ADD CONSTRAINT "flow_embeddings_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_embeddings" ADD CONSTRAINT "element_embeddings_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "element_embeddings_embedding_idx" ON "element_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flow_embeddings_embedding_idx" ON "flow_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_embeddings_embedding_idx" ON "memory_embeddings" USING hnsw ("embedding" vector_cosine_ops);