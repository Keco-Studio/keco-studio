# 协作与表格关系：问题分析与统一方案

## 一、现象

多人协作编辑同一张 Table 时：
- Owner 看到的第 2 行 `name` 为 `1001`
- 协作者 A 看到的第 2 行 `name` 为 `素有五点】`
- 协作者 B 又看到另一份行顺序/内容

即：**同一张表在不同客户端上，行顺序与内容不一致**。

## 二、架构现状（双轨制）

### 2.1 两套数据源

| 层级 | 用途 | 技术 | 持久化 | 跨端同步 |
|------|------|------|--------|----------|
| **LibraryDataContext** | 表格内容（单元格、行数据） | Yjs `Y.Map` (yAssets) + Supabase Realtime | IndexedDB `library-${libraryId}` | ✅ Realtime broadcast + postgres_changes → 写回 Yjs |
| **YjsContext** | 表格行顺序（Y.Array） | Yjs `Y.Array` (yRows) | IndexedDB `asset-table-${libraryId}` | ❌ 仅本地，**不跨端同步** |

### 2.2 数据流简述

1. **内容**
   - 初始：`loadInitialData()` 从 DB 拉取 `library_assets` + `library_asset_values`，写入 `yAssets`。
   - 本地编辑：`updateAssetField` / `updateAssetName` 先写 Yjs，再写 DB，再 `broadcastCellUpdate`。
   - 远端：Realtime 收到 `cell:update` / `asset:create` / `asset:delete` 或 postgres_changes，在 **LibraryDataContext** 里更新 `yAssets`；React 状态 `assets` 由 `yAssets.observeDeep` 得到，`allAssets` = `assets` 按 `created_at` 排序。

2. **顺序**
   - 表格拿到的 `rows` 来自 Adapter：`rows = allAssets`（即上面按 `created_at` 排序的数组）。
   - 表格内部：`useYjsSync(rows, yRows)` 把 `rows` 与本地 **yRows**（Y.Array）做增量同步；展示用 `allRowsSource = yjsRows.length > 0 ? yjsRows : rows`。
   - 因此：**展示顺序** 在“有 yRows 时”来自本地 **yRows**，而 yRows 仅本地 IndexedDB，**不随 Realtime 同步**。

### 2.3 冲突来源归纳

1. **行顺序不一致**
   - **LibraryDataContext** 的 `allAssets` 顺序 = `assets`（来自 Y.Map）按 `created_at` 排序。  
     - Y.Map 遍历顺序在不同客户端、不同更新顺序下可能不一致；  
     - 若某行缺少 `created_at`（见下），排序结果会不同。
   - **协作者收到新行时**：`handleAssetCreateEvent` 只往 `yAssets` 里塞了 `name`、`propertyValues`，**没有设置 `created_at`**。  
     - 发送方：本地 `createAsset` 写 DB 后拿到的 `created_at` 会写入 yAsset，排序正确。  
     - 接收方：没有 `created_at`，`allAssets` 排序时被排到末尾，**同一行在不同端处于不同位置**。
   - **YjsContext 的 yRows**：每个客户端本地一份，可能来自上次会话或不同步的合并结果；`useYjsSync` 在“非大改”时只做增量更新，**不强制用 `rows` 的顺序重排 yRows**，所以本地顺序可能与 Context 的 `rows`（allAssets）不一致。
   - 结果：有人看“第 2 行是 1001”，有人看“第 2 行是 素有五点】”，本质是 **顺序错位**，不是单格内容冲突。

2. **内容与顺序混用两套 Yjs**
   - 内容以 **LibraryDataContext（yAssets + Realtime）** 为准，顺序却混用 **YjsContext（yRows，仅本地）**，没有统一“唯一真相源”，容易出现你描述的“Realtime 和 Yjs 打架”的体感。

## 三、统一方案（单源顺序 + 确定性排序）

### 3.1 原则

- **内容**：继续以 **LibraryDataContext（yAssets）** 为唯一真相源，Realtime 只负责把远端变更写回 yAssets。
- **顺序**：以 **LibraryDataContext 的 `allAssets`** 为唯一顺序来源；表格展示顺序与 `allAssets` 一致，yRows 仅作本地缓存且不得与 `rows` 顺序相悖。

### 3.2 具体改动

1. **协作者收到新行时补全 `created_at`**  
   - 在 `handleAssetCreateEvent` 中：  
     - 若事件带 `targetCreatedAt`，则 `yAsset.set('created_at', event.targetCreatedAt)`；  
     - 若无则用 `event.timestamp` 或 `new Date().toISOString()` 作为兜底。  
   - 这样所有客户端对同一行的 `created_at` 一致，`allAssets` 排序一致。

2. **`allAssets` 排序确定性**  
   - 在 `allAssets` 的 sort 中增加次键：先按 `created_at`，再按 `id`。  
   - 避免 `created_at` 相同时不同客户端顺序不同。

