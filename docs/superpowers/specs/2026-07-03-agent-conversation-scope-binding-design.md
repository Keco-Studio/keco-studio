# Agent 会话 Project/Scope 绑定 Design Spec

**Date:** 2026-07-03  
**Status:** Draft  
**Scope:** 每个 Agent 会话在创建时冻结其所属 project 与数据范围（scope），后续运行时以会话绑定值为唯一权威，不再随前端实时导航漂移；History 列表显示所属 project 与 scope 层级  
**Related:** [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md), [2026-06-12-agent-chat-persistence-design.md](./2026-06-12-agent-chat-persistence-design.md), [2026-06-17-agent-auto-execute-design.md](./2026-06-17-agent-auto-execute-design.md)

---

## 1. Overview

### 1.1 Problem

当前 Agent 的运行时 project 与页面上下文（folder / library / section）**完全来自前端实时导航**（`useNavigation()`），会话本身虽在 `agent_conversations.project_id` 存了创建时的 project，但运行时并不以它为准：

- 发消息时（`useAgentChat.ts:339-350`）发送的是 `ctx.projectId` + 当前 folder/library/section 的**实时值**。
- 后端 `getOrCreateConversation`（`conversation-store.ts:59-72`）对已有会话**只校验 user 归属，不校验 projectId 是否与会话绑定一致**。

**后果：** 用户在 project A 打开 History、切回一条属于 project B 的历史会话继续发消息，实际会带着 **project A 的上下文**执行——多个 project 共用了同一个 Agent 会话，数据可能写错项目。

### 1.2 Decision

**会话即绑定（Conversation-scoped binding）**：每个 Agent 会话在**首次创建时**根据当时的导航层级快照出一个 `scope`，写入 `agent_conversations.meta.scope`。此后该会话的每一轮对话，**project 与页面上下文一律以 `meta.scope` 为唯一权威**，忽略请求体中的实时导航值。

会话与 project 一对多：一个 project 可有多个会话；一个会话只对应它创建时的那个 project，永不改变。History 列表列出该用户所有会话，并标注每条会话所属的 project 与 scope 层级。

### 1.3 Goals

| 目标 | 说明 |
|------|------|
| **G1** | 会话创建时快照 scope 至 `meta.scope`（四档：global / project / folder / table） |
| **G2** | 已存在会话的每一轮，后端从 `meta.scope` 解析 project 与页面上下文，丢弃 body 中的实时导航值 |
| **G3** | project 锁强校验：body.projectId 与会话 `project_id` 不一致时拒绝/忽略，杜绝错配 |
| **G4** | History 列表显示每条会话的所属 project 名 + scope 层级标识 |
| **G5** | ChatPanel 载入会话后，头部显示当前会话锁定的目标（project / folder / table） |
| **G6** | 现有 auto-execute、权限、RAG、多模态等行为不受影响 |

### 1.4 Non-Goals

- **不做「全局 global」档的实际跨-project 能力**（v1 范围）。见 §7 Deferred。global 档在 v1 仅作为一个**受限占位态**：会话可创建，但发消息时提示用户「此会话未绑定具体 project，请先进入一个 project」。真正的跨-project 查询/写入留待后续 spec。
- 不做多个 Agent 面板同时打开（仍单面板 + History 切换）。
- 不改 LLM prompt 中的业务规则（字段解析、rowIndex、引用字段等）。
- 不做会话 scope 的事后编辑（scope 一经创建即冻结；用户如需换 scope，新建会话）。
- 不改 `agent_messages` / `agent_pending_actions` / `agent_traces` 表结构。

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **scope** | 会话绑定的数据范围快照，存于 `agent_conversations.meta.scope` |
| **scope.level** | 四档层级：`global` \| `project` \| `folder` \| `table`，由粗到细 |
| **binding** | 会话运行时以 `meta.scope` 为权威、冻结实时导航的机制 |
| **live navigation** | 前端 `useNavigation()` 提供的实时 project/folder/library/section |
| **scope snapshot** | 会话首次创建时，从 live navigation 判定并写入 meta 的动作 |

