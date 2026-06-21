# Agent Semantic Read Enhancement — Design Spec

**Date:** 2026-06-19
**Status:** Draft (rev. 2 — incorporates design review)
**Revision notes (rev. 2):** confidence 分级；locate.primaryLabel；会话内新鲜数据实时查询路径；索引延迟提示；`includeSchemaHits` 默认调整；token 监控与 rowIndex 排序验收。
**Scope:** 在已有 VectorDB / RAG 基础设施之上，把 Agent **读数据、更新表** 从「整表 SELECT dump」升级为「语义定位 → 精确读写」闭环；让向量检索结果**可行动**（能跳到 `query_assets` / `update_row`），并补齐行级 / 表级语义索引。
**Related:**
- [2026-06-17-agent-vector-memory-rag-design.md](./2026-06-17-agent-vector-memory-rag-design.md) — VectorDB 基础设施（pgvector、索引管道、自动 RAG、`semantic_search`）
- [2026-06-18-agent-self-authoring-data-design.md](./2026-06-18-agent-self-authoring-data-design.md) — 写侧 schema 契约（`get_library_schema`、Strict 校验）
- [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md)

---

## 1. Overview

### 1.1 Problem

用户让 Agent **查看或更新表数据**时，Agent 的主路径仍是 `query_assets`（底层 Supabase `.select()` 拉 `library_assets` + `library_asset_values`）。这对精确读写够用，但对「理解业务再决定改什么」偏弱：

| 痛点 | 表现 |
|------|------|
| **整表 dump** | 大表一次返回数百行 JSON，token 高、模型易漏 |
| **无语义关联** | 「付费货币」与「充值货币」无法自动关联；跨表业务概念需模型自己拼 |
| **检索与读写断层** | 现有 `semantic_search` / 自动 RAG 返回文本片段，但**缺少稳定的定位坐标**（`rowIndex` / `assetId`），模型还要再猜 |
| **索引粒度偏细** | 仅 `library_cell` 单格索引，行级上下文、表级 schema 摘要未进入向量库 |
| **工作流未收敛** | Prompt 只说「模糊用 semantic_search、精确用 query_assets」，未规定**更新表**的标准步骤 |

2026-06-17 spec 已交付 VectorDB 基础设施（`agent_embedding_chunks`、`semantic_search`、每轮自动 RAG）。**本 spec 解决的是：让这些能力真正服务于读 / 更新工作流，而不是停留在「能搜到片段」。**

### 1.2 Root Cause

Agent 数据能力被拆成两条未打通的线：

```
读侧（本 spec）                     写侧（6/18 spec）
─────────────────                  ─────────────────
semantic_search → 文本片段          get_library_schema → 列契约
query_assets → 扁平行 JSON          update_row → 精确写入
         ↑                                    ↑
         └──────── 中间缺「语义 → 坐标」桥 ────┘
```

模型拿到语义片段后，仍不知道「该 `query_assets` 哪张表、哪一行」；拿到整表 JSON 后，又不知道「用户说的 VIP 道具是哪几行」。

### 1.3 Decision

**在现有 VectorDB 上叠加「语义读增强层」：更丰富索引 + 可定位检索结果 + 更新工作流 Prompt 收敛。**

分三阶段：

- **Phase 1（索引增强）**：新增 `library_row`、`library_schema` 两类 chunk；`library_cell` metadata 补齐 `rowIndex`。
- **Phase 2（可行动检索）**：新增 `find_relevant_rows` 读工具，返回语义命中 + 结构化 `locate` 提示 + `suggestedQuery`；收敛 Prompt 为 L3→L1→L2→L1 标准流。
- **Phase 3（体验优化）**：confidence 分级、会话内新鲜数据路径、意图提示、token 监控、E2E 验收与指标。

**不替换** `query_assets` / `get_library_schema`；语义层负责「看见什么」，结构化工具负责「改哪一格」。

### 1.4 Goals

