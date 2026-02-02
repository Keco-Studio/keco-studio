# 架构任务：逐步操作指南

本文档针对**你的两个任务**给出可执行步骤，每步都可单独实现并验证。

- **任务 2**：NavigationContext 统一路由逻辑（会涉及 Sidebar、DashboardLayout、TopBar 改动）
- **任务 3**：Sidebar 文件重构（hooks + 子组件）

---

# 第一部分：NavigationContext 统一路由逻辑

## 步骤 1.1：新增路由解析工具 `lib/utils/routeParams.ts`

**目的**：把「从 pathname + params 推导 currentIds + 页面类型」的逻辑收拢到一处，供 NavigationContext 使用，后续 Sidebar/TopBar 等只消费 Context 不再自己解析。

**操作**：

1. 新建文件 `src/lib/utils/routeParams.ts`。

2. 定义常量（与 Sidebar 当前逻辑一致，并加上 `projects` 以便第一段判断）：
   ```ts
   export const SPECIAL_ROUTE_SEGMENTS = ['folder', 'collaborators', 'settings', 'members', 'projects'] as const;
   ```

3. 定义返回值类型并实现 `parseRouteParams`：
   ```ts
   export type RouteParamsResult = {
     projectId: string | null;
     libraryId: string | null;
     folderId: string | null;
     assetId: string | null;
     isPredefinePage: boolean;
     isLibraryPage: boolean;
   };

   export function parseRouteParams(
     pathname: string,
     _params?: Record<string, string | string[] | undefined>
   ): RouteParamsResult {
     const parts = pathname.split('/').filter(Boolean);
     const projectId = parts[0] && parts[0] !== 'projects' ? parts[0] : null;
     let libraryId: string | null = null;
     let folderId: string | null = null;
     let isPredefinePage = false;
     let assetId: string | null = null;
     let isLibraryPage = false;

     if (parts.length >= 2 && parts[1] === 'folder' && parts[2]) {
       folderId = parts[2];
     } else if (parts.length >= 2 && SPECIAL_ROUTE_SEGMENTS.includes(parts[1] as any)) {
       libraryId = null;
     } else if (parts.length >= 3 && parts[2] === 'predefine') {
       libraryId = parts[1];
       isPredefinePage = true;
     } else if (parts.length >= 3) {
       libraryId = parts[1];
       assetId = parts[2];
     } else if (parts.length >= 2) {
       libraryId = parts[1];
       isLibraryPage = true;
     }

     return { projectId, libraryId, folderId, assetId, isPredefinePage, isLibraryPage };
   }
   ```

4. 保存后运行 `npm run build` 或类型检查，确认无报错。

**验收**：存在 `src/lib/utils/routeParams.ts`，导出 `parseRouteParams` 和 `SPECIAL_ROUTE_SEGMENTS`；对 `/projects`、`/uuid`、`/uuid/folder/fid`、`/uuid/libId`、`/uuid/libId/predefine`、`/uuid/libId/assetId` 等 pathname 的返回值与 Sidebar 当前 `currentIds` 逻辑一致。

---

## 步骤 1.2：NavigationContext 使用 routeParams 并暴露 isPredefinePage / isLibraryPage

**目的**：路由推导统一走 `parseRouteParams`，并在 Context 中暴露页面类型，供 Sidebar、TopBar 使用。

**操作**：

1. 打开 `src/lib/contexts/NavigationContext.tsx`。

2. 在文件顶部增加导入：
   ```ts
   import { parseRouteParams } from '@/lib/utils/routeParams';
   ```

3. 在 `NavigationContextType` 中增加两个字段：
   ```ts
   isPredefinePage: boolean;
   isLibraryPage: boolean;
   ```

4. 在 `NavigationProvider` 内，用 `parseRouteParams(pathname, params)` 替代原来从 params 单独取 projectId/libraryId/assetId、以及用 pathname 正则取 folderId 的逻辑：
   - 在 `useParams()`、`usePathname()` 之后增加：
     ```ts
     const routeParams = useMemo(
       () => parseRouteParams(pathname, params as Record<string, string | string[] | undefined>),
       [pathname, params]
     );
     ```
   - 将原来的：
     - `currentProjectId = useMemo(() => (params.projectId as string) || null, [params.projectId]);`
     - `currentLibraryId = useMemo(...)`
     - `currentAssetId = useMemo(...)`
     - `currentFolderIdFromUrl = useMemo(() => pathname.match(...)...)`
     改为使用 `routeParams`：
     - `currentProjectId = routeParams.projectId`
     - `currentLibraryId = routeParams.libraryId`
     - `currentAssetId = routeParams.assetId`
     - `currentFolderIdFromUrl = routeParams.folderId`（注意保留「currentFolderId = currentFolderIdFromUrl || libraryFolderId」的合并逻辑，即当前 folder 可能来自库的 folder_id）
   - 在 value 中增加：`isPredefinePage: routeParams.isPredefinePage`，`isLibraryPage: routeParams.isLibraryPage`。

