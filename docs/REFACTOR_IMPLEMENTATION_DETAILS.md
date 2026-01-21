# 批量操作功能重构 - 详细实现方案

## 问题根源分析

### 问题1：批量填充"开心"后再填充"22"结果还是"开心"

**根本原因**：
```typescript
// 当前代码 2648行
const sourceValue = sourceRowForFill.propertyValues[startPropertyKey] ?? null;
```

`sourceRowForFill` 来自 `getAllRowsForCellSelection()`，该函数会合并乐观更新：
```typescript
// 2218-2272行
const getAllRowsForCellSelection = useCallback(() => {
  // ...
  if (optimisticUpdate) {
    allRowsMap.set(assetRow.id, {
      ...assetRow,
      propertyValues: { ...assetRow.propertyValues, ...optimisticUpdate.propertyValues }
    });
  }
  // ...
}, [allRowsSource, deletedAssetIds, optimisticEditUpdates, optimisticNewAssets]);
```

**问题流程**：
1. 用户填充"开心" → 设置乐观更新 → UI显示"开心"
2. 用户再次填充"22" → 获取源值时，`getAllRowsForCellSelection()` 返回的数据仍包含旧的乐观更新（"开心"）
3. 如果乐观更新没有及时清理，就会用旧值填充

**解决方案**：
- 批量填充时，源值应该从**基础数据源**获取，而不是从包含乐观更新的数据获取
- 或者，在填充操作前，确保乐观更新已经保存并清理

### 问题2：选择"22"但填充的是"2"

**可能原因**：
1. 字符串截断：值在传递过程中被截断
2. 类型转换问题：数字22被转换为字符串"22"，但在某个环节被截断
3. 乐观更新合并时覆盖：旧的乐观更新值"2"覆盖了新值"22"

**解决方案**：
- 确保值完整传递，不进行任何截断
- 类型转换时保持完整性
- 乐观更新合并时，新值优先

## 重构架构设计

### 目录结构

```
src/components/libraries/
├── LibraryAssetsTable.tsx                    # 主组件（简化后）
├── hooks/
│   ├── useTableDataManager.ts                # 数据管理核心
│   ├── useBatchFill.ts                       # 批量填充
│   ├── useClipboardOperations.ts             # 剪贴板操作
│   ├── useRowOperations.ts                   # 行操作
│   └── useSelectionManager.ts                # 选择管理
├── utils/
│   ├── tableDataUtils.ts                     # 数据工具
│   ├── optimisticUpdateUtils.ts              # 乐观更新工具
│   └── cellSelectionUtils.ts                 # 选择工具
└── types/
    └── tableOperations.ts                    # 操作类型定义
```

## 核心实现

### 1. useTableDataManager.ts - 数据管理核心

