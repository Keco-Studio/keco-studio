# 协作功能（Collaboration）代码梳理文档

本文档梳理与 **Collaboration 协作** 相关的所有代码逻辑：每块代码的职责、涉及文件、以及彼此如何协作。便于接手同事离职后的功能维护与扩展。

---

## 一、协作功能整体架构

协作分为两大块：

1. **项目级协作（成员与权限）**：邀请协作者、角色（admin/editor/viewer）、权限控制、邀请接受/拒绝。
2. **库内实时协作（表格编辑）**：多人同时编辑同一 Library 的资产表格——实时单元格更新、增删行、在线状态与“谁在编辑哪一格”的展示。

数据流与层次关系（简化）：

```
页面 [projectId]/[libraryId]/page.tsx
  → LibraryDataProvider（单库数据 + 实时 + 在线）
  → YjsProvider（仅表格行顺序本地缓存）
  → LibraryAssetsTableAdapter（Context → Table 的桥接）
  → LibraryAssetsTable（表格 UI + useYjsSync + 各种 hooks）
```

- **数据真相源**：`LibraryDataContext` 的 `assets`（来自 Yjs `yAssets` Map）和按 `created_at` 排序的 `allAssets`。
- **行顺序与“在上方/下方插入”**：顺序以 `allAssets` 为准；表格侧用 `yRows` + `useYjsSync` 做本地占位与同步，保证插入位置正确。

---

## 二、类型与约定（Types）

**文件**：`src/lib/types/collaboration.ts`

**作用**：定义协作相关的 TypeScript 类型和常量。

| 内容 | 说明 |
|------|------|
| `CollaboratorRole` | `'admin' \| 'editor' \| 'viewer'` |
| `ROLE_PERMISSIONS` | 各角色能否邀请、管理成员、编辑、查看 |
| `Collaborator` | 协作者信息（id, userId, userName, role, invitedAt 等） |
| `PendingInvitation` | 待接受邀请 |
| `InvitationTokenPayload` | JWT 邀请 token 载荷（invitationId, projectId, email, role, exp） |
| `PresenceState` | 在线状态：userId, userName, activeCell, cursorPosition, lastActivity, connectionStatus |
| `CellUpdateEvent` | 单元格更新广播：assetId, propertyKey, newValue, oldValue, timestamp, userId 等 |
| `AssetCreateEvent` | 资产创建广播：assetId, assetName, propertyValues, insertBeforeRowId/insertAfterRowId, targetCreatedAt |
| `AssetDeleteEvent` | 资产删除广播 |
| `OptimisticUpdate` | 本地乐观更新追踪（用于冲突判断） |
| API 入参/出参类型 | `SendInvitationInput/Output`、`GetCollaboratorsOutput` 等 |
| 工具函数 | `canUserInviteWithRole`, `canUserEdit` 等 |

**被谁用**：所有协作相关 Context、hooks、Service、Server Actions、UI 组件。

---

## 三、项目级协作（成员与邀请）

### 3.1 Collaboration Service

**文件**：`src/lib/services/collaborationService.ts`

**作用**：项目协作者与邀请的**业务逻辑与数据库操作**（不直接管实时编辑）。

| 功能 | 说明 |
|------|------|
| `sendInvitation` | 发送邀请：校验本人/已存在协作者、生成 JWT、写 `project_invitations`、发邮件 |
| `getProjectCollaborators` | 查询某项目的协作者列表 + 待处理邀请 |
| `getUserProjectRole` | 查询用户在某项目的角色（含是否 owner） |
| `acceptInvitation`（内部/Service Role） | 接受邀请：校验 token、写 `project_collaborators`、更新/删除邀请 |
| `removeCollaborator` / `updateCollaboratorRole` | 移除协作者、更新角色（RLS 下由有权限用户调用） |

