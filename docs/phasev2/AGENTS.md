# Agent System Design

## What is an Agent?

An agent is a reusable configuration that customizes how Commandra behaves when interacting with web applications. Think of it as a "personality profile" for the AI — it defines:

- **Instructions:** What the agent knows and how it should behave (the "soul")
- **Domain scope:** Which websites the agent is designed for
- **Tool permissions:** Which browser tools the agent can use
- **Safety rules:** Custom safety overrides (can relax review→safe, never blocked→safe)

## Database Schema

### `agents` table
| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| userId | uuid FK → users | Creator |
| orgId | uuid FK → organizations | Optional org scope |
| name | text | Display name (e.g., "Gmail Organizer") |
| slug | text UNIQUE | URL-safe identifier |
| description | text | Short summary for marketplace |
| instructions | text | Detailed behavior instructions (the "soul") |
| domains | jsonb string[] | Target sites (e.g., ["mail.google.com"]) |
| tools | jsonb string[] | Allowed tools (["*"] = all) |
| safetyRules | jsonb | Custom safety overrides |
| icon | text | Emoji or URL |
| category | text | productivity, data-extraction, etc. |
| tags | jsonb string[] | Search tags |
| isPublic | boolean | Published to marketplace |
| version | text | Semantic version |
| forkedFrom | uuid FK → agents | If forked |
| installs | integer | Install count |
| status | text | draft / published / archived |

### `agent_installs` table
Tracks which users have installed which public agents.

### `agent_ratings` table
1-5 star ratings with optional text reviews.

### `agent_embeddings` table
pgvector embeddings of agent name + description for semantic marketplace search.

## API Routes

```
GET    /api/agents              — List user's agents (created + installed)
GET    /api/agents/:id          — Get agent detail
POST   /api/agents              — Create agent
PUT    /api/agents/:id          — Update agent
DELETE /api/agents/:id          — Delete agent (only creator)
POST   /api/agents/:id/publish  — Publish to marketplace
POST   /api/agents/:id/fork     — Fork a public agent
GET    /api/agents/marketplace  — Browse public agents (search, filter, sort)
POST   /api/agents/:id/install  — Install a public agent
DELETE /api/agents/:id/install  — Uninstall
POST   /api/agents/:id/rate     — Rate an agent
```

## Orchestrator Integration

The orchestrator accepts optional `agentInstructions` and `allowedTools` parameters:

```typescript
interface OrchestratorParams {
  // ... existing params
  agentInstructions?: string;  // Prepended to system prompt
  allowedTools?: string[];     // Filter available tools
}
```

When `agentId` is provided in the chat request:
1. Load agent from DB
2. Extract instructions and tool permissions
3. Pass to orchestrator
4. Agent instructions appear BEFORE the base prompt in the system message
5. Tools are filtered to only those the agent allows (internal tools always available)

## Categories

| Category | Slug | Description |
|----------|------|-------------|
| Productivity | productivity | Task automation, email, calendar |
| Data Extraction | data-extraction | Scraping, data collection |
| Outreach | outreach | Email campaigns, LinkedIn outreach |
| Developer Tools | devtools | GitHub, Jira, CI/CD automation |
| Social Media | social-media | Social media management |
| CRM | crm | Salesforce, HubSpot automation |
| Finance | finance | Financial data, reporting |
| Other | other | Everything else |

## Safety Rules

Agents can define custom safety overrides:
- `allowWrite: true` — Relaxes write actions from "review" to "safe" (auto-approved)
- `allowDelete: false` — Keeps delete actions blocked (default)

Safety hierarchy: agents can relax review→safe but NEVER blocked→safe. The safety classification system always has the final say on truly dangerous actions.

## Example Agent

```json
{
  "name": "Gmail Organizer",
  "slug": "gmail-organizer",
  "description": "Organizes your Gmail inbox by labeling, archiving, and categorizing emails",
  "instructions": "You are a Gmail inbox organization specialist. When the user asks you to organize their inbox:\n1. First, scan the inbox for unread emails\n2. Categorize them: important, newsletters, social, promotions\n3. Apply labels accordingly\n4. Archive newsletters older than 7 days\n5. Always ask before deleting anything\n\nBe concise in your updates. Say what you did, not what you're about to do.",
  "domains": ["mail.google.com"],
  "tools": ["*"],
  "safetyRules": { "allowWrite": true, "allowDelete": false },
  "icon": "📧",
  "category": "productivity",
  "tags": ["gmail", "email", "inbox", "organize"]
}
```
