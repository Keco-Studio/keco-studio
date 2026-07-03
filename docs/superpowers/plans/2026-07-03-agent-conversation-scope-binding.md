# Agent 会话 Project/Scope 绑定 Implementation Plan

**Goal:** 让每个 Agent 会话在创建时冻结其所属 project 与数据范围（scope），运行时以会话绑定值为唯一权威，不再随前端实时导航漂移；History 列表与面板头部展示所属 project 与 scope 层级。

**Architecture:** 会话首次创建时按当时导航层级（table/folder/project/global）快照出 `scope`，存入 `agent_conversations.meta.scope`（jsonb，无表结构变更）。已存在会话续聊时，后端 `POST /api/agent-chat` 从 `meta.scope` 构造 `ToolContext`，忽略请求体的实时导航值。续聊唯一入口即主 POST 路由（`/messages` 仅 GET 拉历史，不驱动 turn）。全局档 v1 受限（不做跨-project）。

**Tech Stack:** TypeScript, Next.js App Router, Supabase (jsonb meta), Jest

**Spec:** `docs/superpowers/specs/2026-07-03-agent-conversation-scope-binding-design.md`

---

## Key Findings（编码前已核实）

- 续聊唯一入口是 `POST /api/agent-chat`（带 `conversationId`）；`conversations/[id]/messages/route.ts` 只有 GET，不驱动 agent turn → spec §4.4 简化为单入口。
- `metaForSave`（`conversation-meta.ts:50`）当前只返回 `{ autoExecute }`，创建会话写 meta 时会覆盖 scope → 创建路径需**合并** autoExecute + scope。
- `resolveConversationMeta`（`conversation-meta.ts:8`）当前只解析 `autoExecute`，需扩展透出 `scope`。
- `getOrCreateConversation`（`conversation-store.ts:55`）已有「已存在会话」与「新建」两分支，是快照与 project 锁的落点。
- `ConversationList` 已显示 `projectName`，`listAllConversations` 的 select 已含 `meta` → 徽标仅需透出 `scope.level`。

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/agent/scope.ts` | `ConversationScope` 类型、`resolveScopeFromNavigation`、`buildContextFromScope` |
| Modify | `src/lib/agent/types.ts` | `ConversationMeta` 增加 `scope?`；导出 `ConversationScope` |
| Modify | `src/lib/agent/conversation-meta.ts` | `resolveConversationMeta` 透出 scope；`metaForSave` 支持合并 scope |
| Modify | `src/lib/agent/conversation-store.ts` | `getOrCreateConversation` 快照 scope + project 锁；list 映射透出 scope |
| Modify | `src/app/api/agent-chat/route.ts` | 新会话快照 scope；已存在会话以 meta.scope 构造 ToolContext |
| Modify | `src/app/api/agent-chat/conversations/[id]/meta/route.ts` | GET meta 返回体已含 scope（meta 透传即可，确认无需改） |
| Modify | `src/components/agent/types.ts` | `SendContext` 无需改；新增前端 scope 展示类型（如需要） |
| Modify | `src/components/agent/ConversationList.tsx` | 渲染 scope 层级徽标 |
| Modify | `src/components/agent/useAgentChat.ts` | 续聊不再发 live navigation；载入会话取回 scope |
| Modify | `src/components/agent/ChatPanel.tsx` | 头部显示 🔒 锁定目标 |
| Create | `tests/unit/agent/scope.test.ts` | `resolveScopeFromNavigation` + `buildContextFromScope` 单测 |
| Modify | `tests/unit/agent/*` (meta) | `resolveConversationMeta` scope 解析 + legacy 降级 |

---

## Task 1: Scope 类型与纯函数（`scope.ts`）

**Files:** Create `src/lib/agent/scope.ts`; Modify `src/lib/agent/types.ts`

- [ ] **Step 1: 在 `types.ts` 定义 `ConversationScope` 并扩展 `ConversationMeta`**

```typescript
export type ScopeLevel = 'global' | 'project' | 'folder' | 'table';

export interface ConversationScope {
  level: ScopeLevel;
  projectId?: string;
  folderId?: string;
  folderName?: string;
  libraryId?: string;
  libraryName?: string;
  sectionName?: string;
}

// 在 ConversationMeta 内新增：
//   scope?: ConversationScope;
```

- [ ] **Step 2: 新建 `src/lib/agent/scope.ts`**

实现两个纯函数：

```typescript
import type { ConversationScope } from './types';

interface NavigationInput {
  projectId?: string;
  currentFolderId?: string;
  currentFolderName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
  currentSectionName?: string;
}

/** §3.1 由细到粗判定 scope level。 */
export function resolveScopeFromNavigation(nav: NavigationInput): ConversationScope {
  if (nav.currentLibraryId) {
    return {
      level: 'table',
      projectId: nav.projectId,
      folderId: nav.currentFolderId,
      folderName: nav.currentFolderName,
      libraryId: nav.currentLibraryId,
      libraryName: nav.currentLibraryName,
      sectionName: nav.currentSectionName,
    };
  }
  if (nav.currentFolderId) {
    return { level: 'folder', projectId: nav.projectId, folderId: nav.currentFolderId, folderName: nav.currentFolderName };
  }
  if (nav.projectId) {
    return { level: 'project', projectId: nav.projectId };
  }
  return { level: 'global' };
}