| ID | 目标 |
|----|------|
| **G1** | 用户用自然语言描述要查看 / 更新的数据时，Agent 能通过语义检索**定位到具体库 / 行**，而非默认拉全表 |
| **G2** | 检索结果携带 `locate`（`libraryName`, `assetId`, `rowIndex`, `primaryLabel`, `fieldLabel` 等）及 `confidence`，模型可一步跳到 `query_assets(rowIndex=…)` |
| **G3** | 向量库除单格外，索引**整行摘要**与**表 schema 摘要**，支持「哪张表管 VIP 定价」类问题 |
| **G4** | 更新表标准流写入 Prompt：`find_relevant_rows` → `query_assets` 定点 → `get_library_schema`（必要时）→ `update_row` |
| **G5** | 与 6/18 写侧 spec 对齐：语义定位负责「找行」，schema 契约负责「填对」 |
| **G6** | 索引与检索失败不阻塞 chat（best-effort，与 6/17 一致） |

### 1.5 Non-Goals

- 不引入独立向量 SaaS；继续用 Supabase pgvector（6/17 决策不变）。
- 不让 LLM 直接写 SQL 或访问裸表。
- 不替代 `query_assets` 作为写入前的事实来源（grounding 仍以 tool 结果为准）。
- 不做 NL→SQL 查询引擎（过重；v1 用 embedding + 结构化 hint）。
- 不做用户可编辑的「语义标签 / 业务实体」UI（v2 考虑）。
- 不重做 6/17 的 chat / design_document 索引策略（仅扩展 library 侧）。

---

## 2. Architecture — Three Layers

```
用户："把 VIP 道具价格改成文档建议的值"
                    │
                    ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 3 — Semantic locate（本 spec 核心）                 │
│ find_relevant_rows / semantic_search / 自动 RAG           │
│ → 命中：道具表 / 钻石礼包 / 类型:VIP + locate{rowIndex:5}  │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 2 — Schema contract（6/18 spec）                    │
│ get_library_schema → 列 / enum / required / writeExample  │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 1 — Precise read/write（现有）                        │
│ query_assets(rowIndex=5) → update_row(propertyValues=…)   │
└──────────────────────────────────────────────────────────┘
```

| 层级 | 工具 | 回答问题 |
|------|------|----------|
| L3 | `find_relevant_rows`, `semantic_search`, 自动 RAG | 用户说的「那个东西」在哪？ |
| L2 | `get_library_schema` | 这张表怎么合法地写？ |
| L1 | `query_assets`, `update_row` | 精确读写哪一格？ |

---

## 3. Approach Options (decision record)

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A. 仅增强索引** | 加 `library_row` / `library_schema` chunk，不改工具 | 改动小 | 模型仍要自己从片段拼坐标 | Phase 1 做，不够 |
| **B. 可行动检索工具** | 新 `find_relevant_rows` 返回 `locate` + `suggestedQuery` | 直接打通 L3→L1；可测 | 需新 tool + prompt | **Phase 2 核心** |
| **C. 语义替代 query_assets** | 更新场景禁止拉全表，只靠向量 | Token 最省 | 漏召回即写错；grounding 风险高 | **不选** |

**选用 B + A**：先补索引（提高召回），再用可行动工具把命中变成结构化下一步。

---

## 4. Indexing Enhancements (Phase 1)

### 4.1 扩展 `source_type`

在 `agent_embedding_chunks.source_type` CHECK 约束中新增（migration ALTER）：

| source_type | 说明 |
|-------------|------|
| `library_cell` | **已有** — 单格文本 |
| `library_row` | **新增** — 整行非空字段摘要 |
| `library_schema` | **新增** — 表结构 + 业务向摘要 |
| `chat_message` | 已有，不变 |
| `design_document` | 已有，不变 |

### 4.2 `library_row` chunk

**目的：** 让「一行数据」作为整体被语义检索（例如用户说「钻石礼包那行」）。

**source_id：** `{asset_id}:row`

**触发：** 与 `library_cell` 相同——`library_asset_values` 写入后 debounce reindex；对该 asset **重算整行 chunk**（替换旧 row chunk）。

**文本格式：**

```text
[道具表] row 5 · 钻石礼包
道具名称: 钻石礼包 | 类型: VIP | 价格: 100 | 描述: 充值专属礼包
```