**依赖**：`@/lib/types/collaboration`、`invitationToken`、`emailService`。  
**注意**：需要管理员/服务端能力的操作通过 **Server Actions** 调用，避免在前端用 Service Role。

### 3.2 Collaboration Server Actions

**文件**：`src/lib/actions/collaboration.ts`

**作用**：Next.js **Server Actions**，带 CSRF 保护与服务端鉴权，供前端表单/按钮调用。

| Action | 说明 |
|--------|------|
| `sendCollaborationInvitation` | 校验输入 → 取当前用户 → 调 `sendInvitation` → revalidatePath |
| `getCollaborators` | 调 `getProjectCollaborators` |
| `getUserRole` | 调 `getUserProjectRole` |
| `updateCollaboratorRole` | 校验权限 → 更新角色 |
| `removeCollaborator` | 校验权限 → 移除协作者 |
| `acceptInvitationByToken` | 用 token 接受邀请（可能用 Service Role） |

**依赖**：`collaborationService`、`createClient`（服务端 Supabase）、`@/lib/types/collaboration`。

### 3.3 相关 UI 与页面

- **邀请/成员管理**：`InviteCollaboratorModal`、`CollaboratorsList`、`CollaboratorsContent`、`AcceptInvitationContent`、接受/拒绝邀请页面等。
- **权限 Hook**：`useCollaboratorPermissions`、`useUserRole`（表格内根据角色禁用编辑等）。

以上共同实现“谁可以访问项目、以什么角色、谁邀请了谁”。

---

## 四、库内实时协作（表格一起改）

核心：**Yjs（本地状态 + 持久化）+ Supabase Realtime（广播 + Postgres Changes）**。

### 4.1 LibraryDataContext（单库数据与实时入口）

**文件**：`src/lib/contexts/LibraryDataContext.tsx`

**作用**：当前 Library 的**唯一数据源**与实时协作入口。对外提供：资产 Map、有序 `allAssets`、增删改接口、连接状态、Presence、Yjs 访问。

| 模块 | 说明 |
|------|------|
| **Yjs 结构** | `yDoc`、`yAssets`（Y.Map<assetId, Y.Map<name, propertyValues, created_at>>） |
| **React 状态** | `assets` 由 `yAssets.observeDeep` 同步；`allAssets = Array.from(assets).sort(created_at)` |
| **初始加载** | `loadInitialData`：读 Supabase `library_assets` + `library_asset_values`，写入 `yAssets` |
| **持久化** | `IndexeddbPersistence('library-${libraryId}', yDoc)`，synced 时也会触发一次 `loadInitialData`（保证恢复后与服务器一致） |
| **单元格更新** | `updateAssetField`：先改 Yjs → 再写 DB → 再 `broadcastCellUpdate`（可选 skipBroadcast） |
| **名称更新** | `updateAssetName`：同上，写 `library_assets` + broadcast |
| **创建资产** | `createAsset`：插 DB → 写 `yAssets`（含 created_at）→ `broadcastAssetCreate`（可带 insertBeforeRowId/insertAfterRowId, targetCreatedAt） |
| **删除资产** | `deleteAsset`：删 DB → 删 yAssets → `broadcastAssetDelete` |
| **批量更新** | `updateMultipleFields`：先全部 `updateAssetField(..., { skipBroadcast: true })`，再逐条 broadcast |
| **收广播** | 通过 `useRealtimeSubscription` 的 onCellUpdate / onAssetCreate / onAssetDelete 写回 Yjs |
| **冲突** | 当前策略：远程优先（onConflict 里调 onCellUpdate） |
| **Presence** | 使用 `usePresenceTracking`，对外暴露 `getUsersEditingField`、`setActiveField`、`presenceUsers` |

**依赖**：`useRealtimeSubscription`、`usePresenceTracking`、`Y`、Supabase、Auth。

### 4.2 useRealtimeSubscription（Supabase 频道与广播）

**文件**：`src/lib/hooks/useRealtimeSubscription.ts`