5. 注意：NavigationContext 内所有依赖 `currentProjectId`、`currentLibraryId`、`currentAssetId`、`currentFolderId` 的逻辑（fetchNames、权限校验、重定向、面包屑等）保持不变，仅「数据来源」从 params/pathname 改为 `routeParams`。

6. 保存后运行构建与 E2E（若有），确认面包屑、权限校验、重定向行为不变。

**验收**：NavigationContext 对外提供 `currentProjectId`、`currentLibraryId`、`currentFolderId`、`currentAssetId`、`isPredefinePage`、`isLibraryPage`，且与 URL 一致；现有功能不变。

---

## 步骤 1.3：Sidebar 改为使用 useNavigation()，移除 pathname 解析

**目的**：Sidebar 不再自己解析 pathname，全部使用 NavigationContext。

**操作**：

1. 打开 `src/components/layout/Sidebar.tsx`。

2. 增加对 NavigationContext 的消费（若尚未导入 useNavigation）：
   ```ts
   import { useNavigation } from '@/lib/contexts/NavigationContext';
   ```

3. 删除对 `usePathname()` 的调用（约第 99 行）。

4. 删除 `currentIds` 的 useMemo（约第 192–230 行），改为：
   ```ts
   const {
     currentProjectId,
     currentLibraryId,
     currentFolderId,
     currentAssetId,
     isPredefinePage,
     isLibraryPage,
   } = useNavigation();
   const currentIds = useMemo(
     () => ({
       projectId: currentProjectId,
       libraryId: currentLibraryId,
       folderId: currentFolderId,
       assetId: currentAssetId,
       isPredefinePage,
       isLibraryPage,
     }),
     [currentProjectId, currentLibraryId, currentFolderId, currentAssetId, isPredefinePage, isLibraryPage]
   );
   ```

5. 处理「Sync selectedFolderId from URL」的 useEffect（约 918–929 行）：  
   当前逻辑是 `currentIds.folderId` 存在则设 selectedFolderId，否则根据 pathname 判断是否在 folder 页再清空。改为仅根据 `currentIds.folderId` 判断即可：
   - 若 `currentIds.folderId` 有值则 `setSelectedFolderId(currentIds.folderId)`；
   - 否则 `setSelectedFolderId(null)`。  
   依赖数组去掉 `pathname`，只保留 `currentIds.folderId`。

6. 处理 `handleAssetDelete` 内「当前是否在看该 asset」的判断（约 1195–1199 行）：  
   当前用 `pathname.split` 和 `parts[2] === assetId`。改为：若 `currentIds.assetId === assetId && currentIds.projectId` 则 `router.push(\`/${currentIds.projectId}/${libraryId}\`)`。依赖数组去掉 `pathname`，保留 `currentIds.projectId`、`currentIds.assetId`。

7. 若 Sidebar 内还有其它直接使用 `pathname` 的地方（例如 `pathname === '/projects'`），改为用 `currentIds`/useNavigation：例如「是否在项目列表页」可判断为 `!currentIds.projectId` 且当前路由为 `/projects`；若 useNavigation 未暴露「是否在 /projects」，可保留 `pathname === '/projects'` 或后续在 Context 中增加 `isProjectsListPage`。  
   当前 Sidebar 约 806 行有 `if (pathname === '/projects' && ...)`，可保留 `pathname === '/projects'`，但需保留 `usePathname()`。更干净的做法是：在 routeParams 或 NavigationContext 中增加 `isProjectsListPage: pathname === '/projects'`，Sidebar 用 context。**本步为减少改动量，可暂时保留 `usePathname()` 仅用于 `pathname === '/projects'`**，其余 pathname 解析全部移除。

8. 保存后运行构建与 E2E，确认侧栏高亮、树展开、删除后跳转等行为不变。

