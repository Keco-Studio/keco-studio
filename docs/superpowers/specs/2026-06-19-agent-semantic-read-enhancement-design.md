# Agent Semantic Read Enhancement — Design Spec

**Date:** 2026-06-19
**Status:** Draft (rev. 2 — incorporates design review)
**Revision notes (rev. 2):** confidence tiers; locate.primaryLabel; real-time query path for session-fresh data; index latency notices; `includeSchemaHits` default adjusted; token monitoring and rowIndex ordering acceptance.
**Scope:** On top of the existing VectorDB / RAG infrastructure, upgrade the Agent's **data reads and table updates** from "full-table SELECT dump" to a "semantic locate → precise read/write" closed loop; make vector retrieval results **actionable** (able to jump to `query_assets` / `update_row`), and fill in row-level / table-level semantic indexing.
**Related:**
- [2026-06-17-agent-vector-memory-rag-design.md](./2026-06-17-agent-vector-memory-rag-design.md) — VectorDB infrastructure (pgvector, indexing pipeline, automatic RAG, `semantic_search`)
- [2026-06-18-agent-self-authoring-data-design.md](./2026-06-18-agent-self-authoring-data-design.md) — write-side schema contract (`get_library_schema`, Strict validation)
- [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md)

---

## 1. Overview

### 1.1 Problem

When users ask the Agent to **view or update table data**, the Agent's main path is still `query_assets` (underneath, Supabase `.select()` pulls `library_assets` + `library_asset_values`). That is adequate for precise reads/writes, but weak for "understand the business, then decide what to change":

| Pain point | Symptom |
|------|------|
| **Full-table dump** | Large tables return hundreds of rows of JSON at once; high token cost, model easily misses things |
| **No semantic association** | "Paid Currency" and "Recharge Currency" cannot be auto-associated; cross-table business concepts must be pieced together by the model |
| **Gap between retrieval and read/write** | The existing `semantic_search` / automatic RAG return text snippets, but **lack stable locating coordinates** (`rowIndex` / `assetId`), so the model still has to guess |
| **Index granularity too fine** | Only `library_cell` per-cell indexing; row-level context and table-level schema summaries never enter the vector store |
| **Workflow not converged** | The prompt only says "fuzzy: use semantic_search, precise: use query_assets", without defining standard steps for **updating tables** |

The 2026-06-17 spec already delivered the VectorDB infrastructure (`agent_embedding_chunks`, `semantic_search`, per-turn automatic RAG). **This spec addresses: making these capabilities truly serve the read / update workflows, rather than stopping at "snippets can be found".**

### 1.2 Root Cause

The Agent's data capabilities are split into two unconnected tracks:

```
Read side (this spec)               Write side (6/18 spec)
─────────────────                  ─────────────────
semantic_search → text snippets     get_library_schema → column contract
query_assets → flat row JSON        update_row → precise write
         ↑                                    ↑
         └──────── missing the "semantics → coordinates" bridge ────┘
```

After getting a semantic snippet, the model still doesn't know "which table and which row to `query_assets`"; after getting full-table JSON, it doesn't know "which rows are the VIP items the user mentioned".

### 1.3 Decision

**Layer a "semantic read enhancement" on top of the existing VectorDB: richer indexing + locatable retrieval results + update-workflow prompt convergence.**

Three phases:

- **Phase 1 (index enhancement)**: Add two new chunk types, `library_row` and `library_schema`; add `rowIndex` to `library_cell` metadata.
- **Phase 2 (actionable retrieval)**: Add the `find_relevant_rows` read tool, returning semantic hits + structured `locate` hints + `suggestedQuery`; converge the prompt onto the L3→L1→L2→L1 standard flow.
- **Phase 3 (experience polish)**: confidence tiers, session-fresh data path, intent hints, token monitoring, E2E acceptance and metrics.

**Not replacing** `query_assets` / `get_library_schema`; the semantic layer handles "what to see", the structured tools handle "which cell to change".

### 1.4 Goals

