-- Phase 13: Agentic System Overhaul
-- Adds outcome tracking to conversations for learning feedback loops

ALTER TABLE "conversations" ADD COLUMN "outcome" text;

ALTER TABLE "flow_runs" ADD COLUMN IF NOT EXISTS "adaptations" jsonb DEFAULT '[]';