**验收**：Sidebar 内不再出现「用 pathname.split 解析 projectId/libraryId/folderId/assetId/isPredefinePage/isLibraryPage」的逻辑；仅保留为判断 `pathname === '/projects'` 时是否保留 usePathname 由你决定（建议后续在 Context 暴露 isProjectsListPage 再删 usePathname）。

---

## 步骤 1.4：DashboardLayout 改用 useNavigation().currentLibraryId

**目的**：Presence 等所需的 currentLibraryId 从 Context 取，不再自算。

**操作**：

1. 打开 `src/components/layout/DashboardLayout.tsx`。

2. 删除 `import { usePathname } from 'next/navigation'` 以及 `const pathname = usePathname();`。

3. 增加 `import { useNavigation } from '@/lib/contexts/NavigationContext';`，并：
   ```ts
   const { currentLibraryId } = useNavigation();
   ```

4. 删除「Extract libraryId from URL」的 useMemo（约 23–32 行），将变量名 `currentLibraryId` 改为直接使用上面的 `currentLibraryId`。若该变量仅用于 Presence 等且当前未使用，可暂时保留命名供后续使用。

5. 保存后运行构建，确认无报错。

**验收**：DashboardLayout 不再使用 pathname 解析；currentLibraryId 来自 useNavigation()。

---

## 步骤 1.5：TopBar 改用 useNavigation() 的 projectId 与 isPredefinePage

**目的**：userRole 和 collaborators 订阅用 currentProjectId，isPredefine 用 context。

**操作**：

1. 打开 `src/components/layout/TopBar.tsx`。

2. TopBar 已使用 `useNavigation()` 取 breadcrumbs、currentAssetId 等。在解构中增加 `currentProjectId`、`isPredefinePage`：
   ```ts
   const { breadcrumbs, currentAssetId, currentProjectId, isPredefinePage, showCreateProjectBreadcrumb: contextShowCreateProjectBreadcrumb } = useNavigation();
   ```

3. 第一个 useEffect（fetchUserRole，约 78–121 行）：  
   删除「Extract projectId from pathname」的 `const parts = pathname.split(...)` 和 `const projectId = parts[0] || null`，改为使用 `currentProjectId`。依赖数组将 `pathname` 改为 `currentProjectId`。

4. 第二个 useEffect（collaborators 订阅，约 124–202 行）：  
   同样删除 pathname 解析，改用 `currentProjectId`；依赖数组将 `pathname` 改为 `currentProjectId`。

5. `const isPredefine = pathname?.includes('/predefine');`（约 267 行）改为使用 context：`const isPredefine = isPredefinePage;`（上面已从 useNavigation 解构出 isPredefinePage）。

6. 若 TopBar 不再需要 pathname，可删除 `const pathname = usePathname();` 及 `usePathname` 的导入。

7. 保存后运行构建与 E2E，确认 TopBar 权限展示、预定义页判断正确。

**验收**：TopBar 内不再用 pathname 解析 projectId；userRole 与 isPredefine 行为与重构前一致。

---

## 第一部分小结

- 路由解析单一来源：`lib/utils/routeParams.ts` + NavigationContext。
- Sidebar、DashboardLayout、TopBar 均改为消费 useNavigation()，不再自算 currentIds。
- 每步完成后建议：`npm run build`、手动点关键路由（/projects、项目、库、folder、predefine、asset）、若有 E2E 则跑一遍。

---

# 第二部分：Sidebar 文件重构

在完成第一部分后，Sidebar 仍是一个大文件。第二部分按「先数据/状态、再 UI」拆成 hooks 和子组件，便于维护和单测。

## 步骤 2.1：抽 `useSidebarProjects` 与 `useSidebarFoldersLibraries`

**目的**：把「项目列表」与「当前项目下 folders + libraries」的请求与缓存从 Sidebar 主文件移出。

**操作**：

1. 在 `src/components/layout/` 下新建 `useSidebarProjects.ts`（或放在 `src/lib/hooks/` 若希望全项目复用）。  
   实现：
   - 入参：`userProfile?.id`、`supabase`（或内部 useSupabase）。
   - 内部：使用现有 Sidebar 中的 useQuery projects（queryKey: `['projects']`，queryFn: listProjects，enabled/staleTime/refetchOnMount 等与原一致）。
   - 返回：`{ projects, isLoading: loadingProjects, error: projectsError, refetch: refetchProjects }`。
   - 若 Sidebar 中有「首次进入 /projects 且无项目时自动创建」等逻辑，可暂时保留在 Sidebar，仅把 useQuery 迁到 hook。

