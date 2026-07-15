# Agent Vector Memory & Project Knowledge RAG Design Spec

**Date:** 2026-06-17  
**Status:** Draft (rev. 2 — incorporates external review)  
**Revision notes (rev. 2):** chat turn-group chunking; v1 mandatory scope quotas; recency-weighted ranking + conflict handling; `AGENT_RETRIEVAL_MAX_CHARS`; v2 retrieval optimizations listed in §17.
**Scope:** Introduce vector retrieval capability for the keco-studio Agent, covering both **(A) long-term conversational memory across time/sessions** and **(B) semantic retrieval of project business knowledge (RAG)**  
**Related:**
- [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md)
- [2026-06-12-agent-chat-persistence-design.md](./2026-06-12-agent-chat-persistence-design.md)
- [2026-06-16-docx-image-multimodal-design.md](./2026-06-16-docx-image-multimodal-design.md)

---

## 1. Overview

### 1.1 Background

The Agent's current "memory" relies entirely on chronological history replay from the `agent_messages` table:

| Mechanism | Current state | Problem |
|------|------|------|
| Short-term coherence | Every turn `loadConversationHistory` → concatenated into LLM messages | Works, but tokens grow linearly with turns |
| Context window | `prepareMessagesForLlm` keeps only the most recent **50** non-system messages | Earlier conversation invisible to the model |
| Cross-session | None | Things the user said in conversation A cannot be recalled in conversation B |
| Project knowledge | `query_assets` / `search_library_cell_values` (ILIKE keywords) | No semantic search; large libraries need many tool calls |
| Design documents | Full text + image URLs resent every turn | High token cost; document fragments cannot be retrieved |

The **Vector DB** proposed by the boss is not meant to replace the existing history storage, but to add a **semantic retrieval layer** on top of it: pick the fragments most relevant "by meaning" to the current question out of massive text, then inject them into the LLM context.

### 1.2 Goals (Track A + Track B)

**Track A — Long-term Conversation Memory**

