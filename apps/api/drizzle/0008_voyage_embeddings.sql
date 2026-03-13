-- Migration: Switch embedding dimensions from 1536 (OpenAI) to 1024 (Voyage AI)
-- Existing embeddings must be regenerated after this migration.
-- Run: pnpm --filter @afe/api tsx src/scripts/backfill-embeddings.ts

-- Drop existing embeddings (they're incompatible with new dimensions)
TRUNCATE element_embeddings, flow_embeddings, memory_embeddings;

-- Alter vector columns from 1536 → 1024 dimensions
ALTER TABLE element_embeddings ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE flow_embeddings ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE memory_embeddings ALTER COLUMN embedding TYPE vector(1024);
