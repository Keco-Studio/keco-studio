# Agent Vector Memory & Project Knowledge RAG Design Spec

**Date:** 2026-06-17  
**Status:** Draft (rev. 2 — incorporates external review)  
**Revision notes (rev. 2):** chat turn-group chunking; v1 mandatory scope quotas; recency-weighted ranking + conflict handling; `AGENT_RETRIEVAL_MAX_CHARS`; v2 retrieval optimizations listed in §17.
**Scope:** 为 keco-studio Agent 引入向量检索能力，同时覆盖 **(A) 跨时间/跨会话的对话长期记忆** 与 **(B) 项目业务知识语义检索（RAG）**  
**Related:**
- [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md)
- [2026-06-12-agent-chat-persistence-design.md](./2026-06-12-agent-chat-persistence-design.md)
- [2026-06-16-docx-image-multimodal-design.md](./2026-06-16-docx-image-multimodal-design.md)

---

## 1. Overview

### 1.1 背景

当前 Agent 的「记忆」完全依赖 `agent_messages` 表的时间序 history replay：

| 机制 | 现状 | 问题 |
|------|------|------|
| 短期连贯 | 每轮 `loadConversationHistory` → 拼进 LLM messages | 有效，但 token 随轮次线性增长 |
| 上下文窗口 | `prepareMessagesForLlm` 只保留最近 **50** 条非 system 消息 | 更早的对话对模型不可见 |
| 跨会话 | 无 | 用户在会话 A 说过的事，会话 B 无法回忆 |
| 项目知识 | `query_assets` / `search_library_cell_values`（ILIKE 关键词） | 无语义搜索；大库需多次 tool 调用 |
| 设计文档 | 全文 + 图片 URL 每轮重发 | token 成本高；无法检索文档片段 |

老板提出的 **Vector DB** 不是要替换现有 history 存储，而是在其之上增加 **语义检索层**：从海量文本中按「意思」挑出与当前问题最相关的片段，再注入 LLM 上下文。

### 1.2 目标（Track A + Track B）

**Track A — 对话长期记忆（Conversation Memory）**

1. 超出 50 条滑动窗口后，Agent 仍能通过语义检索找回**同会话或同项目**内的相关旧消息。
2. 用户在新会话中说「上次我们定的角色表结构」时，能检索到旧会话中的约定（在用户权限范围内）。
3. 降低对「全量 history replay」的依赖，控制 token 成本。

**关于「替代整段 history」的预期（rev. 2 明确）：**

本 spec 的策略是 **增强（augment），不是替换（replace）**。这是刻意设计——直接去掉近期完整 replay 会损害多轮 tool 调用的连贯性。

| 场景 | Token 成本变化 | 收益 |
|------|----------------|------|
| 短期对话（≤50 条） | **基本不变**（仍完整 replay 最近窗口） | 无下降，也无必要 |
| 超长对话（>50 轮） | 窗口外内容不再 replay，改为检索片段注入 | 找回早期约定，避免窗口截断失忆 |
| 跨会话 | 新能力 | 在新会话中语义找回旧会话内容 |
| 设计文档（Phase 3） | **显著下降**（可选不再每轮重发全文） | 主要 token 节省来源 |

**Track B — 项目知识 RAG（Project Knowledge）**

1. 对 library 单元格文本、设计文档正文建立向量索引，支持**语义搜索**。
2. Agent 可通过新 tool 或自动注入的检索结果，找到「意思相近但用词不同」的内容。
3. 与现有 `query_assets`（结构化精确查询）互补，而非替代。

### 1.3 非目标（v1）

- 不替换 `agent_messages` 作为对话真相源；向量表是**索引层**，可重建。
- 不对图片/音频做 CLIP 级多模态 embedding（设计文档图片仍走现有 vision 链路）。
- 不做跨项目全局知识共享（检索始终受 `project_id` + 用户权限约束）。
- 不引入独立向量 SaaS（Pinecone 等）作为 v1 依赖；优先 **Supabase pgvector**，与现有栈一致。
- 不做用户可编辑的「记忆 pin / 忘记」UI（v2 考虑）。

### 1.4 设计原则