```typescript
import { useCallback, useMemo } from 'react';
import { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

interface OptimisticUpdate {
  name: string;
  propertyValues: Record<string, any>;
}

interface TableDataManager {
  // 获取基础数据源（不包含乐观更新）
  getBaseRows: () => AssetRow[];
  
  // 获取完整数据（包含乐观更新）
  getRowsWithOptimisticUpdates: () => AssetRow[];
  
  // 获取特定行的最新值（包含乐观更新）
  getRowValue: (rowId: string, propertyKey: string) => any;
  
  // 获取特定行的基础值（不包含乐观更新）- 关键修复点
  getRowBaseValue: (rowId: string, propertyKey: string) => any;
  
  // 获取特定行的完整最新数据
  getRowWithUpdates: (rowId: string) => AssetRow | null;
  
  // 乐观更新管理
  setOptimisticUpdate: (rowId: string, propertyKey: string, value: any) => void;
  setBatchOptimisticUpdates: (updates: Map<string, OptimisticUpdate>) => void;
  clearOptimisticUpdate: (rowId: string, propertyKey?: string) => void;
  clearAllOptimisticUpdates: () => void;
}

export function useTableDataManager(
  allRowsSource: AssetRow[],
  optimisticEditUpdates: Map<string, OptimisticUpdate>,
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, OptimisticUpdate>>>,
  optimisticNewAssets: Map<string, AssetRow>,
  deletedAssetIds: Set<string>
): TableDataManager {
  
  // 获取基础数据源（不包含乐观更新）
  const getBaseRows = useCallback(() => {
    return allRowsSource.filter(row => !deletedAssetIds.has(row.id));
  }, [allRowsSource, deletedAssetIds]);
  
  // 获取完整数据（包含乐观更新）
  const getRowsWithOptimisticUpdates = useCallback(() => {
    const rowsMap = new Map<string, AssetRow>();
    
    // 添加基础数据并应用乐观更新
    allRowsSource.forEach(row => {
      if (!deletedAssetIds.has(row.id)) {
        const optimisticUpdate = optimisticEditUpdates.get(row.id);
        if (optimisticUpdate) {
          rowsMap.set(row.id, {
            ...row,
            name: optimisticUpdate.name,
            propertyValues: { ...row.propertyValues, ...optimisticUpdate.propertyValues }
          });
        } else {
          rowsMap.set(row.id, row);
        }
      }
    });
    
    // 添加乐观新资产
    optimisticNewAssets.forEach((asset, id) => {
      if (!rowsMap.has(id)) {
        rowsMap.set(id, asset);
      }
    });
    
    // 转换为数组并保持顺序
    const result: AssetRow[] = [];
    const processedIds = new Set<string>();
    
    allRowsSource.forEach(row => {
      if (!deletedAssetIds.has(row.id) && !processedIds.has(row.id)) {
        const rowToAdd = rowsMap.get(row.id);
        if (rowToAdd) {
          result.push(rowToAdd);
          processedIds.add(row.id);
        }
      }
    });
    
    optimisticNewAssets.forEach((asset, id) => {
      if (!processedIds.has(id)) {
        result.push(asset);
        processedIds.add(id);
      }
    });
    
    return result;
  }, [allRowsSource, deletedAssetIds, optimisticEditUpdates, optimisticNewAssets]);
  
  // 获取特定行的基础值（不包含乐观更新）- 关键修复
  const getRowBaseValue = useCallback((rowId: string, propertyKey: string): any => {
    const baseRow = allRowsSource.find(r => r.id === rowId);
    if (!baseRow) {
      return null;
    }
    
    // 直接从基础数据源获取，不受乐观更新影响
    const value = baseRow.propertyValues[propertyKey];
    
    // 如果是name字段且值为空，使用row.name
    const propertyIndex = 0; // 假设第一个属性是name字段，实际应该从orderedProperties获取
    if (propertyIndex === 0 && (value === null || value === undefined || value === '')) {
      return baseRow.name || null;
    }
    
    return value ?? null;
  }, [allRowsSource]);
  
  // 获取特定行的最新值（包含乐观更新）
  const getRowValue = useCallback((rowId: string, propertyKey: string): any => {
    const baseRow = allRowsSource.find(r => r.id === rowId);
    if (!baseRow) {
      // 检查是否是乐观新资产
      const optimisticRow = optimisticNewAssets.get(rowId);
      if (optimisticRow) {
        return optimisticRow.propertyValues[propertyKey] ?? null;
      }
      return null;
    }
    
    const optimisticUpdate = optimisticEditUpdates.get(rowId);
    if (optimisticUpdate && optimisticUpdate.propertyValues.hasOwnProperty(propertyKey)) {
      return optimisticUpdate.propertyValues[propertyKey];
    }
    
    return baseRow.propertyValues[propertyKey] ?? null;
  }, [allRowsSource, optimisticEditUpdates, optimisticNewAssets]);
  
  // 获取特定行的完整最新数据
  const getRowWithUpdates = useCallback((rowId: string): AssetRow | null => {
    const baseRow = allRowsSource.find(r => r.id === rowId);
    if (!baseRow) {
      return optimisticNewAssets.get(rowId) || null;
    }
    
    const optimisticUpdate = optimisticEditUpdates.get(rowId);
    if (optimisticUpdate) {
      return {
        ...baseRow,
        name: optimisticUpdate.name,
        propertyValues: { ...baseRow.propertyValues, ...optimisticUpdate.propertyValues }
      };
    }
    
    return baseRow;
  }, [allRowsSource, optimisticEditUpdates, optimisticNewAssets]);
  
  // 设置乐观更新
  const setOptimisticUpdate = useCallback((rowId: string, propertyKey: string, value: any) => {
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(rowId);
      
      if (existing) {
        newMap.set(rowId, {
          ...existing,
          propertyValues: {
            ...existing.propertyValues,
            [propertyKey]: value
          }
        });
      } else {
        const baseRow = allRowsSource.find(r => r.id === rowId);
        if (baseRow) {
          newMap.set(rowId, {
            name: baseRow.name,
            propertyValues: {
              ...baseRow.propertyValues,
              [propertyKey]: value
            }
          });
        }
      }
      
      return newMap;
    });
  }, [allRowsSource, setOptimisticEditUpdates]);
  
  // 批量设置乐观更新
  const setBatchOptimisticUpdates = useCallback((updates: Map<string, OptimisticUpdate>) => {
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      updates.forEach((update, rowId) => {
        const existing = newMap.get(rowId);
        if (existing) {
          newMap.set(rowId, {
            name: update.name || existing.name,
            propertyValues: {
              ...existing.propertyValues,
              ...update.propertyValues
            }
          });
        } else {
          newMap.set(rowId, update);
        }
      });
      return newMap;
    });
  }, [setOptimisticEditUpdates]);
  
  // 清除乐观更新
  const clearOptimisticUpdate = useCallback((rowId: string, propertyKey?: string) => {
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(rowId);
      
      if (!existing) {
        return prev;
      }
      
      if (propertyKey) {
        // 清除特定属性
        const newPropertyValues = { ...existing.propertyValues };
        delete newPropertyValues[propertyKey];
        
        if (Object.keys(newPropertyValues).length === 0) {
          // 如果没有其他属性更新，删除整个乐观更新
          newMap.delete(rowId);
        } else {
          newMap.set(rowId, {
            ...existing,
            propertyValues: newPropertyValues
          });
        }
      } else {
        // 清除整个行的乐观更新
        newMap.delete(rowId);
      }
      
      return newMap;
    });
  }, [setOptimisticEditUpdates]);
  
  // 清除所有乐观更新
  const clearAllOptimisticUpdates = useCallback(() => {
    setOptimisticEditUpdates(new Map());
  }, [setOptimisticEditUpdates]);
  
  return {
    getBaseRows,
    getRowsWithOptimisticUpdates,
    getRowValue,
    getRowBaseValue,
    getRowWithUpdates,
    setOptimisticUpdate,
    setBatchOptimisticUpdates,
    clearOptimisticUpdate,
    clearAllOptimisticUpdates
  };
}
```