规则：

- `rowIndex` 来自 `library_assets.row_index`（UI 行号，1-based）；metadata 必填。
- 只包含**非空**可见字段；字段顺序按 `order_index`。
- `asset.name` 为 `Untitled` 且行全空 → 不索引。
- 最小长度 20 chars（与 cell 的 10 chars 区分，避免空行碎片）。
- reference 列：索引 display 文本（与 cell 一致），不索引 raw UUID。

**metadata：**

```typescript
{
  libraryId: string;
  libraryName: string;
  assetId: string;
  assetName: string;
  rowIndex: number;          // UI row, 1-based
  primaryLabel: string;      // value of primary label column (e.g. "钻石礼包") for human confirmation
  fieldLabels: string[];     // non-empty fields included
  cellUpdatedAt: string;   // max(updated_at) of row cells
}
```

### 4.3 `library_schema` chunk

**目的：** 让「哪张表有哪些列、管什么业务」可被语义发现（用户未指明库名时）。

**source_id：** `{library_id}:schema`

**触发：**

- `setup_library` / `add_field` / field definition 变更后 enqueue；
- 项目 reindex 时 backfill；
- debounce 5s per library。

**文本格式（基于 `buildLibrarySchemaData`）：**

```text
[道具表] schema · 4 columns · 12 non-empty rows
Primary label: 道具名称 (required)
Columns:
- 道具名称 (string, required) — main row identifier
- 类型 (enum, required) — options: 付费货币, 消耗品, VIP
- 价格 (int, required)
- 描述 (string)
References: none
```

不嵌入 enum 全量若超过 500 chars——截断并附 `…(+N more)`。

**metadata：**

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

### 4.4 `library_cell` metadata 补齐

现有 cell chunk metadata 增加 **`rowIndex`**（从 asset 读取）。自动 RAG 与 `find_relevant_rows` 格式化时展示 `row 5`，降低模型猜行号成本。

### 4.5 RPC scope 扩展

`match_agent_embedding_chunks` 的 `library` scope 过滤器扩展为：

```sql
source_type IN ('library_cell', 'library_row', 'library_schema')
```

**Scope quota 调整（library）：** 默认 quota 4 → **6**（env `AGENT_RETRIEVAL_QUOTA_LIBRARY`，默认 6），以容纳 row/schema 命中。chat / design_document quota 不变。

**Recency half-life：** `library_row` → 90d，`library_schema` → 180d（schema 变更频率低）。

### 4.6 索引优先级与去重

同一 asset 变更时，执行顺序：

1. reindex affected `library_cell` chunk(s)
2. reindex `library_row` for that asset
3. reindex `library_schema` for that library（debounced）

检索合并时，若同一 `assetId` 同时命中 `library_row` 与多个 `library_cell`，**prefer `library_row`**（信息更全、token 更省）；cell 仅在与 row 分数差 > 0.08 时保留（避免丢掉精确字段匹配）。

---

## 5. Actionable Retrieval — `find_relevant_rows` (Phase 2)

### 5.1 Purpose

把语义检索包装成**面向读 / 更新工作流**的一等工具：返回模型能直接消费的 `locate` 与 `suggestedQuery`，而不是裸 `content` 列表。

与 `semantic_search` 的分工：

| Tool | 场景 |
|------|------|
| `semantic_search` | 广义项目知识：对话记忆、设计文档、跨库概念 |
| `find_relevant_rows` | **表格行级**定位：查看 / 更新 / 批量找相关行 |

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

### 5.4 Workflow note（固定返回）

```text
Semantic hits are pointers, not authoritative row data. Before update_row or create_asset:
1) call query_assets with suggestedQuery.params for each target row;
2) call get_library_schema if you need enum/required/reference rules;
3) then update_row with confirmed rowIndex and propertyValues.
When confidence is low or confirmWithUser is true, ask the user to confirm primaryLabel / rowIndex before writing.
```

### 5.7 Confidence 分级

将向量 `similarity`（及 `final_score`）映射为三级置信度，供模型决定是否需用户确认：