**作用**：管理**一个 Library 一个**的 Supabase Realtime 频道，负责：发广播、收广播、收 DB 变更、冲突检测、连接状态、断线重连、队列未发更新。

| 功能 | 说明 |
|------|------|
| **频道** | `supabase.channel('library:${libraryId}:edits', { broadcast: { ack: false } })` |
| **发送** | `broadcastCellUpdate`（debounce 500ms，复杂对象立即）、`broadcastAssetCreate`、`broadcastAssetDelete` |
| **接收广播** | `broadcast` 事件：`cell:update` → handleCellUpdateEvent；`asset:create` / `asset:delete` → 对应 handler |
| **忽略自己** | 通过 `event.userId === currentUserId` 过滤自己的广播 |
| **冲突** | 若存在本地 optimistic 且 remote 更新更晚，则调用 `onConflict(event, localValue)`（当前实现里即用远程覆盖） |
| **Postgres 兜底** | 订阅 `library_asset_values` 的 INSERT/UPDATE、`library_assets` 的 INSERT/UPDATE/DELETE，转成合成 CellUpdateEvent/AssetCreateEvent/AssetDeleteEvent 再交给同一批 handler，保证广播没到时也能通过 DB 变更同步 |
| **防重复** | 用 `recentBroadcastsRef` 在短时间窗口内忽略“自己写 DB 触发的 postgres_changes” |
| **连接状态** | `connectionStatus`：connecting / connected / disconnected / reconnecting；CHANNEL_ERROR 时 2 秒后重连 |
| **队列** | 断线时把要发的更新放进 `queuedUpdates`，重连后 `processQueuedUpdates` 再发 |

**依赖**：`@/lib/types/collaboration`、Supabase、父组件传入的 onCellUpdate/onAssetCreate/onAssetDelete/onConflict。

### 4.3 usePresenceTracking（谁在、在编辑哪一格）

**文件**：`src/lib/hooks/usePresenceTracking.ts`

**作用**：同一 Library 下的**在线状态**与**当前编辑格**（activeCell）/ 光标位置。

| 功能 | 说明 |
|------|------|
| **频道** | `supabase.channel('library:${libraryId}:presence', { presence: { key: userId } })` |
| **状态** | PresenceState：userId, userName, activeCell { assetId, propertyKey }, cursorPosition, lastActivity, connectionStatus |
| **更新** | `updateActiveCell(assetId, propertyKey)`、`updateCursorPosition(row, col)`（节流） |
| **同步** | presence sync/join/leave 时合并 state，得到 `presenceUsers`（不含自己） |
| **查询** | `getUsersEditingCell(assetId, propertyKey)`、`getActiveUsers()` |

**被谁用**：LibraryDataContext 内使用，对外暴露 `setActiveField`（即 updateActiveCell）和 `getUsersEditingField`（即 getUsersEditingCell）。表格获得这些方法后，在单元格 focus 时上报、在单元格上展示“谁正在编辑”。

### 4.4 PresenceContext（可选封装）

**文件**：`src/lib/contexts/PresenceContext.tsx`

**作用**：用 `usePresenceTracking` 包一层，按 `libraryId` 提供 Presence 给子树。当前库页若已用 LibraryDataContext，Presence 主要由 Context 提供；PresenceContext 可用于其它需要“只看在线状态”的界面。

---

## 五、表格行顺序与“插入在上/下”（Yjs 行缓存 + Sync）

表格侧需要：  
- 顺序与 `LibraryDataContext.allAssets` 一致（按 `created_at`）；  
- “在某一行上方/下方插入”时，本地先显示占位行，等真实行从服务端回来再替换占位，且**位置要对**（不能插到表头）。

为此引入：**Yjs 的 yRows（仅作本地行列表缓存）+ useYjsSync（把 allAssets 与 yRows 对齐）**。

