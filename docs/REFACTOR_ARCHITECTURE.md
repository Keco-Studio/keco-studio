# LibraryAssetsTable 重构架构方案

## 当前架构问题

```
LibraryAssetsTable.tsx (7068行)
├── 数据管理逻辑（分散在各处）
├── 批量填充逻辑（2600-2800行，问题代码）
├── Cut/Copy/Paste逻辑（3300-4150行）
├── Insert/Delete/Clear逻辑（4200-5000行）
├── 选择管理逻辑（2200-2600行）
└── UI渲染逻辑（5000-7000行）
```

**问题**：
- 所有逻辑耦合在一个文件中
- 数据获取和操作逻辑混在一起
- 乐观更新管理混乱
- 难以测试和维护

## 重构后架构

```
LibraryAssetsTable.tsx (主组件，~2000行)
│
├── hooks/
│   ├── useTableDataManager.ts          # 数据管理核心
│   │   ├── getBaseRows()               # 获取基础数据
│   │   ├── getRowsWithOptimisticUpdates()  # 获取完整数据
│   │   ├── getRowBaseValue()           # 获取基础值（关键修复）
│   │   ├── getRowValue()               # 获取最新值
│   │   └── 乐观更新管理方法
│   │
│   ├── useBatchFill.ts                 # 批量填充
│   │   ├── fillDown()                  # 向下填充（修复版）
│   │   ├── fillUp()                    # 向上填充
│   │   ├── fillRight()                 # 向右填充
│   │   └── fillLeft()                  # 向左填充
│   │
│   ├── useClipboardOperations.ts       # 剪贴板操作
│   │   ├── handleCut()                 # 剪切
│   │   ├── handleCopy()                # 复制
│   │   └── handlePaste()               # 粘贴
│   │
│   ├── useRowOperations.ts             # 行操作
│   │   ├── handleInsertRowAbove()      # 上方插入
│   │   ├── handleInsertRowBelow()      # 下方插入
│   │   ├── handleDeleteRow()           # 删除行
│   │   └── handleClearContents()       # 清空内容
│   │
│   └── useSelectionManager.ts          # 选择管理
│       ├── selectedCells               # 选中的单元格
│       ├── selectedRowIds              # 选中的行ID
│       └── 选择相关方法
│
├── utils/
│   ├── tableDataUtils.ts               # 数据工具函数
│   ├── optimisticUpdateUtils.ts        # 乐观更新工具
│   └── cellSelectionUtils.ts           # 选择工具
│
└── types/
    └── tableOperations.ts              # 操作类型定义
```

## 数据流设计

### 当前数据流（有问题）

```
用户操作 → getAllRowsForCellSelection() 
         → 返回包含旧乐观更新的数据
         → 获取源值（可能是旧值）
         → 填充操作
         → 设置新的乐观更新
         → 保存（可能覆盖其他乐观更新）
```

**问题**：
- `getAllRowsForCellSelection()` 返回的数据包含所有乐观更新
- 获取源值时可能拿到旧的乐观更新值
- 保存时可能覆盖其他未保存的乐观更新

### 重构后数据流（修复版）

```
用户操作 → dataManager.getRowBaseValue() 
         → 从基础数据源获取源值（不受乐观更新影响）
         → 填充操作
         → dataManager.setOptimisticUpdate()（只更新目标属性）
         → 保存（基础数据 + 填充值，不覆盖其他乐观更新）
         → dataManager.clearOptimisticUpdate()（清除已保存的乐观更新）
```

**改进**：
- 源值从基础数据源获取，确保是最新保存的值
- 乐观更新只更新目标属性，保留其他属性的乐观更新
- 保存时使用基础数据 + 填充值，不包含其他未保存的乐观更新

## 核心修复点

### 修复1：源值获取

**问题代码**（2648行）：
```typescript
const sourceValue = sourceRowForFill.propertyValues[startPropertyKey] ?? null;
// sourceRowForFill 来自 getAllRowsForCellSelection()
// 可能包含旧的乐观更新
```

**修复代码**：
```typescript
const sourceValue = dataManager.getRowBaseValue(sourceRowId, sourcePropertyKey);
// 直接从基础数据源获取，不受乐观更新影响
```

### 修复2：值传递

**问题**：值可能在传递过程中被截断或转换

