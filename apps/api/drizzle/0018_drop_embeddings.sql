-- Phase 16: Remove embedding pipeline — domain knowledge now in S3
DROP TABLE IF EXISTS "element_embeddings";
DROP TABLE IF EXISTS "conversation_embeddings";
DROP TABLE IF EXISTS "memory_embeddings";

ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "embedding_provider";
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "embedding_api_key";
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "embedding_model";