- **DB 仍为对话真相源**：`agent_conversations` + `agent_messages` 不变。
- **检索增强生成（RAG）**：向量检索结果以明确标注的上下文块注入 prompt，模型仍需遵守「以 tool 结果为准」的 grounding 规则。
- **近期 history 优先**：滑动窗口内的消息仍完整保留；向量检索是**补充**，不是替换最近 N 轮。
- **权限对齐**：embedding 检索结果不得越过 RLS / `authorizationService` 边界。
- **可观测、可重建**：索引异步更新；源数据变更后可全量 reindex。

---

## 2. Architecture

### 2.1 高层架构

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

### 2.2 与现有 history 的关系

```
发给 LLM 的 messages（v1 目标形态）:

  system:
    - 现有 buildSystemPrompt(ctx)
    - + "## Retrieved context" 块（向量检索 Top-K，若有）

  ...recent history（滑动窗口，仍由 prepareMessagesForLlm 截断到 50 条）

  user:
    - 页面上下文 augmentation（不变）
    - 用户新消息
```

| 数据 | 存储 | 进入 LLM 的方式 |
|------|------|----------------|
| 最近 50 条消息 | `agent_messages` | 完整 replay（现有逻辑） |
| 更早的同会话消息 | `agent_messages` + 向量索引 | 仅检索到的片段 |
| 其他会话消息 | `agent_messages` + 向量索引 | 仅检索到的片段（同 user + project） |
| Library 单元格 | `library_asset_values` + 向量索引 | 检索片段 或 `semantic_search` tool |
| 设计文档正文 | 消息内文本 + 向量索引 | 检索片段（避免每轮重发全文） |

---

## 3. Approach Options (decision record)

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A. pgvector in Supabase** | 单库 `agent_embedding_chunks` + RPC 相似度搜索 | 与现有栈一致；RLS 可复用；运维简单 | 需 migration；embedding 维度与 Supabase 版本绑定 | **选用** |
| B. 独立向量 SaaS | Pinecone / Qdrant Cloud | 托管扩展性好 | 新依赖、权限同步复杂、成本 | 不选（v1） |
| C. 仅加 `semantic_search` tool，不做自动注入 | Agent 主动调 tool 检索 | 实现最小 | 模型可能忘记调用；连贯性差 | 作为补充，不单用 |

**Retrieval 策略（选用混合）：**

1. **自动检索（每轮 `runAgentTurn` 开头）**：用当前 user message 做 query，取 Top-K 注入 system prompt（Track A + B 混合源）。
2. **显式 tool `semantic_search`**：Agent 需要更深/更窄搜索时主动调用（Track B 为主，也可搜 chat）。

---

## 4. Data Model

### 4.1 Extension

```sql
-- migration: enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;
```

使用 **cosine distance**（`<=>` 运算符）。索引类型：**HNSW**（适合在线检索；数据量百万级前足够）。

### 4.2 Table: `agent_embedding_chunks`

统一存放所有可检索文本片段（chat + library + design doc）。

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | Chunk ID |
| `project_id` | uuid FK → `projects` | 项目隔离（必填） |
| `user_id` | uuid FK → `auth.users` nullable | **chat 来源**必填；library 来源为 NULL（项目级资源） |
| `source_type` | text CHECK | `'chat_message'` \| `'library_cell'` \| `'design_document'` |
| `source_id` | text NOT NULL | 溯源键，格式见 4.3 |
| `conversation_id` | uuid nullable FK | chat 来源时填写 |
| `chunk_index` | int NOT NULL DEFAULT 0 | 同一 source 的第几块（从 0 起） |
| `content` | text NOT NULL | 用于展示的原文片段（≤ 2k chars 推荐） |
| `content_hash` | text NOT NULL | sha256(content)，用于幂等 upsert |
| `metadata` | jsonb DEFAULT '{}' | 结构化溯源，见 4.3 |
| `embedding` | vector(1536) NOT NULL | 向量（维度随 embedding 模型配置，默认 1536） |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |

**Unique constraint:** `(source_type, source_id, chunk_index, content_hash)` — 防止重复索引。

**Indexes:**