### 5.1 YjsContext（表格用 Y.Doc + yRows）

**文件**：`src/lib/contexts/YjsContext.tsx`

**作用**：按 `libraryId` 提供一个独立的 `Y.Doc` 和 `yRows = ydoc.getArray('rows')`，并做 **IndexedDB 持久化**（`asset-table-${libraryId}`）。  
不负责“行从哪来”：只提供空数组，由 useYjsSync 根据 `rows`（即 allAssets）往里同步。

**被谁用**：库页用 `YjsProvider(libraryId)` 包住表格；表格内 `useYjs()` 取 `yRows` 传给 `useYjsSync`。

### 5.2 useYjsRows

**文件**：`src/lib/hooks/useYjsRows.ts`

**作用**：对 `Y.Array` 做 `observe`，返回当前 `yRows.toArray()` 的 React 状态快照，用于只读展示。

### 5.3 useYjsSync（核心：行顺序与占位替换）

**文件**：`src/components/libraries/hooks/useYjsSync.ts`

**入参**：`rows`（来自 LibraryDataContext 的 allAssets）、`yRows`（YjsContext 的 Y.Array）。

**设计**：  
- **顺序以 rows（allAssets）为准**；yRows 只是本地缓存/占位载体。  
- 无占位时：直接用 `rows` 作为展示源，并把 yRows 同步成和 rows 一致（全量替换或仅内容更新）。  
- 有占位时（本地刚“在上/下插入”的 temp-insert-* / temp-paste-*）：展示用 yjsRows，等 `rows[K]` 出现新行时，用该新行替换 yRows 里第 K 位的占位；若新行没有对应占位（例如协作者那边新建的行），则整表用 `rows` 全量替换 yRows 再展示 rows。

**逻辑摘要**：

1. **初始化**：若 yRows 空且 rows 非空，直接 `yRows.insert(0, rows)`。
2. **无 placeholder**：  
   - 若集合或顺序与 rows 不同：清空 yRows，`yRows.insert(0, rows)`。  
   - 否则：只对内容有变的行做 delete+insert 更新，保证索引稳定。
3. **有 placeholder**：  
   - 找出所有“新行”（在 rows 里但不在当前 yRows 的 id 集合里）。  
   - 找出所有 temp 占位及其下标 K。  
   - 从高索引到低索引，若 `rows[K]` 是某条新行，则用该行替换 yRows 的 K 位。  
   - 剩余“无占位对应”的新行：清空 yRows，`yRows.insert(0, rows)`。
4. **展示用谁**：`allRowsSource`：有 placeholder 且（yRows 去掉 temp 后的 id 集合与顺序）与 rows 一致时用 yjsRows，否则用 rows，避免 IndexedDB 里旧 temp 导致顺序错乱。

**被谁用**：LibraryAssetsTable 内：`rows` 来自 Adapter（即 allAssets），`yRows` 来自 useYjs()，`allRowsSource` 作为表格实际数据源。

### 5.4 插入行时“位置”的保证（created_at）

“在第二行 45 上方插入”要插在正确位置，需要 **allAssets 排序** 时新行就在目标行上方。  
`allAssets` 按 `created_at` 升序，因此：

- **useRowOperations**（插入上方/下方）里会为待插入行计算 `created_at`，使其**严格落在“目标上一行”和“目标行”之间**（多行则在该区间内等分），这样 sort 后新行就会紧贴目标行上方，不会跑到表头。  
- LibraryDataContext 的 `createAsset` 会把这个 `created_at` 写入 Yjs 并传给 `broadcastAssetCreate` 的 `targetCreatedAt`，协作者端用该时间写入 Yjs，保证两边顺序一致。

---

## 六、表格 UI 与协作的衔接

### 6.1 LibraryAssetsTableAdapter

**文件**：`src/components/libraries/LibraryAssetsTableAdapter.tsx`

**作用**：把 LibraryDataContext 的接口转成 LibraryAssetsTable 的 props。

