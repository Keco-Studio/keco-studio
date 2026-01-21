# LibraryAssetsTable 批量操作功能重构方案

## 问题分析

### 当前问题

1. **批量填充问题1**：填充"开心"后再填充"22"结果还是"开心"
   - 原因：`getAllRowsForCellSelection()` 返回的数据包含了旧的乐观更新，导致源值获取不正确
   - 位置：`2648行` - `sourceValue` 从 `sourceRowForFill.propertyValues[startPropertyKey]` 获取，但该值可能来自旧的乐观更新
   - 根本原因：乐观更新状态管理混乱，没有及时清理已保存的更新

2. **批量填充问题2**：选择"22"但填充的是"2"
   - 可能原因：
     - 字符串截断问题
     - 乐观更新合并时覆盖了正确的值
     - `baseRow.propertyValues` 和 `optimisticEditUpdates` 合并逻辑有误

3. **代码组织问题**：
   - 文件过长（7068行），难以维护
   - Cut/Copy/Paste/Insert/Clear/Delete/批量填充等功能耦合在一起
   - 数据获取逻辑（`getAllRowsForCellSelection`）和操作逻辑混在一起

## 重构方案

### 架构设计

```
LibraryAssetsTable.tsx (主组件，简化)
├── hooks/
│   ├── useTableDataManager.ts        # 统一的数据管理hook
│   ├── useBatchFill.ts               # 批量填充功能
│   ├── useClipboardOperations.ts     # Cut/Copy/Paste功能
│   ├── useRowOperations.ts           # Insert/Delete/Clear功能
│   └── useSelectionManager.ts        # 选择状态管理
├── utils/
│   ├── tableDataUtils.ts             # 数据工具函数
│   ├── optimisticUpdateUtils.ts      # 乐观更新工具函数
│   └── cellSelectionUtils.ts         # 单元格选择工具函数
└── types/
    └── tableOperations.ts            # 操作相关类型定义
```

### 1. 核心数据管理 Hook (`useTableDataManager.ts`)

**职责**：统一管理表格数据源，提供一致的数据访问接口

```typescript
// hooks/useTableDataManager.ts

interface TableDataManager {
  // 获取基础数据源（不包含乐观更新）
  getBaseRows: () => AssetRow[];
  
  // 获取完整数据（包含乐观更新）
  getRowsWithOptimisticUpdates: () => AssetRow[];
  
  // 获取特定行的最新值（包含乐观更新）
  getRowValue: (rowId: string, propertyKey: string) => any;
  
  // 获取特定行的基础值（不包含乐观更新）
  getRowBaseValue: (rowId: string, propertyKey: string) => any;
  
  // 设置乐观更新
  setOptimisticUpdate: (rowId: string, propertyKey: string, value: any) => void;
  
  // 批量设置乐观更新
  setBatchOptimisticUpdates: (updates: Map<string, Record<string, any>>) => void;
  
  // 清除乐观更新（保存成功后）
  clearOptimisticUpdate: (rowId: string, propertyKey?: string) => void;
  
  // 清除所有乐观更新
  clearAllOptimisticUpdates: () => void;
  
  // 获取特定行的完整最新数据
  getRowWithUpdates: (rowId: string) => AssetRow | null;
}

export function useTableDataManager(
  allRowsSource: AssetRow[],
  optimisticEditUpdates: Map<string, { name: string; propertyValues: Record<string, any> }>,
  setOptimisticEditUpdates: React.Dispatch<...>,
  optimisticNewAssets: Map<string, AssetRow>,
  deletedAssetIds: Set<string>
): TableDataManager
```

**关键改进**：
- 分离基础数据和乐观更新数据
- 提供明确的API获取不同层级的数据
- 统一管理乐观更新的生命周期

### 2. 批量填充 Hook (`useBatchFill.ts`)

**职责**：专门处理批量填充逻辑，解决当前的问题

