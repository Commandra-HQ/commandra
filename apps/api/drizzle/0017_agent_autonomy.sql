-- Phase 16: Agent autonomy levels (supervised/trusted/autonomous)
ALTER TABLE "agents" ADD COLUMN "autonomy" text DEFAULT 'supervised';