2. 新建 `useSidebarFoldersLibraries.ts`（同上，可放 layout 或 lib/hooks）。  
   实现：
   - 入参：`currentProjectId`、`supabase`（或内部 useSupabase）。
   - 内部：使用现有 useQuery folders-libraries（queryKey: `['folders-libraries', currentProjectId]`，queryFn 中 listFolders + listLibraries，enabled 为 projectId 存在且为有效 UUID）。
   - 返回：`{ folders, libraries, isLoading, refetch }`（或与 Sidebar 现有命名一致）。

3. 在 Sidebar 中：
   - 删除 projects 的 useQuery 及相关变量，改为 `const { projects, isLoading: loadingProjects, error: projectsError, refetch: refetchProjects } = useSidebarProjects(...);`。
   - 删除 folders+libraries 的 useQuery，改为 `const { folders, libraries, isLoading: loadingFoldersLibraries, ... } = useSidebarFoldersLibraries(currentIds.projectId, ...);`。
   - 保持其它逻辑（事件监听、invalidate、Realtime 订阅等）仍在 Sidebar 或后续再迁到对应 hook）。

4. 保存后构建并手动验证：项目列表、文件夹/库列表、切换项目后数据正确。

**验收**：Sidebar 主文件行数减少；项目与 folders/libraries 数据来源为两个 hook；行为不变。

---

## 步骤 2.2：抽 `useSidebarModals`

**目的**：把所有「新建/编辑项目、库、文件夹、资产」等弹窗的 visible 与 editingId 状态集中到一个 hook。

**操作**：

1. 新建 `useSidebarModals.ts`（建议放在 `src/components/layout/`）。  
   状态包括：showProjectModal, showEditProjectModal, editingProjectId, showLibraryModal, showEditLibraryModal, editingLibraryId, showFolderModal, showEditFolderModal, editingFolderId, showEditAssetModal, editingAssetId 等（与 Sidebar 当前 state 一致）。  
   提供方法如：openNewProject, closeProjectModal, openEditProject(id), closeEditProjectModal；同理 library/folder/asset。  
   返回：`{ modalsState, modalsActions }` 或平铺的 state + 方法（如 setShowProjectModal, setEditingProjectId, ...）。

2. Sidebar 中删除上述 useState，改为 `const { ... } = useSidebarModals();`，将原有 setState 调用改为 hook 提供的方法。

3. 各 Modal 组件（NewProjectModal、EditLibraryModal 等）的 `visible`、`editingId`、`onCancel`、`onSuccess` 仍由 Sidebar 传入，但数据来源改为 useSidebarModals 的返回值。

4. 保存后构建并验证：新建/编辑项目、库、文件夹、资产，打开关闭行为与重构前一致。

**验收**：弹窗状态与编辑 id 全部由 useSidebarModals 管理；Sidebar 主文件不再包含大量 useState(showXxx/editingXxx)。

---

## 步骤 2.3：抽 `useSidebarTree`

**目的**：由 projects + folders + libraries + assets 构建 Ant Design Tree 所需的 treeData，以及展开键、高亮等。

**操作**：

1. 新建 `useSidebarTree.ts`。  
   入参：`currentIds`（或 projectId/libraryId/folderId/assetId/isPredefinePage/isLibraryPage）、`projects`、`folders`、`libraries`、`assets`（Record<libraryId, AssetRow[]>）、`expandedKeys`、`setExpandedKeys`（或由 hook 内部管理 expandedKeys）。  
   内部：将现有 Sidebar 中「根据 folders/libraries/assets 构建 treeData」的逻辑移入（buildTreeData 或类似函数），返回 `treeData`（DataNode[]）。  
   若高亮 key 也在此计算，可一并返回 `selectedKeys` 或 `activeKeys`。

2. Sidebar 中删除构建 treeData 的 useMemo/函数，改为 `const { treeData, selectedKeys } = useSidebarTree(currentIds, projects, folders, libraries, assets, expandedKeys, setExpandedKeys);`（具体 API 可按你现有命名调整）。

3. Tree 组件仍渲染在 Sidebar 中，只把 data 改为 hook 返回的 treeData。

4. 保存后构建并验证：树结构、展开折叠、高亮与重构前一致。