---

## 3. Scope Model

### 3.1 四档层级判定（创建时快照）

依据会话**首次创建那一刻**的 live navigation，从细到粗判定 level：

```
若 currentLibraryId 存在        → level = 'table'
否则若 currentFolderId 存在      → level = 'folder'
否则若 currentProjectId 存在     → level = 'project'
否则                            → level = 'global'
```

### 3.2 scope 数据结构

存入 `agent_conversations.meta.scope`：

```typescript
interface ConversationScope {
  level: 'global' | 'project' | 'folder' | 'table';
  projectId?: string;      // level >= 'project' 时必填
  folderId?: string;       // level >= 'folder' 时必填
  folderName?: string;     // 快照当时的名称（用于展示，可能过期）
  libraryId?: string;      // level === 'table' 时必填
  libraryName?: string;    // 快照当时的名称
  sectionName?: string;    // 快照当时的 active section tab（可选）
}
```

**注意：** name 字段是创建时的展示快照，可能因后续重命名而过期。运行时以 id 为准解析实时名称（复用 `core.ts:buildSystemMessage` 中已有的 id→name 查询逻辑），name 快照仅用于 History 列表快速展示与降级 fallback。

### 3.3 各档运行时行为

| level | project 权威来源 | 传给 LLM 的页面上下文 | 备注 |
|-------|------------------|-----------------------|------|
| `table` | `scope.projectId` | folder + library + section（均来自 scope） | 最细，Agent 默认操作该表 |
| `folder` | `scope.projectId` | folder（来自 scope），library=none | Agent 默认操作该文件夹 |
| `project` | `scope.projectId` | 无 folder/library | Agent 操作范围为整个 project |
| `global` | 无 | 无 | **v1 受限**：见 §7，发消息前提示先选 project |

---

## 4. Backend Changes

### 4.1 Scope 快照（新会话）

`getOrCreateConversation`（`conversation-store.ts`）在**创建新会话**分支扩展：接收一个 `scope` 参数并写入 `meta.scope`。scope 由 API 路由从请求体的 live navigation 字段判定后传入。

```typescript
// route.ts POST — 仅当创建新会话（无 conversationId）时快照
const scope = resolveScopeFromNavigation({
  projectId: body.projectId,
  currentFolderId: body.currentFolderId,
  currentFolderName: body.currentFolderName,
  currentLibraryId: body.currentLibraryId,
  currentLibraryName: body.currentLibraryName,
  currentSectionName: body.currentSectionName,
});
```

`resolveScopeFromNavigation` 是一个纯函数（新文件 `src/lib/agent/scope.ts`），实现 §3.1 判定逻辑。

### 4.2 运行时以 scope 为权威（已存在会话）

`route.ts` POST 的核心改动：**区分新会话与已存在会话**。

```
if (无 conversationId) {
  // 新会话：快照 scope，ToolContext 用 live navigation（= 快照来源，两者一致）
} else {
  // 已存在会话：从 conversation.meta.scope 构造 ToolContext，
  // 忽略 body 中的 currentFolderId/currentLibraryId/... 实时值
}
```

已存在会话时，`ToolContext` 的 `projectId` / `currentFolderId` / `currentLibraryId` / `currentSectionName` 全部改从 `meta.scope` 读取。这是**冻结的关键落点**：DB 成为唯一权威，前端发不发实时 ctx 都不影响结果。

### 4.3 Project 锁强校验（G3）

`getOrCreateConversation` 对已有会话分支增强：

```typescript
if (params.conversationId) {
  const data = /* fetch */;
  if (data.user_id !== params.userId) throw new Error('Conversation does not belong to the current user.');
  // NEW: project 锁
  if (params.projectId && data.project_id !== params.projectId) {
    // 不报错中断，而是以会话绑定的 project_id 为准（防止错配，静默纠正）
    // 记录一条 warn 日志便于排查
    console.warn('agent.scope.project_mismatch', {
      conversationId: params.conversationId,
      boundProject: data.project_id,
      requestProject: params.projectId,
    });
  }
  return normalizeConversation(data);
}
```

