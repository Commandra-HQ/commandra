# S3 Storage Audit — RESOLVED

> Audited 2026-03-22. All issues resolved in Phase 23.

## Fixes Applied

### 1. Self-improvement for coordinator → **DONE** (Phase 23a)
Removed the `_coordinator` gate. `analyzeAndImprove()` now runs for every conversation with tool calls. Coordinator's S3 files hydrated on resolve.

### 2. Auto-create domain agents → **DONE** (Phase 23c)
After 3+ coordinator interactions on a domain with no existing agent, writes `AGENT_HINT.md` to domain knowledge. Agent sees the hint and suggests creating a specialized agent.

### 3. Screenshots to S3 → **DONE** (Phase 23b)
`uploadScreenshotToS3()` uploads to `agents/{userId}/screenshots/{id}.jpg`, returns signed URL (1-hour expiry). Both LLM providers use URL reference instead of inline base64.

### 4. Run logs for all conversations → **DONE** (via Phase 23a)
`analyzeAndImprove()` now runs for coordinator too, which writes run logs to `runs/{userId}/{date}/`.

### 5. Compaction transcripts → **VERIFIED**
Code exists in `compaction-files.ts` and works correctly. Was not triggering because image token estimation was 30x too high (fixed in Phase 19). With correct estimation, compaction triggers at the right time.

## S3 Structure (expected after first few conversations)

```
agents/
  {userId}/
    _coordinator/
      SKILLS.md                    ← Auto-generated after conversations
      LEARNINGS.md                 ← Corrections accumulated
      ERRORS.md                    ← Failure patterns
      MEMORY.md                    ← Unified knowledge index
    screenshots/
      {uuid}.jpg                   ← Persistent, URL-referenced
    plans/{convId}/
      PLAN.md                      ← Per-conversation plans
    scratchpad/{convId}/
      {key}.json                   ← Inter-agent data
    compactions/{convId}/
      {timestamp}.md               ← Compacted transcripts
  domains/{userId}/
    mail_google_com/
      KNOWLEDGE.md                 ← Domain knowledge
      WORKFLOWS.md                 ← Proven workflows
      AGENT_HINT.md                ← Auto-agent suggestion (after 3+ uses)
  runs/{userId}/
    2026-03-22/
      {time}_{slug}_{convId}.md    ← Run logs
```
