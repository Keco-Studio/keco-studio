# Media/File Upload Feature - 测试指南

## 功能验证清单

### ✅ 已实现并验证的功能

#### 1. 数据库和存储配置
- ✅ Supabase Storage bucket `library-media-files` 已创建并设置为 public
- ✅ RLS 策略已正确配置：
  - Public read access for library-media-files (SELECT)
  - Authenticated users can upload their own files (INSERT)
  - Users can update their own files (UPDATE)
  - Users can delete their own files (DELETE)

#### 2. 代码实现
- ✅ `MediaFileUpload` 组件已实现
- ✅ `mediaFileUploadService` 服务已实现
- ✅ Asset 详情页面已集成 Media/File 字段支持

#### 3. 文件类型和大小限制
- ✅ 支持的文件类型：
  - 图片: JPEG, PNG, GIF, WebP, SVG
  - 文档: PDF
  - Office: Word, Excel, PowerPoint
  - 文本: TXT, CSV
- ✅ 文件大小限制: 5MB
- ✅ 客户端验证已实现

#### 4. 用户体验功能
- ✅ 上传进度提示: "Uploading file..."
- ✅ 上传成功提示: "Upload complete!" (2秒后自动消失)
- ✅ 删除进度提示: "Deleting file..."
- ✅ 错误提示: 显示具体的错误信息

#### 5. 文件查看功能
- ✅ 图片文件: 模态框预览
  - 显示图片
  - "Open in new tab" 按钮
  - "Close" 按钮
  - 点击模态框外部关闭
- ✅ 其他文件: 新标签页打开

## 手动测试步骤

### 前置条件
1. ✅ Supabase 本地实例正在运行 (`npx supabase status`)
2. ✅ Next.js 开发服务器正在运行 (`npm run dev`)
3. ✅ 已经有一个项目和 Library
4. ✅ 已经在 Predefine 中配置了至少一个 Media/File 类型的字段

### 测试步骤

#### 1. 设置 Media/File 字段 (在 Predefine 页面)

1. 登录系统
2. 选择一个项目和 Library
3. 点击 "Predefine" 按钮进入预定义页面
4. 在某个 Section 中：
   - 点击添加字段
   - 输入字段名称，例如 "attachment" 或 "document"
   - 按 `/` 键打开数据类型菜单
   - 选择 "Media/File"
   - 保存字段配置

#### 2. 测试文件上传 (创建新 Asset)

1. 在 Library 侧边栏点击 "+" 创建新 Asset
2. 填写必填字段（如 name）
3. 在 Media/File 字段处：
   - 应该看到 "Choose file to upload" 按钮
   - 点击按钮选择文件
   - 验证点：
     - [ ] 文件大小 > 5MB 时显示错误
     - [ ] 不支持的文件类型显示错误
     - [ ] 有效文件显示 "Uploading file..." 提示
     - [ ] 上传成功后显示 "Upload complete!" 提示
     - [ ] 文件信息正确显示（文件名、大小、图标）
4. 点击 "Create Asset" 保存
5. 验证 Asset 创建成功并包含上传的文件

#### 3. 测试文件查看 (查看模式)

1. 点击刚创建的 Asset 进入详情页
2. 应该是 "Viewing" 模式
3. 在 Media/File 字段处：
   - 应该看到文件信息（图标、文件名、文件大小）
   - 应该看到 "👁️ View" 和 "🗑️ Delete" 按钮
   - 验证点：
     - [ ] 对于图片文件：
       - 点击 "👁️ View" 打开模态框
       - 图片正确显示
       - 点击 "Open in new tab" 可以在新标签页打开
       - 点击 "Close" 或模态框外部可以关闭
     - [ ] 对于非图片文件：
       - 点击 "👁️ View" 在新标签页打开
       - 文件正确显示/下载

#### 4. 测试文件替换 (编辑模式)

1. 在 Asset 详情页点击切换到 "Editing" 模式
2. 在 Media/File 字段处：
   - 删除现有文件（点击 "🗑️ Delete"，确认删除）
   - 验证点：
     - [ ] 显示 "Deleting file..." 提示
     - [ ] 文件信息消失
     - [ ] 显示 "Choose file to upload" 按钮
   - 上传新文件
   - 验证点：
     - [ ] 上传过程与创建时相同
     - [ ] 新文件正确显示
3. 点击 "Save changes" 保存
4. 刷新页面验证文件已更新

#### 5. 测试权限和安全

1. 使用浏览器开发工具查看：
   - [ ] 文件存储路径格式正确：`{userId}/{timestamp}-{filename}`
   - [ ] 文件 URL 可以公开访问（读取）
2. 测试 RLS：
   - 尝试访问其他用户的文件（如果有多个用户）
   - 验证点：
     - [ ] 可以通过 URL 读取其他用户的文件（public read）
     - [ ] 无法删除其他用户的文件

### 6. 测试边界情况

验证以下边界情况：

- [ ] 上传空文件
- [ ] 上传非常大的文件（接近或超过 5MB）
- [ ] 上传特殊字符文件名的文件
- [ ] 上传后立即删除
- [ ] 连续上传多个文件（替换）
- [ ] 在未登录状态下尝试上传（应该显示 "Please sign in to upload files"）

## 已知问题和限制

### 当前实现的限制
1. 每个字段只能上传一个文件（不支持多文件上传）
2. 没有文件预览缩略图
3. 没有拖放上传功能
4. 上传进度只显示文本提示，没有百分比进度条

### 浏览器兼容性
- 现代浏览器（Chrome, Firefox, Safari, Edge）
- 需要启用 JavaScript
- 某些浏览器可能阻止弹出窗口，需要用户允许

## 测试环境信息

### 服务器
- **Supabase Local**: http://127.0.0.1:54321
- **Supabase Studio**: http://127.0.0.1:54323
- **Next.js Dev Server**: http://localhost:3001 (或 3000)

### 数据库
- **Database URL**: postgresql://postgres:postgres@127.0.0.1:54322/postgres
- **Storage Bucket**: library-media-files
- **RLS**: Enabled

### 相关文件
- 组件: `src/components/media/MediaFileUpload.tsx`
- 服务: `src/lib/services/mediaFileUploadService.ts`
- 样式: `src/components/media/MediaFileUpload.module.css`
- 迁移: `supabase/migrations/20251222000000_create_library_media_files_bucket.sql`
- Asset 页面: `src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx`

## 如何报告问题

如果在测试中发现问题，请记录：
1. 问题描述
2. 重现步骤
3. 预期行为
4. 实际行为
5. 浏览器和版本
6. 错误信息（如果有）
7. 截图或录屏（如果可能）

## 下一步

功能已完全实现并可以使用。如果需要，可以：
1. 添加更多自动化测试
2. 改进用户界面
3. 添加上述提到的未来改进功能