| ID | Goal |
|----|------|
| **G1** | When the user describes data to view / update in natural language, the Agent can **locate the specific library / row** via semantic retrieval, rather than pulling the full table by default |
| **G2** | Retrieval results carry `locate` (`libraryName`, `assetId`, `rowIndex`, `primaryLabel`, `fieldLabel`, etc.) plus `confidence`, so the model can jump straight to `query_assets(rowIndex=…)` |
| **G3** | Beyond single cells, the vector store indexes **whole-row summaries** and **table schema summaries**, supporting questions like "which table manages VIP pricing" |
| **G4** | The standard table-update flow is written into the prompt: `find_relevant_rows` → targeted `query_assets` → `get_library_schema` (when needed) → `update_row` |
| **G5** | Aligned with the 6/18 write-side spec: semantic locating handles "finding the row", the schema contract handles "filling it correctly" |
| **G6** | Indexing and retrieval failures do not block chat (best-effort, consistent with 6/17) |

### 1.5 Non-Goals

- No standalone vector SaaS; keep using Supabase pgvector (the 6/17 decision stands).
- Do not let the LLM write SQL directly or access raw tables.
- Do not replace `query_assets` as the source of truth before writes (grounding remains based on tool results).
- No NL→SQL query engine (too heavy; v1 uses embedding + structured hints).
- No user-editable "semantic tags / business entities" UI (considered for v2).
- No rework of the 6/17 chat / design_document indexing strategy (only extending the library side).

---

## 2. Architecture — Three Layers

```
User: "Change the VIP item prices to the values suggested in the doc"
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 3 — Semantic locate (core of this spec)             │
│ find_relevant_rows / semantic_search / automatic RAG      │
│ → hit: Items table / Diamond Bundle / Type:VIP + locate{rowIndex:5} │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 2 — Schema contract (6/18 spec)                     │
│ get_library_schema → columns / enum / required / writeExample │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 1 — Precise read/write (existing)                     │
│ query_assets(rowIndex=5) → update_row(propertyValues=…)   │
└──────────────────────────────────────────────────────────┘
```

| Layer | Tools | Question answered |
|------|------|----------|
| L3 | `find_relevant_rows`, `semantic_search`, automatic RAG | Where is "that thing" the user mentioned? |
| L2 | `get_library_schema` | How do I write to this table legally? |
| L1 | `query_assets`, `update_row` | Which exact cell to read/write? |

---

## 3. Approach Options (decision record)

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A. Index enhancement only** | Add `library_row` / `library_schema` chunks, no tool changes | Small change | The model still has to piece coordinates together from snippets | Do in Phase 1; not enough |
| **B. Actionable retrieval tool** | New `find_relevant_rows` returning `locate` + `suggestedQuery` | Directly bridges L3→L1; testable | Requires new tool + prompt | **Phase 2 core** |
| **C. Semantics replace query_assets** | Forbid full-table pulls in update scenarios; rely on vectors only | Most token-efficient | Missed recall means wrong writes; high grounding risk | **Not chosen** |

**Chosen: B + A** — first enrich the index (improve recall), then use the actionable tool to turn hits into structured next steps.

---

## 4. Indexing Enhancements (Phase 1)

### 4.1 Extend `source_type`

Add to the `agent_embedding_chunks.source_type` CHECK constraint (migration ALTER):

| source_type | Description |
|-------------|------|
| `library_cell` | **Existing** — single-cell text |
| `library_row` | **New** — summary of a row's non-empty fields |
| `library_schema` | **New** — table structure + business-oriented summary |
| `chat_message` | Existing, unchanged |
| `design_document` | Existing, unchanged |

### 4.2 `library_row` chunk

**Purpose:** Let "a row of data" be semantically retrievable as a whole (e.g. the user says "the Diamond Bundle row").

**source_id:** `{asset_id}:row`

**Trigger:** Same as `library_cell` — debounced reindex after `library_asset_values` writes; for that asset, **recompute the whole-row chunk** (replacing the old row chunk).

**Text format:**

```text
[Items] row 5 · Diamond Bundle
Item Name: Diamond Bundle | Type: VIP | Price: 100 | Description: Recharge-exclusive bundle
```

Rules:

