# Agent Marketplace

## Overview

The marketplace is where users discover, install, and share browser automation agents. It's accessible from both the Chrome extension (AgentsTab) and the web dashboard (/marketplace).

## Features

### Discovery
- **Text search** — Matches agent name and description (ilike)
- **Category filters** — Browse by category (productivity, devtools, etc.)
- **Sort options** — Most installed, newest
- **Semantic search** (future) — pgvector embeddings for natural language queries

### Agent Cards
Each marketplace listing shows:
- Icon (emoji)
- Name
- Description
- Author (email)
- Install count
- Domain badges
- Category badge

### Installation
- One-click install adds the agent to the user's collection
- Install count is tracked on the agent (denormalized for performance)
- Installed agents appear in the extension's agent picker
- Users can uninstall at any time

### Forking
- Any public agent can be forked
- Forking creates a copy owned by the user (status: draft)
- Fork lineage tracked via `forkedFrom` FK
- Forked agents can be customized and re-published

### Ratings
- 1-5 star rating system
- Optional text review
- One rating per user per agent (upsert)
- Average rating shown on agent detail page

## API Endpoints

### Browse Marketplace
```
GET /api/agents/marketplace?q=gmail&category=productivity&sort=installs&limit=20&offset=0
```

Response:
```json
{
  "agents": [
    {
      "id": "...",
      "name": "Gmail Organizer",
      "slug": "gmail-organizer",
      "description": "...",
      "icon": "📧",
      "category": "productivity",
      "domains": ["mail.google.com"],
      "tags": ["gmail", "email"],
      "installs": 142,
      "version": "1.0.0",
      "author": { "id": "...", "email": "user@example.com" },
      "createdAt": "2026-03-15T..."
    }
  ]
}
```

### Install/Uninstall
```
POST   /api/agents/:id/install
DELETE /api/agents/:id/install
```

### Rate
```
POST /api/agents/:id/rate
Body: { "rating": 5, "review": "Great agent!" }
```

## Future Enhancements

### Agent Versioning (Phase 4B)
- Semantic versioning (1.0.0 → 1.1.0)
- Published agents create immutable versions
- Installed agents pin to a version
- Update notifications for installed agents

### Semantic Search (Phase 4A)
- Embed agent name + description + instructions summary
- pgvector cosine similarity search
- Same pattern as existing conversation/element embeddings

### Pre-seeded Agents (Phase 4C)
- Convert existing domain seeds into proper agents
- "Gmail Assistant", "GitHub Navigator", "LinkedIn Helper", etc.
- Ship as built-in agents (isPublic: true, userId: system)

### Collections / Featured
- Curated collections (e.g., "Starter Pack", "For Developers")
- Featured agent spotlights
- Trending agents (based on recent installs)