- HNSW on `embedding` with `vector_cosine_ops`
- B-tree on `(project_id, source_type)`
- B-tree on `(conversation_id)` where not null
- B-tree on `(user_id)` where not null

### 4.3 `source_id` 与 `metadata` 约定

| source_type | source_id 格式 | metadata 示例 |
|-------------|----------------|-----------------|
| `chat_message` | `{conversation_id}:turn_group:{chunk_index}` | `{ "conversationId", "messageIds": ["uuid", ...], "messageCount": 4, "firstMessageAt", "lastMessageAt" }` |
| `library_cell` | `{asset_id}:{field_id}` | `{ "libraryId", "libraryName", "assetId", "assetName", "fieldId", "fieldLabel", "sectionId", "cellUpdatedAt" }` |
| `design_document` | `{conversation_id}:{message_id}:chunk:{chunk_index}` | `{ "conversationId", "messageId", "chunkIndex", "chunkHeading", "messageCreatedAt" }` |

**Chat `source_id` 说明：** 一条 chunk 对应一个 **turn group**（见 §5.2.1），不是单条 message。`chunk_index` 在会话内从 0 递增；tail 重索引时允许覆盖最近 2 个 turn group。

### 4.4 与现有表的关系

```
projects 1 ──< agent_conversations 1 ──< agent_messages
    │                                      │
    │                                      └── (indexed as chat_message chunks)
    │
    └── libraries ──< library_assets ──< library_asset_values
                                              └── (indexed as library_cell chunks)

agent_embedding_chunks ── logical pointer ──> source rows (not FK, rebuildable)
```

**重要：** 删除 `agent_messages` / `library_asset_values` 时，通过 application-level 或 DB trigger **级联删除**对应 chunks。

### 4.5 RLS

| Policy | Rule |
|--------|------|
| SELECT | `project_id` 在用户有权限的项目内；`chat_message` 额外要求 `user_id = auth.uid()` |
| INSERT/UPDATE/DELETE | **service role only**（索引管道使用 server-side supabase client） |
| RPC `match_agent_embedding_chunks` | `SECURITY DEFINER`，内部校验 `auth.uid()` + project membership |

客户端不直接读写 embedding 表；检索仅通过 Agent Core 或 `/api/...` 服务端调用。

---

## 5. Embedding Pipeline

### 5.1 Embedding client

新增 `src/lib/agent/embedding-client.ts`：

- OpenAI-compatible `POST /v1/embeddings`
- Env:
  - `EMBEDDING_API_URL`（默认与 `LLM_API_URL` 相同 host）
  - `EMBEDDING_API_KEY`（默认 fallback 到 `LLM_API_KEY`）
  - `EMBEDDING_MODEL`（默认 `text-embedding-3-small` 或团队选定的 MiniMax/OpenAI 兼容模型）
  - `EMBEDDING_DIMENSIONS`（默认 `1536`，须与 DB column 一致）
- 批量上限：每请求 ≤ 64 chunks（可配置）
- 失败重试 1 次；失败记 log，不阻塞用户发消息

### 5.2 Chunking rules

| Source | Chunk strategy | Min length | Notes |
|--------|----------------|------------|-------|
| `chat_message` | **Turn group**（见 §5.2.1）：相邻 3–5 条 user/assistant 消息合并为一个 chunk | 20 chars total | 跳过 tool 消息；assistant 只取可见 `text`，不含 reasoning |
| `library_cell` | 每个非空 **文本类** 单元格一条 chunk；前缀 `"{libraryName} / {assetName} / {fieldLabel}: "` | 10 chars | 跳过 image/file/audio/multimedia/reference 类型；reference 存 displayValue 文本若有 |
| `design_document` | 按段落切分，~400–600 中文字符或 ~800–1200 英文字符，overlap 100 chars | 50 chars | 从 `[Design document]` 消息体提取；图片 URL 不进入 chunk |

#### 5.2.1 Chat turn-group chunking（rev. 2）

单条消息独立检索会丢失多轮话题的上下文连贯性。v1 采用 **相邻消息合并**：

**分组规则（按 `created_at` 升序扫描会话内可索引消息）：**

