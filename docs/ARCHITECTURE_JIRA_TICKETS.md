# Keco Studio 架构优化 — Jira 任务清单

以下任务按**建议执行顺序**排列，可直接复制到 Jira 作为 Story/Task。每个任务包含：标题、描述、验收标准、建议优先级与预估。

**参考文档**：`docs/ARCHITECTURE_ASSESSMENT_CN.md`、`docs/ARCHITECTURE_DOCUMENTATION_CN.md`

---

## Epic（可选）

**标题**：Architecture Refactor & Documentation  
**描述**：统一路由解析、拆分 Sidebar、收拢类型与目录、补充架构文档与架构图，提升可维护性与一致性。  
**验收标准**：路由与 currentIds 单一来源；Sidebar 降至数百行且由 hooks/子组件组成；UserProfile 与侧栏 AssetRow 类型单一来源；Yjs/useYjsRows 归入 lib；至少完成系统概览图、分层图、路由与权限图、Context 数据流图。

---

## 一、统一路由解析（高优先级，建议最先做）

### ARCH-001：在 NavigationContext 中提供完整 currentIds 与页面类型

| 字段 | 内容 |
|------|------|
| **类型** | Story |
| **优先级** | High |
| **预估** | 3–5 SP |

**描述**  
在 NavigationContext 中统一暴露「从路由推导出的所有 id + 页面类型」，供 Sidebar、DashboardLayout、TopBar 消费，避免各处自行解析 pathname/params。

**具体要求**  
- 在 NavigationContext 的 value 中新增（或已有则统一命名）：`projectId`, `libraryId`, `folderId`, `assetId`, `isPredefinePage`, `isLibraryPage`, `isFolderPage`（或等价布尔/枚举）。
- 将 `specialRoutes`（如 folder、collaborators、settings、members、projects）及解析规则收拢到**一处**（如 `lib/utils/routeParams.ts` 或 NavigationContext 内部），便于后续扩展。
- 文档：在代码或 docs 中注明「currentIds 单一来源为 NavigationContext」。

**验收标准**  
- [ ] NavigationContext 对外提供上述 id 与页面类型，且与当前 URL 一致。
- [ ] specialRoutes 与解析逻辑仅在一处定义，无重复常量/正则。
- [ ] 现有面包屑与权限校验行为不变；如有 E2E，全部通过。

---

### ARCH-002：Sidebar、DashboardLayout、TopBar 改用 NavigationContext 的 currentIds

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | High |
| **预估** | 2–3 SP |
| **依赖** | ARCH-001 |

**描述**  
移除 Sidebar、DashboardLayout、TopBar 内所有基于 pathname/params 的「自算 currentIds」逻辑，改为使用 `useNavigation()`（或 NavigationContext）提供的 projectId、libraryId、folderId、currentLibraryId 等。

**验收标准**  
- [ ] Sidebar 内不再出现 pathname.split 或自算 projectId/libraryId/folderId/assetId/isLibraryPage 等；全部来自 useNavigation()。
- [ ] DashboardLayout 中 currentLibraryId 来自 useNavigation()，不再用 pathname 自算。
- [ ] TopBar 中 projectId（用于 userRole 等）来自 useNavigation()，不再 pathname.split。
- [ ] 树高亮、Presence、面包屑、权限展示等行为与重构前一致；E2E 通过。

---

## 二、Sidebar 拆分（中高优先级，依赖路由统一后可并行拆）

### ARCH-003：抽 useSidebarRoute 与 useSidebarProjects / useSidebarFoldersLibraries

| 字段 | 内容 |
|------|------|
| **类型** | Story |
| **优先级** | High |
| **预估** | 3 SP |
| **依赖** | ARCH-002 |

**描述**  
从 Sidebar 中抽出「路由」与「项目/文件夹/库列表数据」到独立 hooks，减少主文件状态与请求逻辑。