```typescript
// hooks/useBatchFill.ts

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
): {
  fillDown: (options: BatchFillOptions) => Promise<BatchFillResult>;
  fillUp: (options: BatchFillOptions) => Promise<BatchFillResult>;
  fillRight: (options: BatchFillOptions) => Promise<BatchFillResult>;
  fillLeft: (options: BatchFillOptions) => Promise<BatchFillResult>;
}
```

**关键改进**：
1. **源值获取**：直接从基础数据源获取源值，不受乐观更新影响
   ```typescript
   // 修复：从基础数据源获取源值，确保获取的是最新保存的值
   const sourceValue = dataManager.getRowBaseValue(sourceRowId, sourcePropertyKey);
   ```

2. **值传递**：确保值完整传递，避免截断
   ```typescript
   // 确保值完整传递
   const fillValue = sourceValue !== null && sourceValue !== undefined 
     ? sourceValue 
     : null;
   ```

3. **乐观更新管理**：只更新目标属性，保留其他属性的乐观更新
   ```typescript
   // 只更新目标属性，保留其他属性的乐观更新
   const currentRow = dataManager.getRowWithUpdates(targetRowId);
   const updatedPropertyValues = {
     ...currentRow.propertyValues,
     [targetPropertyKey]: fillValue
   };
   dataManager.setOptimisticUpdate(targetRowId, targetPropertyKey, fillValue);
   ```

4. **保存逻辑**：使用基础数据 + 单属性更新，避免覆盖其他未保存的乐观更新
   ```typescript
   // 保存时：基础数据 + 填充值，不包含其他未保存的乐观更新
   const baseRow = dataManager.getRowBaseValue(targetRowId);
   const propertyValuesToSave = {
     ...baseRow.propertyValues,
     [targetPropertyKey]: fillValue
   };
   ```

### 3. 剪贴板操作 Hook (`useClipboardOperations.ts`)

**职责**：处理 Cut/Copy/Paste 操作

```typescript
// hooks/useClipboardOperations.ts

interface ClipboardData {
  data: Array<Array<string | number | null>>;
  rowIds: string[];
  propertyKeys: string[];
  isCut: boolean;
}

export function useClipboardOperations(
  dataManager: TableDataManager,
  selectedCells: Set<CellKey>,
  orderedProperties: PropertyConfig[],
  onSaveAsset?: ...,
  onUpdateAsset?: ...
): {
  handleCut: () => ClipboardData | null;
  handleCopy: () => ClipboardData | null;
  handlePaste: (clipboardData: ClipboardData, targetCells: Set<CellKey>) => Promise<void>;
  clipboardData: ClipboardData | null;
  setClipboardData: (data: ClipboardData | null) => void;
}
```

**关键改进**：
- 统一剪贴板数据结构
- 分离 Cut/Copy 和 Paste 逻辑
- Paste 时正确处理新行创建和更新

### 4. 行操作 Hook (`useRowOperations.ts`)

**职责**：处理 Insert/Delete/Clear 操作

```typescript
// hooks/useRowOperations.ts

export function useRowOperations(
  dataManager: TableDataManager,
  selectedCells: Set<CellKey>,
  selectedRowIds: Set<string>,
  orderedProperties: PropertyConfig[],
  onSaveAsset?: ...,
  onUpdateAsset?: ...,
  onDeleteAsset?: ...
): {
  handleInsertRowAbove: () => Promise<void>;
  handleInsertRowBelow: () => Promise<void>;
  handleDeleteRow: () => Promise<void>;
  handleClearContents: () => Promise<void>;
}
```

### 5. 选择管理 Hook (`useSelectionManager.ts`)

**职责**：管理单元格和行的选择状态

```typescript
// hooks/useSelectionManager.ts

export function useSelectionManager(): {
  selectedCells: Set<CellKey>;
  selectedRowIds: Set<string>;
  setSelectedCells: (cells: Set<CellKey>) => void;
  setSelectedRowIds: (ids: Set<string>) => void;
  clearSelection: () => void;
  // ... 其他选择相关方法
}
```

