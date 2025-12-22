# Reference 数据类型功能实现说明

## 功能概述

实现了 Reference 数据类型的完整功能，允许 asset 之间进行跨 library 的引用关联。

## 已实现的功能

### 1. 配置 Reference 字段（Predefine 页面）

**位置**: Predefine 页面 - 字段配置

**功能**:
- 在 FieldItem 和 FieldForm 中，当数据类型选择为 "Reference" 时，会显示配置图标
- 点击配置图标打开配置菜单
- 使用 Ant Design Select 组件（tags 模式）选择可关联的 libraries
- 可以选择多个 libraries，支持搜索和标签显示
- 自动排除当前 library（不能引用自己）

**相关文件**:
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/FieldItem.tsx`
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/FieldForm.tsx`
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/types.ts` - 添加了 `referenceLibraries` 字段

### 2. Asset Reference 选择器（Asset 页面）

**位置**: Asset 详情页/新建 Asset 页面

**功能**:
- 自定义 AssetReferenceSelector 组件
- **Library 选择**: 下拉菜单选择要引用的 library
- **搜索功能**: 支持按 asset 名称搜索
- **Asset 展示**: 使用 Avatar 显示 asset 名称首字母，不同 asset 自动分配不同颜色
- **悬浮提示**: 鼠标悬浮显示完整 asset 名称
- **网格布局**: Asset 以卡片形式在网格中展示
- **展开详情**: 点击展开图标查看关联 asset 的详细信息（ID、Library、前3个字段值）
- **选择和清除**: 点击 asset 卡片选择，点击 × 清除选择

**相关文件**:
- `src/components/asset/AssetReferenceSelector.tsx` - 主组件
- `src/components/asset/AssetReferenceSelector.module.css` - 样式
- `src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx` - 集成到 asset 页面

### 3. 数据存储

**数据库结构**:
- 新增字段: `library_field_definitions.reference_libraries` (uuid[])
- 存储可引用的 library IDs 数组
- Asset 的 reference 值存储在 `library_asset_values.value_json` 中（存储引用的 asset ID）

**相关文件**:
- `supabase/migrations/20251222000000_add_reference_libraries_field.sql` - 数据库迁移
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/hooks/useSchemaSave.ts` - 保存逻辑更新

## 使用流程

### 步骤 1: 应用数据库迁移

需要先应用数据库迁移来添加 `reference_libraries` 字段：

```bash
# 如果使用远程 Supabase（推荐）
npx supabase db push

# 或者手动在 Supabase Dashboard 执行 SQL
# 打开 supabase/migrations/20251222000000_add_reference_libraries_field.sql
# 复制 SQL 内容到 Supabase SQL Editor 执行
```

### 步骤 2: 配置 Reference 字段

1. 进入某个 Library 的 Predefine 页面
2. 添加或编辑字段，选择数据类型为 "Reference"
3. 点击字段右侧的配置图标（齿轮图标）
4. 在弹出的配置菜单中选择可以引用的 libraries
5. 保存字段配置

例如：
- 在"人物"library 中创建一个"武器"字段
- 类型选择 "Reference"
- 配置中选择"武器"library
- 这样人物就可以引用武器 library 中的 assets

### 步骤 3: 使用 Reference 字段

1. 在 Asset 页面（新建或编辑）
2. 找到 Reference 类型的字段
3. 点击输入框弹出选择器
4. 从下拉菜单选择 library（如果配置了多个）
5. 使用搜索框搜索 asset（可选）
6. 点击 asset 卡片进行选择
7. 点击展开图标可以查看引用 asset 的详细信息
8. 保存 asset

## 技术实现细节

### AssetReferenceSelector 组件特点

1. **自动加载**: 根据配置的 referenceLibraries 自动加载可选 libraries 和 assets
2. **智能搜索**: 实时过滤 asset 列表
3. **懒加载详情**: 只在点击展开时才加载 asset 详细信息
4. **响应式设计**: 自适应不同屏幕尺寸
5. **状态管理**: 完善的加载、错误、空状态处理

### Avatar 颜色算法

```typescript
const getAvatarColor = (name: string) => {
  const colors = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068', '#f50', '#2db7f5', '#108ee9'];
  const index = name.charCodeAt(0) % colors.length;
  return colors[index];
};
```

基于 asset 名称首字符的 ASCII 码生成一致的颜色。

## 样式设计

- 遵循 Ant Design 设计规范
- 使用项目主题色 (#8726EE)
- 圆角、阴影等视觉效果保持一致
- 支持 hover、active 等交互状态
- 响应式网格布局

## 注意事项

1. **数据库迁移**: 必须先执行数据库迁移，否则保存会失败
2. **权限**: 确保用户有权限访问被引用的 library
3. **循环引用**: 系统自动排除当前 library，避免自引用
4. **性能**: Asset 列表较多时，搜索功能可以提高选择效率

## 后续可能的优化

1. 添加最近使用的 assets 列表
2. 支持批量选择（multi-select）
3. 在 library 列表页面显示 reference 关系图
4. 添加反向引用查询（查看哪些 assets 引用了当前 asset）
5. 支持跨项目引用

## 相关图标

- `assetRefBookIcon.svg` - 书本图标，表示引用
- `assetRefExpandIcon.svg` - 展开箭头图标

## 测试建议

1. 创建两个 libraries（如"人物"和"武器"）
2. 在"人物"library 添加 reference 字段，配置引用"武器"library
3. 在"武器"library 创建几个 assets
4. 在"人物"library 创建 asset，测试 reference 字段的选择功能
5. 测试搜索、展开详情等功能