| confidence | 条件（默认阈值，可 env 覆盖） | 行为 |
|------------|-------------------------------|------|
| **high** | `similarity >= 0.82` | 可直接走 suggestedQuery → query_assets |
| **medium** | `0.72 <= similarity < 0.82` | 必须 query_assets 确认；回复中提及 primaryLabel |
| **low** | `similarity < 0.72` 但仍过 `AGENT_RETRIEVAL_MIN_SCORE` | `confirmWithUser: true`；向用户展示候选 primaryLabel 请求确认 |

Env：`AGENT_SEMANTIC_CONFIDENCE_HIGH=0.82`，`AGENT_SEMANTIC_CONFIDENCE_MEDIUM=0.72`（与 `AGENT_RETRIEVAL_MIN_SCORE` 对齐）。

**`primaryLabel` 解析：** 取该行主标签列（`findPrimaryLabelField`）的显示值；缺失时回退 `assetName`（非 `Untitled` 时）。

### 5.8 会话内新鲜数据 — 实时查询路径

向量索引有 debounce / 异步延迟（cell ≤30s，schema ≤60s）。**当前会话内刚写入的数据**不应依赖向量召回。

**规则（Prompt rule 33 + 工具层）：**

1. 追踪当前 turn 内已成功执行的 write tools（`create_asset`, `update_row`, `update_asset`, `setup_library` 填表）所影响的 `(libraryId, assetId, rowIndex)`。
2. 若 `find_relevant_rows` 的 query 明显指向**本 turn 刚写入的库**（`ctx.currentLibraryName` 或 write tool 返回的 `libraryName`），在向量检索之外**并行**调用 `query_assets`（`rowIndex` / `nameFilter` 来自 write 结果），将实时行合并进 `hits` 顶部，并标记 `source: 'session_fresh'`、`confidence: 'high'`。
3. 若向量命中 `cellUpdatedAt` 距现在 < `AGENT_SEMANTIC_FRESHNESS_SEC`（默认 **45**），在 `freshnessNote` 中说明：「索引可能未刷新，请以 query_assets 结果为准。」

```text
freshnessNote example:
"Vector index may lag up to ~30s after edits. Rows marked session_fresh are live; always confirm via query_assets before update_row."
```

### 5.5 Implementation sketch

- 文件：`src/lib/agent/tools/find-relevant-rows.ts`
- 内部：`embedQuery` → RPC `library` scope（含 row/cell/schema）→ `rankCandidates` → dedupe（§4.6）→ map to `locate` / `suggestedQuery`
- `rowIndex` 解析：优先 metadata.rowIndex；缺失时按 `library_assets.row_index` 回填（server-side lookup，batch by assetId）
- category: `read`，免确认

### 5.6 增强 `semantic_search`（小改）

在 `data.results[]` 中为 `library_cell` / `library_row` 命中**同样附带** `locate` 与 `suggestedQuery`（与 `find_relevant_rows` 共享 formatter：`src/lib/agent/semantic-locate.ts`）。

自动 RAG 注入格式（`formatRetrievedContext`）对 library 类 chunk 追加定位后缀：

```text
1. [library_row · 道具表 · row 5 · 钻石礼包 · updated 2026-06-18] … → query_assets(libraryName="道具表", rowIndex=5)
```

---

## 6. Prompt & Workflow Rules (Phase 2)

在 `prompts.ts` 新增规则（编号接在现有 SEMANTIC SEARCH 规则之后）：

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

**意图启发式（可选，Phase 3）：** 在 `runAgentTurn` 对 user message 做轻量关键词检测（`更新|修改|改成|价格|类型|所有…` 等），在 system prompt CURRENT CONTEXT 后追加一行：

```text
Hint: this message looks like a table update intent — prefer find_relevant_rows before query_assets.
```

仅提示，不强制 tool_choice；`AGENT_SEMANTIC_LOCATE_HINT=true`（默认 true）可关闭。

---

## 7. Data Flow — Update Table (target state)