| 适配 | 说明 |
|------|------|
| rows | 使用 `allAssets` 映射成表格行（或 overrideRows，如版本快照） |
| onSaveAsset | → Context 的 `createAsset` |
| onUpdateAsset / onUpdateAssets | → 单条/批量 `updateAssetName` + `updateAssetField` |
| onDeleteAsset / onDeleteAssets | → Context 的 `deleteAsset` |
| currentUser | 从 Auth 取，带 avatarColor |
| enableRealtime | 固定 true |
| presenceTracking | `{ updateActiveCell: setActiveField, getUsersEditingCell: getUsersEditingField }` |

页面层：LibraryDataProvider 已包住整页，Adapter 在 YjsProvider 内渲染 Table，所以 Table 拿到的 rows 来自 Context，yRows 来自 YjsContext。

### 6.2 LibraryAssetsTable

**文件**：`src/components/libraries/LibraryAssetsTable.tsx`

**作用**：表格主体 UI。协作相关要点：

- 使用 **useYjs()** 取 `yRows`，**useYjsSync(rows, yRows)** 得到 `allRowsSource`，后续行数据用 `allRowsSource`（以及 resolved rows、deleted 等）。
- 把 `presenceTracking` 传给单元格：focus 时 `updateActiveCell(assetId, propertyKey)`，单元格内用 `getUsersEditingCell` 显示谁在编辑（如 CellPresenceAvatars）。
- 连接状态可来自 Context（若暴露）或 Realtime 的 connectionStatus，用于 ConnectionStatusIndicator。
- 行操作（插入上/下、删除、批量编辑等）通过 **useRowOperations** 调用 Context 的 createAsset/deleteAsset 等，并操作 yRows（如插入 temp 占位）。

### 6.3 useRowOperations（插入上/下、删除、批量）

**文件**：`src/components/libraries/hooks/useRowOperations.ts`

**作用**：实现“在选中行上方/下方插入 N 行”、“删除选中行”、“批量编辑”等。协作相关：

- **插入上方**：计算目标行的上一行与目标行的 `created_at`，在中间等分得到新行的 `created_at`；先往 yRows 里 `insert(targetRowIndex, [tempRow])`（temp-insert-above-*），再调 Context 的 createAsset（带 createdAt、insertBeforeRowId），并 broadcastAssetCreate（insertBeforeRowId, targetCreatedAt）；乐观 UI 用 temp 占位，等服务端回来新行后由 useYjsSync 用 rows[K] 替换占位。
- **插入下方**：同理，用 insertAfterRowId 和比目标行晚的 created_at。
- 删除：调 Context deleteAsset，并 broadcast（在 Context 内完成）。

### 6.4 useCellEditing

**文件**：`src/components/libraries/hooks/useCellEditing.ts`

**作用**：单元格编辑状态、校验、保存。保存时调用 `onUpdateAsset`（即 Context 的 update），并可能直接改 yRows（如内联更新某一格）；focus 时通过 `presenceTracking.updateActiveCell` 上报当前格，实现“谁在编辑哪一格”。

### 6.5 useClickOutsideAutoSave / useClipboardOperations 等

**文件**：如 `useClickOutsideAutoSave.ts`、`useClipboardOperations.ts`

**作用**：失焦保存、粘贴等会调用 Context 的 updateAssetField / updateMultipleFields 等，从而走 Yjs + DB + broadcast；粘贴插入行时也会往 yRows 插 temp 占位并调 createAsset，逻辑与“插入上方”类似，保证顺序和占位替换一致。

---

## 七、Realtime 与 Presence 的 UI

- **ConnectionStatusIndicator**：展示 `connectionStatus`（connecting/connected/disconnected/reconnecting）和可选的 queuedUpdatesCount。  
- **StackedAvatars / PresenceIndicators**：展示当前库内在线用户。  
- **CellPresenceAvatars**：在单元格内展示正在编辑该格的用户（来自 getUsersEditingCell）。

