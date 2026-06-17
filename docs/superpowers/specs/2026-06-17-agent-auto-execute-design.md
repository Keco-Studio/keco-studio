# Agent Auto-Execute (Disable Confirmations) Design Spec

**Date:** 2026-06-17  
**Status:** Draft  
**Scope:** 默认关闭 Agent 全部写操作确认，写 tool 在单次 SSE 流内连续执行；保留可选「确认模式」供需要时开启  
**Related:** [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md), [2026-06-12-agent-chat-persistence-design.md](./2026-06-12-agent-chat-persistence-design.md)

---

## 1. Overview

### 1.1 Problem

当前 Agent 对每个写 tool 都会暂停 ReAct 循环、关闭 SSE、等待用户点击 Confirm，再通过 `/api/agent-chat/confirm` 恢复。批量数据处理时（多行 `update_row`、多次 `create_asset`、跨库 `set_reference` 等），确认次数与 SSE 往返次数线性增长，体验极差。

现有 `skipConfirmation` 仅覆盖 `pre_execute` 工具，且需通过 LLM 调用 `set_conversation_option`（本身还要 meta 确认）才能开启，入口隐蔽、覆盖面不足。

### 1.2 Decision

**默认采用「全自动执行」**：所有写 tool（含 `post_preview` 的两阶段工具）在单次用户消息触发的 SSE 流内直接完成，不再弹出确认卡。

用户接受的风险模型：**出问题就 F5**——主要指**丢弃尚未发生的修改**（进行中的 SSE、尚未执行的 tool、Confirm 模式下悬而未决的 pending action），而不是「一键撤销已落库的数据」。已写入 Supabase 的操作仍不可通过 F5 回滚（见 §6）。

### 1.3 Goals

| 目标 | 说明 |
|------|------|
| **G1** | 默认 `autoExecute: true`，新会话开箱即用，无确认卡 |
| **G2** | `post_preview` 工具在 auto 模式下：`execute()` 成功后立即 `executeImport()`，不暂停 |
| **G3** | 单次用户 turn 内多个写 tool 连续执行，SSE 不中断 |
| **G4** | ChatPanel 提供可见开关，可切回「确认模式」 |
| **G5** | 权限层不变：Viewer 仍不可写；确认层与权限层独立 |

### 1.4 Non-Goals

- 不做 undo / 版本回滚 / 软删除恢复
- 不做批量 tool 聚合（`batch_update_rows` 等）——本 spec 只改确认策略
- 不改 tool schema 或 LLM prompt 中的业务规则（字段解析、rowIndex 等）
- 不删除 `agent_pending_actions` 表或 `/confirm` 路由——确认模式仍需要

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **autoExecute** | 会话级开关：`true` = 跳过全部确认，直接执行写操作 |
| **requireConfirmation** | `autoExecute === false` 的别名，沿用现有三种 `confirmationMode` 流程 |
| **pre_execute** | 写前确认模式（create/update/delete 等） |
| **post_preview** | 先 preview 再确认写入（import_script、update_row、setup_library、set_reference） |
| **meta** | 选项变更本身需确认（`set_conversation_option`，见 §5.4） |

---

## 3. Behavior Specification

### 3.1 Default

**所有对话默认 Auto**（新会话 + 加载历史会话）：

- **新会话**：创建时写入 `meta.autoExecute = true`（或从 user preference 初始化，preference 默认也为 `true`）
- **历史会话**：读取 meta 时若 `autoExecute` 缺失且 legacy `skipConfirmation` 也未开启，**按 `true` 解析**（见 §4.1 `resolveConversationMeta`）
- **新用户全局偏好**（localStorage）：缺省视为 `autoExecute: true`
- ChatPanel header 显示状态：`Auto`（默认）/ `Confirm`（用户手动开启确认时）

### 3.2 ReAct loop — `needsConfirmation`

```typescript
function needsConfirmation(tool: AgentTool, meta: ConversationMeta): boolean {
  if (tool.category === 'read') return false;
  if (meta.autoExecute === true) return false; // NEW: supersedes all modes
  // Existing logic below unchanged for requireConfirmation mode:
  if (tool.confirmationMode === 'post_preview' || tool.confirmationMode === 'meta') return true;
  if (tool.confirmationMode === 'pre_execute' && meta.skipConfirmation) return false;
  return true;
}
```