3. **表格顺序与 Context 对齐**  
   - 在 `useYjsSync` 中：若当前 `yRows` 的 id 顺序与 `rows` 的 id 顺序不一致，则用 `rows` 做一次**整表替换**（清空 yRows 再 `insert(0, rows)`），保证展示顺序与 `rows`（即 allAssets）一致。  
   - 这样即使用户曾有过本地 yRows 历史，也会被纠正为与当前 Context 一致。

4. **（可选）postgres 新行事件带上 created_at**  
   - 从 DB 的 INSERT 构造 `AssetCreateEvent` 时，把 `newRecord.created_at` 放进 `targetCreatedAt`，这样通过 postgres_changes 收到的新行也有正确 `created_at`。

### 3.3 不改动的部分

- Realtime 仍只驱动“内容”更新到 **LibraryDataContext** 的 yAssets；不引入“行顺序”的 Realtime 同步。
- YjsContext 的 yRows 仍只做本地缓存与乐观 UI（如插入占位），但**顺序以 rows 为准**，通过上述“顺序不一致则整表替换”保证与 allAssets 一致。

## 四、预期效果

- 所有客户端 `allAssets` 顺序一致（created_at + id 确定性排序）。
- 协作者收到新行时也有 `created_at`，不会出现“新行在别人那排到末尾”的错位。
- 表格展示顺序与 `allAssets` 一致，多人看到的“第 N 行”对应同一条 asset，行内容与顺序一致。

## 五、已实施的修复清单（汇总）

### 5.1 行数/行序不一致（如 44 vs 28）

| 问题 | 修改 | 文件 |
|------|------|------|
| 本地 yRows 与 Context 行集合/顺序不一致 | `useYjsSync` 在行集合或顺序与 `rows` 不一致时，用 `rows` 做整表替换 | `useYjsSync.ts` |
| IndexedDB 恢复覆盖 DB 最新数据 | 在 IndexedDB `synced` 事件后执行 `loadInitialData()`，用 DB 覆盖本地恢复的旧数据 | `LibraryDataContext.tsx` |

### 5.2 列数不一致（如 4 列 vs 8 列）

| 问题 | 修改 | 文件 |
|------|------|------|
| 库 schema 被 React Query 缓存，不同端看到不同列数 | 为 `librarySchema` 查询添加 `refetchOnMount: 'always'` | `page.tsx` |

### 5.3 Cut/清空操作不同步

| 问题 | 修改 | 文件 |
|------|------|------|
| name 列清空后协作者端不消失 | `handleCellUpdateEvent` 在 `propertyKey === 'name'` 时同时更新 `yAsset.set('name', valueForYjs ?? '')` | `LibraryDataContext.tsx` |
| 批量清空时逐个消失、体验差 | 对收到的 cell 更新做批量队列，约 1 帧内合并后用一次 `yDoc.transact()` 应用 | `LibraryDataContext.tsx` |

### 5.4 其他修复

| 问题 | 修改 | 文件 |
|------|------|------|
| `loadInitialData` before initialization | 将 IndexedDB 的 `useEffect` 移到 `loadInitialData` 定义之后 | `LibraryDataContext.tsx` |
| `useYjsSync` 中 `[...setY]` 的 TypeScript 报错 | 使用 `Array.from(setY).every((id: string) => ...)` | `useYjsSync.ts` |
| 定时器与浏览器兼容 | 用 `ReturnType<typeof setTimeout>` 替代 `NodeJS.Timeout`，并在 unmount 时清理 | `LibraryDataContext.tsx` |

---

## 六、数据流与设计原则（修复后）

```
┌─────────────────────────────────────────────────────────────────┐
│  唯一真相源：LibraryDataContext (yAssets + DB)                    │
│  - 行内容、行顺序（按 created_at + id 排序）                      │
│  - Realtime broadcast/postgres_changes 写回 yAssets              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  表格展示：allAssets → rows → useYjsSync → allRowsSource         │
│  - yRows 仅作本地缓存，顺序/集合以 rows 为准                     │
│  - 不一致时整表替换，保证与 Context 一致                         │
└─────────────────────────────────────────────────────────────────┘
```

- **内容**：以 LibraryDataContext（yAssets）为唯一来源，Realtime 只负责把远端变更写回 yAssets。
- **顺序**：以 `allAssets`（created_at + id 排序）为唯一顺序来源，yRows 与 rows 保持一致。

---

## 七、后续可选增强

- 若希望行顺序也支持“拖拽排序”并同步，可考虑在 LibraryDataContext 中为 asset 增加 `order_index` 或沿用 `created_at` 的显式更新，并仍以 Context 为唯一顺序源，Realtime 只同步内容与顺序字段，表格继续只消费 `allAssets`。
