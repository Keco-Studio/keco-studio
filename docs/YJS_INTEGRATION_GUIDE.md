# Yjs 集成指南 - 从零开始

## 📚 目录
1. [Yjs 是什么？](#yjs-是什么)
2. [Yjs 能解决什么问题？](#yjs-能解决什么问题)
3. [在表格中的优势](#在表格中的优势)
4. [安装和准备](#安装和准备)
5. [核心概念](#核心概念)
6. [集成步骤](#集成步骤)
7. [代码改动示例](#代码改动示例)
8. [与 Supabase Realtime 集成](#与-supabase-realtime-集成)
9. [常见问题](#常见问题)

---

## Yjs 是什么？

**Yjs** 是一个 **CRDT（Conflict-free Replicated Data Types，无冲突复制数据类型）** 框架，专门用于实现多人协作编辑。

### 简单理解

想象一下：
- **普通状态管理**：你有一个数组 `[1, 2, 3]`，用户 A 在位置 1 插入 `4`，用户 B 在位置 2 插入 `5`
  - 结果可能不一致：`[1, 4, 2, 3]` vs `[1, 2, 5, 3]` ❌

- **Yjs 状态管理**：使用 `Y.Array`，用户 A 和 B 同时操作
  - Yjs 自动合并，所有用户看到相同结果：`[1, 4, 2, 5, 3]` ✅

### 核心特性

1. **自动冲突解决**：多人同时编辑不会产生冲突
2. **离线支持**：断网也能编辑，联网后自动同步
3. **实时同步**：操作立即同步到所有用户
4. **操作历史**：内置 Undo/Redo 支持
5. **高性能**：只同步变更，不是整个数据

---

## Yjs 能解决什么问题？

### 你当前表格的问题

1. **行混乱问题**：
   - 用户 A 在第 3 行双击编辑
   - 用户 B 在第 2 行插入新行
   - 结果：用户 A 的编辑框可能出现在第 4 行 ❌

2. **粘贴位置错误**：
   - 用户 A 复制第 4 行的数据
   - 用户 B 删除第 2 行
   - 用户 A 粘贴时，位置计算错误 ❌

3. **状态不一致**：
   - 每个用户本地维护自己的状态
   - 多人操作时，状态不同步 ❌

### Yjs 如何解决

1. **统一数据源**：
   - 所有用户共享同一个 `Y.Array`
   - 所有操作都基于这个共享数组
   - 自动保证所有用户看到相同的数据顺序 ✅

2. **基于 ID 而非索引**：
   - 每行有唯一 ID
   - 操作基于 ID，不依赖数组索引
   - 插入/删除不会影响其他行的定位 ✅

3. **自动合并冲突**：
   - 多人同时操作时，Yjs 自动合并
   - 不会丢失数据
   - 保证最终一致性 ✅

---

## 在表格中的优势

### 1. 解决行混乱问题

**之前**：
```typescript
// 每个用户维护自己的 rows 数组
const [rows, setRows] = useState<AssetRow[]>([]);

// 用户 A：在第 3 行编辑
const rowIndex = 3; // 基于索引，不稳定

// 用户 B：删除第 2 行
// 结果：用户 A 的 rowIndex 现在指向错误的行 ❌
```

**使用 Yjs**：
```typescript
// 所有用户共享同一个 Y.Array
const yRows = ydoc.getArray<AssetRow>('rows');

// 用户 A：基于 ID 编辑
const row = yRows.find(r => r.id === 'row-123'); // 基于 ID，稳定 ✅

// 用户 B：删除其他行
// 不影响用户 A 的 row 引用 ✅
```

### 2. 解决粘贴位置错误

**之前**：
```typescript
// 粘贴时基于索引计算位置
const targetIndex = startRowIndex + clipboardRowIndex;
// 如果其他用户插入/删除了行，索引就错了 ❌
```

**使用 Yjs**：
```typescript
// 粘贴时基于 ID 查找目标行
const targetRow = yRows.find(r => r.id === targetRowId);
// 即使其他用户操作，ID 仍然有效 ✅
```

### 3. 多人协作支持

- **实时同步**：一个用户的操作立即同步到所有用户
- **冲突解决**：多人同时编辑同一单元格，自动合并
- **离线支持**：断网编辑，联网后自动同步
- **操作历史**：内置 Undo/Redo

---

## 安装和准备

### 1. 安装包

```bash
cd /home/coco/pro/keco-studio
npm install yjs y-indexeddb
```

**包说明**：
- `yjs`：核心库（必需）
- `y-indexeddb`：本地持久化（可选，但推荐）

**注意**：我们使用 Supabase Realtime 作为同步层，所以不需要 `y-websocket`。

### 2. 是否需要注册账户？

**不需要！** Yjs 本身完全免费开源，不需要注册任何账户。

### 3. 是否需要付费？

**不需要！** 
- Yjs 核心库：MIT 开源，完全免费
- `y-indexeddb`：MIT 开源，完全免费
- Supabase Realtime：你已经在使用，免费额度通常足够

### 4. React 集成库（可选）

如果你想要更方便的 React hooks，可以安装：

```bash
npm install @y-sweet/react
# 或者
npm install react-yjs
```

**注意**：这些是可选的，我们也可以自己实现 hooks。

---

## 核心概念

### 1. Y.Doc（文档）

Yjs 的核心，所有共享数据都存储在一个文档中。

```typescript
import * as Y from 'yjs';

const ydoc = new Y.Doc();
```

### 2. Y.Array（数组）

类似 JavaScript 数组，但支持多人协作。

```typescript
const yRows = ydoc.getArray<AssetRow>('rows');

// 插入
yRows.insert(0, [newRow]);

// 删除
yRows.delete(0, 1);

// 读取
const rows = yRows.toArray();
```

### 3. Y.Map（对象）

类似 JavaScript 对象，用于存储键值对。

```typescript
const yRow = ydoc.getMap('row-123');
yRow.set('name', 'New Name');
const name = yRow.get('name');
```

### 4. Provider（提供者）

负责同步数据到其他客户端。

```typescript
// 使用 Supabase Realtime（我们自己的实现）
// 或者使用 y-indexeddb 做本地持久化
import { IndexeddbPersistence } from 'y-indexeddb';

const persistence = new IndexeddbPersistence('asset-table', ydoc);
```

---

## 集成步骤

### 步骤 1：创建 Yjs Context

创建 `src/contexts/YjsContext.tsx`：

```typescript
'use client';

import React, { createContext, useContext, useMemo, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

interface YjsContextType {
  ydoc: Y.Doc;
  yRows: Y.Array<AssetRow>;
  isConnected: boolean;
}

const YjsContext = createContext<YjsContextType | null>(null);

export function YjsProvider({ 
  children, 
  libraryId 
}: { 
  children: React.ReactNode;
  libraryId: string;
}) {
  // 为每个 library 创建独立的文档
  const ydoc = useMemo(() => new Y.Doc(), [libraryId]);
  const yRows = useMemo(() => ydoc.getArray<AssetRow>('rows'), [ydoc]);
  
  const [isConnected, setIsConnected] = useState(false);

  // 本地持久化
  useEffect(() => {
    const persistence = new IndexeddbPersistence(`asset-table-${libraryId}`, ydoc);
    
    persistence.on('synced', () => {
      setIsConnected(true);
    });

    return () => {
      persistence.destroy();
    };
  }, [ydoc, libraryId]);

  // TODO: 集成 Supabase Realtime 同步
  // 这里后续会添加 Supabase Realtime 的同步逻辑

  return (
    <YjsContext.Provider value={{ ydoc, yRows, isConnected }}>
      {children}
    </YjsContext.Provider>
  );
}

export function useYjs() {
  const context = useContext(YjsContext);
  if (!context) {
    throw new Error('useYjs must be used within YjsProvider');
  }
  return context;
}
```

### 步骤 2：创建 React Hook

创建 `src/hooks/useYjsRows.ts`：

```typescript
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { AssetRow } from '@/lib/types/libraryAssets';

export function useYjsRows(yRows: Y.Array<AssetRow>): AssetRow[] {
  const [rows, setRows] = useState<AssetRow[]>([]);

  useEffect(() => {
    // 初始读取
    setRows(yRows.toArray());

    // 监听变化
    const updateRows = () => {
      setRows(yRows.toArray());
    };

    yRows.observe(updateRows);

    return () => {
      yRows.unobserve(updateRows);
    };
  }, [yRows]);

  return rows;
}
```

### 步骤 3：修改 LibraryAssetsTable 组件

在 `LibraryAssetsTable.tsx` 中集成 Yjs：

```typescript
import { useYjs } from '@/contexts/YjsContext';
import { useYjsRows } from '@/hooks/useYjsRows';

export function LibraryAssetsTable({
  library,
  sections,
  properties,
  rows, // 这个可以保留作为初始数据
  onSaveAsset,
  onUpdateAsset,
  onDeleteAsset,
}: LibraryAssetsTableProps) {
  const { yRows } = useYjs();
  
  // 使用 Yjs 的 rows，而不是 props 的 rows
  const yjsRows = useYjsRows(yRows);

  // 初始化：将 props.rows 同步到 Yjs（仅第一次）
  useEffect(() => {
    if (yRows.length === 0 && rows.length > 0) {
      yRows.insert(0, rows);
    }
  }, []); // 只在组件挂载时执行一次

  // 后续所有操作都基于 yRows，而不是本地 state
  // ...
}
```

---

## 代码改动示例

### 改动 1：插入行

**之前**：
```typescript
const handleInsertRow = async (index: number) => {
  const newRow = { id: generateId(), name: 'New', propertyValues: {} };
  await onSaveAsset(newRow.name, newRow.propertyValues);
  // 需要等待父组件刷新，然后更新本地 state
};
```

**使用 Yjs**：
```typescript
const handleInsertRow = async (index: number) => {
  const newRow = { id: generateId(), name: 'New', propertyValues: {} };
  
  // 立即更新 Yjs（乐观更新）
  yRows.insert(index, [newRow]);
  
  // 异步保存到数据库
  await onSaveAsset(newRow.name, newRow.propertyValues);
  // 其他用户会立即看到新行，不需要等待数据库
};
```

### 改动 2：删除行

**之前**：
```typescript
const handleDeleteRow = async (rowId: string) => {
  const index = rows.findIndex(r => r.id === rowId);
  await onDeleteAsset(rowId);
  // 需要等待父组件刷新
};
```

**使用 Yjs**：
```typescript
const handleDeleteRow = async (rowId: string) => {
  const index = yRows.toArray().findIndex(r => r.id === rowId);
  
  // 立即从 Yjs 删除（乐观更新）
  if (index >= 0) {
    yRows.delete(index, 1);
  }
  
  // 异步删除数据库
  await onDeleteAsset(rowId);
};
```

### 改动 3：编辑单元格

**之前**：
```typescript
const handleSaveEditedRow = async (rowId: string, newData: any) => {
  const index = rows.findIndex(r => r.id === rowId);
  await onUpdateAsset(rowId, newData.name, newData.propertyValues);
  // 需要等待父组件刷新
};
```

**使用 Yjs**：
```typescript
const handleSaveEditedRow = async (rowId: string, newData: any) => {
  const index = yRows.toArray().findIndex(r => r.id === rowId);
  
  if (index >= 0) {
    // 立即更新 Yjs（乐观更新）
    yRows.delete(index, 1);
    yRows.insert(index, [{ ...yRows.toArray()[index], ...newData }]);
  }
  
  // 异步更新数据库
  await onUpdateAsset(rowId, newData.name, newData.propertyValues);
};
```

### 改动 4：粘贴操作

**之前**：
```typescript
const handlePaste = () => {
  const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
  // 基于索引计算目标位置，可能出错 ❌
  const targetRowIndex = startRowIndex + clipboardRowIndex;
  // ...
};
```

**使用 Yjs**：
```typescript
const handlePaste = () => {
  const allRows = yRows.toArray();
  const startRow = allRows.find(r => r.id === startRowId);
  const startIndex = allRows.indexOf(startRow);
  
  // 基于 ID 查找，即使其他用户操作也不受影响 ✅
  clipboardData.forEach((row, i) => {
    const targetIndex = startIndex + i;
    // 如果超出范围，创建新行
    if (targetIndex >= allRows.length) {
      yRows.insert(allRows.length, [createNewRow(row)]);
    } else {
      // 更新现有行
      const existingRow = allRows[targetIndex];
      yRows.delete(targetIndex, 1);
      yRows.insert(targetIndex, [{ ...existingRow, ...row }]);
    }
  });
};
```

---

## 与 Supabase Realtime 集成

### 方案：使用 Supabase Realtime 作为 Yjs 的同步层

创建 `src/lib/yjsSupabaseProvider.ts`：

```typescript
import * as Y from 'yjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';

export class SupabaseYjsProvider {
  private channel: RealtimeChannel | null = null;
  private ydoc: Y.Doc;
  private roomName: string;
  private supabase: any;

  constructor(ydoc: Y.Doc, roomName: string, supabase: any) {
    this.ydoc = ydoc;
    this.roomName = roomName;
    this.supabase = supabase;
    this.connect();
  }

  private connect() {
    // 订阅 Supabase Realtime channel
    this.channel = this.supabase
      .channel(`yjs-${this.roomName}`)
      .on('broadcast', { event: 'yjs-update' }, (payload: any) => {
        // 接收其他用户的更新
        Y.applyUpdate(this.ydoc, new Uint8Array(payload.payload));
      })
      .subscribe();

    // 监听 Yjs 的更新，发送到 Supabase
    this.ydoc.on('update', (update: Uint8Array) => {
      this.channel?.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload: Array.from(update),
      });
    });
  }

  destroy() {
    this.channel?.unsubscribe();
  }
}
```

在 `YjsContext.tsx` 中使用：

```typescript
import { SupabaseYjsProvider } from '@/lib/yjsSupabaseProvider';
import { useSupabase } from '@/lib/SupabaseContext';

export function YjsProvider({ children, libraryId }: Props) {
  const supabase = useSupabase();
  const ydoc = useMemo(() => new Y.Doc(), [libraryId]);
  const yRows = useMemo(() => ydoc.getArray<AssetRow>('rows'), [ydoc]);

  useEffect(() => {
    if (supabase) {
      const provider = new SupabaseYjsProvider(ydoc, libraryId, supabase);
      return () => provider.destroy();
    }
  }, [ydoc, libraryId, supabase]);

  // ...
}
```

---

## 常见问题

### Q1: Yjs 会影响性能吗？

**A**: 不会。Yjs 只同步变更（delta），不是整个数据。对于你的表格（几百行），性能完全没问题。

### Q2: 如果网络断开怎么办？

**A**: Yjs 支持离线编辑。使用 `y-indexeddb` 可以持久化到本地，断网时继续编辑，联网后自动同步。

### Q3: 如何调试 Yjs？

**A**: 
```typescript
// 查看当前状态
console.log(yRows.toArray());

// 监听所有变化
yRows.observe((event) => {
  console.log('Rows changed:', event);
});
```

### Q4: 如何重置 Yjs 数据？

**A**: 
```typescript
// 清空所有数据
yRows.delete(0, yRows.length);

// 或者重新创建文档
const newYdoc = new Y.Doc();
```

### Q5: 如何处理冲突？

**A**: Yjs 使用 CRDT 算法，自动解决冲突。你不需要手动处理。

---

## 下一步

1. **安装包**：运行 `npm install yjs y-indexeddb`
2. **创建 Context**：创建 `YjsContext.tsx`
3. **创建 Hook**：创建 `useYjsRows.ts`
4. **修改组件**：在 `LibraryAssetsTable.tsx` 中集成
5. **测试**：打开两个浏览器窗口，测试多人编辑

---

## 总结

- ✅ **免费开源**：不需要注册账户，不需要付费
- ✅ **自动冲突解决**：解决行混乱和粘贴位置错误
- ✅ **实时同步**：多人协作编辑
- ✅ **离线支持**：断网也能编辑
- ✅ **易于集成**：只需要修改数据操作部分，UI 逻辑不变

**预计集成时间**：1-2 天（如果熟悉 React 和状态管理）