数据来源：LibraryDataContext 的 connectionStatus、presenceUsers，以及 Table 传入的 presenceTracking。

---

## 八、realtimeService、sharedDocumentService

- **realtimeService**（`src/lib/services/realtimeService.ts`）：提供事件校验、构造 payload、连接状态文案/颜色等工具函数，给 useRealtimeSubscription 和 ConnectionStatusIndicator 用。  
- **sharedDocumentService**：操作 `shared_documents` 表，用于“共享文档”类功能（如富文本协作），与当前**库资产表格协作**无直接耦合。

---

## 九、数据流小结（库内实时编辑）

1. **读**：LibraryDataContext 从 Supabase 加载初始数据 → 写入 Yjs `yAssets` → observeDeep 驱动 `assets` → `allAssets` 排序后给 Adapter → Table 的 `rows` = allAssets（或 override）；Table 内 useYjsSync(rows, yRows) 得到 `allRowsSource`，再经 useResolvedRows 等得到最终展示行。
2. **写（单元格）**：用户编辑 → updateAssetField → Yjs 更新 → DB 写入 → broadcastCellUpdate；其他人通过 broadcast 或 postgres_changes 收到 → handleCellUpdateEvent → 写 Yjs → UI 更新。
3. **写（新行）**：插入上/下 → 算 created_at、插 temp 到 yRows、createAsset + broadcastAssetCreate；服务端插入 DB → 本端 Yjs 已有（createAsset 里写的）；协作者通过 broadcast 或 library_assets INSERT 收到 → handleAssetCreateEvent → 写 Yjs；useYjsSync 用 rows[K] 替换本地 temp 占位。
4. **删行**：deleteAsset → DB 删除 → 删 Yjs → broadcastAssetDelete；其他人收到后从 Yjs 删对应项。
5. **Presence**：focus 单元格时 setActiveField(assetId, propertyKey)；Presence 频道同步；getUsersEditingCell 供单元格展示头像等。

---

## 十、文件索引（按职责）

| 职责 | 文件 |
|------|------|
| 类型定义 | `src/lib/types/collaboration.ts` |
| 项目协作服务 | `src/lib/services/collaborationService.ts` |
| 协作 Server Actions | `src/lib/actions/collaboration.ts` |
| 库数据与实时入口 | `src/lib/contexts/LibraryDataContext.tsx` |
| 实时频道与广播 | `src/lib/hooks/useRealtimeSubscription.ts` |
| 在线与编辑格 | `src/lib/hooks/usePresenceTracking.ts`、`src/lib/contexts/PresenceContext.tsx` |
| 表格 Yjs 与行同步 | `src/lib/contexts/YjsContext.tsx`、`src/lib/hooks/useYjsRows.ts`、`src/components/libraries/hooks/useYjsSync.ts` |
| 表格桥接与 UI | `src/components/libraries/LibraryAssetsTableAdapter.tsx`、`src/components/libraries/LibraryAssetsTable.tsx` |
| 行/格操作 | `src/components/libraries/hooks/useRowOperations.ts`、`useCellEditing.ts`、`useClickOutsideAutoSave.ts`、`useClipboardOperations.ts` |
| 工具与 UI | `src/lib/services/realtimeService.ts`、`ConnectionStatusIndicator`、`PresenceIndicators`、`CellPresenceAvatars` |
| 页面与 Provider 挂载 | `src/app/(dashboard)/[projectId]/[libraryId]/page.tsx`（LibraryDataProvider、YjsProvider、Adapter） |

---

以上即协作相关代码的完整梳理：每块负责什么、依赖谁、数据如何流动，便于你后续维护和扩展。若你要针对某一块（例如只改“插入上方”或只改 Presence）做修改，可以按上述模块边界定位到对应文件与函数。