### 6. 工具函数 (`tableDataUtils.ts`, `optimisticUpdateUtils.ts`)

**职责**：提供纯函数工具，便于测试和维护

```typescript
// utils/optimisticUpdateUtils.ts

/**
 * 合并基础数据和乐观更新
 */
export function mergeRowWithOptimisticUpdates(
  baseRow: AssetRow,
  optimisticUpdate?: { name: string; propertyValues: Record<string, any> }
): AssetRow;

/**
 * 获取特定属性的值（优先乐观更新）
 */
export function getPropertyValue(
  baseRow: AssetRow,
  propertyKey: string,
  optimisticUpdate?: { name: string; propertyValues: Record<string, any> }
): any;

/**
 * 构建保存数据（基础数据 + 特定更新）
 */
export function buildSaveData(
  baseRow: AssetRow,
  updates: Record<string, any>,
  orderedProperties: PropertyConfig[]
): { assetName: string; propertyValues: Record<string, any> };
```

## 实施步骤

### 阶段1：创建基础架构（1-2天）

1. 创建 `useTableDataManager.ts` - 统一数据管理
2. 创建工具函数文件
3. 创建类型定义文件

### 阶段2：重构批量填充（2-3天）

1. 创建 `useBatchFill.ts`
2. 修复源值获取问题
3. 修复值传递问题
4. 测试批量填充功能

### 阶段3：重构剪贴板操作（2-3天）

1. 创建 `useClipboardOperations.ts`
2. 重构 Cut/Copy/Paste 逻辑
3. 测试剪贴板功能

### 阶段4：重构行操作（1-2天）

1. 创建 `useRowOperations.ts`
2. 重构 Insert/Delete/Clear 逻辑
3. 测试行操作功能

### 阶段5：集成和测试（2-3天）

1. 在主组件中集成所有 hooks
2. 全面测试所有功能
3. 性能优化
4. 代码清理

## 关键修复点

### 批量填充问题修复

1. **源值获取修复**：
   ```typescript
   // 旧代码（有问题）
   const sourceValue = sourceRowForFill.propertyValues[startPropertyKey] ?? null;
   
   // 新代码（修复）
   const sourceValue = dataManager.getRowBaseValue(sourceRowId, sourcePropertyKey);
   ```

2. **值传递修复**：
   ```typescript
   // 确保值完整传递，避免截断
   const fillValue = sourceValue !== null && sourceValue !== undefined 
     ? (typeof sourceValue === 'string' ? sourceValue : String(sourceValue))
     : null;
   ```

3. **乐观更新修复**：
   ```typescript
   // 只更新目标属性，保留其他属性的乐观更新
   const currentRow = dataManager.getRowWithUpdates(targetRowId);
   if (currentRow) {
     dataManager.setOptimisticUpdate(
       targetRowId, 
       targetPropertyKey, 
       fillValue
     );
   }
   ```

4. **保存逻辑修复**：
   ```typescript
   // 保存时使用基础数据 + 填充值
   const baseRow = dataManager.getRowBaseValue(targetRowId);
   const propertyValuesToSave = {
     ...baseRow.propertyValues,
     [targetPropertyKey]: fillValue
   };
   // 不包含其他未保存的乐观更新，避免覆盖
   ```

## 测试策略

1. **单元测试**：为每个 hook 和工具函数编写单元测试
2. **集成测试**：测试各个功能模块之间的协作
3. **E2E测试**：测试完整的用户操作流程
4. **边界测试**：测试边界情况和错误处理

## 预期收益

1. **代码可维护性**：主组件从7000+行减少到2000行以内
2. **功能稳定性**：修复批量填充的bug，提高功能可靠性
3. **开发效率**：模块化后便于并行开发和测试
4. **代码复用**：工具函数和hooks可以在其他组件中复用

## 注意事项

1. **向后兼容**：确保重构不影响现有功能
2. **性能考虑**：避免不必要的重渲染和计算
3. **错误处理**：完善错误处理和用户反馈
4. **文档更新**：更新相关文档和注释