```
User: "把 VIP 道具价格改成文档建议的值"
  │
  ├─► [auto RAG] design_document chunk: "VIP 道具建议定价 199"
  │
  ├─► find_relevant_rows("VIP 道具 价格")
  │     ├─ library_row · 道具表 · row 5 · 钻石礼包
  │     └─ suggestedQuery: query_assets(libraryName="道具表", rowIndex=5)
  │
  ├─► query_assets(libraryName="道具表", rowIndex=5)
  │     └─ cells confirmed, referenceTargets available
  │
  ├─► get_library_schema("道具表")   // if price column type unclear
  │
  └─► update_row(rowIndex=5, propertyValues={ "价格": 199 })
```

对比**现状弯路**：

```
query_assets(道具表) → 200 rows → model guesses → miss / wrong row / token blowup
```

---

## 8. Code Touch Points

| File / area | Change |
|-------------|--------|
| `supabase/migrations/..._semantic_read_source_types.sql` | 扩展 `source_type` CHECK；更新 RPC library scope |
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

**Reuse（不重复造）：**

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

Kill switch：`AGENT_INDEXING_ENABLED=false` 时 Phase 1 不写入新 chunk；`find_relevant_rows` 仍可用但仅命中旧 `library_cell`。

---

## 10. Phased Rollout

### Phase 1 — Richer Index (2–3 天)

- Migration: new source types + RPC filter
- `library_row` + `library_schema` index pipeline
- Cell metadata `rowIndex` backfill on reindex
- Backfill script for one pilot project
- **验收：** 语义 query「VIP 道具」能命中 `library_row`；「哪张表管价格」能命中 `library_schema`

### Phase 2 — Actionable Tool + Prompt (2–3 天)

- `semantic-locate.ts` + `semantic-confidence.ts` + `find_relevant_rows` tool
- `semantic_search` locate + confidence enrichment
- Prompt rules 30–34
- Retrieved context format with locate suffix
- `query_assets` >50 rows 时 `_llmNote` 强制窄化（FR-S13）
- **验收：** E2E「更新 VIP 道具价格」走 find → query(rowIndex) → update，不拉全表

### Phase 3 — Polish (1–2 天)

- Session-fresh 路径（§5.8）与 turn write tracker
- Intent hint in `core.ts`
- Dedupe policy tuning；token 监控：`agent_traces` 记录 `semanticLocateHits`、检索块字符数、find vs query 调用比
- 按 staging 数据评估 `AGENT_RETRIEVAL_QUOTA_LIBRARY` 是否需下调
- 文档与指标对比（见 §13）

---

## 11. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-S1 | `library_row` chunk 在 cell 写入后 30s 内可检索 |
| FR-S2 | `library_schema` 在 field 变更后 60s 内可检索 |
| FR-S3 | `find_relevant_rows` 返回带 `locate.rowIndex` 的命中（当 asset 存在） |
| FR-S4 | `suggestedQuery` 可被模型直接用于 `query_assets` 参数 |
| FR-S5 | 同一 asset 的 row + cell 命中按 §4.6 去重 |
| FR-S6 | 更新类 E2E：禁止无过滤 `query_assets` 拉取 >50 行（由 prompt + trace 审计） |
| FR-S7 | 与 `get_library_schema` 并存，更新流两者均被 prompt 引用 |
| FR-S8 | `AGENT_SEMANTIC_ROW_INDEX_ENABLED=false` 时行为回退到仅 `library_cell` |
| FR-S9 | 索引 / 检索失败不导致 chat 5xx |
| FR-S10 | 每个 row/cell hit 返回 `confidence` 与 `locate.primaryLabel` |
| FR-S11 | `confidence=low` 时 `confirmWithUser=true` |
| FR-S12 | 本 turn 内 write 影响的行可通过 `session_fresh` 路径实时返回 |
| FR-S13 | `query_assets` 返回 >50 行时附带 `_llmNote` 要求窄化 |

---

## 12. Testing Plan