1. 只纳入 `role ∈ {user, assistant}` 且文本非空的消息；**跳过** `tool` 消息（噪声大、体量大）。
2. 从当前指针起，累积消息直到满足以下任一条件即封口为一个 turn group：
   - 已包含 **5 条**消息；或
   - 已包含 **3 条**消息且下一条消息与上一条间隔 **> 30 分钟**（视为新话题）；或
   - 到达会话末尾。
3. 单条超长消息（> 1,500 chars）可独立成组，不与其他消息合并。
4. **Overlap：** 每个 turn group 与上一个 group **共享最后 1 条消息**（滑动窗口），避免话题在组边界被切断。

**Chunk 文本格式：**

```text
[2026-06-10 14:02] User: 角色表用哪些列？
[2026-06-10 14:02] Assistant: 建议 姓名、年龄、阵营三列。
[2026-06-10 14:03] User: 再加一个 reference 到势力库。
```

**索引更新策略（tail reindex）：**

- 每次 `saveMessage` 后，仅对该 `conversation_id` **重算并 re-embed 最后 2 个 turn group**（当前组可能未完成，前一组可能因 overlap 变化）。
- 全量 backfill 时对整个会话顺序执行分组。

### 5.3 Indexing triggers

| Event | Action | Sync mode |
|-------|--------|-----------|
| `saveMessage` 成功（user / assistant） | tail reindex：重算该会话最后 2 个 turn group | **异步**（`void reindexConversationTail(...).catch(log)`） |
| Agent write tools 修改 `library_asset_values` | enqueue affected cells | 异步，debounce 2s per cell key |
| 用户发送含 `[Design document]` 的 user 消息 | chunk + index 全文 | 异步，在 `saveMessage` 之后 |
| 手动 reindex API（admin） | 全量重建 project chunks | 同步 job，限流 |

**v1 不做：** 对历史数据的自动 backfill migration job 作为部署步骤单独运行（见 §10 Phase 0）。

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

每轮 `runAgentTurn` 在 `loadConversationHistory` 之后：

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

流程：`queryText → embed once → per-scope RPC candidate fetch → merge → recency rerank (§6.5) → apply scope quotas → truncate by maxChars`。

#### 6.1.1 Scope quotas（v1 必须实现）

**不做统一全局 Top-K**——否则 library 结果易淹没 chat 记忆，或反过来。v1 对每个 scope **分别检索再合并**：

| Scope | Filter | Quota (max chunks) |
|-------|--------|-------------------|
| `chat_same_conversation` | `conversation_id = current`, `source_type = chat_message` | **3** |
| `chat_same_project` | `user_id = current`, `project_id = current`, `conversation_id != current` | **2** |
| `library` | `source_type = library_cell`, `project_id = current` | **4** |
| `design_document` | `source_type = design_document`, `project_id = current` | **3** |

每个 scope 独立 RPC（或在单次 RPC 内用 scope 参数分区），各取 `quota × 2` 条候选（过召回），合并后经 §6.5 重排，再按 quota 截断。总注入上限仍受 `AGENT_RETRIEVAL_MAX_CHARS` 约束。

Env 覆盖（可选）：`AGENT_RETRIEVAL_QUOTA_CHAT_SAME=3` 等，默认如上。

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

内部：按 scope 过滤 → `similarity = 1 - (embedding <=> p_query_embedding)` → `similarity >= p_min_score` → 返回候选（**不在 SQL 层做最终排序**，由应用层 §6.5 统一重排）。

### 6.3 Prompt injection format

注入到 system prompt 末尾（英文，与现有 system prompt 一致）：

```markdown
## Retrieved context (semantic search — may be incomplete)
The following snippets were retrieved by similarity search. They supplement recent chat history; they are NOT guaranteed complete. Prefer fresh tool results for factual data.

1. [chat_message · conversation abc · last updated 2026-06-15] (3 messages) User: ... Assistant: ...
2. [library_cell · 角色库 · 主角A · 人设 · updated 2026-06-14] 性格开朗，出身贵族...
3. [design_document · chunk 2/5 · 2026-06-12] 第二章角色关系：主角与女主为青梅竹马...

If retrieved context conflicts with tool results or the user's latest message, trust tools and the latest message.
When multiple chat snippets disagree, prefer the snippet with the **most recent timestamp** (newer decisions override older ones).
```

