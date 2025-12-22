# Media/File Upload Feature Guide

## 功能概述

当你在 Predefine 页面设置 property 的 dataType 为 **Media/File** 时，在创建或编辑 Asset 时就可以上传和管理文件。

## 功能特性

### 1. 支持的文件类型
- **图片**: JPEG, JPG, PNG, GIF, WebP, SVG
- **文档**: PDF
- **Microsoft Office**: Word (.doc, .docx), Excel (.xls, .xlsx), PowerPoint (.ppt, .pptx)
- **文本文件**: TXT, CSV

### 2. 文件大小限制
- 最大文件大小: **5MB**

### 3. 文件查看
- **图片文件**: 点击 "👁️ View" 按钮后，在模态框中预览图片
  - 模态框中可以点击 "Open in new tab" 在新标签页中打开
  - 点击关闭按钮或模态框外部区域关闭预览
- **其他文件**: 点击 "👁️ View" 按钮后，直接在新标签页中打开文件

### 4. 文件删除
- 点击 "🗑️ Delete" 按钮删除文件
- 需要确认才会执行删除操作

### 5. 上传状态提示
- **上传中**: 显示 "Uploading file..." 提示
- **上传成功**: 显示 "Upload complete!" 提示（2秒后自动消失）
- **删除中**: 显示 "Deleting file..." 提示
- **错误提示**: 如果上传或删除失败，会显示具体的错误信息

## 数据存储

### Supabase Storage
文件存储在 Supabase Storage 的 `library-media-files` bucket 中。

### 文件路径结构
```
{userId}/{timestamp}-{sanitized_filename}
```

例如：`123e4567-e89b-12d3-a456-426614174000/1703260800000-my_document.pdf`

### Row Level Security (RLS)
配置了以下 RLS 策略以确保安全：

1. **公开读取**: 所有人都可以读取文件
2. **认证用户上传**: 只有认证用户可以上传文件到自己的文件夹
3. **用户更新**: 用户只能更新自己的文件
4. **用户删除**: 用户只能删除自己的文件

## 如何使用

### 1. 在 Predefine 中配置 Media/File 字段

1. 进入项目的 Library
2. 点击 "Predefine" 按钮
3. 在某个 Section 中添加一个新的 property
4. 输入字段名称（例如 "attachment"、"document" 等）
5. 按 `/` 键打开数据类型菜单
6. 选择 "Media/File"

### 2. 在 Asset 中上传文件

#### 创建新 Asset 时上传文件
1. 点击 Library 侧边栏的 "+" 按钮创建新 Asset
2. 填写必填字段（如 name）
3. 在 Media/File 字段处，点击 "Choose file to upload" 按钮
4. 选择要上传的文件
5. 等待上传完成（会显示进度提示）
6. 点击 "Create Asset" 保存

#### 编辑现有 Asset 时上传文件
1. 点击 Asset 进入详情页
2. 点击顶部的 "Editing" 模式（如果是 "Viewing" 模式）
3. 在 Media/File 字段处，点击 "Choose file to upload" 按钮
4. 选择要上传的文件
5. 等待上传完成
6. 点击 "Save changes" 保存

### 3. 查看文件

- 在 Asset 详情页的 Media/File 字段中，会显示已上传的文件信息：
  - 文件图标（根据文件类型显示）
  - 文件名
  - 文件大小
- 点击 "👁️ View" 按钮查看文件

### 4. 删除文件

- 在 Asset 编辑模式下
- 点击 "🗑️ Delete" 按钮
- 确认删除操作
- 点击 "Save changes" 保存

## 技术实现

### 组件
- **MediaFileUpload** (`src/components/media/MediaFileUpload.tsx`): 文件上传组件
  - 文件选择
  - 上传进度显示
  - 文件预览
  - 文件删除

### 服务
- **mediaFileUploadService** (`src/lib/services/mediaFileUploadService.ts`): 文件上传服务
  - 文件验证（类型、大小）
  - 上传到 Supabase Storage
  - 删除文件
  - 工具函数（格式化文件大小、获取文件图标等）

### 数据结构

在 `library_asset_values` 表中，Media/File 字段的 `value_json` 存储以下结构：

```typescript
{
  url: string;          // 文件的公开 URL
  path: string;         // Storage 中的文件路径
  fileName: string;     // 原始文件名
  fileSize: number;     // 文件大小（字节）
  fileType: string;     // MIME 类型
  uploadedAt: string;   // 上传时间（ISO 8601）
}
```

## 数据库迁移

相关的数据库迁移文件：
- `supabase/migrations/20251222000000_create_library_media_files_bucket.sql`

如果需要在生产环境中应用此功能，请确保运行此迁移文件。

## 安全注意事项

1. **认证要求**: 用户必须登录才能上传、更新或删除文件
2. **文件隔离**: 每个用户的文件存储在独立的文件夹中
3. **RLS 保护**: 数据库级别的访问控制确保用户只能操作自己的文件
4. **文件大小限制**: 5MB 限制防止滥用存储空间
5. **文件类型限制**: 只允许安全的文件类型上传

## 故障排除

### 上传失败

1. **检查文件大小**: 确保文件小于 5MB
2. **检查文件类型**: 确保文件类型在支持的列表中
3. **检查登录状态**: 确保用户已登录
4. **检查 Supabase 连接**: 确保 Supabase 服务正常运行

### 无法查看文件

1. **检查 URL**: 确保文件的公开 URL 有效
2. **检查浏览器**: 某些浏览器可能阻止弹出窗口，需要允许弹出窗口

### 无法删除文件

1. **检查编辑模式**: 确保在编辑模式下（不是查看模式）
2. **检查权限**: 确保你是文件的所有者

## 未来改进

可能的功能增强：
- [ ] 支持多文件上传
- [ ] 添加文件预览缩略图
- [ ] 支持拖放上传
- [ ] 添加上传进度条（百分比）
- [ ] 支持更多文件类型
- [ ] 增加文件大小限制选项