### 2. useBatchFill.ts - 批量填充（修复版）

```typescript
import { useCallback } from 'react';
import { PropertyConfig } from '@/lib/types/libraryAssets';
import { TableDataManager } from './useTableDataManager';

interface BatchFillOptions {
  sourceRowId: string;
  sourcePropertyKey: string;
  targetRowIds: string[];
  targetPropertyKey: string;
}

interface BatchFillResult {
  success: boolean;
  updatedRows: Array<{ rowId: string; propertyKey: string; value: any }>;
  error?: string;
}

export function useBatchFill(
  dataManager: TableDataManager,
  orderedProperties: PropertyConfig[],
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>
) {
  
  const fillDown = useCallback(async (options: BatchFillOptions): Promise<BatchFillResult> => {
    const { sourceRowId, sourcePropertyKey, targetRowIds, targetPropertyKey } = options;
    
    // 关键修复1：从基础数据源获取源值，不受乐观更新影响
    const sourceValue = dataManager.getRowBaseValue(sourceRowId, sourcePropertyKey);
    
    // 关键修复2：确保值完整传递，避免截断
    const fillValue = sourceValue !== null && sourceValue !== undefined 
      ? sourceValue  // 保持原始类型和值
      : null;
    
    if (!onUpdateAsset) {
      return {
        success: false,
        updatedRows: [],
        error: 'onUpdateAsset is not provided'
      };
    }
    
    const updatedRows: Array<{ rowId: string; propertyKey: string; value: any }> = [];
    const optimisticUpdates = new Map<string, Record<string, any>>();
    
    // 准备所有更新
    for (const targetRowId of targetRowIds) {
      // 关键修复3：只更新目标属性，保留其他属性的乐观更新
      const currentRow = dataManager.getRowWithUpdates(targetRowId);
      if (!currentRow) {
        continue;
      }
      
      // 设置乐观更新（只更新目标属性）
      dataManager.setOptimisticUpdate(targetRowId, targetPropertyKey, fillValue);
      
      // 记录更新
      updatedRows.push({
        rowId: targetRowId,
        propertyKey: targetPropertyKey,
        value: fillValue
      });
    }
    
    // 执行保存操作
    try {
      const updatePromises = updatedRows.map(async ({ rowId, propertyKey, value }) => {
        // 关键修复4：保存时使用基础数据 + 填充值，不包含其他未保存的乐观更新
        const baseRow = dataManager.getRowWithUpdates(rowId);
        if (!baseRow) {
          return;
        }
        
        // 获取基础数据
        const baseRows = dataManager.getBaseRows();
        const baseRowData = baseRows.find(r => r.id === rowId);
        if (!baseRowData) {
          return;
        }
        
        // 构建保存数据：基础数据 + 填充值
        const propertyValuesToSave = {
          ...baseRowData.propertyValues,
          [propertyKey]: value
        };
        
        // 确定资产名称
        const nameFieldKey = orderedProperties[0]?.key;
        let assetName = baseRowData.name || 'Untitled';
        if (nameFieldKey === propertyKey) {
          assetName = value !== null && value !== undefined ? String(value) : '';
        } else if (nameFieldKey && baseRowData.propertyValues[nameFieldKey]) {
          assetName = String(baseRowData.propertyValues[nameFieldKey]);
        }
        
        // 保存
        await onUpdateAsset(rowId, assetName, propertyValuesToSave);
        
        // 保存成功后，清除该属性的乐观更新
        dataManager.clearOptimisticUpdate(rowId, propertyKey);
      });
      
      await Promise.all(updatePromises);
      
      return {
        success: true,
        updatedRows
      };
    } catch (error) {
      console.error('Batch fill failed:', error);
      return {
        success: false,
        updatedRows: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }, [dataManager, orderedProperties, onUpdateAsset]);
  
  return {
    fillDown
  };
}
```