若无结果，不添加该 section（避免空块浪费 token）。

### 6.4 与 `prepareMessagesForLlm` 的协作

- **不改变** sliding window 逻辑（仍 50 条）。
- Retrieved context 放在 **system message**，不计入 50 条 window。
- Retrieved context 总字符上限：由 **`AGENT_RETRIEVAL_MAX_CHARS`** 控制（默认 **32,000** chars；超出则按 §6.5 `final_score` 从低到高截断）。

#### 6.4.1 `AGENT_RETRIEVAL_MAX_CHARS` 管什么、不管什么

**只管** system prompt 里 `## Retrieved context` 这一块的**拼接后总长度**（scope 配额内选出的 chunk 原文之和）。

**不管：**

| 部分 | 是否受此上限约束 |
|------|------------------|
| 现有 `buildSystemPrompt` 规则 + CURRENT CONTEXT | 否 |
| 最近 50 条 history replay | 否（走 `prepareMessagesForLlm` 另一条链路） |
| 当前 user 消息 + 图片 parts | 否 |
| ReAct 循环中的 tool 结果 | 否（走 `MAX_TOOL_CONTENT_CHARS` 等现有逻辑） |

**32k 能装多少（粗算）：**

- 中文为主时 32k chars ≈ **8k–10k tokens**，仅检索注入块。
- 在默认 scope quota（3+2+4+3 = 12 chunks）下，平均每 chunk 可留 **~2,600 chars**——足够放下多轮 turn group、若干 library 单元格、设计文档 2–3 个段落。
- 复杂项目（多 library + 跨会话记忆 + 设计文档同时命中）时，12 条配额可能先触顶；此时按 `final_score` 截断的是**最不相关的尾部 chunk**，而不是整段检索失败。

**为何默认 32k 而非 8k：** 8k 在「多库 + 长 turn group + 设计文档片段」同时注入时容易把 library/文档内容截没，检索收益打折。32k 是「检索层」的慷慨预算；总 context 仍受模型窗口限制，若整包超限由现有 LLM 客户端 / 模型侧处理（与今天长对话行为一致）。

Env 可下调（如 staging 用 `8000` 做成本实验），生产默认 **32000**。

### 6.5 Ranking: recency-weighted merge（v1 必须实现）

初筛仅 cosine similarity 不足——跨会话检索可能命中互相矛盾的旧约定。v1 在应用层对每个候选计算：

```typescript
final_score = similarity * (1 - RECENCY_WEIGHT) + recency_score * RECENCY_WEIGHT
// RECENCY_WEIGHT default 0.2 (env: AGENT_RETRIEVAL_RECENCY_WEIGHT)

recency_score = exp(-age_days / half_life_days)
// half_life_days: chat_message → 30, library_cell → 90, design_document → 60
// age_days from metadata.lastMessageAt | cellUpdatedAt | messageCreatedAt
```

**合并与冲突处理：**

1. 各 scope 内按 `final_score` 降序取满 quota。
2. 跨 scope 合并后整体再按 `final_score` 排序，用于 `maxChars` 截断。
3. 同一 `conversation_id` 的 chat chunks 若 `final_score` 相差 < 0.05，**强制 prefer 更新的** `lastMessageAt`。
4. Prompt 层（§6.3）+ 时间戳标注；**不以向量相似度单独决定**冲突胜负。

**v1 不做** HyDE / cross-encoder re-rank / query rewrite（见 §17 v2）。

---

## 7. New Agent Tool: `semantic_search`

### 7.1 Purpose

供 Agent **主动**做更深检索（自动 Top-8 不够时）。

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

### 7.4 System prompt rule（新增一条）