**决策：静默纠正而非报错**——因为前端在 project A 载入 project B 的会话是合法操作（用户就是想继续那条对话），后端只需保证用会话绑定的 project 执行即可。

### 4.4 `/messages` 续聊路由同步

`conversations/[id]/messages/route.ts` 若也驱动 agent turn（续聊），须应用同样的「以 meta.scope 为权威」逻辑。实现时复用 §4.2 的同一构造函数，避免两个入口行为分叉。

> **实现注意：** 抽出一个共享函数 `buildToolContextForConversation(conversation, authed, liveBody?)`，POST 主路由与 messages 续聊路由都调用它，保证单一事实来源。

### 4.5 `resolveConversationMeta` 兼容

现有 `resolveConversationMeta`（`conversation-meta.ts`）负责解析 `autoExecute`。扩展它一并解析 `scope`（缺失时 `scope = undefined`，视为 legacy 会话）。

**Legacy 会话（无 meta.scope）降级策略：** 直接沿用会话的 `project_id` 作为 `level: 'project'`，页面上下文为空。即老会话表现为「绑定到 project、无更细 scope」，行为安全且不破坏历史数据。

---

## 5. Frontend Changes

### 5.1 发消息（`useAgentChat.ts` send）

- **新会话首条消息**：继续发送 live navigation 全字段（作为快照来源），行为不变。
- **已存在会话**：可继续发送 live 字段（后端会忽略），但更清晰的做法是**不再发送**这些字段，仅发 `conversationId` + `message`。推荐后者以明确「上下文由会话决定」的语义。

### 5.2 载入会话后恢复 scope 展示

`loadConversation` 拉取会话 meta 时，一并取回 `scope`，存入本地 state 供头部展示（§5.4）。复用现有 `/conversations/[id]/meta` 路由，扩展其返回体包含 `scope`。

### 5.3 History 列表标注 project + scope（G4）

`ConversationList.tsx` 已显示 `projectName`。扩展 `ConversationItem` 与 `listAllConversations` 的返回，附带 `scope.level` 与相应名称，在 meta 行渲染层级徽标：

```
{title}
{projectName} · {scopeBadge} · {updatedAt}
```

`scopeBadge` 示例：
- table：`📄 LibraryName`
- folder：`📁 FolderName`
- project：`📦 Project`（或省略，projectName 已表达）
- global：`🌐 Global`

`listAllConversations`（`conversation-store.ts:292`）的 `select` 已含 `meta`，仅需在映射时透出 `scope`。

### 5.4 ChatPanel 头部显示锁定目标（G5）

面板载入会话后，header 显示当前会话锁定的 scope（只读，不可改）：

```
Keco Assistant  🔒 ProjectA / 📁 FolderX
```

新会话（尚未创建，即将按当前导航快照）显示实时导航的预览目标，提示用户「本次将绑定到此」。

---

## 6. Data Model

**无表结构变更。** 仅在 `agent_conversations.meta`（jsonb）内新增 `scope` 键：

```jsonc
{
  "autoExecute": true,
  "scope": {
    "level": "table",
    "projectId": "uuid",
    "folderId": "uuid",
    "folderName": "Worldview",
    "libraryId": "uuid",
    "libraryName": "Characters",
    "sectionName": "Basic Info"
  }
}
```

向后兼容：无 `scope` 键的历史会话按 §4.5 降级为 `level: 'project'`。

---

## 7. Deferred: 「全局 global」档

v1 **不实现**跨-project 的实际能力。global 档的完整落地需要：

- 面板在无 `currentProjectId` 时也能开（当前 `ChatPanel.tsx:133` 直接 `return null`）。
- 后端 `route.ts:43` 放开对合法 `projectId` 的强制要求。
- 所有 tool 从「单 projectId 查询」改造为「跨用户可访问的多 project 查询」，并相应放开 RLS / 权限校验。