| Level | Cases |
|-------|-------|
| Unit | `buildLibraryRowChunkText` / `buildLibrarySchemaChunkText` 格式与截断 |
| Unit | `mapHitToLocate` — metadata 缺 rowIndex 时回填；primaryLabel 解析 |
| Unit | `computeConfidence` — 阈值边界 high/medium/low |
| Unit | dedupe：row 优于 cell；schema 不与 row 混排去重 |
| Integration | UI 排序变更后 `row_index` 与 `locate.rowIndex` 仍与 `query_assets` 一致 |
| Integration | 本 turn write 后 find 返回 `session_fresh` 命中（不依赖向量） |
| Integration | 写入 cell → row + schema chunk upsert |
| Integration | `find_relevant_rows` paraphrase query 命中预期 row |
| E2E | 「把钻石礼包价格改成 199」：find → query(rowIndex) → update，trace 无全表 query |
| E2E | 「哪张表有 VIP 类型」：schema hit → get_library_schema |
| Regression | `AGENT_INDEXING_ENABLED=false` 全绿；现有 `semantic_search` 不回归 |

---

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| 行级语义 recall@5（人工 20 query） | ≥ 85%（含 paraphrase） |
| 更新场景无过滤全表 query 比例 | < 10%（trace 统计） |
| 更新 E2E 一次成功率 | ≥ 75%（试点 10 场景） |
| 较「仅 query_assets」token 节省（更新场景） | ≥ 40% 中位数 |
| `find_relevant_rows` 平均返回字符数 | 监控并 < 4k chars（Phase 3 调 quota） |

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| 语义漏召回 / 误召 | `confidence` 分级 + low 时 `confirmWithUser`；Prompt (b) 强制 `query_assets` |
| rowIndex 与 UI 不一致 | 统一用 `library_assets.row_index`；tool 层回填；验收测排序后一致性 |
| 索引延迟 | §5.8 会话内 `session_fresh` 走实时 `query_assets`；`freshnessNote` 提示 |
| schema chunk 过时 | field 变更触发 reindex；schema 命中后仍建议 `get_library_schema` |
| 双 tool 混淆 | 明确分工表（§5.1）；`find_relevant_rows` 为更新主入口 |
| 索引量 / token 膨胀 | row 优于 cell 去重；`includeSchemaHits` 默认 false；Phase 3 监控调 quota |

---

## 15. Relationship to Other Specs

| Spec | 关系 |
|------|------|
| **6/17 Vector RAG** | 本 spec **扩展**其 library 索引与检索消费方式；不重复 chat/design_doc 工作 |
| **6/18 Schema Writes** | 写侧契约不变；本 spec 规定更新前先 **语义定位 (L3)** 再 **schema (L2)** 再 **写入 (L1)** |
| **6/15 Design Doc → Tables** | 设计文档仍走 semantic / RAG 理解；填表仍用 schema + 精确写 |

---

## 16. Open Items

| # | Question | Proposed default |
|---|----------|------------------|
| 1 | `find_relevant_rows` vs 扩展 `query_assets` 加 `semanticQuery` 参数 | 独立 tool，避免 query_assets 职责膨胀 |
| 2 | 是否在 Phase 2 对 `query_assets` 加 hard limit 警告（>50 rows 返回 `_llmNote` 强制窄化） | **已决：是**（Phase 2，FR-S13） |
| 3 | schema chunk 是否索引 section 分组 | v1 不分组；v2 按 section 拆 chunk |
| 4 | confidence 阈值是否可 per-library 配置 | v1 全局 env；v2 考虑 |

---

## 17. Summary for Stakeholders

- **问题：** Agent 更新表前用 SELECT 拉全表，数据有值无语义，token 贵、易漏改。
- **方案：** 在已有 VectorDB 上做**语义读增强**——行级 / 表级索引 + 可定位检索工具 + 标准更新工作流。
- **关键交付：** `find_relevant_rows`（语义命中 → `rowIndex` → `query_assets`）+ `library_row` / `library_schema` 索引。
- **与写侧配合：** 6/18 保证「填对」；本 spec 保证「找对」。
- **不替代：** 精确读写仍靠 `query_assets` / `update_row`；向量结果是**指针**，不是写库依据。

---

*Status: rev. 2 — review feedback incorporated; ready for implementation plan. Next step: `writing-plans` → `docs/superpowers/plans/2026-06-19-agent-semantic-read-enhancement.md`*