- `rowIndex` comes from `library_assets.row_index` (UI row number, 1-based); required in metadata.
- Include only **non-empty** visible fields; field order follows `order_index`.
- `asset.name` is `Untitled` and the row is entirely empty → do not index.
- Minimum length 20 chars (distinguished from the cell's 10 chars, avoiding empty-row fragments).
- Reference columns: index the display text (same as cell), not the raw UUID.

**metadata:**

```typescript
{
  libraryId: string;
  libraryName: string;
  assetId: string;
  assetName: string;
  rowIndex: number;          // UI row, 1-based
  primaryLabel: string;      // value of primary label column (e.g. "Diamond Bundle") for human confirmation
  fieldLabels: string[];     // non-empty fields included
  cellUpdatedAt: string;   // max(updated_at) of row cells
}
```

### 4.3 `library_schema` chunk

**Purpose:** Make "which table has which columns and manages what business" semantically discoverable (when the user hasn't named a library).

**source_id:** `{library_id}:schema`

**Trigger:**

- Enqueue after `setup_library` / `add_field` / field definition changes;
- Backfill during project reindex;
- Debounce 5s per library.

**Text format (based on `buildLibrarySchemaData`):**

```text
[Items] schema · 4 columns · 12 non-empty rows
Primary label: Item Name (required)
Columns:
- Item Name (string, required) — main row identifier
- Type (enum, required) — options: Paid Currency, Consumable, VIP
- Price (int, required)
- Description (string)
References: none
```

Do not embed the full enum set if it exceeds 500 chars — truncate and append `…(+N more)`.

**metadata:**

```typescript
{
  libraryId: string;
  libraryName: string;
  columnCount: number;
  rowCount: number;
  primaryLabelField: string;
  schemaUpdatedAt: string;
}
```

### 4.4 `library_cell` metadata completion

Add **`rowIndex`** to the existing cell chunk metadata (read from the asset). Automatic RAG and `find_relevant_rows` display `row 5` when formatting, lowering the model's cost of guessing row numbers.

### 4.5 RPC scope extension

The `library` scope filter of `match_agent_embedding_chunks` extends to:

```sql
source_type IN ('library_cell', 'library_row', 'library_schema')
```

**Scope quota adjustment (library):** default quota 4 → **6** (env `AGENT_RETRIEVAL_QUOTA_LIBRARY`, default 6), to accommodate row/schema hits. chat / design_document quotas unchanged.

**Recency half-life:** `library_row` → 90d, `library_schema` → 180d (schemas change infrequently).

### 4.6 Indexing priority and deduplication

When the same asset changes, execution order:

1. reindex affected `library_cell` chunk(s)
2. reindex `library_row` for that asset
3. reindex `library_schema` for that library (debounced)

When merging retrieval results, if the same `assetId` hits both `library_row` and multiple `library_cell`, **prefer `library_row`** (more complete information, more token-efficient); keep a cell only if its score exceeds the row's by > 0.08 (to avoid losing precise field matches).

---

## 5. Actionable Retrieval — `find_relevant_rows` (Phase 2)

### 5.1 Purpose

Wrap semantic retrieval as a first-class tool **oriented to read / update workflows**: return `locate` and `suggestedQuery` the model can consume directly, rather than a bare `content` list.

Division of labor with `semantic_search`:

| Tool | Scenario |
|------|------|
| `semantic_search` | Broad project knowledge: conversation memory, design documents, cross-library concepts |
| `find_relevant_rows` | **Table row-level** locating: view / update / bulk-find related rows |

### 5.2 Parameters

```typescript
{
  query: string;              // required — natural language
  libraryName?: string;       // optional narrow filter
  limit?: number;             // default 10, max 20
  includeSchemaHits?: boolean; // default false — set true when user has not named a library / asks "which table"
}
```

### 5.3 Result shape

```typescript
{
  success: true,
  displayHint: 'list',
  data: {
    query: string,
    hits: Array<{
      sourceType: 'library_row' | 'library_cell' | 'library_schema',
      content: string,
      similarity: number,
      confidence: 'high' | 'medium' | 'low',  // see §5.7
      locate: {
        libraryId: string,
        libraryName: string,
        assetId?: string,      // absent for schema-only hits
        assetName?: string,
        rowIndex?: number,     // 1-based UI row
        primaryLabel?: string, // primary label column value — secondary confirmation for user/model
        fieldId?: string,      // cell hits only
        fieldLabel?: string,
      },
      suggestedQuery?: {       // present when assetId or rowIndex known
        tool: 'query_assets',
        params: {
          libraryName: string,
          rowIndex?: number,
          nameFilter?: string,  // prefer primaryLabel when rowIndex unknown
        },
      },
      confirmWithUser?: boolean,  // true when confidence === 'low'
    }>,
    schemaHits?: Array<{       // when includeSchemaHits — tables to explore first
      libraryName: string,
      libraryId: string,
      content: string,
      similarity: number,
      suggestedQuery: {
        tool: 'get_library_schema' | 'query_assets',
        params: { libraryName: string },
      },
    }>,
    workflowNote: string,     // fixed guidance — see §5.4
    freshnessNote?: string,   // present when any hit may be stale — see §5.8
  },
}
```

### 5.4 Workflow note (always returned)

```text
Semantic hits are pointers, not authoritative row data. Before update_row or create_asset:
1) call query_assets with suggestedQuery.params for each target row;
2) call get_library_schema if you need enum/required/reference rules;
3) then update_row with confirmed rowIndex and propertyValues.
When confidence is low or confirmWithUser is true, ask the user to confirm primaryLabel / rowIndex before writing.
```

### 5.7 Confidence tiers

Map vector `similarity` (and `final_score`) to three confidence tiers, for the model to decide whether user confirmation is needed:

| confidence | Condition (default thresholds, env-overridable) | Behavior |
|------------|-------------------------------|------|
| **high** | `similarity >= 0.82` | Can go directly via suggestedQuery → query_assets |
| **medium** | `0.72 <= similarity < 0.82` | Must confirm via query_assets; mention primaryLabel in the reply |
| **low** | `similarity < 0.72` but still above `AGENT_RETRIEVAL_MIN_SCORE` | `confirmWithUser: true`; show candidate primaryLabel to the user and ask for confirmation |

Env: `AGENT_SEMANTIC_CONFIDENCE_HIGH=0.82`, `AGENT_SEMANTIC_CONFIDENCE_MEDIUM=0.72` (aligned with `AGENT_RETRIEVAL_MIN_SCORE`).

**`primaryLabel` resolution:** take the display value of the row's primary label column (`findPrimaryLabelField`); fall back to `assetName` when missing (if not `Untitled`).

### 5.8 Session-fresh data — real-time query path

The vector index has debounce / async latency (cell ≤30s, schema ≤60s). **Data just written within the current session** should not rely on vector recall.

**Rules (Prompt rule 33 + tool layer):**

1. Track the `(libraryId, assetId, rowIndex)` affected by write tools successfully executed within the current turn (`create_asset`, `update_row`, `update_asset`, `setup_library` data fills).
2. If the `find_relevant_rows` query clearly targets **a library written to this turn** (`ctx.currentLibraryName` or the `libraryName` returned by a write tool), call `query_assets` **in parallel** with vector retrieval (`rowIndex` / `nameFilter` from the write results), merge the live rows at the top of `hits`, and mark them `source: 'session_fresh'`, `confidence: 'high'`.
3. If a vector hit's `cellUpdatedAt` is less than `AGENT_SEMANTIC_FRESHNESS_SEC` (default **45**) from now, state in `freshnessNote`: "The index may not be refreshed; treat query_assets results as authoritative."

```text
freshnessNote example:
"Vector index may lag up to ~30s after edits. Rows marked session_fresh are live; always confirm via query_assets before update_row."
```

### 5.5 Implementation sketch

- File: `src/lib/agent/tools/find-relevant-rows.ts`
- Internals: `embedQuery` → RPC `library` scope (including row/cell/schema) → `rankCandidates` → dedupe (§4.6) → map to `locate` / `suggestedQuery`
- `rowIndex` resolution: prefer metadata.rowIndex; when missing, backfill from `library_assets.row_index` (server-side lookup, batch by assetId)
- category: `read`, no confirmation required

### 5.6 Enhance `semantic_search` (minor change)

For `library_cell` / `library_row` hits in `data.results[]`, **also attach** `locate` and `suggestedQuery` (sharing the formatter with `find_relevant_rows`: `src/lib/agent/semantic-locate.ts`).

The automatic RAG injection format (`formatRetrievedContext`) appends a locating suffix to library-type chunks:

```text
1. [library_row · Items · row 5 · Diamond Bundle · updated 2026-06-18] … → query_assets(libraryName="Items", rowIndex=5)
```

---

## 6. Prompt & Workflow Rules (Phase 2)

Add rules in `prompts.ts` (numbering continues after the existing SEMANTIC SEARCH rules):

```
30. SEMANTIC LOCATE BEFORE BULK READ: When the user asks to view, change, or update
    table data described by meaning (not by exact row number or library name), call
    find_relevant_rows FIRST. Do NOT call query_assets without libraryName and at
    least one narrow filter (rowIndex, nameFilter) unless the table is tiny (<20 rows)
    or the user explicitly asked for the full table.

31. UPDATE WORKFLOW (L3 → L1 → L2 → L1):
    a) find_relevant_rows (or semantic_search for design-doc / chat context)
    b) query_assets with suggestedQuery — confirm exact cells and referenceTargets
    c) get_library_schema when writing enums, references, or required fields
    d) update_row / create_asset with confirmed rowIndex and propertyValues

32. SCHEMA VS SEMANTIC: get_library_schema answers "how to write correctly";
    find_relevant_rows answers "which rows matter". Use both when updating —
    never skip (b) even if retrieved context looks complete.

33. SESSION-FRESH DATA: If this turn already wrote rows via create_asset / update_row /
    update_asset, prefer query_assets on those rows (session_fresh) over vector hits for
    the same targets. Vector index can lag ~30s — never skip query_assets confirmation
    because retrieved context "looks" up to date.

34. LOW CONFIDENCE: When find_relevant_rows returns confidence=low or confirmWithUser=true,
    show the user locate.primaryLabel and libraryName and ask which row to update before
    calling update_row.
```

**Intent heuristic (optional, Phase 3):** In `runAgentTurn`, run a lightweight keyword check on the user message (`update|modify|change to|price|type|all…`, etc.), and append one line after CURRENT CONTEXT in the system prompt:

```text
Hint: this message looks like a table update intent — prefer find_relevant_rows before query_assets.
```

Hint only, no forced tool_choice; can be disabled via `AGENT_SEMANTIC_LOCATE_HINT=true` (default true).

---

## 7. Data Flow — Update Table (target state)

```
User: "Change the VIP item prices to the values suggested in the doc"
  │
  ├─► [auto RAG] design_document chunk: "Suggested VIP item price: 199"
  │
  ├─► find_relevant_rows("VIP item price")
  │     ├─ library_row · Items · row 5 · Diamond Bundle
  │     └─ suggestedQuery: query_assets(libraryName="Items", rowIndex=5)
  │
  ├─► query_assets(libraryName="Items", rowIndex=5)
  │     └─ cells confirmed, referenceTargets available
  │
  ├─► get_library_schema("Items")   // if price column type unclear
  │
  └─► update_row(rowIndex=5, propertyValues={ "Price": 199 })
```

Compare with the **current detour**:

```
query_assets(Items) → 200 rows → model guesses → miss / wrong row / token blowup
```

---

## 8. Code Touch Points

| File / area | Change |
|-------------|--------|
| `supabase/migrations/..._semantic_read_source_types.sql` | Extend the `source_type` CHECK; update the RPC library scope |
| `src/lib/agent/chunking.ts` | `buildLibraryRowChunkText`, `buildLibrarySchemaChunkText` |
| `src/lib/agent/embedding-index.ts` | `reindexLibraryRow`, `reindexLibrarySchema`; cell metadata +rowIndex |
| `src/lib/agent/semantic-locate.ts` | **New** — shared `locate` / `suggestedQuery` mapping |
| `src/lib/agent/semantic-confidence.ts` | **New** — similarity → confidence mapping |
| `src/lib/agent/tools/find-relevant-rows.ts` | **New** tool |
| `src/lib/agent/tools/semantic-search.ts` | attach `locate` + `confidence` on library hits |
| `src/lib/agent/embedding-retrieval.ts` | format lines with locate suffix; dedupe policy |
| `src/lib/agent/embedding-config.ts` | library quota 6; half-life for new types |
| `src/lib/agent/tools/index.ts` | register `find_relevant_rows` |
| `src/lib/agent/prompts.ts` | rules 30–34 |
| `src/lib/agent/core.ts` | turn write tracker for session_fresh; intent hint (Phase 3) |
| Write hooks / `setup_library` / `add_field` | trigger `library_schema` reindex |
| `scripts/reindex-project-embeddings.ts` | backfill row + schema chunks |

**Reuse (no reinvention):**

- `buildLibrarySchemaData` from `library-schema-builder.ts`
- `buildQueryAssetRows` / `cellDisplayString` for row text
- 6/17 embedding client, RPC, RLS

---

## 9. Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `AGENT_SEMANTIC_ROW_INDEX_ENABLED` | `true` | Index `library_row` chunks |
| `AGENT_SEMANTIC_SCHEMA_INDEX_ENABLED` | `true` | Index `library_schema` chunks |
| `AGENT_RETRIEVAL_QUOTA_LIBRARY` | `6` | Library scope quota (was 4) |
| `AGENT_SEMANTIC_LOCATE_HINT` | `true` | Intent hint in system prompt |
| `AGENT_LIBRARY_ROW_MIN_CHARS` | `20` | Min row chunk length |
| `AGENT_LIBRARY_SCHEMA_DEBOUNCE_MS` | `5000` | Schema reindex debounce |
| `AGENT_SEMANTIC_CONFIDENCE_HIGH` | `0.82` | high confidence floor |
| `AGENT_SEMANTIC_CONFIDENCE_MEDIUM` | `0.72` | medium confidence floor |
| `AGENT_SEMANTIC_FRESHNESS_SEC` | `45` | Staleness warning window for vector hits |

Kill switch: when `AGENT_INDEXING_ENABLED=false`, Phase 1 writes no new chunks; `find_relevant_rows` remains usable but only hits old `library_cell` chunks.

---

## 10. Phased Rollout

### Phase 1 — Richer Index (2–3 days)

- Migration: new source types + RPC filter
- `library_row` + `library_schema` index pipeline
- Cell metadata `rowIndex` backfill on reindex
- Backfill script for one pilot project
- **Acceptance:** semantic query "VIP items" hits `library_row`; "which table manages prices" hits `library_schema`

### Phase 2 — Actionable Tool + Prompt (2–3 days)

- `semantic-locate.ts` + `semantic-confidence.ts` + `find_relevant_rows` tool
- `semantic_search` locate + confidence enrichment
- Prompt rules 30–34
- Retrieved context format with locate suffix
- `query_assets` >50 rows returns `_llmNote` forcing narrowing (FR-S13)
- **Acceptance:** E2E "update VIP item price" follows find → query(rowIndex) → update, without pulling the full table

### Phase 3 — Polish (1–2 days)

- Session-fresh path (§5.8) and turn write tracker
- Intent hint in `core.ts`
- Dedupe policy tuning; token monitoring: `agent_traces` records `semanticLocateHits`, retrieved chunk character counts, find vs query call ratio
- Evaluate against staging data whether `AGENT_RETRIEVAL_QUOTA_LIBRARY` needs lowering
- Documentation and metric comparison (see §13)

---

## 11. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-S1 | `library_row` chunk retrievable within 30s of a cell write |
| FR-S2 | `library_schema` retrievable within 60s of a field change |
| FR-S3 | `find_relevant_rows` returns hits carrying `locate.rowIndex` (when the asset exists) |
| FR-S4 | `suggestedQuery` can be used directly by the model as `query_assets` parameters |
| FR-S5 | Row + cell hits for the same asset deduped per §4.6 |
| FR-S6 | Update-type E2E: no unfiltered `query_assets` pulling >50 rows (audited by prompt + trace) |
| FR-S7 | Coexists with `get_library_schema`; both are referenced by the prompt in the update flow |
| FR-S8 | With `AGENT_SEMANTIC_ROW_INDEX_ENABLED=false`, behavior falls back to `library_cell` only |
| FR-S9 | Indexing / retrieval failures do not cause chat 5xx |
| FR-S10 | Every row/cell hit returns `confidence` and `locate.primaryLabel` |
| FR-S11 | When `confidence=low`, `confirmWithUser=true` |
| FR-S12 | Rows affected by writes within the current turn are returned live via the `session_fresh` path |
| FR-S13 | `query_assets` returning >50 rows includes an `_llmNote` requiring narrowing |

---

## 12. Testing Plan

| Level | Cases |
|-------|-------|
| Unit | `buildLibraryRowChunkText` / `buildLibrarySchemaChunkText` formatting and truncation |
| Unit | `mapHitToLocate` — backfill when metadata lacks rowIndex; primaryLabel resolution |
| Unit | `computeConfidence` — threshold boundaries high/medium/low |
| Unit | dedupe: row preferred over cell; schema not deduped against rows |
| Integration | After UI reordering, `row_index` and `locate.rowIndex` remain consistent with `query_assets` |
| Integration | After a write within the turn, find returns a `session_fresh` hit (independent of vectors) |
| Integration | Cell write → row + schema chunk upsert |
| Integration | `find_relevant_rows` paraphrase query hits the expected row |
| E2E | "Change the Diamond Bundle price to 199": find → query(rowIndex) → update, no full-table query in the trace |
| E2E | "Which table has the VIP type": schema hit → get_library_schema |
| Regression | All green with `AGENT_INDEXING_ENABLED=false`; existing `semantic_search` does not regress |

---

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| Row-level semantic recall@5 (20 manual queries) | ≥ 85% (including paraphrases) |
| Proportion of unfiltered full-table queries in update scenarios | < 10% (trace statistics) |
| Update E2E first-attempt success rate | ≥ 75% (10 pilot scenarios) |
| Token savings vs "query_assets only" (update scenarios) | ≥ 40% median |
| `find_relevant_rows` average returned character count | Monitored and < 4k chars (tune quota in Phase 3) |

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Semantic missed recall / false recall | `confidence` tiers + `confirmWithUser` when low; prompt step (b) forces `query_assets` |
| rowIndex inconsistent with UI | Uniformly use `library_assets.row_index`; backfill at tool layer; acceptance tests for post-reorder consistency |
| Index latency | §5.8 session `session_fresh` goes via live `query_assets`; `freshnessNote` notice |
| Stale schema chunks | Field changes trigger reindex; still recommend `get_library_schema` after schema hits |
| Confusion between the two tools | Explicit division-of-labor table (§5.1); `find_relevant_rows` is the primary update entry point |
| Index volume / token bloat | Row-over-cell dedupe; `includeSchemaHits` defaults to false; Phase 3 monitors and tunes quota |

---

## 15. Relationship to Other Specs

| Spec | Relationship |
|------|------|
| **6/17 Vector RAG** | This spec **extends** its library indexing and how retrieval is consumed; does not duplicate chat/design_doc work |
| **6/18 Schema Writes** | Write-side contract unchanged; this spec mandates **semantic locate (L3)** before updates, then **schema (L2)**, then **write (L1)** |
| **6/15 Design Doc → Tables** | Design documents still go through semantic / RAG understanding; table filling still uses schema + precise writes |

---

## 16. Open Items

| # | Question | Proposed default |
|---|----------|------------------|
| 1 | `find_relevant_rows` vs extending `query_assets` with a `semanticQuery` parameter | Standalone tool, avoiding responsibility bloat in query_assets |
| 2 | Whether to add a hard-limit warning to `query_assets` in Phase 2 (>50 rows returns `_llmNote` forcing narrowing) | **Decided: yes** (Phase 2, FR-S13) |
| 3 | Whether schema chunks index section groupings | v1 no grouping; v2 split chunks by section |
| 4 | Whether confidence thresholds are configurable per-library | v1 global env; consider for v2 |

---

## 17. Summary for Stakeholders

- **Problem:** Before updating tables, the Agent pulls full tables via SELECT; the data has values but no semantics — expensive in tokens, easy to miss changes.
- **Solution:** Build **semantic read enhancement** on the existing VectorDB — row-level / table-level indexing + a locatable retrieval tool + a standard update workflow.
- **Key deliverables:** `find_relevant_rows` (semantic hit → `rowIndex` → `query_assets`) + `library_row` / `library_schema` indexing.
- **Coordination with the write side:** 6/18 guarantees "filling it correctly"; this spec guarantees "finding it correctly".
- **Not a replacement:** precise reads/writes still rely on `query_assets` / `update_row`; vector results are **pointers**, not a basis for writing to the database.

---

*Status: rev. 2 — review feedback incorporated; ready for implementation plan. Next step: `writing-plans` → `docs/superpowers/plans/2026-06-19-agent-semantic-read-enhancement.md`*