```
29. SEMANTIC SEARCH: Use semantic_search when the user asks about meaning/concept
    ("类似…的角色", "之前讨论过的设定", "文档里关于战斗系统的描述") rather than
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
| `src/lib/agent/conversation-store.ts` | `saveMessage` 后 trigger async index |
| `src/lib/agent/tools/semantic-search.ts` | **New** tool |
| `src/lib/agent/tools/index.ts` | register tool |
| `src/lib/agent/prompts.ts` | rule 29 + document retrieved context |
| Write tool handlers (`update-asset`, `create-asset`, `update-row`, …) | optional hook: `scheduleLibraryCellReindex` |
| `src/app/api/agent-chat/reindex/route.ts` | **New** — admin/project reindex (optional Phase 2) |

**不变：**

- `useAgentChat` 请求体（仍只发新消息 + conversationId）
- `agent_messages` schema
- 前端 History UI

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

### Phase 0 — Infrastructure（1–2 天）

- pgvector migration + RPC
- embedding client + unit tests (mock API)
- manual reindex script for one project

### Phase 1 — Project Knowledge RAG（Track B）

- Index `library_cell` on write + backfill script
- `semantic_search` tool
- **不**改 `runAgentTurn` 自动注入（降低风险）
- 验收：语义能搜到 ILIKE 搜不到的 paraphrase

### Phase 2 — Conversation Memory（Track A）

- Index `chat_message` on save + backfill recent conversations
- Auto retrieval in `runAgentTurn`
- 验收：超过 50 轮后仍能回答「会话开头约定的表名」

### Phase 3 — Design Document Chunks（Track B 增强）

- Index design doc text chunks
- 可选：对已索引文档，**不再**每轮重发全文（仅保留图片 URL parts + 检索片段）—— **单独 flag** `AGENT_DESIGN_DOC_VECTOR_ONLY=false` 默认关闭，待质量验证后开启

---

## 11. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-V1 | 启用 pgvector；`agent_embedding_chunks` 表与 HNSW 索引可创建 |
| FR-V2 | 服务端可对文本 batch 生成 embedding 并 upsert |
| FR-V3 | `semantic_search` tool 返回按相似度排序的结果，受 project 权限约束 |
| FR-V4 | Library 单元格写入后，对应 chunk 在 30s 内可检索（异步） |
| FR-V5 | 用户/助手消息保存后，chat chunk 在 30s 内可检索（Phase 2） |
| FR-V6 | `runAgentTurn` 自动注入 Retrieved context，且不超过 `AGENT_RETRIEVAL_MAX_CHARS`（Phase 2） |
| FR-V7 | 删除 message / asset cell 时，对应 embedding chunks 被清理 |
| FR-V8 | `AGENT_RETRIEVAL_ENABLED=false` 时行为与今天完全一致 |
| FR-V9 | 检索与索引失败不导致 chat 请求 5xx（best-effort + log） |
| FR-V10 | chat 检索仅返回 `user_id = 当前用户` 的消息 |
| FR-V11 | 自动检索 v1 必须按 scope quota 分区取结果，禁止单一全局 Top-K |
| FR-V12 | Chat 索引使用 turn group（3–5 条相邻消息），非单条 message |
| FR-V13 | 检索排序使用 similarity + recency 加权；冲突时较新时间戳优先 |

---

## 12. Security & Privacy

1. **chat_message** chunks 带 `user_id`；RPC 强制 `user_id = auth.uid()`，用户不能检索他人对话。
2. **library_cell** chunks 按 `project_id` + 现有 project membership 校验（与 `resolveUserRole` 一致）；Viewer 可检索只读内容。
3. Embedding API 请求仅服务端发起；不向浏览器暴露 embedding key。
4. Chunk `content` 可能含敏感剧本——与源数据权限相同，不扩大暴露面。
5. `agent_traces` 可记录 `retrievalChunkIds` 便于调试（不含 embedding 向量）。

---

## 13. Testing Plan

| Level | Cases |
|-------|-------|
| Unit | turn group 分组/overlap/tail reindex；content_hash 幂等；`formatRetrievedContext` 截断 |
| Unit | scope quota 合并；`final_score` recency 加权；冲突时较新 chunk 胜出 |
| Unit | `prepareMessagesForLlm` 与 retrieved context 共存；window 仍 50 条 |
| Integration | mock embedding API → upsert → RPC match 返回预期排序 |
| Integration | `saveMessage` 后异步 index；update cell 后 reindex |
| E2E | 写入 library 数据 → `semantic_search` 用同义不同词找到 |
| E2E | 60+ 轮对话 → 问早期约定 → 自动检索命中（Phase 2） |
| Regression | `AGENT_RETRIEVAL_ENABLED=false` 时全绿 |

---

## 14. Observability

- Log: `embedding.index.{source_type}` duration, chunk count, failures
- Log: `embedding.retrieve` query length, hit count, top similarity
- `agent_traces` 扩展字段（可选）：`retrieval: { chunkIds, topScore, latencyMs }`

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| 检索到错误片段导致幻觉 | Prompt 明确「以 tool 结果为准」；显示 source + 时间戳；相似度阈值 |
| 跨会话矛盾约定 | recency 加权排序 + prompt「较新时间戳优先」；仍建议用户以当前 tool 结果为准 |
| 索引延迟 | 近期 50 条 window 仍完整；异步索引 + 30s SLA |
| Embedding 成本 | 跳过短文本；content_hash 去重；library 只索引文本列 |
| pgvector 迁移 | 独立 migration；先在 staging 验证 Supabase 版本支持 |
| 与 ILIKE 搜索重复 | 分工：`search_library_cell_values` 给 UI 全局搜索；`semantic_search` 给 Agent |

---

## 16. Success Metrics

| Metric | Target |
|--------|--------|
| 语义搜索 recall@5（人工标注 20 条 query） | ≥ 80% |
| 50+ 轮会话「早期事实」问答准确率 | ≥ 70%（Phase 2） |
| Chat P95 延迟增加（含检索） | ≤ +300ms |
| 索引失败率 | < 1% |

---

## 17. Open Items

### 17.1 Resolve before implementation plan

| # | Question | Proposed default |
|---|----------|------------------|
| 1 | Embedding 模型最终选型（MiniMax embedding vs OpenAI） | 与 LLM 同厂商 MiniMax；若无则 `text-embedding-3-small` |
| 2 | 历史 library 数据是否部署时全量 backfill | 是，跑一次性 `scripts/reindex-project-embeddings.ts` |
| 3 | Phase 3 是否默认关闭「设计文档仅向量不重发全文」 | 是，flag 默认 `false` |

### 17.2 v2 retrieval optimizations（非 v1，已记录）

以下会显著影响检索质量，**v1 不实现**，纳入后续迭代：

| Technique | Purpose | Notes |
|-----------|---------|-------|
| **Query rewrite / expansion** | 将口语化 user message 改写为更适合检索的 query | 需额外 LLM 调用；可与 `semantic_search` 共用 |
| **HyDE** | 先生成假设性回答，用其 embedding 检索 | 提高召回，成本 +1 LLM call per turn |
| **Cross-encoder re-ranking** | 对初筛 Top-20 用 reranker 模型精排 | 需额外模型服务；替换或增强 §6.5 线性加权 |
| **MMR diversity** | 避免注入内容高度重复的 chunks | 在 quota 合并后做去重 |

v1 以 **scope quota + recency-weighted ranking** 保证基线质量；上线后用 §16 指标决定是否优先做 rerank 或 query rewrite。

---

## 18. Summary for stakeholders

- **Vector DB 不是替代 history**，而是让 Agent 在 **token 有限** 时仍能「按意思找到」旧对话和项目知识。
- **Track A（记忆）**：索引聊天记录 → 自动检索补全 50 条窗口之外的上下文。
- **Track B（知识）**：索引 library 与设计文档 → `semantic_search` + 自动注入。
- **存储选型**：Supabase **pgvector**，不新增外部向量服务。
- **分三期交付**：基础设施 → 项目 RAG tool → 对话记忆自动检索 → 设计文档优化。
- **rev. 2 强化**：chat turn-group chunking、v1 scope 配额、时间衰减排序与冲突处理、可配置 `AGENT_RETRIEVAL_MAX_CHARS`。

---

*Status: ready for implementation plan. Next step: `writing-plans` → `docs/superpowers/plans/2026-06-17-agent-vector-memory-rag.md`*