**修复**：
```typescript
const fillValue = sourceValue !== null && sourceValue !== undefined 
  ? sourceValue  // 保持原始类型和值
  : null;
```

### 修复3：乐观更新管理

**问题**：乐观更新可能覆盖其他未保存的更新

**修复**：
```typescript
// 只更新目标属性
dataManager.setOptimisticUpdate(targetRowId, targetPropertyKey, fillValue);
// 保留其他属性的乐观更新
```

### 修复4：保存逻辑

**问题**：保存时可能包含其他未保存的乐观更新，导致覆盖

**修复**：
```typescript
// 保存时：基础数据 + 填充值
const baseRow = dataManager.getRowBaseValue(targetRowId);
const propertyValuesToSave = {
  ...baseRow.propertyValues,
  [targetPropertyKey]: fillValue
};
// 不包含其他未保存的乐观更新
```

## 组件职责划分

### useTableDataManager
- **职责**：统一管理表格数据源和乐观更新
- **输入**：基础数据源、乐观更新状态、新资产、已删除资产
- **输出**：数据访问接口和乐观更新管理方法
- **关键方法**：
  - `getRowBaseValue()` - 获取基础值（不受乐观更新影响）
  - `getRowValue()` - 获取最新值（包含乐观更新）
  - `setOptimisticUpdate()` - 设置乐观更新
  - `clearOptimisticUpdate()` - 清除乐观更新

### useBatchFill
- **职责**：处理批量填充操作
- **输入**：dataManager、orderedProperties、onUpdateAsset
- **输出**：fillDown/fillUp/fillRight/fillLeft 方法
- **关键修复**：
  - 使用 `getRowBaseValue()` 获取源值
  - 确保值完整传递
  - 只更新目标属性的乐观更新
  - 保存时使用基础数据 + 填充值

### useClipboardOperations
- **职责**：处理剪贴板操作（Cut/Copy/Paste）
- **输入**：dataManager、selectedCells、orderedProperties、回调函数
- **输出**：handleCut/handleCopy/handlePaste 方法
- **关键点**：
  - 统一剪贴板数据结构
  - 分离 Cut/Copy 和 Paste 逻辑
  - 正确处理新行创建和更新

### useRowOperations
- **职责**：处理行操作（Insert/Delete/Clear）
- **输入**：dataManager、selectedCells、selectedRowIds、回调函数
- **输出**：各种行操作方法
- **关键点**：
  - 统一使用 dataManager 获取数据
  - 正确处理乐观更新

### useSelectionManager
- **职责**：管理选择状态
- **输入**：无（内部状态管理）
- **输出**：选择状态和方法
- **关键点**：
  - 统一管理单元格和行选择
  - 提供选择相关工具方法

## 实施优先级

### 阶段1：核心数据管理（最高优先级）
1. 创建 `useTableDataManager.ts`
2. 实现 `getRowBaseValue()` 方法（关键修复）
3. 实现乐观更新管理方法

### 阶段2：批量填充修复（高优先级）
1. 创建 `useBatchFill.ts`
2. 使用 `getRowBaseValue()` 获取源值
3. 修复值传递和乐观更新逻辑
4. 测试批量填充功能

### 阶段3：其他功能重构（中优先级）
1. 创建 `useClipboardOperations.ts`
2. 创建 `useRowOperations.ts`
3. 创建 `useSelectionManager.ts`

### 阶段4：集成和优化（低优先级）
1. 在主组件中集成所有hooks
2. 清理旧代码
3. 性能优化
4. 完善测试

## 预期效果

### 代码量减少
- 主组件：7068行 → ~2000行（减少70%+）
- 功能模块化：每个hook ~200-500行
- 工具函数：每个文件 ~100-200行

### 功能稳定性提升
- 批量填充问题修复
- 乐观更新管理更清晰
- 数据一致性保证

### 开发效率提升
- 模块化开发
- 易于测试
- 易于维护和扩展

## 注意事项

1. **向后兼容**：确保重构不影响现有功能
2. **渐进式迁移**：逐步替换，不要一次性重写
3. **测试覆盖**：每个模块都要有充分的测试
4. **性能考虑**：避免不必要的重渲染和计算
5. **错误处理**：完善错误处理和用户反馈