**验收**：treeData 构建逻辑在 useSidebarTree 中；Sidebar 仅传入数据和 currentIds，接收 treeData 并渲染 Tree。

---

## 步骤 2.4：抽 `useSidebarContextMenu`

**目的**：右键菜单的坐标、类型、targetId 及关闭逻辑集中管理。

**操作**：

1. 新建 `useSidebarContextMenu.ts`。  
   状态：`contextMenu: { x, y, type, id } | null`。  
   方法：`openContextMenu(x, y, type, id)`、`closeContextMenu()`。  
   返回：`{ contextMenu, openContextMenu, closeContextMenu }`。

2. Sidebar 中删除 contextMenu 的 useState 及 setContextMenu 的调用，改为使用 useSidebarContextMenu。  
   所有 onRightClick 或类似回调中，原来 setContextMenu({ x, y, type, id }) 改为 hook 的 openContextMenu。

3. ContextMenu 组件的 visible、position、menuType、targetId 仍由 Sidebar 传入，数据来源改为 useSidebarContextMenu。

4. 保存后验证：项目/库/文件夹/资产右键菜单显示与关闭正常。

**验收**：右键菜单状态与逻辑在 useSidebarContextMenu 中；Sidebar 不再直接维护 contextMenu state。

---

## 步骤 2.5：拆出 `SidebarTreeView` 子组件

**目的**：Tree 的渲染与节点图标、标题、onSelect/onRightClick 回调独立成组件，减轻 Sidebar 主文件体积。

**操作**：

1. 新建 `src/components/layout/SidebarTreeView.tsx`。  
   Props：treeData、expandedKeys、setExpandedKeys、onSelect、onRightClick、selectedKeys、renderTitle（可选）、以及 Sidebar 中传给 Tree 的其它必要 props（如 className、blockNode 等）。  
   内部：只渲染 Ant Design Tree，以及节点上的图标、标题、预定义/资产图标等（从 Sidebar 中剪切过来）。

2. Sidebar 中：删除 Tree 及其子节点的 JSX，改为 `<SidebarTreeView treeData={...} expandedKeys={...} onSelect={...} onRightClick={...} ... />`，回调仍由 Sidebar 定义并传入（如 handleProjectClick、handleLibraryClick、handleAssetDelete 等）。

3. 样式：可从 Sidebar.module.css 中把与 Tree 相关的 class 移到 SidebarTreeView.module.css，或在 Sidebar.module.css 中保留并由 SidebarTreeView 使用相同类名。

4. 保存后构建并验证：树展示、点击、右键、图标与重构前一致。

**验收**：SidebarTreeView 为独立文件，只负责 Tree 的展示与事件回调；Sidebar 主文件行数明显减少。

---

## 步骤 2.6：拆出 `SidebarUserMenu` 子组件

**目的**：用户头像、昵称、下拉菜单、登出/设置入口独立成组件。

**操作**：

1. 新建 `src/components/layout/SidebarUserMenu.tsx`。  
   Props：userProfile（或 displayName、avatarUrl、avatarInitial）、onLogout、onAuthNav、menuRef、showMenu、setShowMenu 等（与 Sidebar 当前用户区域所需一致）。  
   内部：渲染头像、昵称、下拉菜单、登出/设置等；点击外部关闭菜单的逻辑可在该组件内用 useEffect + menuRef 实现。

2. Sidebar 中：删除用户区域 JSX，改为 `<SidebarUserMenu userProfile={userProfile} onLogout={handleLogout} onAuthNav={handleAuthNav} ... />`。  
   handleLogout、handleAuthNav 仍定义在 Sidebar（或后续再迁到 hook）。

3. 保存后验证：用户菜单展开收起、登出、跳转行为不变。

**验收**：SidebarUserMenu 为独立文件；Sidebar 主文件仅保留布局与组合逻辑，行数控制在数百行内（如目标 500 行以内）。

---

## 第二部分小结

- 数据/请求：useSidebarProjects、useSidebarFoldersLibraries。
- 状态：useSidebarModals、useSidebarContextMenu；树数据：useSidebarTree。
- UI：SidebarTreeView、SidebarUserMenu。
- Sidebar.tsx 最终职责：组合上述 hooks 与子组件、布局、事件监听入口（projectCreated、sidebar-toggle 等）、以及尚未迁出的逻辑（如 assets 拉取、Realtime 订阅等可按需再拆）。

建议每完成一步就提交并跑一遍构建与关键路径测试，便于定位问题。
