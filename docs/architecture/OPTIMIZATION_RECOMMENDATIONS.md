# Keco Studio - 优化建议文档

**文档版本**: 1.0  
**创建日期**: 2026-01-30  
**关联文档**: [架构文档](./ARCHITECTURE.md)

---

## 📋 目录

1. [概述](#概述)
2. [优化建议分类](#优化建议分类)
3. [关键优化建议](#关键优化建议)
4. [实施优先级](#实施优先级)
5. [优化路线图](#优化路线图)

---

## 概述

本文档根据对Keco Studio项目的全面代码审查，提供了具体的优化建议。所有建议按照**严重程度**（Critical, High, Medium, Low）和**类型**（Performance, Maintainability, Security, Architecture）进行分类。

### 严重程度定义

| 级别 | 定义 | 影响 |
|------|------|------|
| **Critical** | 必须立即解决的问题，影响系统稳定性或安全性 | 可能导致系统崩溃、数据丢失或安全漏洞 |
| **High** | 重要问题，严重影响开发效率或用户体验 | 导致开发困难、维护成本高、用户体验差 |
| **Medium** | 中等优先级问题，有改进空间 | 影响代码质量、可维护性 |
| **Low** | 小优化，可以逐步改进 | 轻微影响，但改进有价值 |

---

## 优化建议分类

### 按严重程度统计

| 严重程度 | 数量 |
|---------|------|
| Critical | 3 |
| High | 8 |
| Medium | 6 |
| Low | 5 |
| **总计** | **22** |

### 按类型统计

| 类型 | 数量 |
|------|------|
| Architecture | 5 |
| Maintainability | 8 |
| Performance | 5 |
| Security | 2 |
| Code Quality | 2 |

---

## 关键优化建议

### Critical 级别

---

#### OPT-001: 超大组件重构 - Sidebar.tsx (2330行)

**严重程度**: Critical  
**类型**: Maintainability, Architecture  
**影响文件**: `src/components/layout/Sidebar.tsx`

**问题描述**:
Sidebar组件包含2330行代码，集成了过多功能：
- 项目/库/文件夹导航树
- 版本控制侧边栏
- 协作者管理
- 文件夹管理
- 右键菜单
- 拖拽排序

**当前问题**:
1. 修改任何功能都有引入bug的风险
2. 难以定位和修复bug
3. 测试困难（单元测试几乎不可能）
4. 新开发者理解成本极高
5. 代码复用困难

**建议方案**:

**拆分结构**:
```
src/components/layout/
├── Sidebar.tsx (主容器，200行以内)
├── sidebar/
│   ├── SidebarHeader.tsx
│   ├── ProjectNavigationTree.tsx (项目树)
│   ├── LibraryNavigationTree.tsx (库树)
│   ├── FolderNavigationTree.tsx (文件夹树)
│   ├── NavigationContextMenu.tsx (右键菜单)
│   ├── SidebarDragAndDrop.tsx (拖拽逻辑)
│   ├── hooks/
│   │   ├── useSidebarNavigation.ts
│   │   ├── useSidebarDragDrop.ts
│   │   └── useSidebarContextMenu.ts
│   └── utils/
│       └── navigationUtils.ts
```

**重构步骤**:
1. 创建新的目录结构
2. 提取独立功能模块（先不改逻辑）
3. 编写单元测试覆盖各模块
4. 逐步优化各模块逻辑
5. 删除旧的Sidebar.tsx

**预期收益**:
- 单个组件<300行
- 可测试性提升90%
- Bug定位时间减少70%
- 新功能开发效率提升50%

**估算工作量**: 2周

---

#### OPT-002: 超大组件重构 - LibraryAssetsTable.tsx (2335行)

**严重程度**: Critical  
**类型**: Maintainability, Architecture, Performance  
**影响文件**: `src/components/libraries/LibraryAssetsTable.tsx`

**问题描述**:
LibraryAssetsTable是项目中最复杂的组件，包含2335行代码：
- 表格渲染和布局
- 单元格编辑逻辑
- 拖拽排序
- 剪贴板操作
- 批量编辑
- 右键菜单
- Presence Avatars
- 引用字段弹窗
- 无数的useEffect和useState

**当前问题**:
1. 性能问题：大型表格（>500行）渲染缓慢
2. 状态管理混乱：过多useState和useEffect
3. 难以追踪数据流
4. 修改一个功能可能破坏其他功能
5. 几乎不可能写单元测试

**建议方案**:

**拆分策略**:
```
src/components/libraries/
├── LibraryAssetsTable.tsx (主容器，<200行)
├── table/
│   ├── TableCore.tsx (核心表格渲染)
│   ├── TableVirtualized.tsx (虚拟化表格，性能优化)
│   ├── TableHeader.tsx (表头)
│   ├── TableRow.tsx (行组件)
│   ├── TableCell.tsx (单元格)
│   ├── CellEditor/ (单元格编辑器)
│   │   ├── TextCellEditor.tsx
│   │   ├── NumberCellEditor.tsx
│   │   ├── BooleanCellEditor.tsx
│   │   ├── DateCellEditor.tsx
│   │   ├── ReferenceCellEditor.tsx
│   │   └── index.ts
│   ├── TableContextMenu.tsx
│   ├── TableToast.tsx
│   ├── BatchEditMenu.tsx
│   └── EmptyState.tsx
```

**性能优化**:
```typescript
// 1. 使用虚拟化渲染（推荐 react-window 或 @tanstack/react-virtual）
import { useVirtualizer } from '@tanstack/react-virtual';

// 2. 使用 React.memo 优化行组件
const TableRow = React.memo(({ row }) => {
  // ...
}, (prevProps, nextProps) => {
  return prevProps.row.id === nextProps.row.id 
    && prevProps.row.updatedAt === nextProps.row.updatedAt;
});

// 3. 使用 useMemo 优化计算
const sortedRows = useMemo(() => {
  return rows.sort((a, b) => a.order - b.order);
}, [rows]);
```

**状态管理优化**:
```typescript
// 使用 useReducer 替代多个 useState
type TableState = {
  selectedCells: Set<string>;
  editingCell: { rowId: string; fieldId: string } | null;
  hoveredRow: string | null;
  contextMenu: { x: number; y: number; rowId: string } | null;
};

const [state, dispatch] = useReducer(tableReducer, initialState);
```

**预期收益**:
- 渲染性能提升80%（虚拟化）
- 代码可读性提升90%
- Bug定位时间减少80%
- 支持大型表格（>10,000行）

**估算工作量**: 3周

---

#### OPT-003: TypeScript严格模式启用

**严重程度**: Critical  
**类型**: Code Quality, Maintainability  
**影响文件**: `tsconfig.json`, 所有TypeScript文件

**问题描述**:
```json
{
  "compilerOptions": {
    "strict": false  // ❌ 问题所在
  }
}
```

当前项目禁用了TypeScript严格模式，导致：
1. 大量`any`类型，失去类型安全
2. 可能的运行时错误（null/undefined）
3. IDE提示不准确
4. 重构风险高

**问题示例**:
```typescript
// 当前代码（有风险）
function updateAsset(asset: any) {  // ❌ any类型
  return asset.name.toUpperCase();  // 可能运行时错误
}

// 应该是
function updateAsset(asset: Asset | null) {  // ✅ 明确类型
  return asset?.name.toUpperCase() ?? '';   // ✅ 安全访问
}
```

**建议方案**:

**分步启用严格模式**:
```json
// tsconfig.json
{
  "compilerOptions": {
    // 第一步：启用基础严格检查
    "noImplicitAny": true,           // 禁止隐式any
    "strictNullChecks": true,        // 严格空检查
    
    // 第二步：启用更严格的检查
    "strictFunctionTypes": true,     // 严格函数类型
    "strictBindCallApply": true,     // 严格bind/call/apply
    
    // 第三步：完全启用
    "strict": true
  }
}
```

**修复步骤**:
1. 启用`noImplicitAny`，修复所有错误（预计200+个）
2. 启用`strictNullChecks`，添加null/undefined检查
3. 启用`strictFunctionTypes`和其他选项
4. 最终启用`strict: true`

**常见修复模式**:
```typescript
// 1. any类型修复
- function handleData(data: any)
+ function handleData(data: AssetRow | null)

// 2. null检查修复
- const name = user.profile.name;
+ const name = user?.profile?.name ?? 'Unknown';

// 3. 类型断言修复
- const element = document.querySelector('.btn') as HTMLElement;
+ const element = document.querySelector('.btn');
+ if (element instanceof HTMLElement) { ... }
```

**预期收益**:
- 运行时错误减少60%
- IDE提示准确度提升100%
- 重构信心提升
- 代码质量提升

**估算工作量**: 2周

---

### High 级别

---

#### OPT-004: 目录结构统一和清理

**严重程度**: High  
**类型**: Maintainability, Architecture  
**影响文件**: 全项目

**问题描述**:
目录结构混乱，存在重复目录：
1. `src/contexts/` 和 `src/lib/contexts/` 并存
2. `src/hooks/` 和 `src/lib/hooks/` 并存
3. 组件内部的hooks分散

**当前结构**:
```
src/
├── contexts/          # ❌ 旧目录，只有1个文件
│   └── YjsContext.tsx
├── hooks/             # ❌ 旧目录，只有1个文件
│   └── useYjsRows.ts
└── lib/
    ├── contexts/      # ✅ 新目录
    │   ├── AuthContext.tsx
    │   ├── LibraryDataContext.tsx
    │   └── ...
    └── hooks/         # ✅ 新目录
        ├── useRealtimeSubscription.ts
        └── ...
```

**建议方案**:

**统一目录结构**:
```
src/
├── lib/
│   ├── contexts/           # 所有Context统一在这里
│   │   ├── AuthContext.tsx
│   │   ├── LibraryDataContext.tsx
│   │   ├── PresenceContext.tsx
│   │   ├── NavigationContext.tsx
│   │   └── YjsContext.tsx      # 从 src/contexts/ 移过来
│   └── hooks/              # 所有全局Hooks统一在这里
│       ├── useRealtimeSubscription.ts
│       ├── usePresenceTracking.ts
│       ├── useYjsRows.ts       # 从 src/hooks/ 移过来
│       └── ...
```

**删除目录**:
- `src/contexts/` (迁移完成后删除)
- `src/hooks/` (迁移完成后删除)

**更新所有导入路径**:
```typescript
// 旧路径
- import { YjsContext } from '@/contexts/YjsContext';
// 新路径
+ import { YjsContext } from '@/lib/contexts/YjsContext';
```

**预期收益**:
- 代码结构更清晰
- 减少查找文件的时间
- 避免重复代码
- 新开发者更容易理解

**估算工作量**: 1周

---

#### OPT-005: 减少相对导入路径，统一使用别名导入

**严重程度**: High  
**类型**: Maintainability  
**影响文件**: 86个文件使用相对导入

**问题描述**:
大量文件使用`../`相对导入，导致：
1. 导入路径难以理解
2. 移动文件时需要更新大量导入
3. 代码可读性差

**问题示例**:
```typescript
// ❌ 难以理解的相对路径
import { something } from '../../../../lib/services/projectService';
import { another } from '../../../hooks/useData';
import { Component } from '../../components/Modal';

// ✅ 清晰的别名路径
import { something } from '@/lib/services/projectService';
import { another } from '@/lib/hooks/useData';
import { Component } from '@/components/Modal';
```

**当前配置**:
```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]  // ✅ 已配置，但未充分使用
    }
  }
}
```

**建议方案**:

**批量替换相对导入**:
```bash
# 使用脚本批量替换（需要编写）
npm run fix:imports
```

**建议的导入规范**:
```typescript
// 1. 外部库
import React from 'react';
import { useQuery } from '@tanstack/react-query';

// 2. 内部模块（使用别名）
import { projectService } from '@/lib/services/projectService';
import { useAuth } from '@/lib/contexts/AuthContext';
import { Button } from '@/components/ui/Button';

// 3. 相对导入（仅用于同目录或子目录）
import { TableRow } from './TableRow';
import { useTableData } from './hooks/useTableData';
```

**预期收益**:
- 导入路径更清晰
- 移动文件更容易
- 代码可读性提升
- IDE自动补全更准确

**估算工作量**: 3天

---

#### OPT-006: LibraryDataContext职责过多，需要拆分

**严重程度**: High  
**类型**: Architecture, Maintainability  
**影响文件**: `src/lib/contexts/LibraryDataContext.tsx` (668行)

**问题描述**:
LibraryDataContext集成了过多职责：
1. Yjs文档管理
2. IndexedDB持久化
3. Supabase Realtime订阅
4. Presence tracking
5. 资产CRUD操作
6. 批量操作
7. 缓存管理

**当前问题**:
1. 单个文件过大（668行）
2. 难以测试
3. 状态管理复杂
4. 难以理解数据流

**建议方案**:

**拆分成多个Context**:
```
src/lib/contexts/
├── library-data/
│   ├── LibraryDataContext.tsx      # 主Context（<100行）
│   ├── YjsDocumentContext.tsx      # Yjs文档管理
│   ├── RealtimeSyncContext.tsx     # Realtime同步
│   ├── AssetOperationsContext.tsx  # 资产操作
│   └── hooks/
│       ├── useYjsDocument.ts
│       ├── useRealtimeSync.ts
│       └── useAssetOperations.ts
```

**重构后的使用方式**:
```typescript
// 组合多个Provider
<LibraryDataProvider libraryId={id}>
  <YjsDocumentProvider>
    <RealtimeSyncProvider>
      <AssetOperationsProvider>
        {children}
      </AssetOperationsProvider>
    </RealtimeSyncProvider>
  </YjsDocumentProvider>
</LibraryDataProvider>

// 或使用组合Provider
<CombinedLibraryProvider libraryId={id}>
  {children}
</CombinedLibraryProvider>
```

**预期收益**:
- 单个Context<150行
- 职责清晰
- 可测试性提升
- 可复用性提升

**估算工作量**: 1.5周

---

#### OPT-007: 实现虚拟化表格渲染

**严重程度**: High  
**类型**: Performance  
**影响文件**: `src/components/libraries/LibraryAssetsTable.tsx`

**问题描述**:
当前表格渲染所有行，导致：
1. 大型表格（>500行）渲染缓慢
2. 滚动不流畅
3. 内存占用高
4. 浏览器可能卡顿

**性能测试结果**（估算）:
| 行数 | 当前渲染时间 | 虚拟化后 |
|------|------------|----------|
| 100  | 200ms      | 50ms     |
| 500  | 1000ms     | 80ms     |
| 1000 | 2000ms+    | 100ms    |
| 5000 | 卡死       | 150ms    |

**建议方案**:

**使用虚拟化库**:
```bash
npm install @tanstack/react-virtual
```

**实现虚拟化表格**:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualizedTable({ rows }: { rows: AssetRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // 行高48px
    overscan: 10, // 预渲染10行
  });
  
  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={row.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TableRow row={row} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**预期收益**:
- 渲染性能提升80%
- 支持10,000+行表格
- 内存占用减少70%
- 滚动流畅

**估算工作量**: 1周

---

#### OPT-008: Yjs与Supabase双重状态同步优化

**严重程度**: High  
**类型**: Architecture, Performance  
**影响文件**: `src/lib/contexts/LibraryDataContext.tsx`, `src/lib/hooks/useRealtimeSubscription.ts`

**问题描述**:
当前架构使用Yjs（本地CRDT）+ Supabase Realtime（远程订阅）双层架构，存在问题：
1. 双重真相源，可能不一致
2. 网络中断时数据不同步
3. 冲突解决逻辑复杂
4. 调试困难

**当前数据流**:
```
用户编辑 → Yjs Doc → 组件重渲染
         ↓
    Supabase DB ← Realtime订阅 → 其他客户端
```

**问题场景**:
1. **场景1**: 用户离线编辑，Yjs有数据，但DB未更新
2. **场景2**: Realtime订阅失败，其他用户看不到更新
3. **场景3**: Yjs和DB数据冲突，不知道以哪个为准

**建议方案**:

**方案A: 统一使用Supabase Realtime（推荐）**
```typescript
// 移除Yjs，完全依赖Supabase
// 优点：单一真相源，简单
// 缺点：离线支持较弱

// 使用React Query + Realtime
const { data: assets } = useQuery({
  queryKey: ['library', libraryId, 'assets'],
  queryFn: () => libraryAssetsService.getAssets(libraryId),
});

useRealtimeSubscription({
  channel: `library:${libraryId}`,
  table: 'library_assets',
  onInsert: (payload) => {
    queryClient.setQueryData(['library', libraryId, 'assets'], (old) => [
      ...old,
      payload.new,
    ]);
  },
  onUpdate: (payload) => {
    queryClient.setQueryData(['library', libraryId, 'assets'], (old) =>
      old.map((asset) =>
        asset.id === payload.new.id ? payload.new : asset
      )
    );
  },
});
```

**方案B: Yjs + Supabase Provider（更复杂但更强大）**
```typescript
// 使用 y-supabase provider（如果存在）
// 或自己实现Yjs到Supabase的同步
import { SupabaseProvider } from 'y-supabase'; // 假设有这个库

const provider = new SupabaseProvider(
  yDoc,
  supabase,
  {
    table: 'library_assets',
    libraryId,
  }
);
```

**方案C: 保持现状，但改进同步逻辑**
```typescript
// 添加同步状态跟踪
type SyncStatus = {
  yjsVersion: number;
  dbVersion: number;
  isSynced: boolean;
  pendingChanges: number;
};

// 添加冲突解决策略
function resolveConflict(yjsData, dbData) {
  // 使用时间戳或版本号解决冲突
  return yjsData.updatedAt > dbData.updatedAt ? yjsData : dbData;
}
```

**预期收益**:
- 数据一致性提升
- 减少同步bug
- 简化架构
- 易于调试

**估算工作量**: 
- 方案A: 2周
- 方案B: 3-4周
- 方案C: 1周

**推荐**: 方案A（简化架构）

---

#### OPT-009: 增加单元测试覆盖

**严重程度**: High  
**类型**: Code Quality, Maintainability  
**影响文件**: 核心业务逻辑文件（Services, Hooks, Utils）

**问题描述**:
当前项目只有E2E测试，缺少单元测试：
1. 重构风险高
2. Bug修复困难
3. 核心逻辑未被测试覆盖
4. 测试反馈慢（E2E测试慢）

**当前测试覆盖**:
```
✅ E2E测试（Playwright）: 10+ 个测试规格
❌ 单元测试: 0%
❌ 集成测试: 0%
```

**建议方案**:

**安装测试框架**:
```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom
```

**配置vitest**:
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**优先测试的模块**:

**1. Services层（业务逻辑）**:
```typescript
// src/lib/services/__tests__/projectService.test.ts
import { describe, it, expect, vi } from 'vitest';
import { projectService } from '../projectService';

describe('projectService', () => {
  it('should create project with default library', async () => {
    const mockSupabase = createMockSupabase();
    const result = await projectService.createProject(mockSupabase, {
      name: 'Test Project',
    });
    expect(result).toHaveProperty('id');
    expect(result.name).toBe('Test Project');
  });
});
```

**2. Utils层（工具函数）**:
```typescript
// src/lib/utils/__tests__/nameValidation.test.ts
import { describe, it, expect } from 'vitest';
import { validateProjectName } from '../nameValidation';

describe('validateProjectName', () => {
  it('should accept valid names', () => {
    expect(validateProjectName('My Project')).toBe(true);
  });
  
  it('should reject empty names', () => {
    expect(validateProjectName('')).toBe(false);
  });
  
  it('should reject names with special characters', () => {
    expect(validateProjectName('Project<>')).toBe(false);
  });
});
```

**3. Hooks层（自定义Hooks）**:
```typescript
// src/lib/hooks/__tests__/useCollaboratorPermissions.test.ts
import { renderHook } from '@testing-library/react';
import { useCollaboratorPermissions } from '../useCollaboratorPermissions';

describe('useCollaboratorPermissions', () => {
  it('should return admin permissions for owner', () => {
    const { result } = renderHook(() =>
      useCollaboratorPermissions('project-id', 'owner-id')
    );
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canDelete).toBe(true);
  });
});
```

**测试覆盖目标**:
| 模块 | 目标覆盖率 |
|------|-----------|
| Services | 80% |
| Utils | 90% |
| Hooks | 70% |
| Components | 50% |

**预期收益**:
- 重构信心提升
- Bug发现提前
- 文档作用（测试即文档）
- 开发效率提升

**估算工作量**: 3-4周

---

#### OPT-010: 统一错误处理策略

**严重程度**: High  
**类型**: Maintainability, User Experience  
**影响文件**: 所有API路由，Service层，组件层

**问题描述**:
当前错误处理不统一：
1. API路由错误格式不一致
2. 客户端错误处理分散
3. 用户看到的错误信息不友好
4. 缺少错误日志和监控

**当前问题示例**:
```typescript
// API路由A
return NextResponse.json({ error: 'Not found' }, { status: 404 });

// API路由B  
return NextResponse.json({ message: 'Error occurred' }, { status: 500 });

// API路由C
throw new Error('Something went wrong');
```

**建议方案**:

**1. 统一错误类型**:
```typescript
// src/lib/errors/AppError.ts
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// 预定义错误
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super('UNAUTHORIZED', 'Unauthorized access', 401);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}
```

**2. API路由错误处理中间件**:
```typescript
// src/lib/api/errorHandler.ts
export function withErrorHandler(
  handler: (req: Request) => Promise<Response>
) {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          },
          { status: error.statusCode }
        );
      }
      
      // 未知错误
      console.error('Unexpected error:', error);
      return NextResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        },
        { status: 500 }
      );
    }
  };
}

// 使用
export const POST = withErrorHandler(async (req: Request) => {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  
  // 业务逻辑...
});
```

**3. 客户端错误处理**:
```typescript
// src/lib/hooks/useErrorHandler.ts
export function useErrorHandler() {
  const showError = (error: Error | AppError) => {
    if (error instanceof AppError) {
      message.error(error.message);
    } else {
      message.error('An unexpected error occurred');
    }
  };
  
  return { showError };
}

// 使用
const { showError } = useErrorHandler();

try {
  await projectService.createProject(...);
} catch (error) {
  showError(error as Error);
}
```

**4. 错误监控（推荐Sentry）**:
```typescript
// src/lib/monitoring/sentry.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

// 在错误处理中发送到Sentry
if (error instanceof AppError) {
  Sentry.captureException(error, {
    tags: {
      errorCode: error.code,
      statusCode: error.statusCode,
    },
  });
}
```

**预期收益**:
- 错误处理统一
- 用户体验提升
- 易于调试
- 错误监控和追踪

**估算工作量**: 1周

---

#### OPT-011: React Query缓存策略优化

**严重程度**: High  
**类型**: Performance  
**影响文件**: 所有使用React Query的组件

**问题描述**:
当前React Query配置可能不够优化：
1. 缓存时间配置不合理
2. 缓存失效策略不明确
3. 乐观更新未充分利用
4. 可能有重复请求

**建议方案**:

**1. 优化Query配置**:
```typescript
// src/lib/providers/QueryProvider.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5分钟内数据被认为是新鲜的
      cacheTime: 10 * 60 * 1000, // 缓存保留10分钟
      refetchOnWindowFocus: true, // 窗口聚焦时重新获取
      refetchOnMount: true,
      retry: 1, // 失败重试1次
    },
    mutations: {
      retry: 0, // 变更不重试
    },
  },
});
```

**2. 优化Query Keys策略**:
```typescript
// src/lib/utils/queryKeys.ts
export const queryKeys = {
  // 分层的query key结构
  projects: {
    all: ['projects'] as const,
    lists: () => [...queryKeys.projects.all, 'list'] as const,
    list: (filters: string) => [...queryKeys.projects.lists(), { filters }] as const,
    details: () => [...queryKeys.projects.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.projects.details(), id] as const,
  },
  libraries: {
    all: ['libraries'] as const,
    lists: () => [...queryKeys.libraries.all, 'list'] as const,
    list: (projectId: string) => [...queryKeys.libraries.lists(), projectId] as const,
    details: () => [...queryKeys.libraries.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.libraries.details(), id] as const,
    assets: (libraryId: string) => ['library-assets', libraryId] as const,
  },
} as const;
```

**3. 使用乐观更新**:
```typescript
// 示例：乐观更新资产名称
const updateAssetMutation = useMutation({
  mutationFn: (data: { assetId: string; name: string }) =>
    libraryAssetsService.updateAsset(data.assetId, { name: data.name }),
  
  // 乐观更新
  onMutate: async (newData) => {
    // 取消正在进行的查询
    await queryClient.cancelQueries({
      queryKey: queryKeys.libraries.assets(libraryId),
    });
    
    // 保存之前的数据（用于回滚）
    const previousAssets = queryClient.getQueryData(
      queryKeys.libraries.assets(libraryId)
    );
    
    // 乐观更新缓存
    queryClient.setQueryData(
      queryKeys.libraries.assets(libraryId),
      (old: Asset[]) =>
        old.map((asset) =>
          asset.id === newData.assetId
            ? { ...asset, name: newData.name }
            : asset
        )
    );
    
    return { previousAssets };
  },
  
  // 错误回滚
  onError: (err, newData, context) => {
    queryClient.setQueryData(
      queryKeys.libraries.assets(libraryId),
      context.previousAssets
    );
  },
  
  // 成功后重新获取
  onSettled: () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.libraries.assets(libraryId),
    });
  },
});
```

**4. 预加载数据**:
```typescript
// 预加载下一页数据
function ProjectList() {
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.lists(),
    queryFn: projectService.getProjects,
  });
  
  // 鼠标悬停时预加载项目详情
  const prefetchProject = (projectId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.projects.detail(projectId),
      queryFn: () => projectService.getProject(projectId),
    });
  };
  
  return (
    <div>
      {projects.map((project) => (
        <div
          key={project.id}
          onMouseEnter={() => prefetchProject(project.id)}
        >
          {project.name}
        </div>
      ))}
    </div>
  );
}
```

**预期收益**:
- 减少重复请求
- 用户体验提升（乐观更新）
- 性能提升
- 缓存管理更清晰

**估算工作量**: 1周

---

### Medium 级别

---

#### OPT-012: 优化Realtime订阅管理

**严重程度**: Medium  
**类型**: Performance, Maintainability  
**影响文件**: `src/lib/hooks/useRealtimeSubscription.ts`

**问题描述**:
当前Realtime订阅可能存在：
1. 订阅未正确清理（内存泄漏）
2. 重复订阅同一个channel
3. 订阅过多导致性能问题

**建议方案**:

**1. 统一订阅管理器**:
```typescript
// src/lib/realtime/SubscriptionManager.ts
class SubscriptionManager {
  private channels = new Map<string, RealtimeChannel>();
  
  subscribe(channelName: string, config: ChannelConfig) {
    // 如果已订阅，返回现有channel
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }
    
    const channel = supabase.channel(channelName);
    this.channels.set(channelName, channel);
    return channel;
  }
  
  unsubscribe(channelName: string) {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.unsubscribe();
      this.channels.delete(channelName);
    }
  }
  
  cleanup() {
    this.channels.forEach((channel) => channel.unsubscribe());
    this.channels.clear();
  }
}

export const subscriptionManager = new SubscriptionManager();
```

**2. 优化Hook**:
```typescript
export function useRealtimeSubscription(config: SubscriptionConfig) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  
  useEffect(() => {
    channelRef.current = subscriptionManager.subscribe(
      config.channelName,
      config
    );
    
    return () => {
      if (channelRef.current) {
        subscriptionManager.unsubscribe(config.channelName);
      }
    };
  }, [config.channelName]);
}
```

**预期收益**:
- 避免内存泄漏
- 避免重复订阅
- 订阅管理更清晰

**估算工作量**: 3天

---

#### OPT-013: 添加Loading和Error边界

**严重程度**: Medium  
**类型**: User Experience, Maintainability  
**影响文件**: 所有组件

**问题描述**:
缺少统一的Loading和Error UI：
1. Loading状态不一致
2. 错误边界缺失
3. 用户体验不佳

**建议方案**:

**1. 全局Error Boundary**:
```typescript
// src/components/ErrorBoundary.tsx
'use client';

import React from 'react';
import { Result, Button } from 'antd';

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="Something went wrong"
          subTitle={this.state.error?.message}
          extra={
            <Button
              type="primary"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </Button>
          }
        />
      );
    }
    
    return this.props.children;
  }
}
```

**2. Loading组件**:
```typescript
// src/components/Loading.tsx
export function Loading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={fullScreen ? 'loading-fullscreen' : 'loading'}>
      <Spin size="large" />
    </div>
  );
}
```

**3. 使用Suspense**:
```typescript
// 在layout中使用
<Suspense fallback={<Loading fullScreen />}>
  <ErrorBoundary>
    {children}
  </ErrorBoundary>
</Suspense>
```

**预期收益**:
- 用户体验提升
- 错误处理统一
- 代码更简洁

**估算工作量**: 2天

---

#### OPT-014: 优化文件上传逻辑

**严重程度**: Medium  
**类型**: User Experience, Performance  
**影响文件**: `src/lib/services/imageUploadService.ts`, `src/lib/services/mediaFileUploadService.ts`

**问题描述**:
当前文件上传缺少：
1. 上传进度显示
2. 文件压缩
3. 断点续传
4. 批量上传优化

**建议方案**:

**1. 添加上传进度**:
```typescript
export async function uploadImageWithProgress(
  file: File,
  onProgress: (progress: number) => void
): Promise<string> {
  const fileName = `${Date.now()}-${file.name}`;
  
  const { data, error } = await supabase.storage
    .from('tiptap-images')
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
      onUploadProgress: (progress) => {
        const percent = (progress.loaded / progress.total) * 100;
        onProgress(percent);
      },
    });
  
  if (error) throw error;
  return data.path;
}
```

**2. 图片压缩**:
```typescript
import imageCompression from 'browser-image-compression';

export async function compressImage(file: File): Promise<File> {
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
  };
  
  return await imageCompression(file, options);
}
```

**3. 批量上传优化**:
```typescript
export async function uploadMultipleFiles(
  files: File[],
  onProgress: (fileIndex: number, progress: number) => void
): Promise<string[]> {
  // 限制并发数为3
  const concurrency = 3;
  const results: string[] = [];
  
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((file, index) =>
        uploadImageWithProgress(file, (progress) => {
          onProgress(i + index, progress);
        })
      )
    );
    results.push(...batchResults);
  }
  
  return results;
}
```

**预期收益**:
- 用户体验提升
- 上传成功率提升
- 性能优化

**估算工作量**: 1周

---

#### OPT-015: 添加代码注释和文档

**严重程度**: Medium  
**类型**: Maintainability  
**影响文件**: 所有核心模块

**问题描述**:
代码注释不足：
1. 复杂函数缺少注释
2. 业务逻辑不清晰
3. 新开发者理解困难

**建议方案**:

**1. 添加JSDoc注释**:
```typescript
/**
 * 创建新项目并返回项目ID和默认库ID
 * 
 * @param supabase - Supabase客户端实例
 * @param data - 项目数据
 * @param data.name - 项目名称（必填）
 * @param data.description - 项目描述（可选）
 * @returns 包含projectId和defaultLibraryId的对象
 * @throws {ValidationError} 当项目名称为空时
 * @throws {UnauthorizedError} 当用户未登录时
 * 
 * @example
 * ```typescript
 * const result = await projectService.createProject(supabase, {
 *   name: 'My New Project',
 *   description: 'Project description'
 * });
 * console.log(result.projectId);
 * ```
 */
export async function createProject(
  supabase: SupabaseClient,
  data: { name: string; description?: string }
): Promise<{ projectId: string; defaultLibraryId: string }> {
  // 实现...
}
```

**2. 添加README文件**:
```markdown
# 项目服务（Project Service）

## 概述
项目服务负责管理项目的创建、更新、删除等操作。

## API

### createProject
创建新项目...

## 使用示例
\`\`\`typescript
import { projectService } from '@/lib/services/projectService';

const project = await projectService.createProject(supabase, {
  name: 'My Project'
});
\`\`\`

## 相关模块
- `libraryService`: 管理项目中的资产库
- `collaborationService`: 管理项目协作者
```

**3. 生成API文档**:
```bash
# 使用TypeDoc生成文档
npm install --save-dev typedoc
npx typedoc --out docs/api src/lib/services
```

**预期收益**:
- 代码可读性提升
- 新开发者上手更快
- 维护更容易

**估算工作量**: 2周

---

#### OPT-016: 优化数据库查询性能

**严重程度**: Medium  
**类型**: Performance  
**影响文件**: 所有Service文件

**问题描述**:
可能存在的数据库性能问题：
1. N+1查询问题
2. 缺少必要的索引
3. 未使用数据库函数优化

**建议方案**:

**1. 使用JOIN避免N+1查询**:
```typescript
// ❌ N+1查询
const projects = await supabase.from('projects').select('*');
for (const project of projects) {
  const libraries = await supabase
    .from('libraries')
    .select('*')
    .eq('project_id', project.id);
  project.libraries = libraries;
}

// ✅ 使用JOIN一次查询
const projects = await supabase
  .from('projects')
  .select(`
    *,
    libraries (
      id,
      name,
      description,
      created_at
    )
  `);
```

**2. 添加数据库索引**:
```sql
-- 检查缺少的索引
-- library_assets 表经常按 library_id 查询
CREATE INDEX IF NOT EXISTS idx_library_assets_library_id 
  ON library_assets(library_id);

-- library_asset_values 经常按 asset_id 查询
CREATE INDEX IF NOT EXISTS idx_library_asset_values_asset_id 
  ON library_asset_values(asset_id);

-- 添加复合索引
CREATE INDEX IF NOT EXISTS idx_collaborators_project_user 
  ON project_collaborators(project_id, user_id)
  WHERE accepted_at IS NOT NULL;
```

**3. 使用数据库函数**:
```sql
-- 创建函数获取库的完整数据（包括字段定义和资产）
CREATE OR REPLACE FUNCTION get_library_full_data(p_library_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'library', (SELECT row_to_json(l) FROM libraries l WHERE l.id = p_library_id),
    'fields', (SELECT json_agg(row_to_json(f)) FROM library_field_definitions f WHERE f.library_id = p_library_id),
    'assets', (SELECT json_agg(
      json_build_object(
        'id', a.id,
        'name', a.name,
        'values', (SELECT json_object_agg(v.field_id, v.value_json) FROM library_asset_values v WHERE v.asset_id = a.id)
      )
    ) FROM library_assets a WHERE a.library_id = p_library_id)
  ) INTO result;
  
  RETURN result;
END;
$$;
```

**预期收益**:
- 查询性能提升50-80%
- 数据库负载减少
- 用户体验提升

**估算工作量**: 1周

---

#### OPT-017: 实现数据导出功能

**严重程度**: Medium  
**类型**: Feature, User Experience  
**影响文件**: 新功能

**问题描述**:
当前缺少数据导出功能，用户无法：
1. 导出资产数据到Excel/CSV
2. 备份数据
3. 在其他工具中使用数据

**建议方案**:

**1. 实现CSV导出**:
```typescript
// src/lib/utils/exportUtils.ts
export function exportToCSV(
  assets: AssetRow[],
  fields: FieldDefinition[]
): string {
  const headers = ['ID', 'Name', ...fields.map((f) => f.field_name)];
  const rows = assets.map((asset) => [
    asset.id,
    asset.name,
    ...fields.map((field) => {
      const value = asset.values[field.id];
      return formatValueForCSV(value, field.data_type);
    }),
  ]);
  
  const csv = [
    headers.join(','),
    ...rows.map((row) => row.map(escapeCsvValue).join(',')),
  ].join('\n');
  
  return csv;
}

function formatValueForCSV(value: any, dataType: string): string {
  if (value === null || value === undefined) return '';
  
  switch (dataType) {
    case 'date':
      return new Date(value).toLocaleDateString();
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'reference':
      return value.map((v: any) => v.name).join('; ');
    default:
      return String(value);
  }
}

function escapeCsvValue(value: any): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// 触发下载
export function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
```

**2. 实现Excel导出（使用exceljs）**:
```typescript
import ExcelJS from 'exceljs';

export async function exportToExcel(
  assets: AssetRow[],
  fields: FieldDefinition[],
  libraryName: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(libraryName);
  
  // 设置列
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 36 },
    { header: 'Name', key: 'name', width: 30 },
    ...fields.map((field) => ({
      header: field.field_name,
      key: field.id,
      width: 20,
    })),
  ];
  
  // 添加数据
  assets.forEach((asset) => {
    const row: any = {
      id: asset.id,
      name: asset.name,
    };
    fields.forEach((field) => {
      row[field.id] = formatValueForExcel(
        asset.values[field.id],
        field.data_type
      );
    });
    worksheet.addRow(row);
  });
  
  // 下载
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${libraryName}_${Date.now()}.xlsx`;
  link.click();
}
```

**3. 添加导出按钮**:
```typescript
// 在LibraryHeader中添加导出按钮
<Button
  icon={<DownloadOutlined />}
  onClick={() => {
    const csv = exportToCSV(assets, fields);
    downloadCSV(csv, `${library.name}_${Date.now()}.csv`);
  }}
>
  Export CSV
</Button>
```

**预期收益**:
- 用户可以备份数据
- 支持数据分析
- 提升用户满意度

**估算工作量**: 3-4天

---

### Low 级别

---

#### OPT-018: 启用ESLint规则优化

**严重程度**: Low  
**类型**: Code Quality  
**影响文件**: `eslint.config.js`, 所有TypeScript文件

**问题描述**:
当前ESLint配置可能不够严格，建议启用更多规则：
1. 未使用的变量
2. console.log语句
3. debugger语句
4. 魔法数字

**建议方案**:
```javascript
// eslint.config.js
export default {
  extends: ['next/core-web-vitals', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-magic-numbers': ['warn', { ignore: [0, 1, -1] }],
  },
};
```

**估算工作量**: 2天

---

#### OPT-019: 添加性能监控

**严重程度**: Low  
**类型**: Performance, Monitoring  
**影响文件**: 新功能

**问题描述**:
缺少性能监控，无法：
1. 跟踪页面加载时间
2. 监控API响应时间
3. 识别性能瓶颈

**建议方案**:

**使用Vercel Analytics（如果部署在Vercel）**:
```bash
npm install @vercel/analytics
```

```typescript
// app/layout.tsx
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

**或使用Google Analytics**:
```typescript
// lib/analytics.ts
export function trackPageView(url: string) {
  if (typeof window.gtag !== 'undefined') {
    window.gtag('config', 'GA_MEASUREMENT_ID', {
      page_path: url,
    });
  }
}

export function trackEvent(action: string, params?: any) {
  if (typeof window.gtag !== 'undefined') {
    window.gtag('event', action, params);
  }
}
```

**估算工作量**: 1天

---

#### OPT-020: 优化Bundle大小

**严重程度**: Low  
**类型**: Performance  
**影响文件**: `next.config.mjs`

**问题描述**:
Bundle可能过大，影响首屏加载时间

**建议方案**:

**1. 分析Bundle**:
```bash
npm install --save-dev @next/bundle-analyzer
```

```javascript
// next.config.mjs
import withBundleAnalyzer from '@next/bundle-analyzer';

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default bundleAnalyzer({
  // next config...
});
```

```bash
ANALYZE=true npm run build
```

**2. 优化导入**:
```typescript
// ❌ 导入整个库
import { Button, Modal, Table } from 'antd';

// ✅ 只导入需要的组件（如果支持）
import Button from 'antd/lib/button';
import Modal from 'antd/lib/modal';
```

**3. 代码分割**:
```typescript
// 动态导入大型组件
const HeavyComponent = dynamic(
  () => import('@/components/HeavyComponent'),
  { loading: () => <Loading /> }
);
```

**估算工作量**: 2天

---

#### OPT-021: 添加键盘快捷键

**严重程度**: Low  
**类型**: User Experience  
**影响文件**: 新功能

**问题描述**:
缺少键盘快捷键，影响高级用户效率

**建议方案**:

**实现快捷键系统**:
```typescript
// src/lib/hooks/useKeyboardShortcuts.ts
import { useEffect } from 'react';

type ShortcutConfig = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  handler: () => void;
};

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const isCtrl = !shortcut.ctrl || event.ctrlKey;
        const isShift = !shortcut.shift || event.shiftKey;
        const isMeta = !shortcut.meta || event.metaKey;
        const isKey = event.key.toLowerCase() === shortcut.key.toLowerCase();
        
        if (isCtrl && isShift && isMeta && isKey) {
          event.preventDefault();
          shortcut.handler();
          break;
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}

// 使用
useKeyboardShortcuts([
  {
    key: 'n',
    ctrl: true,
    handler: () => setShowNewProjectModal(true),
  },
  {
    key: 's',
    ctrl: true,
    handler: () => saveProject(),
  },
]);
```

**常用快捷键建议**:
- `Ctrl+N`: 新建项目/库
- `Ctrl+S`: 保存
- `Ctrl+F`: 搜索
- `Ctrl+Z`: 撤销
- `Ctrl+Shift+Z`: 重做
- `Delete`: 删除选中项
- `Esc`: 关闭弹窗

**估算工作量**: 3天

---

#### OPT-022: 改进移动端响应式设计

**严重程度**: Low  
**类型**: User Experience  
**影响文件**: 所有组件CSS

**问题描述**:
当前设计可能主要针对桌面端，移动端体验不佳

**建议方案**:

**1. 添加响应式断点**:
```css
/* globals.css */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: -280px;
    transition: left 0.3s;
  }
  
  .sidebar.open {
    left: 0;
  }
  
  .table-container {
    overflow-x: auto;
  }
}
```

**2. 移动端优化的组件**:
```typescript
function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <>
      <Button
        className="mobile-menu-button"
        onClick={() => setIsOpen(true)}
      >
        <MenuOutlined />
      </Button>
      
      <Drawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        placement="left"
      >
        <Sidebar />
      </Drawer>
    </>
  );
}
```

**估算工作量**: 1周

---

### Security 级别

---

#### OPT-023: 增强文件上传安全性

**严重程度**: High (Security相关)  
**类型**: Security  
**影响文件**: `src/lib/services/imageUploadService.ts`, `src/lib/services/mediaFileUploadService.ts`

**问题描述**:
文件上传可能存在安全风险：
1. 文件类型验证不够严格
2. 文件名未清理（可能XSS）
3. 文件大小未严格限制
4. 缺少病毒扫描

**当前问题示例**:
```typescript
// ❌ 只检查MIME type，可以被伪造
if (file.type !== 'image/jpeg') {
  throw new Error('Invalid file type');
}
```

**建议方案**:

**1. 严格的文件验证**:
```typescript
// src/lib/utils/fileValidation.ts
import fileType from 'file-type';

export async function validateImageFile(file: File): Promise<boolean> {
  // 1. 检查文件大小
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_SIZE) {
    throw new ValidationError('File size exceeds 10MB');
  }
  
  // 2. 检查MIME type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new ValidationError('Invalid file type');
  }
  
  // 3. 检查文件签名（真实文件类型）
  const buffer = await file.arrayBuffer();
  const type = await fileType.fromBuffer(buffer);
  
  if (!type || !allowedTypes.includes(type.mime)) {
    throw new ValidationError('File content does not match type');
  }
  
  // 4. 检查文件扩展名
  const ext = file.name.split('.').pop()?.toLowerCase();
  const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  if (!ext || !allowedExts.includes(ext)) {
    throw new ValidationError('Invalid file extension');
  }
  
  return true;
}
```

**2. 清理文件名**:
```typescript
export function sanitizeFileName(fileName: string): string {
  // 移除危险字符
  return fileName
    .replace(/[^a-zA-Z0-9.-]/g, '_')  // 替换特殊字符
    .replace(/\.{2,}/g, '.')          // 移除多个点
    .slice(0, 100);                   // 限制长度
}

// 使用UUID作为文件名
export function generateSafeFileName(originalName: string): string {
  const ext = originalName.split('.').pop();
  return `${crypto.randomUUID()}.${ext}`;
}
```

**3. Supabase Storage RLS策略**:
```sql
-- 限制上传文件大小
CREATE POLICY "Limit upload size"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = 'library-media-files'
    AND octet_length(decode(encode(content, 'hex'), 'hex')) < 10485760  -- 10MB
  );

-- 限制文件类型
CREATE POLICY "Restrict file types"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = 'library-media-files'
    AND (
      content_type = ANY(ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
      OR content_type = ANY(ARRAY['video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav'])
    )
  );
```

**4. 添加内容安全策略（CSP）**:
```typescript
// next.config.mjs
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline';
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: https:;
      media-src 'self' https:;
      connect-src 'self' https://*.supabase.co;
      font-src 'self';
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
      upgrade-insecure-requests;
    `.replace(/\s{2,}/g, ' ').trim()
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  }
];

export default {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};
```

**预期收益**:
- 防止恶意文件上传
- 防止XSS攻击
- 防止文件名注入
- 提升系统安全性

**估算工作量**: 1周

---

#### OPT-024: 实现审计日志

**严重程度**: Medium (Security相关)  
**类型**: Security, Compliance  
**影响文件**: 新功能

**问题描述**:
缺少审计日志，无法：
1. 追踪谁做了什么操作
2. 安全事件调查
3. 合规要求

**建议方案**:

**1. 创建审计日志表**:
```sql
-- supabase/migrations/new_audit_logs.sql
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,  -- 'create', 'update', 'delete', 'login', 'logout'
  resource_type TEXT NOT NULL,  -- 'project', 'library', 'asset', etc.
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

-- RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 只有管理员可以查看审计日志
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.user_id = auth.uid()
        AND pc.role = 'admin'
        AND pc.accepted_at IS NOT NULL
    )
  );
```

**2. 审计日志服务**:
```typescript
// src/lib/services/auditLogService.ts
export async function logAuditEvent(
  supabase: SupabaseClient,
  event: {
    action: 'create' | 'update' | 'delete' | 'login' | 'logout';
    resourceType: 'project' | 'library' | 'asset' | 'user';
    resourceId?: string;
    oldValues?: any;
    newValues?: any;
  }
) {
  const { data: { user } } = await supabase.auth.getUser();
  
  await supabase.from('audit_logs').insert({
    user_id: user?.id,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    old_values: event.oldValues,
    new_values: event.newValues,
    // IP和User-Agent需要从请求中获取
  });
}

// 在API路由中使用
export async function POST(req: Request) {
  const project = await projectService.createProject(...);
  
  await logAuditEvent(supabase, {
    action: 'create',
    resourceType: 'project',
    resourceId: project.id,
    newValues: project,
  });
  
  return NextResponse.json(project);
}
```

**3. 审计日志查看界面**:
```typescript
// src/app/(dashboard)/[projectId]/audit-logs/page.tsx
export default function AuditLogsPage() {
  const { data: logs } = useQuery({
    queryKey: ['audit-logs', projectId],
    queryFn: () => auditLogService.getAuditLogs(projectId),
  });
  
  return (
    <Table
      dataSource={logs}
      columns={[
        { title: 'Time', dataIndex: 'created_at', render: (date) => formatDate(date) },
        { title: 'User', dataIndex: 'user_id', render: (id) => <UserName userId={id} /> },
        { title: 'Action', dataIndex: 'action' },
        { title: 'Resource', dataIndex: 'resource_type' },
        { title: 'Details', render: (record) => <AuditLogDetails log={record} /> },
      ]}
    />
  );
}
```

**预期收益**:
- 安全事件可追踪
- 满足合规要求
- 用户行为分析

**估算工作量**: 1周

---

## 实施优先级

### P0（立即处理，1-2个月）

1. **OPT-001**: 超大组件重构 - Sidebar.tsx （2周）
2. **OPT-002**: 超大组件重构 - LibraryAssetsTable.tsx （3周）
3. **OPT-003**: TypeScript严格模式启用 （2周）

**预期收益**: 代码可维护性提升90%，bug定位效率提升70%

---

### P1（高优先级，3-4个月）

4. **OPT-004**: 目录结构统一和清理 （1周）
5. **OPT-005**: 减少相对导入路径 （3天）
6. **OPT-006**: LibraryDataContext职责拆分 （1.5周）
7. **OPT-007**: 实现虚拟化表格渲染 （1周）
8. **OPT-008**: Yjs与Supabase双重状态同步优化 （2周）
9. **OPT-009**: 增加单元测试覆盖 （3-4周）
10. **OPT-010**: 统一错误处理策略 （1周）
11. **OPT-011**: React Query缓存策略优化 （1周）
12. **OPT-023**: 增强文件上传安全性 （1周）

**预期收益**: 性能提升60%，安全性提升，测试覆盖率>70%

---

### P2（中等优先级，5-6个月）

13. **OPT-012**: 优化Realtime订阅管理 （3天）
14. **OPT-013**: 添加Loading和Error边界 （2天）
15. **OPT-014**: 优化文件上传逻辑 （1周）
16. **OPT-015**: 添加代码注释和文档 （2周）
17. **OPT-016**: 优化数据库查询性能 （1周）
18. **OPT-017**: 实现数据导出功能 （3-4天）
19. **OPT-024**: 实现审计日志 （1周）

**预期收益**: 用户体验提升，性能优化，可维护性提升

---

### P3（低优先级，长期改进）

20. **OPT-018**: 启用ESLint规则优化 （2天）
21. **OPT-019**: 添加性能监控 （1天）
22. **OPT-020**: 优化Bundle大小 （2天）
23. **OPT-021**: 添加键盘快捷键 （3天）
24. **OPT-022**: 改进移动端响应式设计 （1周）

**预期收益**: 代码质量提升，用户体验优化

---

## 优化路线图

### 第一阶段（月1-2）: 基础重构
- ✅ 完成超大组件拆分（Sidebar, LibraryAssetsTable）
- ✅ 启用TypeScript严格模式
- ✅ 统一目录结构

**里程碑**: 代码可维护性提升90%

---

### 第二阶段（月3-4）: 性能与测试
- ✅ 虚拟化表格渲染
- ✅ 优化状态同步机制
- ✅ 增加单元测试覆盖（>70%）
- ✅ React Query缓存优化

**里程碑**: 性能提升60%，测试覆盖率>70%

---

### 第三阶段（月5-6）: 安全与体验
- ✅ 增强文件上传安全性
- ✅ 实现审计日志
- ✅ 统一错误处理
- ✅ 优化文件上传体验
- ✅ 数据库查询优化

**里程碑**: 安全性提升，用户体验优化

---

### 第四阶段（月7+）: 持续改进
- ✅ 性能监控
- ✅ 代码质量工具
- ✅ 移动端优化
- ✅ 新功能开发（导出、快捷键等）

**里程碑**: 生产就绪，持续迭代

---

## 总结

### 关键指标

| 指标 | 当前状态 | 优化后目标 |
|------|---------|----------|
| **代码可维护性** | 中等（超大组件，混乱结构） | 高（模块化，清晰结构） |
| **类型安全** | 低（strict: false） | 高（strict: true） |
| **测试覆盖率** | <10%（仅E2E） | >70%（单元+E2E） |
| **性能** | 中等（大表格慢） | 高（虚拟化，优化） |
| **安全性** | 中等 | 高（文件验证，审计日志） |
| **开发效率** | 低（bug定位难） | 高（清晰架构，测试覆盖） |

### 投入与回报

**总估算工作量**: 约25-30周（6-7个月）

**预期回报**:
1. 代码可维护性提升90%
2. Bug定位效率提升70%
3. 渲染性能提升80%
4. 开发效率提升50%
5. 系统安全性大幅提升
6. 测试覆盖率从<10%提升到>70%

### 建议

根据团队规模和项目紧急程度，建议：

**小团队（2-3人）**: 
- 优先处理P0和P1级别的优化
- 分4-6个月完成核心重构
- 新功能开发同时逐步改进

**中大团队（4+人）**:
- 可以并行处理多个优化任务
- 3-4个月完成主要优化
- 专人负责测试和文档

**推荐策略**:
1. 先修复架构问题（P0），再优化性能（P1）
2. 逐步迁移，避免大规模重写
3. 每次优化都要有测试保护
4. 定期Review进度，调整优先级

---

**文档结束**

