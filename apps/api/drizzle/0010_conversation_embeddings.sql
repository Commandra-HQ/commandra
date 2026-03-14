-- Phase 13d: Conversation embeddings for "do that thing again" recall
CREATE TABLE IF NOT EXISTS "conversation_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
	"message_text" text NOT NULL,
	"embedding_model" text,
	"embedding" vector(1024),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "conv_embed_conv_idx" ON "conversation_embeddings" ("conversation_id");
CREATE INDEX IF NOT EXISTS "conv_embed_vector_idx" ON "conversation_embeddings" USING hnsw ("embedding" vector_cosine_ops);
