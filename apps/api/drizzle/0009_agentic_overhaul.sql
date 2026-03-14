-- Phase 13: Agentic System Overhaul
-- Adds outcome tracking to conversations for learning feedback loops

ALTER TABLE "conversations" ADD COLUMN "outcome" text;