/** 从会话绑定的 scope 构造 ToolContext 的导航字段（§4.2）。legacy 无 scope 时降级为 project 档。 */
export function contextFieldsFromScope(
  scope: ConversationScope | undefined,
  fallbackProjectId: string
): Pick<ToolContext, 'projectId' | 'currentFolderId' | 'currentFolderName' | 'currentLibraryId' | 'currentLibraryName' | 'currentSectionName'> {
  if (!scope) {
    return { projectId: fallbackProjectId }; // §4.5 legacy → project 档
  }
  return {
    projectId: scope.projectId ?? fallbackProjectId,
    currentFolderId: scope.folderId,
    currentFolderName: scope.folderName,
    currentLibraryId: scope.libraryId,
    currentLibraryName: scope.libraryName,
    currentSectionName: scope.sectionName,
  };
}
```

- [ ] **Step 3: 单测 `tests/unit/agent/scope.test.ts`**

覆盖：table/folder/project/global 四档判定；无 scope 降级；scope.projectId 缺失时用 fallback。

```bash
cd /home/hetu/project/keco-studio && npx jest tests/unit/agent/scope.test.ts
```

Expected: 全部通过。

---

## Task 2: Meta 解析与保存合并 scope

**Files:** Modify `src/lib/agent/conversation-meta.ts`

- [ ] **Step 1: `resolveConversationMeta` 透出 scope**

保留 autoExecute 逻辑，附带原样透传 `raw.scope`：

```typescript
export function resolveConversationMeta(raw): ConversationMeta {
  const autoExecute = raw?.autoExecute === false ? false : true; // 现有语义
  const resolved: ConversationMeta = { autoExecute };
  if (raw?.scope) resolved.scope = raw.scope;
  return resolved;
}
```

（保持现有 skipConfirmation 兼容分支不变。）

- [ ] **Step 2: `metaForSave` 支持合并 scope**

```typescript
export function metaForSave(autoExecute: boolean, scope?: ConversationScope): ConversationMeta {
  return scope ? { autoExecute, scope } : { autoExecute };
}
```

- [ ] **Step 3: 单测更新**

`resolveConversationMeta`：有/无 scope；legacy（无 scope + 无 autoExecute）→ `{autoExecute:true}` 无 scope。

```bash
cd /home/hetu/project/keco-studio && npx jest tests/unit/agent
```

---

## Task 3: 会话创建快照 scope + project 锁

**Files:** Modify `src/lib/agent/conversation-store.ts`

- [ ] **Step 1: `getOrCreateConversation` 新增 `scope` 参数，创建时合并写入 meta**

```typescript
params: { conversationId?; userId; projectId; initialAutoExecute?; scope?: ConversationScope }
// 新建分支：
const initialMeta = metaForSave(params.initialAutoExecute ?? true, params.scope);
```

- [ ] **Step 2: 已存在会话分支加 project 锁（静默纠正 + warn，§4.3）**

在返回前，若 `params.projectId && data.project_id !== params.projectId` → `console.warn('agent.scope.project_mismatch', {...})`。不抛错。

- [ ] **Step 3: `mapConversationListRow` 透出 scope**

`ConversationListItem` 已含 `meta`（经 `resolveConversationMeta`）；确认 scope 已随 meta 透出。若前端更方便，额外平铺一个 `scopeLevel` 字段。

- [ ] **Step 4: 编译检查**

```bash
cd /home/hetu/project/keco-studio && npx tsc --noEmit
```

---

## Task 4: 主 POST 路由——快照与绑定

**Files:** Modify `src/app/api/agent-chat/route.ts`

- [ ] **Step 1: 判定新会话 vs 已存在会话**

- 无 `body.conversationId` → 新会话：`scope = resolveScopeFromNavigation(body)`，传入 `getOrCreateConversation`；`ToolContext` 用 live body（与快照一致）。
- 有 `body.conversationId` → 已存在会话：`getOrCreateConversation` 取回 conversation，`const scope = resolveConversationMeta(conversation.meta).scope`；`ToolContext` 的导航字段用 `contextFieldsFromScope(scope, conversation.project_id)`，**忽略 body 的 folder/library/section**。

- [ ] **Step 2: global 档 v1 受限（§7）**

已存在会话且 `scope?.level === 'global'`（或新会话判定为 global）→ 返回 400：
`{ error: '此会话未绑定具体项目，请进入一个项目后新建对话。' }`

- [ ] **Step 3: projectId 校验适配**

已存在会话时，projectId 以会话绑定为准；body.projectId 的 UUID 校验仅用于新会话路径。

- [ ] **Step 4: 编译 + 冒烟**

```bash
cd /home/hetu/project/keco-studio && npx tsc --noEmit && npm run build
```

---

## Task 5: 前端——续聊不发实时导航 + 载入取回 scope

**Files:** Modify `src/components/agent/useAgentChat.ts`

- [ ] **Step 1: `send` 区分新/续聊**

`conversationIdRef.current` 存在（续聊）时，body 只发 `conversationId` + `message` + `imageUrls`，不发 folder/library/section（§5.1 推荐）。新会话首条仍发全字段作快照来源。

- [ ] **Step 2: 载入会话取回 scope 存 state**

`loadConversation` 中 `fetchConversationMeta` 已请求 `/meta`；扩展其解析出 `scope`，通过新增的 `scope` state 暴露给 ChatPanel。新增 hook 返回值 `activeScope`。

- [ ] **Step 3: 编译检查**

```bash
cd /home/hetu/project/keco-studio && npx tsc --noEmit
```

---

## Task 6: History 徽标 + 面板头部锁定目标

**Files:** Modify `src/components/agent/ConversationList.tsx`, `src/components/agent/ChatPanel.tsx`, `ChatPanel.module.css`

- [ ] **Step 1: `ConversationList` 渲染 scope 徽标（§5.3）**

`ConversationItem` 增加 `scope?: { level; folderName?; libraryName? }`（从 `/conversations?scope=all` 返回体透出）。meta 行渲染：
- table → `📄 {libraryName}`；folder → `📁 {folderName}`；project → 省略；global → `🌐 Global`。

- [ ] **Step 2: `ChatPanel` 头部显示锁定目标（§5.4）**

载入会话后用 `activeScope` 渲染 `🔒 {projectName} / {scopeBadge}`（只读）。新会话显示实时导航预览（提示「本次将绑定到此」）。

- [ ] **Step 3: 样式**

在 `ChatPanel.module.css` 加徽标/锁定标签样式，复用现有 `convMeta` 风格。

- [ ] **Step 4: 编译 + build**

```bash
cd /home/hetu/project/keco-studio && npm run build
```

---

## Task 7: 集成验证与回归

- [ ] **Step 1: 单测全绿**

```bash
cd /home/hetu/project/keco-studio && npx jest tests/unit/agent
```

- [ ] **Step 2: 手动验证（§9.2 / §9.3）**

1. 在某 table 上下文新建会话发消息 → DB `meta.scope.level === 'table'`，ids 正确。
2. 切到另一 project → History 载入第 1 步会话续聊 → tool 命中**原** project 的 library。
3. project 锁：构造 body.projectId 与会话不符 → 以会话 project 执行 + warn 日志。
4. Legacy 会话（手动删除 meta.scope）→ 按 project 档运行，不报错。
5. History 列表：多 project 会话各显示正确 project 名 + scope 徽标。
6. 载入会话 → 头部 🔒 锁定目标；切 project 后头部不变。

- [ ] **Step 3: 回归**

auto-execute（Auto/Confirm 切换）、权限（Viewer 不可写）、RAG、多模态图片上传 行为无变化。

- [ ] **Step 4: 清理临时文件，最终 build**

```bash
cd /home/hetu/project/keco-studio && npm run build
```

---

## Success Criteria（对齐 spec §12）

- [ ] 新会话创建时正确写入 `meta.scope`，四档判定符合规则
- [ ] 已存在会话续聊以 `meta.scope` 为准，切换 project 不影响
- [ ] project A 载入 project B 会话续聊，tool 命中 project B 数据
- [ ] History 每条会话显示所属 project 名 + scope 徽标
- [ ] ChatPanel 头部显示当前会话锁定目标
- [ ] Legacy 会话（无 meta.scope）不报错，按 project 档运行
- [ ] auto-execute / 权限 / RAG / 多模态 回归无变化

---

## Notes

- **无数据库迁移、无破坏性变更**：scope 存于既有 `meta` jsonb，历史会话经降级路径兼容。
- **Language rule:** 代码/注释英文；面向用户的错误文案与 UI 文案中文（如 global 受限提示、锁定徽标）。
- **Commit:** 每个 Task 完成且 build/测试通过后再提交；当前分支 `debug`，如需推送另建 feature 分支，不直接推 main。