**具体要求**  
- `useSidebarRoute()`：从 NavigationContext 读取 currentIds 与页面类型，返回给 Sidebar 使用（若 ARCH-002 已用 useNavigation，可仅为封装一层便于树高亮等）。
- `useSidebarProjects()`：projects 的 useQuery、invalidate 时机（如 projectCreated/Updated 事件），返回 `{ projects, isLoading, refetch }` 等。
- `useSidebarFoldersLibraries()`：当前 project 下的 folders + libraries 的 useQuery，返回 `{ folders, libraries, isLoading, refetch }` 等。
- Hooks 放置于 `components/layout/` 下或 `lib/hooks/`（若希望全项目复用则放 lib）。

**验收标准**  
- [ ] 三个 hook 存在且职责单一；Sidebar 使用后行为与重构前一致。
- [ ] Sidebar.tsx 行数减少，且不再直接写 projects/folders/libraries 的 useQuery 与 pathname 解析。

---

### ARCH-004：抽 useSidebarTree 与 useSidebarModals

| 字段 | 内容 |
|------|------|
| **类型** | Story |
| **优先级** | High |
| **预估** | 5 SP |
| **依赖** | ARCH-003 |

**描述**  
将「树数据构建」与「所有弹窗的开关状态 + editingXxxId」从 Sidebar 抽到 hooks。

**具体要求**  
- `useSidebarTree()`：接收 projects/folders/libraries/assets（或从 useSidebarProjects、useSidebarFoldersLibraries 等获取），输出 Ant Design Tree 所需的 `treeData`；可包含展开键、高亮键等。
- `useSidebarModals()`：集中管理「新建/编辑项目、库、文件夹、资产」等 6+ 个 Modal 的 visible 与 editingId，提供 open/close 方法；各 Modal 仍为现有组件，仅由 Sidebar 或该 hook 传入 props。

**验收标准**  
- [ ] useSidebarTree 产出 treeData，Sidebar 仅负责将 treeData 传给 Tree 组件。
- [ ] useSidebarModals 统一管理所有侧栏相关弹窗状态，Sidebar 无分散的 useState(visible/editingId)。
- [ ] 新建/编辑/删除项目、库、文件夹、资产等交互与重构前一致；E2E 通过。

---

### ARCH-005：抽 useSidebarContextMenu 与 SidebarTreeView、SidebarUserMenu 子组件

| 字段 | 内容 |
|------|------|
| **类型** | Story |
| **优先级** | High |
| **预估** | 3–5 SP |
| **依赖** | ARCH-004 |

**描述**  
将右键菜单状态与 Tree/用户菜单 UI 拆成 hook 与子组件，进一步瘦身 Sidebar。

**具体要求**  
- `useSidebarContextMenu()`：管理右键菜单的 visible、position、menuType、targetId 及 close 逻辑，返回状态与 handlers。
- `SidebarTreeView`：仅负责渲染 Ant Design Tree（节点图标、标题、onSelect、onRightClick 等），接收 treeData 与回调。
- `SidebarUserMenu`：头像、昵称、下拉菜单、登出/设置入口，接收 userProfile 与 onAuthRequest 等。

**验收标准**  
- [ ] 右键菜单行为与重构前一致；Sidebar 内无分散的 contextMenu state。
- [ ] SidebarTreeView、SidebarUserMenu 为独立文件，Sidebar 主文件仅组合 hooks 与布局。
- [ ] Sidebar.tsx 总行数降至约 500 行以内（或按团队约定目标）。

---

## 三、类型收拢（中优先级）

### ARCH-006：统一 UserProfile 类型定义与引用

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | Medium |
| **预估** | 1–2 SP |

**描述**  
以 lib/types 中**一份** UserProfile 为准（如 `lib/types/shared-document.ts` 或新建 `lib/types/user.ts`），AuthContext、Sidebar 及所有引用处从该处 import；若某处只需部分字段，使用 `Pick<UserProfile, 'id'|'email'|...'>`。

**验收标准**  
- [ ] 全项目仅在一处定义 UserProfile（或 Re-export），无重复 interface/type。
- [ ] AuthContext、Sidebar、TopBar 等均从 lib/types 引用；类型变更只需改一处。
- [ ] 构建与类型检查通过。

