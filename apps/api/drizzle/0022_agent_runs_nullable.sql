-- Make agentId nullable so coordinator/regular chats can record usage
ALTER TABLE "agent_runs" ALTER COLUMN "agent_id" DROP NOT NULL;
