# 协作编辑功能实现说明

## 概述
本文档描述了在 LibraryAssetsTable 中实现的实时协作编辑功能。

## 已实现的功能

### 1. 单元格协作者头像显示
- ✅ 在单元格右下角显示正在编辑该单元格的用户头像
- ✅ 头像为小方形（16x16px），显示用户名的首字母
- ✅ 头像颜色与用户的 avatarColor 一致
- ✅ 支持 tooltip 显示完整用户名

### 2. 多协作者头像排列
- ✅ 当多个用户同时编辑同一单元格时，头像从右到左排列
- ✅ 第一个用户（最早进入的用户）的头像显示在最右边
- ✅ 最多显示 3 个头像，超过的用户数量显示为 "+N"

### 3. 单元格边框颜色
- ✅ 有协作者的单元格左侧显示 3px 彩色边框
- ✅ 边框颜色继承第一个用户（最右边头像）的 avatarColor
- ✅ 边框颜色过渡动画（0.2s ease）

### 4. 实时同步
- ✅ 通过 Supabase Realtime 实现单元格编辑的实时广播
- ✅ 通过数据库 postgres_changes 监听 `library_assets` 表变化
- ✅ 通过数据库 postgres_changes 监听 `library_asset_values` 表变化
- ✅ 新建 asset 时实时同步到所有协作者
- ✅ 编辑 asset 时实时同步到所有协作者
- ✅ 删除 asset 时实时同步到所有协作者

### 5. Presence Tracking
- ✅ 使用 `usePresenceTracking` hook 追踪用户活动单元格
- ✅ 通过 `handleCellFocus` 和 `handleCellBlur` 更新用户的 activeCell
- ✅ 通过 `getUsersEditingCell` 获取正在编辑特定单元格的用户列表

## 技术实现

### 组件层级
```
LibraryAssetsTable
├── CellPresenceAvatars (新增)
│   └── 显示单元格右下角的协作者头像
├── ReferenceField
├── MediaFileUpload
└── 各类型单元格渲染
```

### CSS 样式
- `.cellWithPresence`: 有协作者的单元格样式
- `.cellPresenceAvatars`: 头像容器（右下角定位）
- `.cellPresenceAvatar`: 单个头像样式

### 数据流
1. 用户编辑单元格 → `handleCellFocus` → 更新 presence 状态
2. Presence 状态通过 Supabase Realtime 广播
3. 其他用户接收 presence 更新 → `getUsersEditingCell` 返回协作者列表
4. 单元格渲染时显示协作者头像和边框

### 实时同步机制
1. **单元格编辑**: 通过 `broadcastCellUpdate` 广播变更
2. **Asset 创建**: 
   - 调用 `createAsset` 保存到数据库
   - 触发 `assetCreated` 事件
   - Postgres changes 监听捕获变化并刷新
3. **Asset 更新**:
   - 调用 `updateAsset` 保存到数据库
   - 触发 `assetUpdated` 事件
   - Postgres changes 监听捕获变化并刷新
4. **Asset 删除**:
   - 调用 `deleteAsset` 删除数据库记录
   - 触发 `assetDeleted` 事件
   - Postgres changes 监听捕获变化并刷新

## 用户体验

### 视觉反馈
- 🎨 彩色边框清晰标识协作中的单元格
- 👤 头像实时显示当前协作者
- ✨ 流畅的过渡动画

### 交互反馈
- 🖱️ Hover 头像时放大显示
- 💬 Tooltip 显示用户完整信息
- 🔄 实时同步，无需手动刷新

## 浏览器兼容性
- ✅ Chrome/Edge (推荐)
- ✅ Firefox
- ✅ Safari

## 性能优化
- React.memo 缓存 CellPresenceAvatars 组件
- 只在有协作者时渲染头像组件
- 使用 CSS transform 实现动画（GPU 加速）

## 已知限制
1. 最多显示 3 个头像，超过数量仅显示计数
2. 需要用户登录才能使用协作功能
3. 依赖 Supabase Realtime 服务的稳定性

## 测试建议
1. 打开两个浏览器窗口（或使用隐私模式）
2. 使用不同用户账号登录
3. 同时编辑同一个 library 的 asset
4. 验证头像显示、边框颜色、实时同步功能

## 相关文件
- `/src/components/libraries/LibraryAssetsTable.tsx` - 主表格组件
- `/src/components/libraries/LibraryAssetsTable.module.css` - 样式文件
- `/src/lib/hooks/usePresenceTracking.ts` - Presence tracking hook
- `/src/lib/hooks/useRealtimeSubscription.ts` - Realtime 订阅 hook
- `/src/lib/utils/avatarColors.ts` - 头像颜色生成工具
- `/src/components/collaboration/StackedAvatars.tsx` - 堆叠头像组件（编辑模式使用）
- `/src/app/(dashboard)/[projectId]/[libraryId]/page.tsx` - Library 页面（数据库监听）

## 更新日志
- 2026-01-13: 初始实现协作编辑功能
  - 添加单元格协作者头像显示
  - 实现彩色边框标识
  - 修复编辑和新建 asset 的实时同步问题
  - 添加数据库层面的 postgres_changes 监听
  - 更新 TopBar 用户头像：从默认图标改为显示用户名首字母
  - 用户头像使用与协作功能一致的颜色方案（基于用户ID的确定性颜色）