---

### ARCH-007：统一侧栏与资产页的 AssetRow 相关类型

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | Medium |
| **预估** | 2 SP |

**描述**  
在 lib/types 中定义侧栏用「轻量资产」类型（如 `SidebarAssetRow` 或 `Pick<AssetRow, 'id'|'name'|'library_id'>`），Sidebar 与相关 service 统一使用；资产详情页 [assetId]/page 尽量复用 lib/types/libraryAssets 的 AssetRow，或显式 extend/Pick 并加注释说明与库表 AssetRow 的关系。

**验收标准**  
- [ ] Sidebar 内不再本地定义 AssetRow；使用 lib/types 中的类型。
- [ ] [assetId] 页如使用 AssetRow，来自 lib 或显式 Pick/Extend 并注释。
- [ ] 构建与类型检查通过。

---

## 四、页面级瘦身（中优先级）

### ARCH-008：库页 [libraryId]/page 抽 useLibraryPageData 与 useLibraryVersion

| 字段 | 内容 |
|------|------|
| **类型** | Story |
| **优先级** | Medium |
| **预估** | 3 SP |

**描述**  
将库页的数据请求与版本相关状态抽到 hooks，页面只做布局与组合。

**具体要求**  
- `useLibraryPageData()`：库基本信息、资产列表等 useQuery 及依赖的 libraryId 等。
- `useLibraryVersion()`（或 useLibraryVersionHistory）：版本列表、当前版本、创建/恢复/删除版本等状态与请求。
- 页面文件仅组合上述 hooks 与版本侧栏、表头、表格容器等子区域（子组件拆分可另开任务）。

**验收标准**  
- [ ] 库页主文件行数明显减少；数据与版本逻辑在 hooks 中。
- [ ] 版本切换、创建、恢复、删除行为与重构前一致；E2E 通过。

---

### ARCH-009：项目页 [projectId]/page 抽 useProjectPageData 与 useProjectModals

| 字段 | 内容 |
|------|------|
| **类型** | Story |
| **优先级** | Medium |
| **预估** | 2–3 SP |

**描述**  
将项目页的「项目 + 文件夹 + 库列表」请求与「新建/编辑文件夹、库」等弹窗状态抽到 hooks。

**具体要求**  
- `useProjectPageData()`：当前项目、文件夹列表、库列表的 useQuery。
- `useProjectModals()`：新建/编辑文件夹、库等 Modal 的 visible 与 editingId 及 open/close。
- 页面只做布局与列表/卡片视图组合。

**验收标准**  
- [ ] 项目页主文件行数减少；数据与弹窗状态在 hooks 中。
- [ ] 新建/编辑文件夹与库、列表与卡片切换行为不变；E2E 通过。

---

## 五、目录与工具（低优先级）

### ARCH-010：YjsContext 与 useYjsRows 迁入 lib

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | Low |
| **预估** | 1 SP |

**描述**  
将 `src/contexts/YjsContext.tsx` 移至 `lib/contexts/YjsContext.tsx`，将 `src/hooks/useYjsRows.ts` 移至 `lib/hooks/useYjsRows.ts`，并更新所有引用。

**验收标准**  
- [ ] 无 `src/contexts`、`src/hooks` 下 Yjs 相关文件；引用全部指向 lib。
- [ ] 构建与 E2E 通过。

---

### ARCH-011：Sidebar 内截断文本工具迁出

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | Low |
| **预估** | 1 SP |

**描述**  
将 Sidebar 内的 `getCharWidth`、`getStringWidth`、`truncateText` 迁到 `lib/utils/textTruncate.ts`（若其他处也会用）或 `components/layout/sidebarUtils.ts`（若仅侧栏用），Sidebar 从该处 import，减少主文件长度。

**验收标准**  
- [ ] Sidebar 主文件中无上述函数实现；从 utils 或 sidebarUtils 引用。
- [ ] 侧栏文本截断表现与重构前一致。

---

## 六、架构文档与架构图