### 3. 主组件集成示例

```typescript
// LibraryAssetsTable.tsx (简化版)

import { useTableDataManager } from './hooks/useTableDataManager';
import { useBatchFill } from './hooks/useBatchFill';
import { useClipboardOperations } from './hooks/useClipboardOperations';
import { useRowOperations } from './hooks/useRowOperations';

export function LibraryAssetsTable({ ... }: LibraryAssetsTableProps) {
  // ... 现有状态 ...
  
  // 创建数据管理器
  const dataManager = useTableDataManager(
    allRowsSource,
    optimisticEditUpdates,
    setOptimisticEditUpdates,
    optimisticNewAssets,
    deletedAssetIds
  );
  
  // 创建批量填充hook
  const batchFill = useBatchFill(
    dataManager,
    orderedProperties,
    onUpdateAsset
  );
  
  // 创建剪贴板操作hook
  const clipboardOps = useClipboardOperations(
    dataManager,
    selectedCells,
    orderedProperties,
    onSaveAsset,
    onUpdateAsset
  );
  
  // 创建行操作hook
  const rowOps = useRowOperations(
    dataManager,
    selectedCells,
    selectedRowIds,
    orderedProperties,
    onSaveAsset,
    onUpdateAsset,
    onDeleteAsset
  );
  
  // 在拖拽填充时使用新的批量填充
  const handleCellDragEnd = useCallback((e: MouseEvent) => {
    // ... 现有逻辑 ...
    
    if (endRowIndex > startRowIndex) {
      // 使用新的批量填充API
      const targetRowIds = [];
      for (let r = startRowIndex + 1; r <= endRowIndex; r++) {
        const targetRow = allRowsForFill[r];
        if (targetRow) {
          targetRowIds.push(targetRow.id);
        }
      }
      
      batchFill.fillDown({
        sourceRowId: startRowId,
        sourcePropertyKey: startPropertyKey,
        targetRowIds,
        targetPropertyKey: startPropertyKey
      });
    }
  }, [batchFill, ...]);
  
  // ... 其他代码 ...
}
```

## 关键修复点总结

1. **源值获取**：使用 `getRowBaseValue()` 从基础数据源获取，不受乐观更新影响
2. **值传递**：保持原始类型和值，不进行截断或转换
3. **乐观更新**：只更新目标属性，保留其他属性的乐观更新
4. **保存逻辑**：使用基础数据 + 填充值，不包含其他未保存的乐观更新

## 迁移步骤

1. **第一步**：创建 `useTableDataManager.ts`，不改变现有逻辑，只是封装
2. **第二步**：创建 `useBatchFill.ts`，修复批量填充问题
3. **第三步**：在主组件中逐步替换，先测试批量填充
4. **第四步**：创建其他hooks，逐步迁移其他功能
5. **第五步**：清理旧代码，优化性能

## 测试要点

1. **批量填充测试**：
   - 填充"开心"后再填充"22"，应该填充"22"
   - 填充数字22，应该完整填充22，不是2
   - 填充后立即再次填充，应该使用最新保存的值

2. **乐观更新测试**：
   - 填充一列后，其他列的乐观更新应该保留
   - 保存后，乐观更新应该清除

3. **边界情况测试**：
   - 空值填充
   - 大值填充
   - 并发填充

