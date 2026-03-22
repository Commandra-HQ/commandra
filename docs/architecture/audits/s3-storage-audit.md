# S3 Storage Audit — What's Actually There vs What Should Be

> Audited 2026-03-22. The S3 storage is nearly empty. Most agent infrastructure is unused because the default coordinator skips self-improvement.

## What's in S3 right now

```
agents/                                    ← Single bucket
  d27278ef.../                             ← User folder
    plans/                                 ← Plans per conversation
      4bf97add.../PLAN.md
      71ece104.../PLAN.md
      8047d5af.../PLAN.md
      8350af51.../PLAN.md
  domains/d27278ef.../                     ← Domain knowledge
    mail_google_com/
      KNOWLEDGE.md (1.5KB)                 ← Gmail selector escaping rules
      WORKFLOWS.md (1.4KB)                 ← Gmail compose workflow
```

**Total: 6 files. ~5KB of data.**

## What SHOULD be in S3 (for a truly agentic system)

```
agents/
  {userId}/
    _coordinator/                          ← DEFAULT AGENT should have files too!
      MEMORY.md                            ← What the coordinator has learned
      SKILLS.md                            ← Workflows it's mastered
      LEARNINGS.md                         ← Corrections from user
      ERRORS.md                            ← Failure patterns
    gmail-helper/                          ← Auto-created domain agent
      SOUL.md                              ← "You are a Gmail specialist..."
      SKILLS.md                            ← Auto-extracted from teaching conversations
      LEARNINGS.md                         ← "Selectors need escaping"
      ERRORS.md                            ← "Don't use #:vd directly"
      MEMORY.md                            ← Unified knowledge index
    github-navigator/                      ← Another auto-created agent
      SOUL.md
      SKILLS.md
      ...
    plans/{convId}/PLAN.md                 ← Plans (working)
    scratchpad/{convId}/{key}.json         ← Inter-agent data (working)
    screenshots/                           ← Screenshots in S3 (NOT IMPLEMENTED)
      {timestamp}_{domain}.jpg
    compactions/{convId}/                  ← Conversation transcripts (NOT VERIFIED)
      {timestamp}.md
  domains/{userId}/
    mail_google_com/
      KNOWLEDGE.md                         ← Working
      WORKFLOWS.md                         ← Working
      MEMORY.md                            ← User-specific domain prefs
    github_com/
      KNOWLEDGE.md                         ← Should exist after GitHub usage
      WORKFLOWS.md
  runs/{userId}/
    2026-03-22/                            ← Run logs (EMPTY — coordinator skips self-improve)
      09-00_gmail-helper_conv123.md
```

## The Fundamental Problem

**The default `_coordinator` agent skips ALL self-improvement.**

From `chat.ts` line 291-292:

```typescript
if (agentConfig.id !== '_coordinator') {
    // Self-improvement only runs for non-coordinator agents
```

And from `self-improve.ts` — `analyzeAndImprove()` is ONLY called for non-coordinator agents.

This means:

- **No SKILLS.md** — the coordinator never learns workflows
- **No LEARNINGS.md** — corrections are never captured
- **No ERRORS.md** — failure patterns are never recorded
- **No MEMORY.md** — no unified memory index
- **No run logs** — no history in S3
- **No screenshots in S3** — they're in /tmp with 1-hour TTL

The user has been teaching the agent for hours. The agent saves domain knowledge (KNOWLEDGE.md, WORKFLOWS.md) because those use `save_knowledge` tool. But all the self-improvement infrastructure (skills, learnings, errors, memory, runs) is dead because it's gated behind `!== '_coordinator'`.

## Root Cause Analysis

The design assumed users would create named agents for repeated tasks. But in practice:

1. Users chat with the default coordinator for everything
2. The coordinator is where all the learning happens
3. But the coordinator explicitly skips self-improvement
4. So learned knowledge is ONLY saved when the agent explicitly calls `save_knowledge`
5. The automatic post-run analysis never runs

## Fixes Required

### 1. Enable self-improvement for the coordinator

Remove the `agentConfig.id !== '_coordinator'` gate. Or better: always run self-improvement, but write to domain-specific files instead of agent-specific files.

### 2. Auto-create domain agents

When the coordinator works on a domain 3+ times, auto-create a domain agent (e.g., `gmail-helper`). This agent inherits the knowledge and gets the full self-improvement pipeline.

### 3. Screenshots to S3

Upload screenshots to S3 bucket, generate signed URLs, pass URLs to LLM instead of inline base64. Current: screenshots in /tmp/commandra-screenshots/ with 1-hour TTL.

### 4. Run logs for all conversations

Write run logs for every conversation (not just non-coordinator agents). This creates a searchable history of what happened.

### 5. Compaction transcripts

Verify that conversation compaction transcripts are actually being saved to S3. The code exists in `compaction-files.ts` but may not be triggering (context window was artificially small due to the image token bug).

## Impact

Without these fixes:

- The agent starts cold every session (no accumulated skills)
- User corrections are lost (no learnings)
- Failure patterns repeat (no error memory)
- No screenshots persist for analysis
- No run history for debugging
- The entire Phase 15-22 agent infrastructure is effectively unused
