# Yjs 集成示例 - 如何修改 LibraryAssetsTable

本文档展示如何将 Yjs 集成到现有的 `LibraryAssetsTable` 组件中。

## 步骤 1：在父组件中包裹 YjsProvider

找到使用 `LibraryAssetsTable` 的父组件（可能在 `src/app/[projectId]/[libraryId]/page.tsx` 或类似位置）：

```typescript
import { YjsProvider } from '@/contexts/YjsContext';

export default function LibraryPage() {
  const params = useParams();
  const libraryId = params.libraryId as string;

  return (
    <YjsProvider libraryId={libraryId}>
      <LibraryAssetsTable
        library={library}
        sections={sections}
        properties={properties}
        rows={rows}
        onSaveAsset={onSaveAsset}
        onUpdateAsset={onUpdateAsset}
        onDeleteAsset={onDeleteAsset}
      />
    </YjsProvider>
  );
}
```

## 步骤 2：修改 LibraryAssetsTable 组件

在 `LibraryAssetsTable.tsx` 文件顶部添加导入：

```typescript
import { useYjs } from '@/contexts/YjsContext';
import { useYjsRows } from '@/hooks/useYjsRows';
```

在组件内部，修改数据源：

```typescript
export function LibraryAssetsTable({
  library,
  sections,
  properties,
  rows, // 保留作为初始数据源
  onSaveAsset,
  onUpdateAsset,
  onDeleteAsset,
}: LibraryAssetsTableProps) {
  // 获取 Yjs 实例
  const { yRows } = useYjs();
  
  // 使用 Yjs 的 rows（会自动同步）
  const yjsRows = useYjsRows(yRows);
  
  // 初始化：将 props.rows 同步到 Yjs（仅第一次）
  useEffect(() => {
    if (yRows.length === 0 && rows.length > 0) {
      // 只在 Yjs 为空且 props 有数据时初始化
      yRows.insert(0, rows);
    }
  }, []); // 只在组件挂载时执行一次

  // 后续使用 yjsRows 而不是 rows
  // 但为了兼容现有代码，可以创建一个统一的 rows 变量
  const allRows = yjsRows.length > 0 ? yjsRows : rows;

  // 修改 allRowsForDisplay useMemo 使用 allRows
  const allRowsForDisplay = useMemo(() => {
    const baseRows: AssetRow[] = allRows
      .filter((row): row is AssetRow => !deletedAssetIds.has(row.id))
      .map((row): AssetRow => {
        const assetRow = row as AssetRow;
        const optimisticUpdate = optimisticEditUpdates.get(assetRow.id);
        if (optimisticUpdate && optimisticUpdate.name === assetRow.name) {
          return {
            ...assetRow,
            name: optimisticUpdate.name,
            propertyValues: { ...assetRow.propertyValues, ...optimisticUpdate.propertyValues }
          };
        }
        return assetRow;
      });
    
    const optimisticAssets: AssetRow[] = Array.from(optimisticNewAssets.values())
      .sort((a, b) => a.id.localeCompare(b.id));
    
    return [...baseRows, ...optimisticAssets];
  }, [allRows, deletedAssetIds, optimisticEditUpdates, optimisticNewAssets]);
  
  // ... 其他代码保持不变
}
```

## 步骤 3：修改插入行操作

找到 `handleAddRow` 或类似的插入行函数：

```typescript
// 之前
const handleAddRow = async () => {
  const newRow = { id: generateId(), name: 'New', propertyValues: {} };
  await onSaveAsset(newRow.name, newRow.propertyValues);
  // 需要等待父组件刷新
};

// 使用 Yjs
const handleAddRow = async () => {
  const newRow = { 
    id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    libraryId: library?.id || '',
    name: 'New', 
    propertyValues: {} 
  };
  
  // 立即更新 Yjs（乐观更新）
  yRows.insert(yRows.length, [newRow]);
  
  // 异步保存到数据库
  try {
    await onSaveAsset(newRow.name, newRow.propertyValues);
    // 成功后，父组件会刷新，Yjs 会自动合并真实数据
  } catch (error) {
    // 失败时，从 Yjs 中移除
    const index = yRows.toArray().findIndex(r => r.id === newRow.id);
    if (index >= 0) {
      yRows.delete(index, 1);
    }
  }
};
```

## 步骤 4：修改删除行操作

找到删除行的函数：

```typescript
// 之前
const handleDeleteRow = async (rowId: string) => {
  const index = rows.findIndex(r => r.id === rowId);
  await onDeleteAsset(rowId);
  // 需要等待父组件刷新
};

// 使用 Yjs
const handleDeleteRow = async (rowId: string) => {
  const allRows = yRows.toArray();
  const index = allRows.findIndex(r => r.id === rowId);
  
  if (index >= 0) {
    // 立即从 Yjs 删除（乐观更新）
    yRows.delete(index, 1);
    
    // 异步删除数据库
    try {
      await onDeleteAsset(rowId);
    } catch (error) {
      // 失败时，恢复行（从 props.rows 中查找并重新插入）
      const originalRow = rows.find(r => r.id === rowId);
      if (originalRow) {
        yRows.insert(index, [originalRow]);
      }
    }
  }
};
```