**Meta 解析（统一入口 `resolveConversationMeta`）：**

```typescript
function resolveConversationMeta(raw: ConversationMeta | null | undefined): ConversationMeta {
  if (raw?.autoExecute === false) return { autoExecute: false };
  if (raw?.autoExecute === true || raw?.skipConfirmation === true) return { autoExecute: true };
  return { autoExecute: true }; // default: all conversations Auto
}
```

写入时统一用 `autoExecute`，不再写 `skipConfirmation`。

### 3.3 Auto-execute path per confirmation mode

当 `needsConfirmation === false` 且 tool 为 write 时：

#### A. `pre_execute` / `meta`

与现有 no-confirmation 分支相同：直接 `tool.execute()` → `tool_result` SSE → 持久化 → 继续循环。

#### B. `post_preview`（**本 spec 核心新增逻辑**）

当前 no-confirmation 分支**只调用 `execute()`，不会调用 `executeImport()`**，导致 preview 工具在旧 `skipConfirmation` 下实际上不会写入 DB。auto 模式必须补齐：

```
1. yield tool_call_start
2. result = await tool.execute(params, ctx)     // preview phase
3. if !result.success → tool_result (failure) → continue loop
4. if !tool.executeImport → treat as single-phase; tool_result → continue
5. importResult = await tool.executeImport(result, params, ctx)
6. yield tool_call_end
7. yield tool_result (importResult data + displayHint from preview or import)
8. cache_invalidated if needed
9. persist assistant + tool messages → continue loop (NO return)
```

**SSE 事件：** auto 模式下仍发送 preview 阶段的 `tool_result`（用户可在流里看到变更摘要），但不发送 `confirmation_request`。

**Trace：** 分别记录 `phase: 'execute'` 与 `phase: 'executeImport'`（与 confirm resume 路径一致）。

### 3.4 Require-confirmation path（`autoExecute: false`）

完全保留现有行为：

- `pre_execute` / `meta`：暂停 → `confirmation_request` → `/confirm` → resume
- `post_preview`：preview → `confirmation_request` → `/confirm` → `executeImport`
- 前端 `ConfirmationCard` / `ScriptPreviewCard` / `SkillPreviewCard` 照常渲染

### 3.5 Multi-tool turns

用户在 auto 模式下发送一条消息，Agent 若连续调用 N 个写 tool：

- 全部在**同一条 SSE 连接**内顺序执行
- 每步推送 `tool_call_start` → `tool_result`（及 `cache_invalidated`）
- 仅在整轮结束或出错时推送 `done` / `error`
- **不再**因中间写操作而 `return` 关闭 SSE

---

## 4. Data Model

### 4.1 `ConversationMeta`（`agent_conversations.meta` jsonb）

```typescript
interface ConversationMeta {
  /** Default true for new conversations. When true, all write tools skip confirmation. */
  autoExecute?: boolean;

  /** @deprecated Read as autoExecute=true if set. Do not write on new saves. */
  skipConfirmation?: boolean;
}
```

| Field | Default | Scope |
|-------|---------|-------|
| `autoExecute` | **`true`（缺省即 true）** | Per conversation；历史会话加载时同样默认 true |
| `skipConfirmation` | — | Legacy only; read → `autoExecute: true` if set |

**Resolved default:** 仅当用户显式切到 Confirm（`autoExecute: false` 写入 DB）时，该会话才走确认流。

### 4.2 User preference (localStorage)

| Key | Value | Purpose |
|-----|-------|---------|
| `keco:agent:auto-execute:{userId}` | `"true"` \| `"false"` | Default for **new** conversations when user clicks "New" |

规则：

- 创建新会话时：meta 从 user preference 初始化（preference 缺省 = `true`）
- 用户在 ChatPanel 切换开关时：更新当前会话 meta **并**更新 user preference
- 加载历史会话时：经 `resolveConversationMeta` 解析；**未显式设为 false 的会话一律 Auto**