### ARCH-012：编写架构概览与分层图

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | Medium |
| **预估** | 2 SP |

**描述**  
在 docs 中新增「系统概览」：一页内说明系统边界、用户 → Next.js → Supabase/邮件、技术栈；并补充「前端分层与目录图」（到目录/包级，依赖方向），可用 Mermaid 或 Draw.io，并附简短说明。

**验收标准**  
- [ ] docs 中有系统概览图或等效文字+图；新人能快速理解系统与依赖。
- [ ] 分层图包含展示层 → 状态/编排 → 业务层 → 基础设施，且标注依赖方向。
- [ ] ARCHITECTURE_DOCUMENTATION_CN.md 中对应章节可引用或嵌入该图。

---

### ARCH-013：编写路由与权限图、Context 与数据流图

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | Medium |
| **预估** | 2 SP |
| **依赖** | ARCH-001、ARCH-002 完成后更准确 |

**描述**  
在 docs 中补充：① 路由与权限图：路由树、受保护路由、currentIds 单一来源（NavigationContext）及消费者；② Context 与数据流图：Auth、Navigation、Presence、LibraryData 的来源与主要消费者。可用 Mermaid 或 Draw.io。

**验收标准**  
- [ ] 路由图能看出路由结构与 currentIds 提供方/消费方。
- [ ] Context 图能看出各 Context 数据来源与主要消费组件/页面。
- [ ] 与 ARCHITECTURE_DOCUMENTATION_CN.md 中「建议画的图」对应。

---

### ARCH-014：编写库表/协作数据流图（可选）

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | Low |
| **预估** | 1–2 SP |

**描述**  
在 docs 中补充库表/协作数据流图：从 API/Realtime 到 services/hooks、LibraryDataContext、再到库表 UI，标出 queryKeys、invalidate、乐观更新边界等，便于后续协作与缓存相关改动。

**验收标准**  
- [ ] 图覆盖主要数据源、LibraryDataContext、useRequestCache/useCacheMutations/Realtime 等与库表 UI 的关系。
- [ ] 文档中有简短说明，便于新人理解协作与缓存策略。

---

### ARCH-015：Sidebar 重构完成后补充 Sidebar 模块图（可选）

| 字段 | 内容 |
|------|------|
| **类型** | Task |
| **优先级** | Low |
| **预估** | 1 SP |
| **依赖** | ARCH-005 |

**描述**  
在 Sidebar 拆分为 hooks + 子组件稳定后，在 docs 中补充「Sidebar 模块图」：标出 useSidebarRoute、useSidebarTree、useSidebarModals、SidebarTreeView、SidebarUserMenu 等边界与数据流，便于后续维护与单测。

**验收标准**  
- [ ] 图能反映当前 Sidebar 的 hooks 与子组件划分及数据/回调流向。
- [ ] 与 ARCHITECTURE_DOCUMENTATION_CN.md 中「Sidebar 模块图」描述一致。

---

## 七、任务顺序与依赖小结

```
ARCH-001 → ARCH-002 → ARCH-003 → ARCH-004 → ARCH-005
    ↓           ↓
ARCH-013（路由/Context 图可随 001/002 后更新）

ARCH-006, ARCH-007（类型收拢，可与 003–005 并行）
ARCH-008, ARCH-009（页面瘦身，可与 Sidebar 并行）
ARCH-012（概览与分层图，可与开发并行）
ARCH-010, ARCH-011（低优先级，收尾）
ARCH-014, ARCH-015（文档增强，可选）
```

**建议 Sprint 分配示例**  
- Sprint 1：ARCH-001、ARCH-002、ARCH-012（路由统一 + 文档基础）  
- Sprint 2：ARCH-003、ARCH-004、ARCH-005（Sidebar 拆分）  
- Sprint 3：ARCH-006、ARCH-007、ARCH-008、ARCH-009（类型 + 页面瘦身）  
- Sprint 4：ARCH-010、ARCH-011、ARCH-013、ARCH-014、ARCH-015（收尾与文档完善）