1. Beyond the 50-message sliding window, the Agent can still recover relevant old messages **within the same conversation or the same project** via semantic retrieval.
2. When the user says "the character table structure we agreed on last time" in a new conversation, the agreement from the old conversation can be retrieved (within the user's permission scope).
3. Reduce reliance on "full history replay" and control token cost.

**Expectations about "replacing history entirely" (clarified in rev. 2):**

This spec's strategy is **augment, not replace**. This is deliberate — directly removing the full replay of recent history would harm coherence across multi-turn tool calls.

| Scenario | Token cost change | Benefit |
|------|----------------|------|
| Short conversations (≤50 messages) | **Essentially unchanged** (recent window still fully replayed) | No decrease, and none needed |
| Very long conversations (>50 turns) | Content outside the window is no longer replayed; retrieved fragments injected instead | Recovers early agreements, avoids window-truncation amnesia |
| Cross-session | New capability | Semantically recover old-conversation content in a new conversation |
| Design documents (Phase 3) | **Significant decrease** (optionally no longer resend the full text every turn) | Main source of token savings |

**Track B — Project Knowledge RAG**

1. Build vector indexes over library cell text and design document bodies, supporting **semantic search**.
2. The Agent can find content that is "similar in meaning but different in wording" via a new tool or auto-injected retrieval results.
3. Complements the existing `query_assets` (structured exact queries) rather than replacing it.

### 1.3 Non-Goals (v1)

- Do not replace `agent_messages` as the conversation source of truth; the vector table is an **index layer** and rebuildable.
- No CLIP-level multimodal embedding for images/audio (design document images still go through the existing vision pipeline).
- No cross-project global knowledge sharing (retrieval is always constrained by `project_id` + user permissions).
- No standalone vector SaaS (Pinecone etc.) as a v1 dependency; prefer **Supabase pgvector**, consistent with the existing stack.
- No user-editable "memory pin / forget" UI (considered for v2).

### 1.4 Design Principles

- **The DB remains the conversation source of truth**: `agent_conversations` + `agent_messages` unchanged.
- **Retrieval-augmented generation (RAG)**: vector retrieval results are injected into the prompt as clearly labeled context blocks; the model must still follow the "tool results are authoritative" grounding rule.
- **Recent history first**: messages within the sliding window are still fully retained; vector retrieval **supplements**, it does not replace the most recent N turns.
- **Permission alignment**: embedding retrieval results must not cross RLS / `authorizationService` boundaries.
- **Observable, rebuildable**: indexes update asynchronously; full reindex is possible after source data changes.

---

## 2. Architecture

### 2.1 High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  ChatPanel / useAgentChat                                       │
│  (unchanged: still sends conversationId + new message only)     │
└────────────────────────────┬────────────────────────────────────┘
                             │ POST /api/agent-chat
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Agent Core — runAgentTurn                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. loadConversationHistory (recent window, as today)      │   │
│  │ 2. retrieveRelevantChunks(query, scopes)  ★ NEW           │   │
│  │ 3. buildSystemMessage + retrieved context block  ★ NEW  │   │
│  │ 4. [system, ...windowed history, user] → LLM              │   │
│  │ 5. ReAct loop (+ semantic_search tool available)  ★ NEW   │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────┬───────────────────────────────┬────────────────────┘
             │                               │
             ▼                               ▼
┌────────────────────────┐    ┌──────────────────────────────────┐
│  agent_messages (PG)   │    │  agent_embedding_chunks (PG)     │
│  truth source          │    │  + pgvector HNSW index  ★ NEW    │
└───────────┬────────────┘    └──────────────┬───────────────────┘
            │                                ▲
            │         ┌──────────────────────┴───────────────────┐
            │         │  Indexing pipeline (async)  ★ NEW         │
            │         │  • on message save → embed chat chunks    │
            │         │  • on asset write → embed library cells   │
            │         │  • on design doc send → embed doc chunks  │
            │         └──────────────────────────────────────────┘
            │                                │
            └────────────────────────────────┘
                         Embedding API (OpenAI-compatible)
```

### 2.2 Relationship to existing history

```
Messages sent to the LLM (v1 target shape):

  system:
    - existing buildSystemPrompt(ctx)
    - + "## Retrieved context" block (vector-retrieved Top-K, if any)

  ...recent history (sliding window, still truncated to 50 by prepareMessagesForLlm)

  user:
    - page context augmentation (unchanged)
    - user's new message
```

| Data | Storage | How it enters the LLM |
|------|------|----------------|
| Most recent 50 messages | `agent_messages` | Full replay (existing logic) |
| Earlier same-conversation messages | `agent_messages` + vector index | Retrieved fragments only |
| Other conversations' messages | `agent_messages` + vector index | Retrieved fragments only (same user + project) |
| Library cells | `library_asset_values` + vector index | Retrieved fragments or the `semantic_search` tool |
| Design document body | In-message text + vector index | Retrieved fragments (avoid resending full text every turn) |

---

## 3. Approach Options (decision record)

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A. pgvector in Supabase** | Single-DB `agent_embedding_chunks` + RPC similarity search | Consistent with existing stack; RLS reusable; simple ops | Needs migration; embedding dimensions tied to Supabase version | **Chosen** |
| B. Standalone vector SaaS | Pinecone / Qdrant Cloud | Good managed scalability | New dependency, complex permission sync, cost | Not chosen (v1) |
| C. Only add a `semantic_search` tool, no auto-injection | Agent proactively calls the tool to retrieve | Minimal implementation | Model may forget to call it; poor coherence | Complementary only, not standalone |

**Retrieval strategy (hybrid, chosen):**

1. **Automatic retrieval (at the start of every `runAgentTurn`)**: use the current user message as the query, take Top-K and inject into the system prompt (mixed Track A + B sources).
2. **Explicit tool `semantic_search`**: the Agent calls it proactively when deeper/narrower search is needed (mainly Track B; can also search chat).

---

## 4. Data Model

### 4.1 Extension

```sql
-- migration: enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;
```

Use **cosine distance** (the `<=>` operator). Index type: **HNSW** (suited to online retrieval; sufficient below millions of rows).

### 4.2 Table: `agent_embedding_chunks`

Unified storage for all retrievable text fragments (chat + library + design doc).

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | Chunk ID |
| `project_id` | uuid FK → `projects` | Project isolation (required) |
| `user_id` | uuid FK → `auth.users` nullable | Required for **chat sources**; NULL for library sources (project-level resources) |
| `source_type` | text CHECK | `'chat_message'` \| `'library_cell'` \| `'design_document'` |
| `source_id` | text NOT NULL | Provenance key, format in 4.3 |
| `conversation_id` | uuid nullable FK | Set for chat sources |
| `chunk_index` | int NOT NULL DEFAULT 0 | Which chunk of the same source (starting at 0) |
| `content` | text NOT NULL | Original text fragment for display (≤ 2k chars recommended) |
| `content_hash` | text NOT NULL | sha256(content), for idempotent upsert |
| `metadata` | jsonb DEFAULT '{}' | Structured provenance, see 4.3 |
| `embedding` | vector(1536) NOT NULL | Vector (dimensions follow the embedding model config, default 1536) |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |

**Unique constraint:** `(source_type, source_id, chunk_index, content_hash)` — prevents duplicate indexing.

**Indexes:**

- HNSW on `embedding` with `vector_cosine_ops`
- B-tree on `(project_id, source_type)`
- B-tree on `(conversation_id)` where not null
- B-tree on `(user_id)` where not null

### 4.3 `source_id` and `metadata` conventions

| source_type | source_id format | metadata example |
|-------------|----------------|-----------------|
| `chat_message` | `{conversation_id}:turn_group:{chunk_index}` | `{ "conversationId", "messageIds": ["uuid", ...], "messageCount": 4, "firstMessageAt", "lastMessageAt" }` |
| `library_cell` | `{asset_id}:{field_id}` | `{ "libraryId", "libraryName", "assetId", "assetName", "fieldId", "fieldLabel", "sectionId", "cellUpdatedAt" }` |
| `design_document` | `{conversation_id}:{message_id}:chunk:{chunk_index}` | `{ "conversationId", "messageId", "chunkIndex", "chunkHeading", "messageCreatedAt" }` |

**Chat `source_id` note:** one chunk corresponds to one **turn group** (see §5.2.1), not a single message. `chunk_index` increments from 0 within a conversation; tail reindexing may overwrite the most recent 2 turn groups.

### 4.4 Relationship to existing tables

```
projects 1 ──< agent_conversations 1 ──< agent_messages
    │                                      │
    │                                      └── (indexed as chat_message chunks)
    │
    └── libraries ──< library_assets ──< library_asset_values
                                              └── (indexed as library_cell chunks)

agent_embedding_chunks ── logical pointer ──> source rows (not FK, rebuildable)
```

**Important:** when deleting `agent_messages` / `library_asset_values`, **cascade-delete** the corresponding chunks via application-level logic or a DB trigger.

### 4.5 RLS

| Policy | Rule |
|--------|------|
| SELECT | `project_id` within the user's permitted projects; `chat_message` additionally requires `user_id = auth.uid()` |
| INSERT/UPDATE/DELETE | **service role only** (the indexing pipeline uses the server-side supabase client) |
| RPC `match_agent_embedding_chunks` | `SECURITY DEFINER`, internally verifies `auth.uid()` + project membership |

Clients never read/write the embedding table directly; retrieval only goes through the Agent Core or server-side `/api/...` calls.

---

## 5. Embedding Pipeline

### 5.1 Embedding client

New `src/lib/agent/embedding-client.ts`:

- OpenAI-compatible `POST /v1/embeddings`
- Env:
  - `EMBEDDING_API_URL` (defaults to the same host as `LLM_API_URL`)
  - `EMBEDDING_API_KEY` (defaults to falling back to `LLM_API_KEY`)
  - `EMBEDDING_MODEL` (default `text-embedding-3-small` or the team-chosen MiniMax/OpenAI-compatible model)
  - `EMBEDDING_DIMENSIONS` (default `1536`, must match the DB column)
- Batch cap: ≤ 64 chunks per request (configurable)
- Retry once on failure; log failures, do not block the user from sending messages

### 5.2 Chunking rules

| Source | Chunk strategy | Min length | Notes |
|--------|----------------|------------|-------|
| `chat_message` | **Turn group** (see §5.2.1): 3–5 adjacent user/assistant messages merged into one chunk | 20 chars total | Skip tool messages; assistant contributes only the visible `text`, no reasoning |
| `library_cell` | One chunk per non-empty **text-type** cell; prefixed with `"{libraryName} / {assetName} / {fieldLabel}: "` | 10 chars | Skip image/file/audio/multimedia/reference types; for references, store displayValue text if available |
| `design_document` | Split by paragraph, ~400–600 CJK characters or ~800–1200 English characters, overlap 100 chars | 50 chars | Extracted from the `[Design document]` message body; image URLs do not enter chunks |

#### 5.2.1 Chat turn-group chunking (rev. 2)

Retrieving single messages in isolation loses the contextual coherence of multi-turn topics. v1 uses **adjacent-message merging**:

**Grouping rules (scan indexable messages in the conversation by ascending `created_at`):**

1. Include only messages with `role ∈ {user, assistant}` and non-empty text; **skip** `tool` messages (noisy, bulky).
2. From the current pointer, accumulate messages until any of the following conditions is met, then seal a turn group:
   - it already contains **5** messages; or
   - it already contains **3** messages and the next message is **> 30 minutes** after the previous one (treated as a new topic); or
   - end of the conversation is reached.
3. A single very long message (> 1,500 chars) may form its own group, not merged with other messages.
4. **Overlap:** each turn group **shares its last 1 message** with the previous group (sliding window), avoiding topics being cut off at group boundaries.

**Chunk text format:**

```text
[2026-06-10 14:02] User: Which columns should the character table have?
[2026-06-10 14:02] Assistant: I suggest three columns: Name, Age, Faction.
[2026-06-10 14:03] User: Also add a reference to the factions library.
```

**Index update strategy (tail reindex):**

- After each `saveMessage`, only recompute and re-embed the **last 2 turn groups** of that `conversation_id` (the current group may be incomplete; the previous group may change due to overlap).
- During full backfill, perform grouping sequentially over the entire conversation.

### 5.3 Indexing triggers

| Event | Action | Sync mode |
|-------|--------|-----------|
| `saveMessage` succeeds (user / assistant) | tail reindex: recompute the conversation's last 2 turn groups | **Async** (`void reindexConversationTail(...).catch(log)`) |
| Agent write tools modify `library_asset_values` | enqueue affected cells | Async, debounce 2s per cell key |
| User sends a user message containing `[Design document]` | chunk + index the full text | Async, after `saveMessage` |
| Manual reindex API (admin) | Full rebuild of project chunks | Synchronous job, rate-limited |

**Not in v1:** automatic backfill migration jobs for historical data run separately as a deployment step (see §10 Phase 0).

### 5.4 Upsert / stale deletion

```
indexChunk(source):
  1. chunk text → content_hash
  2. if unchanged hash exists for (source_type, source_id, chunk_index) → skip embed
  3. else embed → upsert row
  4. delete chunks for source where chunk_index >= new_chunk_count (doc was shortened)
```

---

## 6. Retrieval

### 6.1 Query construction

Every `runAgentTurn`, after `loadConversationHistory`:

```typescript
const queryText = stripContextAugmentation(input.userMessage);
const chunks = await retrieveRelevantChunks({
  supabase,
  queryText,
  projectId: toolContext.projectId,
  userId: toolContext.userId,
  conversationId,
  scopeQuotas: SCOPE_QUOTAS,  // v1 mandatory — see §6.1.1
  minScore: 0.72,
  maxChars: AGENT_RETRIEVAL_MAX_CHARS,
});
```

Flow: `queryText → embed once → per-scope RPC candidate fetch → merge → recency rerank (§6.5) → apply scope quotas → truncate by maxChars`.

#### 6.1.1 Scope quotas (mandatory in v1)

**No single global Top-K** — otherwise library results tend to drown out chat memory, or vice versa. v1 retrieves **each scope separately, then merges**:

| Scope | Filter | Quota (max chunks) |
|-------|--------|-------------------|
| `chat_same_conversation` | `conversation_id = current`, `source_type = chat_message` | **3** |
| `chat_same_project` | `user_id = current`, `project_id = current`, `conversation_id != current` | **2** |
| `library` | `source_type = library_cell`, `project_id = current` | **4** |
| `design_document` | `source_type = design_document`, `project_id = current` | **3** |

Each scope gets an independent RPC (or partitioned by a scope parameter within one RPC), each fetching `quota × 2` candidates (over-recall); after merging, rerank per §6.5, then truncate by quota. The total injection is still bounded by `AGENT_RETRIEVAL_MAX_CHARS`.

Env overrides (optional): `AGENT_RETRIEVAL_QUOTA_CHAT_SAME=3` etc.; defaults as above.

### 6.2 RPC: `match_agent_embedding_chunks`

```sql
-- Simplified signature
match_agent_embedding_chunks(
  p_query_embedding vector(1536),
  p_project_id uuid,
  p_user_id uuid,
  p_conversation_id uuid,
  p_scope text,              -- single scope per call in v1
  p_match_count int,         -- typically quota * 2
  p_min_score float
) RETURNS TABLE (
  id uuid,
  source_type text,
  content text,
  metadata jsonb,
  similarity float,
  source_timestamp timestamptz  -- lastMessageAt / cellUpdatedAt / messageCreatedAt
)
```

Internals: filter by scope → `similarity = 1 - (embedding <=> p_query_embedding)` → `similarity >= p_min_score` → return candidates (**no final ordering at the SQL layer**; the application layer reranks uniformly per §6.5).

### 6.3 Prompt injection format

Injected at the end of the system prompt (in English, consistent with the existing system prompt):

```markdown
## Retrieved context (semantic search — may be incomplete)
The following snippets were retrieved by similarity search. They supplement recent chat history; they are NOT guaranteed complete. Prefer fresh tool results for factual data.

1. [chat_message · conversation abc · last updated 2026-06-15] (3 messages) User: ... Assistant: ...
2. [library_cell · Characters · Protagonist A · Character profile · updated 2026-06-14] Cheerful personality, born into nobility...
3. [design_document · chunk 2/5 · 2026-06-12] Chapter 2, character relationships: the protagonist and the female lead are childhood friends...

If retrieved context conflicts with tool results or the user's latest message, trust tools and the latest message.
When multiple chat snippets disagree, prefer the snippet with the **most recent timestamp** (newer decisions override older ones).
```

If there are no results, omit the section (avoid wasting tokens on an empty block).

### 6.4 Cooperation with `prepareMessagesForLlm`

- **Do not change** the sliding window logic (still 50 messages).
- Retrieved context goes in the **system message**, not counted toward the 50-message window.
- Total character cap for retrieved context: controlled by **`AGENT_RETRIEVAL_MAX_CHARS`** (default **32,000** chars; when exceeded, truncate from the lowest `final_score` per §6.5).

#### 6.4.1 What `AGENT_RETRIEVAL_MAX_CHARS` does and does not govern

**Only governs** the **total concatenated length** of the `## Retrieved context` block in the system prompt (the sum of chunk texts selected within scope quotas).

**Does not govern:**

| Part | Bounded by this cap? |
|------|------------------|
| Existing `buildSystemPrompt` rules + CURRENT CONTEXT | No |
| The most recent 50-message history replay | No (goes through the separate `prepareMessagesForLlm` path) |
| The current user message + image parts | No |
| Tool results during the ReAct loop | No (governed by existing logic such as `MAX_TOOL_CONTENT_CHARS`) |

**How much fits in 32k (rough math):**

- For predominantly CJK text, 32k chars ≈ **8k–10k tokens**, for the retrieval injection block alone.
- Under the default scope quotas (3+2+4+3 = 12 chunks), each chunk gets on average **~2,600 chars** — enough for multi-turn turn groups, several library cells, and 2–3 design document paragraphs.
- For complex projects (many libraries + cross-session memory + design documents all hitting at once), the 12-chunk quota may cap out first; in that case what gets truncated by `final_score` is **the least relevant tail chunks**, not a wholesale retrieval failure.

**Why 32k by default rather than 8k:** 8k easily truncates library/document content away when "multiple libraries + long turn groups + design document fragments" are injected simultaneously, discounting the retrieval benefit. 32k is a generous budget for the "retrieval layer"; total context is still bounded by the model window, and if the whole package exceeds it, the existing LLM client / model side handles it (same as today's long-conversation behavior).

Env can lower it (e.g. `8000` on staging for cost experiments); production default is **32000**.

### 6.5 Ranking: recency-weighted merge (mandatory in v1)

Cosine similarity alone is insufficient for the first pass — cross-session retrieval may hit mutually contradictory old agreements. In v1 the application layer computes, per candidate:

```typescript
final_score = similarity * (1 - RECENCY_WEIGHT) + recency_score * RECENCY_WEIGHT
// RECENCY_WEIGHT default 0.2 (env: AGENT_RETRIEVAL_RECENCY_WEIGHT)

recency_score = exp(-age_days / half_life_days)
// half_life_days: chat_message → 30, library_cell → 90, design_document → 60
// age_days from metadata.lastMessageAt | cellUpdatedAt | messageCreatedAt
```

**Merging and conflict handling:**

1. Within each scope, take up to the quota in descending `final_score`.
2. After merging across scopes, sort again by `final_score` overall, used for `maxChars` truncation.
3. For chat chunks from the same `conversation_id`, if `final_score` differs by < 0.05, **force-prefer the newer** `lastMessageAt`.
4. Prompt layer (§6.3) + timestamp labels; **never decide conflicts by vector similarity alone**.

**Not in v1:** HyDE / cross-encoder re-rank / query rewrite (see §17 v2).

---

## 7. New Agent Tool: `semantic_search`

### 7.1 Purpose

Lets the Agent **proactively** perform deeper retrieval (when the automatic Top-8 is not enough).

### 7.2 Schema

```typescript
{
  name: 'semantic_search',
  category: 'read',
  parameters: {
    query: string,          // required — natural language search
    scope?: 'chat' | 'library' | 'design_document' | 'all',  // default 'all'
    libraryName?: string,   // optional filter for library scope
    limit?: number,         // default 10, max 20
  }
}
```

### 7.3 Result shape

```typescript
{
  success: true,
  data: {
    results: Array<{
      sourceType: string,
      content: string,
      similarity: number,
      metadata: Record<string, unknown>,
    }>,
    note: 'Semantic matches only. Use query_assets for exact structured queries.',
  },
  displayHint: 'list',
}
```

### 7.4 System prompt rule (one new rule)

```
29. SEMANTIC SEARCH: Use semantic_search when the user asks about meaning/concept
    ("characters similar to...", "the setting we discussed before", "what the
    document says about the combat system") rather than
    exact row/column operations. For precise table reads/writes, still use
    query_assets and other structured tools. Retrieved context in the system
    prompt is a preview — call semantic_search for exhaustive lookup.
```

---

## 8. Code Touch Points

| File / area | Change |
|-------------|--------|
| `supabase/migrations/..._agent_embedding_chunks.sql` | pgvector + table + RPC + RLS |
| `src/lib/agent/embedding-client.ts` | **New** — embed API |
| `src/lib/agent/chunking.ts` | **New** — chunk strategies |
| `src/lib/agent/embedding-index.ts` | **New** — index upsert/delete |
| `src/lib/agent/embedding-retrieval.ts` | **New** — retrieve + format for prompt |
| `src/lib/agent/core.ts` | `runAgentTurn`: call retrieval; extend `buildSystemMessage` |
| `src/lib/agent/conversation-store.ts` | Trigger async indexing after `saveMessage` |
| `src/lib/agent/tools/semantic-search.ts` | **New** tool |
| `src/lib/agent/tools/index.ts` | register tool |
| `src/lib/agent/prompts.ts` | rule 29 + document retrieved context |
| Write tool handlers (`update-asset`, `create-asset`, `update-row`, …) | optional hook: `scheduleLibraryCellReindex` |
| `src/app/api/agent-chat/reindex/route.ts` | **New** — admin/project reindex (optional Phase 2) |

**Unchanged:**

- `useAgentChat` request body (still sends only the new message + conversationId)
- `agent_messages` schema
- Frontend History UI

---

## 9. Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `EMBEDDING_API_URL` | `LLM_API_URL` | Embeddings endpoint base |
| `EMBEDDING_API_KEY` | `LLM_API_KEY` | API key |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Model name |
| `EMBEDDING_DIMENSIONS` | `1536` | Vector column width |
| `AGENT_RETRIEVAL_ENABLED` | `true` | Kill switch for auto retrieval |
| `AGENT_RETRIEVAL_MIN_SCORE` | `0.72` | Cosine similarity floor |
| `AGENT_RETRIEVAL_MAX_CHARS` | `32000` | Max chars for `## Retrieved context` block only (see §6.4.1) |
| `AGENT_RETRIEVAL_RECENCY_WEIGHT` | `0.2` | Weight of recency in `final_score` (0–1) |
| `AGENT_CHAT_TURN_GROUP_MAX_MESSAGES` | `5` | Max messages per chat turn group |
| `AGENT_CHAT_TURN_GROUP_MIN_MESSAGES` | `3` | Target group size before optional early seal |
| `AGENT_INDEXING_ENABLED` | `true` | Kill switch for async indexing |

---

## 10. Phased Rollout

### Phase 0 — Infrastructure (1–2 days)

- pgvector migration + RPC
- embedding client + unit tests (mock API)
- manual reindex script for one project

### Phase 1 — Project Knowledge RAG (Track B)

- Index `library_cell` on write + backfill script
- `semantic_search` tool
- **Do not** change `runAgentTurn` auto-injection (lowers risk)
- Acceptance: semantic search finds paraphrases that ILIKE cannot

### Phase 2 — Conversation Memory (Track A)

- Index `chat_message` on save + backfill recent conversations
- Auto retrieval in `runAgentTurn`
- Acceptance: after more than 50 turns, can still answer "the table name agreed at the start of the conversation"

### Phase 3 — Design Document Chunks (Track B enhancement)

- Index design doc text chunks
- Optional: for already-indexed documents, **stop** resending the full text every turn (keep only image URL parts + retrieved fragments) — **separate flag** `AGENT_DESIGN_DOC_VECTOR_ONLY=false`, off by default, enabled after quality validation

---

## 11. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-V1 | pgvector enabled; the `agent_embedding_chunks` table and HNSW index can be created |
| FR-V2 | Server side can batch-generate embeddings for text and upsert |
| FR-V3 | The `semantic_search` tool returns results sorted by similarity, constrained by project permissions |
| FR-V4 | After a library cell write, the corresponding chunk is retrievable within 30s (async) |
| FR-V5 | After a user/assistant message is saved, the chat chunk is retrievable within 30s (Phase 2) |
| FR-V6 | `runAgentTurn` auto-injects Retrieved context, not exceeding `AGENT_RETRIEVAL_MAX_CHARS` (Phase 2) |
| FR-V7 | When a message / asset cell is deleted, the corresponding embedding chunks are cleaned up |
| FR-V8 | With `AGENT_RETRIEVAL_ENABLED=false`, behavior is exactly as today |
| FR-V9 | Retrieval and indexing failures do not cause chat request 5xx (best-effort + log) |
| FR-V10 | Chat retrieval returns only messages with `user_id = current user` |
| FR-V11 | Automatic retrieval in v1 must partition results by scope quota; a single global Top-K is forbidden |
| FR-V12 | Chat indexing uses turn groups (3–5 adjacent messages), not single messages |
| FR-V13 | Retrieval ranking uses similarity + recency weighting; on conflict, the newer timestamp wins |

---

## 12. Security & Privacy

1. **chat_message** chunks carry `user_id`; the RPC enforces `user_id = auth.uid()`, so users cannot retrieve others' conversations.
2. **library_cell** chunks are validated by `project_id` + existing project membership (consistent with `resolveUserRole`); Viewers can retrieve read-only content.
3. Embedding API requests are server-initiated only; the embedding key is never exposed to the browser.
4. Chunk `content` may contain sensitive script material — same permissions as the source data; no expanded exposure surface.
5. `agent_traces` may record `retrievalChunkIds` for debugging (without embedding vectors).

---

## 13. Testing Plan

| Level | Cases |
|-------|-------|
| Unit | Turn group grouping/overlap/tail reindex; content_hash idempotency; `formatRetrievedContext` truncation |
| Unit | Scope quota merging; `final_score` recency weighting; newer chunk wins on conflict |
| Unit | `prepareMessagesForLlm` coexists with retrieved context; window still 50 messages |
| Integration | mock embedding API → upsert → RPC match returns expected ordering |
| Integration | Async indexing after `saveMessage`; reindex after cell update |
| E2E | Write library data → `semantic_search` finds it with synonymous but different wording |
| E2E | 60+ turn conversation → ask about early agreements → auto retrieval hits (Phase 2) |
| Regression | All green with `AGENT_RETRIEVAL_ENABLED=false` |

---

## 14. Observability

- Log: `embedding.index.{source_type}` duration, chunk count, failures
- Log: `embedding.retrieve` query length, hit count, top similarity
- `agent_traces` extended field (optional): `retrieval: { chunkIds, topScore, latencyMs }`

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Retrieved wrong fragments cause hallucination | Prompt explicitly says "tool results are authoritative"; show source + timestamps; similarity threshold |
| Contradictory agreements across sessions | Recency-weighted ranking + prompt "newer timestamp wins"; still advise users to trust current tool results |
| Indexing latency | The recent 50-message window is still complete; async indexing + 30s SLA |
| Embedding cost | Skip short text; content_hash dedup; library indexes text columns only |
| pgvector migration | Standalone migration; verify Supabase version support on staging first |
| Overlap with ILIKE search | Division of labor: `search_library_cell_values` for UI global search; `semantic_search` for the Agent |

---

## 16. Success Metrics

| Metric | Target |
|--------|--------|
| Semantic search recall@5 (20 manually labeled queries) | ≥ 80% |
| "Early facts" QA accuracy in 50+ turn conversations | ≥ 70% (Phase 2) |
| Chat P95 latency increase (with retrieval) | ≤ +300ms |
| Indexing failure rate | < 1% |

---

## 17. Open Items

### 17.1 Resolve before implementation plan

| # | Question | Proposed default |
|---|----------|------------------|
| 1 | Final embedding model choice (MiniMax embedding vs OpenAI) | Same vendor as the LLM, MiniMax; otherwise `text-embedding-3-small` |
| 2 | Full backfill of historical library data at deploy time? | Yes, run a one-off `scripts/reindex-project-embeddings.ts` |
| 3 | Should Phase 3's "design doc vector-only, no full-text resend" default to off? | Yes, flag defaults to `false` |

### 17.2 v2 retrieval optimizations (not v1, recorded)

The following significantly affect retrieval quality; **not implemented in v1**, slated for later iterations:

| Technique | Purpose | Notes |
|-----------|---------|-------|
| **Query rewrite / expansion** | Rewrite colloquial user messages into queries better suited to retrieval | Requires an extra LLM call; can be shared with `semantic_search` |
| **HyDE** | Generate a hypothetical answer first, retrieve using its embedding | Improves recall, costs +1 LLM call per turn |
| **Cross-encoder re-ranking** | Precisely rerank the first-pass Top-20 with a reranker model | Requires an extra model service; replaces or augments §6.5's linear weighting |
| **MMR diversity** | Avoid injecting highly duplicative chunks | Deduplicate after quota merging |

v1 guarantees baseline quality with **scope quotas + recency-weighted ranking**; after launch, use §16 metrics to decide whether rerank or query rewrite comes first.

---

## 18. Summary for stakeholders

- **The Vector DB does not replace history**; it lets the Agent "find by meaning" old conversations and project knowledge even when **tokens are limited**.
- **Track A (memory)**: index chat records → automatic retrieval fills in context beyond the 50-message window.
- **Track B (knowledge)**: index libraries and design documents → `semantic_search` + auto-injection.
- **Storage choice**: Supabase **pgvector**; no new external vector service.
- **Delivered in three phases**: infrastructure → project RAG tool → automatic conversation-memory retrieval → design document optimization.
- **rev. 2 hardening**: chat turn-group chunking, v1 scope quotas, time-decay ranking with conflict handling, configurable `AGENT_RETRIEVAL_MAX_CHARS`.

---

*Status: ready for implementation plan. Next step: `writing-plans` → `docs/superpowers/plans/2026-06-17-agent-vector-memory-rag.md`*