### 4.3 Unchanged tables

`agent_pending_actions` 仅在 `autoExecute: false` 时使用；auto 模式下不应新增 pending rows。

---

## 5. API & Frontend

### 5.1 PATCH conversation meta（新增）

```
PATCH /api/agent-chat/conversations/:id/meta
Body: { autoExecute: boolean }
Auth: same as agent-chat
Response: { meta: ConversationMeta }
```

用于 ChatPanel 开关直接写 DB，**不经过** LLM 的 `set_conversation_option`。

### 5.2 Existing routes

| Route | Change |
|-------|--------|
| `POST /api/agent-chat` | Pass `conversationMeta.autoExecute` into `runAgentTurn` |
| `POST /api/agent-chat/confirm` | No change; used only in requireConfirmation mode |
| Conversation create | Initialize `meta: { autoExecute: <userPref> }` |

### 5.3 ChatPanel UI

**Header 增加 Toggle：**

```
[ Auto ▼ ]  或  [ Confirm ▼ ]
```

- **Auto**（默认）：`autoExecute: true`，tooltip：`Write tools run immediately. Refresh (F5) to discard in-progress work or fix a stale UI—not to undo saved changes.`
- **Confirm**：`autoExecute: false`，恢复现有确认卡流程

切换时：

1. 若当前有 `isStreaming`，禁用切换
2. 调用 PATCH meta API
3. 更新 localStorage user preference
4. 可选：append 一条 system note 到聊天区（非 LLM 消息）：`Mode: Auto — confirmations disabled for this conversation.`

**确认模式 UI 保留：** `ConfirmationCard`、`ScriptPreviewCard` 等不删除；auto 模式下不会收到 `confirmation_request` 事件。

### 5.4 `set_conversation_option` tool

| Option | Auto mode | Confirm mode |
|--------|-----------|--------------|
| Deprecate `skipConfirmation` | Ignore or map to `autoExecute` | Same mapping |

**Recommendation:** 保留 tool 但改为设置 `autoExecute`；在 auto 模式下 **meta 确认也跳过**（与「全关确认」一致）。若 `autoExecute: false`，切换选项仍走 meta 确认。

更新 `prompts.ts` RULE 7：

- 删除「让用户说 skip confirmation 再调 tool」的流程
- 改为：「用户可在 ChatPanel 切换 Auto/Confirm；默认 Auto」

---

## 6. Limitations & User Expectations

### 6.1 F5 的预期用途（产品共识）

用户心智：**F5 = 丢弃还没做完的事**，而不是撤销已完成写入。

| 场景 | F5 效果 |
|------|---------|
| Agent 正在流式回复 / 执行 tool 中途 | **可以打断**：丢弃本轮未完成的 SSE 与尚未执行的 tool |
| Confirm 模式下悬而未决的 pending action | **可以丢弃**：刷新后 pending 过期，该步不会写入 |
| 界面/cache 与 DB 不一致 | **可以修复**：刷新 UI；写成功后仍会走 `cache_invalidated` + `router.refresh()` |
| **已经**成功写入 Supabase 的数据 | **不能撤销**；F5 不会回滚 DB |

### 6.2 其他边界

| 场景 | 说明 |
|------|------|
| 中断 SSE | 已执行的 tool 已落库；队列中未执行的 tool 不会跑 |
| Delete 误操作 | Auto 模式下 delete 立即生效；无 soft-delete |
| 需要逐步确认 | 手动切 ChatPanel 为 **Confirm** |

产品立场：**速度优先**；对「还没发生的修改」用 F5 止损；对已落库错误需人工改数据或走 Confirm 模式防呆。

---

## 7. Affected Tools

### 7.1 Write tools — auto mode executes immediately

| Tool | Mode | Auto behavior |
|------|------|---------------|
| `create_asset` | pre_execute | execute |
| `update_asset` | pre_execute | execute |
| `delete_asset` | pre_execute | execute |
| `add_field` | pre_execute | execute |
| `create_library` | pre_execute | execute |
| `create_folder` | pre_execute | execute |
| `delete_library` | pre_execute | execute |
| `rename_library` | pre_execute | execute |
| `import_script` | post_preview | execute → executeImport |
| `update_row` | post_preview | execute → executeImport |
| `setup_library` | post_preview | execute → executeImport |
| `set_reference` | post_preview | execute → executeImport |
| `set_conversation_option` | meta | execute (no meta confirm when auto) |

