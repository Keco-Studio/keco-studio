# Keco Studio 架构评估与优化建议

## 一、整体评价

| 维度         | 评价     | 说明 |
|--------------|----------|------|
| 分层清晰度   | 较好     | 展示层 (app/components)、状态层 (lib/contexts)、业务层 (lib/services, lib/hooks) 划分明确 |
| 职责分配     | 部分合理 | lib/ 内 services、hooks、types、utils 分工清楚；少数巨型组件职责过重 |
| 可维护性     | 中等     | LibraryAssetsTable 已按 hooks 拆分；Sidebar、库页、项目页仍为单文件大组件 |
| 一致性       | 需改进   | 路由解析、类型定义、目录归属存在重复与分散 |

**结论**：整体架构方向正确，lib 层设计良好，主要问题集中在「少数超大组件」和「路由/类型重复」上，适合按优先级渐进式重构。

---

## 二、做得好的地方（保持现状）

1. **lib/ 业务层**
   - **services/**：project、library、folder、libraryAssets、realtime、authorization 等职责单一，与 UI 解耦，便于测试和复用。
   - **hooks/**：useRequestCache、useCacheMutations、useRealtimeSubscription、usePresenceTracking 等集中在 lib，被多页面使用。
   - **queryKeys**：统一在 `lib/utils/queryKeys.ts`，利于缓存策略一致和 invalidate 准确。

2. **LibraryAssetsTable 重构成果**
   - 表格逻辑已拆成 hooks：useTableDataManager、useBatchFill、useClipboardOperations、useRowOperations、useCellSelection、useResolvedRows 等，数据流和乐观更新边界清晰。
   - 子组件（CellEditor、TableHeader、BatchEditMenu、AssetCardPanel 等）按功能拆分，结构合理。

3. **Context 分工**
   - AuthContext：登录态与用户信息。
   - NavigationContext：当前 project/library/asset/folder、面包屑。
   - PresenceContext：在线用户与 activeCell。
   - LibraryDataContext：库内资产单一数据源（与 Yjs/Realtime 协同）。
   - 各 Context 职责不重叠，使用范围明确。

4. **页面与路由**
   - App Router 结构清晰：`(dashboard)/projects`、`[projectId]`、`[libraryId]`、`folder/[folderId]`、`collaborators`、`auth`、`api` 等，与业务匹配。

---

## 三、需要优化与重构的地方

### 1. Sidebar.tsx 体量过大（高优先级）

| 指标       | 现状        | 建议 |
|------------|-------------|------|
| 行数       | ~2368 行    | 拆成多个子组件 + 多个 hooks |
| useState   | 约 25+ 个   | 按领域收敛到 hooks（树状态、弹窗状态、右键菜单状态等） |
| 直接 import | 44 个      | 通过 hooks/子组件间接依赖，减少顶层依赖 |
| 职责       | 树数据、CRUD、弹窗、右键菜单、用户菜单、事件监听、路由解析等全在一起 | 按「数据 / 交互 / 展示」拆分 |

**问题**：
- 单文件承担：路由解析、项目/库/文件夹/资产列表拉取、树构建、6+ 种 Modal 的开关与编辑 id、右键菜单、用户下拉、侧边栏显隐、事件监听（projectCreated、projectUpdated、authStateChanged、sidebar-toggle）等，可读性和单测成本都高。
- 路由解析逻辑与 NavigationContext、DashboardLayout、TopBar 重复（见下节）。

**建议拆分方向**（不要求一次做完，可分批）：
- **hooks**  
  - `useSidebarRoute()`：从 NavigationContext 或统一路由 hook 取 currentIds，不再在 Sidebar 内用 pathname 自算。  
  - `useSidebarProjects()`：projects 的 useQuery + invalidate 逻辑。  
  - `useSidebarFoldersLibraries()`：folders + libraries 的 useQuery。  
  - `useSidebarTree()`：由 folders/libraries/assets 构建 Ant Design Tree 的 treeData。  
  - `useSidebarModals()`：所有「是否展示 xx 弹窗 + editingXxxId」的状态与打开/关闭方法。  
  - `useSidebarContextMenu()`：右键菜单的坐标、type、id 状态与关闭逻辑。
- **子组件**  
  - `SidebarTreeView`：只负责渲染 Tree + 节点图标/标题，接收 treeData 和 onSelect/onRightClick 等回调。  
  - `SidebarUserMenu`：头像、昵称、下拉菜单、登出/设置入口。  
  - 各 Modal 仍用现有 NewProjectModal、EditLibraryModal 等，仅由 Sidebar 或 useSidebarModals 传入 visible 和 editingId。

这样 Sidebar.tsx 主要做「组合 hooks + 布局 + 事件监听入口」，体量可降到数百行内。

---

### 2. 路由解析重复（中高优先级）

**现状**：  
以下多处自行解析 pathname 或 params，逻辑相似但不统一：

| 位置               | 解析内容 |
|--------------------|----------|
| Sidebar            | pathname → projectId, libraryId, folderId, isPredefinePage, assetId, isLibraryPage（currentIds） |
| Sidebar 内部       | 另有 3 处 pathname.split 用于树高亮等 |
| NavigationContext  | params.projectId/libraryId/assetId + pathname 正则取 folderId |
| DashboardLayout    | pathname → currentLibraryId（用于 Presence 等） |
| TopBar             | pathname.split 取 projectId（用于 userRole 等） |

**问题**：
- 规则一旦调整（例如新增 segment），需要改多处，易漏。
- specialRoutes（folder、collaborators、settings、members）等在 Sidebar 与 DashboardLayout 中重复维护。

**建议**：
- **方案 A（推荐）**：在 NavigationContext 中统一提供「从路由推导出的所有 id + 页面类型」，例如：  
  `projectId, libraryId, folderId, assetId, isPredefinePage, isLibraryPage, isFolderPage`。  
  Sidebar、DashboardLayout、TopBar 都只消费 `useNavigation()`，不再自己 pathname.split。
- **方案 B**：抽一个 `useRouteParams()`（或 `useDashboardRoute()`）hook，内部用 useParams + usePathname，返回与方案 A 相同的结构，由 NavigationProvider 或 Layout 提供均可。  
两种方案都建议把「specialRoutes + 解析规则」收拢到一处（例如 lib/utils/routeParams.ts 或 NavigationContext 内）。

---

### 3. 类型定义分散（中优先级）

**现状**：
- **UserProfile**：在 Sidebar、AuthContext、lib/types/shared-document.ts 各有定义或使用，结构类似但不保证同一来源。
- **AssetRow（侧栏用）**：Sidebar 内自定义 `AssetRow = { id, name, library_id }`，与 lib/types/libraryAssets 的 AssetRow 不完全一致；资产详情页 [assetId]/page 又有一个本地 AssetRow 类型。

**问题**：
- 类型变更时要改多处，容易不一致。
- 新人难以判断「权威类型」在哪。

**建议**：
- **UserProfile**：以 lib/types 中一份为准（例如 lib/types/shared-document.ts 或新建 lib/types/user.ts），AuthContext 与 Sidebar 都从该处 import；若 Sidebar 只需部分字段，用 `Pick<UserProfile, 'id'|'email'|...'>`。
- **侧栏用「轻量资产」**：在 lib/types 中定义 `SidebarAssetRow` 或使用 `Pick<AssetRow, 'id'|'name'|'library_id'>`，Sidebar 与相关 service 统一使用，避免在组件内重复定义。
- **[assetId] 页的 AssetRow**：尽量复用 lib/types/libraryAssets.AssetRow，或显式 extend/Pick，并在文件头注释「与库表 AssetRow 的关系」。

---

### 4. 页面级组件仍然偏大（中优先级）

| 页面/组件           | 行数（约） | 建议 |
|--------------------|------------|------|
| [libraryId]/page.tsx | ~887      | 拆成 useLibraryPageData、useLibraryVersion、子区域组件（版本侧栏、表头、表格容器） |
| [projectId]/page.tsx | ~621      | 拆成 useProjectPageData、useProjectModals、列表/卡片视图子组件 |
| LibraryAssetsTable.tsx | ~2335     | 已用 hooks 化解逻辑，可再抽「表格主体」与「批量编辑/空状态」为独立组件文件，降低单文件行数 |

**建议**：
- 库页：先抽「版本相关状态与请求」到 useLibraryVersion（或 useLibraryVersionHistory），再考虑把版本侧栏、表头、空白行/新建行区域拆成小组件。
- 项目页：先抽「项目 + 文件夹 + 库列表」的 useQuery 与「展示/编辑弹窗」状态到 useProjectPageData / useProjectModals，页面只做布局与组合。

---

### 5. 目录与归属一致性（低优先级）

**现状**：
- 大部分 Context 在 `lib/contexts/`，但 **YjsContext** 在 `src/contexts/`。
- 大部分业务 hooks 在 `lib/hooks/`，但 **useYjsRows** 在 `src/hooks/`。

**建议**：
- 将 `src/contexts/YjsContext.tsx` 移到 `lib/contexts/YjsContext.tsx`，并更新引用。
- 将 `src/hooks/useYjsRows.ts` 移到 `lib/hooks/useYjsRows.ts`，并更新引用。  
这样「所有全局状态与业务 hooks 都在 lib 下」的约定更一致，便于查找和依赖管理。

---

### 6. 工具函数与 UI 耦合（低优先级）

**现状**：
- Sidebar 内实现了 `getCharWidth`、`getStringWidth`、`truncateText`（按显示宽度截断中英文），仅在本组件使用。

**建议**：
- 若其他列表/表格也需要「按字符显示宽度截断」，可迁到 `lib/utils/textTruncate.ts`（或类似命名），Sidebar 从该处 import。
- 若确认仅 Sidebar 使用，可保留在 Sidebar 目录下的 `sidebarUtils.ts` 或文件底部，减少主文件长度，便于测试。

---

## 四、各层职责分配是否合理

| 层级/位置        | 当前职责                     | 是否合理 | 说明 |
|------------------|------------------------------|----------|------|
| **app/**         | 路由、layout、页面入口       | 合理     | 符合 Next.js 习惯，页面只做组合与路由级数据加载即可 |
| **components/layout** | 布局、Sidebar、TopBar、ContextMenu | 部分过重 | Sidebar 职责过多，应下放到 hooks + 子组件 |
| **components/libraries** | 库表、弹窗、hooks、utils   | 合理     | 已按 hooks 拆分，边界清晰 |
| **lib/contexts** | Auth、Navigation、Presence、LibraryData | 合理     | 建议补充「路由解析」单一来源，并收拢 Yjs |
| **lib/services**  | 与 Supabase 的 CRUD、Realtime 等 | 合理     | 保持「页面/组件不直接调 Supabase」即可 |
| **lib/hooks**     | 缓存、Realtime、Presence、权限等 | 合理     | 建议 useYjsRows 迁入以统一位置 |
| **lib/types**    | 领域模型与 DTO               | 需加强   | 收拢 UserProfile、侧栏 AssetRow 等，避免分散定义 |
| **lib/utils**    | queryKeys、校验、时间、请求等 | 合理     | 可新增路由解析工具（若采用集中解析方案） |

---

## 五、建议的优化顺序（优先级）

1. **高**：统一路由解析（NavigationContext 或 useRouteParams），并让 Sidebar、DashboardLayout、TopBar 改用同一数据源；再开始 Sidebar 的 hooks + 子组件拆分。
2. **中高**：Sidebar 拆分（useSidebarRoute、useSidebarTree、useSidebarModals、SidebarTreeView、SidebarUserMenu 等），先拆数据与状态，再拆 UI。
3. **中**：类型收拢（UserProfile、Sidebar 用 AssetRow）到 lib/types，并统一引用。
4. **中**：库页/项目页的数据与弹窗逻辑抽 hooks，页面文件瘦身。
5. **低**：YjsContext、useYjsRows 迁入 lib；Sidebar 内截断文本等工具迁到 lib/utils 或 sidebarUtils。

---

## 六、小结

- **整体架构**：分层和 lib 设计良好，主要瓶颈在「少数超大组件」和「路由/类型重复」。
- **分配**：除 Sidebar 和路由解析外，各层职责基本合理；通过「统一路由 + 类型 + Sidebar 拆分」即可明显提升可维护性和一致性。
- 建议按上述优先级渐进式重构，先做路由与 Sidebar，再收拢类型与页面级 hooks，最后做目录与工具函数的小调整。每步都可单独落地和验证，不影响现有功能。

---

## 七、架构文档与架构图建议

- **文档应细化到什么程度**：分三层——**概览**（1–2 页，给新人/产品）、**设计层**（分层、目录职责、Context/路由，给开发与 Code Review）、**实现层**（仅对易混或刚重构部分写细，按需查阅）。原则：单一事实来源、与代码同步、避免过度细化。
- **建议画的图**：  
  1. **系统概览图**（应用级）：用户 → Next.js → Supabase/邮件，技术栈。  
  2. **前端分层与目录图**（目录级）：展示层 → 状态/编排 → 业务层 → 基础设施，依赖方向。  
  3. **路由与权限图**（路由段级）：路由树、受保护路由、currentIds 单一来源（NavigationContext）及消费者。  
  4. **Context 与数据流图**（Context 级）：Auth / Navigation / Presence / LibraryData 的来源与主要消费者。  
  5. **库表/协作数据流图**（模块级）：库表数据、Realtime/Yjs、缓存与乐观更新。  
  6. **Sidebar 模块图**（可选，重构后）：hooks + 子组件边界与数据流。  

更细的说明、每张图的目的与画法、以及 Mermaid 示例见 **[ARCHITECTURE_DOCUMENTATION_CN.md](./ARCHITECTURE_DOCUMENTATION_CN.md)**。
