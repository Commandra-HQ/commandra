# Phase 12b — Vector Embeddings + Semantic Search

Postgres has pgvector installed and `element_embeddings` table exists, but nothing generates or queries embeddings yet. This phase adds provider-agnostic embedding generation (background, never in the indexing hot path) and vector search for element finding, flow matching, and memory retrieval.

## What Gets Embedded

| Data | Why | When |
|------|-----|------|
| Element labels (button text, input names, link labels) | Find the right element when selectors break and fuzzy match isn't enough | Background Inngest job after page upsert |
| Flow names + step intents | "do that thing from last week" → find the right flow | On flow create/update |
| Domain memory entries | Retrieve relevant learned patterns for current context | On memory write |

## What Does NOT Get Embedded
- Raw HTML / DOM structure — waste of tokens
- Full page content — privacy violation (never send PII to backend)
- Every element on every page — only interactive elements that have been indexed

## Embedding Provider

Provider-agnostic, same pattern as LLM layer. Each provider implements `embed(texts: string[]): Promise<number[][]>`.

Starting providers:
- **OpenAI** `text-embedding-3-small` (1536 dims) — cheap, good quality, default
- **Ollama** local embeddings (nomic-embed-text, 768 dims) — for air-gapped/self-hosted

Vector column dimension is configurable per provider. Migration updates `element_embeddings.embedding` to match.

## Architecture

```
Page indexed → stored in Postgres (no embeddings, fast)
                  ↓
        Inngest background job picks up new/updated pages
                  ↓
        Batch embed element labels via provider adapter
                  ↓
        Store in element_embeddings table
                  ↓
At action time: fuzzy match fails → vector search fallback
At flow search: embed user query → cosine similarity on flows
At memory retrieval: embed context → find relevant memories
```

## Data Flow

### Element Embedding (Background)
```
page_indexed event → Inngest job triggers
  → Load page elements from Postgres
  → Filter: only elements without current embedding (new or label changed)
  → Batch embed labels: ["Submit Order", "Cancel", "Email input", ...]
  → Upsert into element_embeddings table
```

### Vector Search at Action Time
```
Action execution → primary selector fails → fallback selectors fail → fuzzy match fails
  → Extension sends find_element { label, type, pageUrl } to backend via WS
  → Backend embeds the label query
  → Cosine similarity search against element_embeddings for that page's site
  → Returns best matching selector + fallbacks
  → Extension executes action with returned selector
```

### Flow Search
```
User types in FlowsTab search → embed query
  → Cosine similarity against flow name + step intent embeddings
  → Return ranked flows
```

## Schema Changes

### Update element_embeddings
- Change vector dimension from 256 to configurable (default 1536 for OpenAI)
- Add `embeddingModel` column to track which model generated the embedding
- Add `labelHash` column to detect when re-embedding is needed (label changed)
- Add HNSW index for fast cosine similarity search

### New table: flow_embeddings
```sql
CREATE TABLE flow_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  text TEXT NOT NULL,           -- flow name + concatenated step intents
  embedding vector(1536),
  embedding_model TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### New table: memory_embeddings
```sql
CREATE TABLE memory_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,     -- what this memory is about
  memory_text TEXT NOT NULL,    -- the actual memory content
  embedding vector(1536),
  embedding_model TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Implementation Order

```
Step 1: Embedding provider layer                               ✅ Done
        apps/api/src/llm/embeddings.ts — provider-agnostic embed() function
        EmbeddingProvider interface: embed(texts: string[]) → number[][]
        OpenAI adapter (text-embedding-3-small)
        Ollama adapter (nomic-embed-text)
        Provider selection from LLM settings (same config pattern as chat models)

Step 2: Schema migration                                        ✅ Done
        Update element_embeddings: vector dim 1536, add embeddingModel + labelHash columns
        Create flow_embeddings table
        Create memory_embeddings table
        Add HNSW indexes on all embedding columns

Step 3: Background embedding job (Inngest)                      ✅ Done
        Event: page/upserted → triggers element embedding job
        Event: flow/saved → triggers flow embedding job
        Inngest serve endpoint wired into Hono server
        Batch embed element labels for new/changed elements
        Skip elements with matching labelHash (already embedded)
        Stale embedding cleanup on re-index

Step 4: Vector search functions                                 ✅ Done
        apps/api/src/db/vector-search.ts
        searchElements(query, siteId, limit) → cosine similarity on element_embeddings
        searchElementsOnPage(query, pageId, limit) → scoped to single page
        searchFlows(query, userId, limit) → cosine similarity on flow_embeddings
        searchMemories(query, siteId, limit) → cosine similarity on memory_embeddings

Step 5: Wire into selector resilience                           ✅ Done
        New WS message: find_element { label, type, domain, requestId }
        Backend embeds label → vector search → returns best selector
        Extension falls back to this after fuzzy match fails (4th tier)
        5-second timeout on vector search to not block actions

Step 6: Wire into flows + memory                                ✅ Done
        Flow create → embed name + step intents → Inngest background job
        Flow update → re-embed if name/steps changed
        GET /api/flows/search?q= → semantic flow search endpoint
        Memory embedding table ready (write + search wired, awaits memory system)
```

## What's NOT in Phase 12b

- Embedding during page indexing (stays in background job, never blocks ingestion)
- Cross-site element search (scoped to site for now)
- Re-ranking with LLM (vector similarity score is enough)
- Embedding page screenshots (text embeddings only)
- Conversation embedding (can add later, not critical now)