## 步骤 5：修改编辑单元格操作

找到 `handleSaveEditedRow` 函数：

```typescript
// 之前
const handleSaveEditedRow = async (assetId: string, assetName: string) => {
  await onUpdateAsset(assetId, assetName, editingRowData);
  // 需要等待父组件刷新
};

// 使用 Yjs
const handleSaveEditedRow = async (assetId: string, assetName: string) => {
  const allRows = yRows.toArray();
  const index = allRows.findIndex(r => r.id === assetId);
  
  if (index >= 0) {
    // 立即更新 Yjs（乐观更新）
    const updatedRow = {
      ...allRows[index],
      name: assetName,
      propertyValues: { ...allRows[index].propertyValues, ...editingRowData }
    };
    
    yRows.delete(index, 1);
    yRows.insert(index, [updatedRow]);
    
    // 异步更新数据库
    try {
      await onUpdateAsset(assetId, assetName, editingRowData);
    } catch (error) {
      // 失败时，恢复原始数据
      yRows.delete(index, 1);
      yRows.insert(index, [allRows[index]]);
    }
  }
  
  // 清除编辑状态
  setEditingRowId(null);
  setEditingRowData({});
};
```

## 步骤 6：修改粘贴操作

找到 `handlePaste` 函数，修改索引查找逻辑：

```typescript
// 之前
const handlePaste = async () => {
  const allRowsForSelection = getAllRowsForCellSelection();
  const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
  // 基于索引计算，可能出错
  // ...
};

// 使用 Yjs
const handlePaste = async () => {
  const allRows = yRows.toArray(); // 使用 Yjs 的数组
  const startRow = allRows.find(r => r.id === startRowId);
  const startIndex = allRows.indexOf(startRow);
  
  if (startIndex === -1) return;
  
  // 基于 ID 查找，即使其他用户操作也不受影响
  clipboardData.forEach((clipboardRow, clipboardRowIndex) => {
    const targetIndex = startIndex + clipboardRowIndex;
    
    // 如果超出范围，创建新行
    if (targetIndex >= allRows.length) {
      const newRow = createRowFromClipboard(clipboardRow);
      yRows.insert(allRows.length, [newRow]);
    } else {
      // 更新现有行
      const existingRow = allRows[targetIndex];
      const updatedRow = {
        ...existingRow,
        ...applyClipboardDataToRow(existingRow, clipboardRow, orderedProperties)
      };
      
      yRows.delete(targetIndex, 1);
      yRows.insert(targetIndex, [updatedRow]);
    }
  });
  
  // 异步保存到数据库
  // ...
};
```

## 步骤 7：修改 getAllRowsForCellSelection

```typescript
// 之前
const getAllRowsForCellSelection = useCallback(() => {
  const allRowsForSelection = rows
    .filter(...)
    .map(...);
  // ...
}, [rows, ...]);

// 使用 Yjs
const getAllRowsForCellSelection = useCallback(() => {
  // 直接使用 Yjs 的数组，保证所有用户看到相同顺序
  const allRowsForSelection = yRows.toArray()
    .filter((row): row is AssetRow => !deletedAssetIds.has(row.id))
    .map((row): AssetRow => {
      const assetRow = row as AssetRow;
      const optimisticUpdate = optimisticEditUpdates.get(assetRow.id);
      if (optimisticUpdate && optimisticUpdate.name === assetRow.name) {
        return {
          ...assetRow,
          name: optimisticUpdate.name,
          propertyValues: { ...assetRow.propertyValues, ...optimisticUpdate.propertyValues }
        };
      }
      return assetRow;
    });
  
  const optimisticAssets: AssetRow[] = Array.from(optimisticNewAssets.values())
    .sort((a, b) => a.id.localeCompare(b.id));
  
  return [...allRowsForSelection, ...optimisticAssets];
}, [yRows, deletedAssetIds, optimisticEditUpdates, optimisticNewAssets]);
```

## 注意事项

1. **初始化时机**：只在 Yjs 为空时初始化，避免覆盖已有数据
2. **错误处理**：数据库操作失败时，需要从 Yjs 中恢复
3. **乐观更新**：先更新 Yjs，再保存数据库，提升用户体验
4. **ID 稳定性**：确保每行都有唯一且稳定的 ID
5. **兼容性**：保留对 props.rows 的支持，作为后备数据源

## 测试步骤

1. 打开两个浏览器窗口
2. 在一个窗口中插入行，应该立即在另一个窗口看到
3. 在一个窗口中编辑单元格，应该立即在另一个窗口看到
4. 在一个窗口中删除行，应该立即在另一个窗口看到
5. 测试离线编辑（断开网络），应该能继续编辑
6. 重新连接网络，应该自动同步

## 后续优化

1. **集成 Supabase Realtime**：实现真正的多人实时同步
2. **添加 Presence**：显示其他用户正在编辑的单元格
3. **添加 Undo/Redo**：使用 Yjs 内置的历史功能
4. **性能优化**：对于大量数据，考虑虚拟滚动