v1 行为：若会话 scope.level === 'global'（理论上仅当用户在无 project 上下文时创建，v1 UI 层面应尽量避免产生），发消息时后端返回明确错误提示「此会话未绑定具体项目，请进入一个项目后新建对话」。留待独立 spec（跨-project Agent）处理。

---

## 8. Edge Cases

| # | 场景 | 处理 |
|---|------|------|
| E1 | scope 绑定的 folder/library 事后被删除 | 运行时 id→name 查询失败，name 用快照 fallback；tool 调用返回「资源不存在」由 LLM 向用户说明 |
| E2 | scope 绑定的资源被重命名 | 运行时以 id 解析最新名称；History 徽标可能显示旧快照名（可接受，或列表加载时刷新） |
| E3 | Legacy 会话（无 meta.scope） | §4.5 降级为 `level: 'project'` |
| E4 | 用户在 project A 载入 project B 的会话续聊 | 后端以会话绑定的 project B 执行（§4.3 静默纠正）；缓存失效事件需指向 B 的 library |
| E5 | 新会话首条消息时用户无任何 project 上下文 | level = 'global'，触发 §7 v1 受限提示 |
| E6 | 写操作后的 cache 失效（`invalidateCache`） | 基于 scope 绑定的 libraryId，而非 live navigation |

---

## 9. Testing Strategy

### 9.1 Unit

- `resolveScopeFromNavigation`：四档判定的边界（各字段有无组合）。
- `resolveConversationMeta`：`scope` 解析 + legacy 降级。
- `buildToolContextForConversation`：已存在会话忽略 live body、以 meta.scope 为准。

### 9.2 Integration

1. 在 table 上下文创建会话 → meta.scope.level === 'table' 且 ids 正确。
2. 切到另一 project → 载入第 1 步会话续聊 → tool 调用命中原 project 的 library，而非当前 project。
3. project 锁：body.projectId 与会话不符 → 以会话绑定 project 执行 + warn 日志。
4. Legacy 会话（手动去除 meta.scope）→ 按 project 档运行，不报错。

### 9.3 Manual

- History 列表：多 project 会话各自显示正确 project 名 + scope 徽标。
- 载入会话 → 头部显示 🔒 锁定目标；切换 project 后头部不变。

---

## 10. Rollout

| Step | Action |
|------|--------|
| 1 | 上线 `resolveScopeFromNavigation` + 新会话写 `meta.scope` |
| 2 | 上线「已存在会话以 meta.scope 为权威」+ project 锁校验 |
| 3 | 上线 History 徽标 + 头部锁定目标展示 |
| 4 | Legacy 会话经降级路径平滑过渡，无需数据迁移 |

**无破坏性变更、无数据迁移**：历史会话通过 §4.5 降级路径兼容。

---

## 11. Open Questions

| # | Question | Decision |
|---|----------|----------|
| Q1 | 已存在会话续聊时前端是否仍发 live navigation 字段？ | 推荐不发（§5.1），后端无论如何以 meta.scope 为准 |
| Q2 | project 锁不一致时报错还是静默纠正？ | **Locked: 静默纠正**（§4.3），载入他 project 会话续聊是合法操作 |
| Q3 | scope 是否允许事后编辑？ | **Locked: No**，一经创建即冻结，换 scope 请新建会话 |
| Q4 | global 档 v1 是否可创建？ | v1 尽量在 UI 层避免产生；若产生则受限提示（§7） |
| Q5 | name 快照过期如何处理？ | 运行时以 id 解析最新名；徽标容忍旧名（E2） |

---

## 12. Success Criteria

- [ ] 新会话创建时正确写入 `meta.scope`，四档判定符合 §3.1
- [ ] 已存在会话续聊时，project 与页面上下文以 `meta.scope` 为准，切换 project 不影响
- [ ] 在 project A 载入 project B 会话续聊，tool 命中 project B 的数据
- [ ] History 列表每条会话显示所属 project 名 + scope 层级徽标
- [ ] ChatPanel 头部显示当前会话锁定目标
- [ ] Legacy 会话（无 meta.scope）不报错，按 project 档运行
- [ ] auto-execute / 权限 / RAG / 多模态 行为回归无变化