Read tools：无变化。

---

## 8. Implementation Plan (high level)

### Phase 1 — Core loop

1. Extend `ConversationMeta` with `autoExecute`; migration helper for `skipConfirmation`
2. Update `needsConfirmation()` in `core.ts`
3. Add `executePostPreviewTool()` helper: execute + executeImport in one path
4. Wire auto path for post_preview (fix skipConfirmation gap)
5. Unit tests: `needsConfirmation`, post_preview auto path, legacy meta migration

### Phase 2 — API & persistence

1. PATCH meta endpoint
2. New conversation defaults from user preference
3. Agent-chat route passes updated meta

### Phase 3 — Frontend

1. ChatPanel Auto/Confirm toggle
2. localStorage user preference
3. Remove reliance on LLM for mode switching; update empty-state copy

### Phase 4 — Cleanup

1. Deprecate `skipConfirmation` in types/docs/skills
2. Update `prompts.ts` rule 7
3. Update `.claude/skills/debug-agent.md`

---

## 9. Testing

### 9.1 Unit (`tests/unit/agent/`)

| Case | Expect |
|------|--------|
| `autoExecute: true` + `create_asset` | No confirmation; execute once |
| `autoExecute: true` + `update_row` | execute + executeImport; no pending action |
| `autoExecute: false` + `update_row` | confirmation_request; pending action saved |
| Legacy `{ skipConfirmation: true }` | Treated as autoExecute |
| `autoExecute: true` + failed preview | No executeImport; error tool_result |

### 9.2 E2E (optional, headed)

1. Auto mode: send「create asset X」→ 无 Confirm 按钮 → 数据出现在 library
2. Toggle Confirm → 同会话 create → 出现 Confirm 卡
3. Auto mode: 连续两条写指令 → 单次 SSE 内多个 tool_result

### 9.3 Manual

- Viewer 角色：写 tool 仍返回 permission error（与确认无关）
- import_script 大文本：auto 模式下长时间单 SSE（注意 `maxDuration` 60s 限制不变）

---

## 10. Rollout

| Step | Action |
|------|--------|
| 1 | Ship with **`resolveConversationMeta` 缺省 = true**（新会话 + 历史会话） |
| 2 | 仅 `meta.autoExecute === false` 的会话保持 Confirm 行为 |
| 3 | Announce in release notes: 「Agent 对话默认 Auto；F5 用于丢弃进行中的操作；需确认时可切 Confirm」 |

**Product decision (locked):** 不做 feature flag 保守期；**所有对话默认 Auto**，与用户「全关确认 + F5 丢未完成修改」一致。

---

## 11. Open Questions

| # | Question | Decision |
|---|----------|----------|
| Q1 | 旧会话是否默认 auto？ | **Locked: Yes** — 所有对话经 `resolveConversationMeta` 缺省为 Auto |
| Q2 | delete 在 auto 下是否仍要确认？ | **Locked: No** — 切 Confirm 模式即可 |
| Q3 | 是否保留 ScriptPreviewCard 只读展示？ | **Yes** — 流内 tool_result 展示，无按钮 |
| Q4 | F5 语义 | **Locked** — 丢弃未完成修改 / 修 UI；不撤销已落库数据 |
| Q5 | `maxDuration` 批量写入超时 | Out of scope |

---

## 12. Success Criteria

- [ ] 新会话与历史会话（未显式 Confirm）默认无确认卡，连续 10 次 `update_row` 无需点击 Confirm
- [ ] `post_preview` 工具在 auto 模式下实际写入 DB（非仅 preview）
- [ ] Confirm 模式与现网行为一致（回归）
- [ ] ChatPanel 开关可持久化到会话 + 用户偏好
- [ ] 文档与 prompt 不再引导「说 skip confirmation」
