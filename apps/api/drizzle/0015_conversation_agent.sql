ALTER TABLE "conversations" ADD COLUMN "agent_id" uuid REFERENCES "agents"("id");
