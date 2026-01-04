# 文件上传安全性测试指南

## 📋 概述

文件上传安全性测试 (`file-upload-security.spec.ts`) 用于验证文件上传功能的安全性，包括：
- 文件类型验证
- 文件大小限制
- 路径遍历攻击防护
- 未授权上传防护
- 恶意文件扩展名验证

## 🚀 如何运行测试

### 方法 1：使用 npm 脚本（推荐）

```bash
# 运行文件上传安全测试
npm run test:upload-security
```

### 方法 2：直接使用 Playwright 命令

```bash
# 运行文件上传安全测试
npx playwright test tests/e2e/specs/file-upload-security.spec.ts

# 带浏览器界面运行（可以看到测试过程）
npx playwright test tests/e2e/specs/file-upload-security.spec.ts --headed

# 运行特定测试用例
npx playwright test tests/e2e/specs/file-upload-security.spec.ts -g "should reject executable files"

# 调试模式运行
npx playwright test tests/e2e/specs/file-upload-security.spec.ts --debug
```

### 方法 3：运行所有测试（包括文件上传安全测试）

```bash
# 运行所有 E2E 测试
npm run test:e2e
```

## ⚙️ 前置条件

### 1. 环境变量配置

测试需要真实的 Supabase 实例。确保在 `.env` 或 `.env.local` 中配置：

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**注意**：如果没有配置真实的 Supabase 实例，测试会自动跳过（使用 `test.skip`）。

### 2. 测试用户

确保测试用户存在（见 `tests/e2e/fixures/users.ts`）：
- `users.seedEmpty` - 用于文件上传测试

### 3. 开发服务器

测试会自动启动开发服务器（通过 `playwright.config.ts` 中的 `webServer` 配置），但如果你想手动启动：

```bash
# 在一个终端启动开发服务器
npm run dev

# 在另一个终端运行测试
npm run test:upload-security
```

## 📊 测试报告

测试完成后，会生成 HTML 测试报告：

```bash
# 查看测试报告
npx playwright show-report
```

报告会显示：
- ✅ 通过的测试
- ❌ 失败的测试
- ⏱️ 执行时间
- 📸 失败时的截图和视频（如果配置了）

## 🧪 测试场景说明

### 当前可运行的测试

#### 1. 未授权上传测试 ✅

**可以运行**：测试未登录用户无法访问文件上传功能
- 验证未认证用户被重定向到登录页面
- 验证文件上传输入框不可见

```bash
npm run test:upload-security
```

这个测试会自动运行并通过。

### 需要手动设置的测试（已跳过）

以下测试目前被标记为 `test.skip()`，因为它们需要完整的数据设置：

#### 1. 文件类型验证 ⏭️

需要：
- 一个项目
- 一个 library（在该项目中）
- 一个 predefined template，其中至少有一个 'image' 或 'file' 类型的字段
- 导航到 asset 创建页面：`/[projectId]/[libraryId]/new`

测试会验证以下文件类型被正确拒绝：
- `.exe` - 可执行文件
- `.sh` - Shell 脚本
- `.php` - PHP 文件
- `.js` - JavaScript 文件

#### 2. 文件大小限制 ⏭️

- 测试超过 5MB 的文件被拒绝
- 测试小于 5MB 的文件被接受

#### 3. 路径遍历攻击 ⏭️

- 测试包含 `../` 的文件名被正确处理
- 测试包含空字节的文件名被正确处理

## ⚠️ 重要说明

### 为什么这些测试被跳过？

文件上传功能 (`MediaFileUpload` 组件) 只在以下情况下显示：
1. 用户在 Asset 创建/编辑页面（`/[projectId]/[libraryId]/[assetId]` 或 `/[projectId]/[libraryId]/new`）
2. 该 Library 的 Predefined Template 中至少有一个字段类型是 `'image'` 或 `'file'`

这意味着要测试文件上传，需要：
- 完整的数据链：Project → Library → Template (with file/image field) → Asset Creation Page
- 复杂的导航逻辑
- 每个测试前的数据准备

当前测试文件专注于可以独立运行的测试（未授权上传），避免复杂的数据设置问题。

### 如何手动测试文件上传安全性？

如果你想手动测试文件上传的安全性：

1. **准备测试数据**：
   ```bash
   # 运行 happy-path 测试创建基础数据
   npm run test:happy
   ```

2. **手动测试场景**：
   - 登录系统
   - 导航到有文件上传功能的 Asset 创建页面
   - 尝试上传不同类型的文件（.exe, .sh, .php, .js）
   - 尝试上传超过 5MB 的文件
   - 验证错误消息是否正确显示

3. **或者创建专门的测试数据**：
   - 创建一个项目
   - 创建一个 library
   - 创建一个 template，包含 image 或 file 类型的字段
   - 然后取消注释相关测试并运行

## ⚠️ 重要提示

### 测试中的导航逻辑

**注意**：测试文件中的 `beforeEach` 钩子包含示例导航逻辑，用于导航到包含文件上传功能的页面。**你可能需要根据实际的页面结构调整这些导航逻辑**。

当前测试假设：
1. 用户登录后可以访问项目页面
2. 项目页面或资产页面包含文件上传组件

如果实际的页面结构不同，请修改 `beforeEach` 中的导航逻辑。

### 查找文件上传输入框

测试使用以下选择器查找文件上传输入框：

```typescript
const fileInput = page.locator('input[type="file"]').first();
```

如果页面中有多个文件上传输入框，或者选择器不同，请相应调整。

## 🔄 CI/CD 集成

### 当前状态

**文件上传安全测试目前不会在 GitHub Actions 中自动运行**。

当前 CI 工作流 (`.github/workflows/playwright.yml`) 只运行：
- `test:e2e:sequential` - 包含 `happy-path.spec.ts` 和 `destructive.spec.ts`

### 如果需要添加到 CI

如果你想在每次 push 时自动运行文件上传安全测试，有两个选择：

#### 选择 1：添加到现有测试序列

修改 `package.json`：

```json
{
  "scripts": {
    "test:e2e:sequential": "playwright test tests/e2e/specs/happy-path.spec.ts tests/e2e/specs/destructive.spec.ts tests/e2e/specs/file-upload-security.spec.ts"
  }
}
```

#### 选择 2：作为独立测试步骤（推荐）

修改 `.github/workflows/playwright.yml`：

```yaml
- name: Run file upload security tests
  run: npm run test:upload-security
  continue-on-error: false
```

**注意**：添加到 CI 前，确保：
1. ✅ 测试在本地运行成功
2. ✅ 导航逻辑正确适配实际页面结构
3. ✅ 测试数据清理逻辑正确

## 🐛 故障排除

### 测试被跳过

如果看到测试被跳过，检查：
1. ✅ 环境变量是否正确配置
2. ✅ Supabase URL 是否为真实实例（不是 example.supabase.co）
3. ✅ 查看测试输出中的跳过原因

### 测试失败：找不到文件上传输入框

```
Error: locator.locator: Target closed
```

**解决方案**：
1. 检查页面是否正确加载
2. 调整 `beforeEach` 中的导航逻辑
3. 确认文件上传组件确实存在
4. 使用 `--headed` 模式查看实际页面

### 测试失败：文件上传被接受（应该被拒绝）

如果恶意文件被成功上传，说明：
1. ⚠️ 文件类型验证可能有问题
2. ⚠️ 服务器端验证可能缺失
3. ⚠️ 需要检查 `validateMediaFile` 函数

## 📚 相关文档

- [Playwright 官方文档](https://playwright.dev/)
- [项目测试指南](./CI_TEST_GUIDE.md)
- [安全测试文档](./specs/security.spec.ts)

## 💡 最佳实践

1. **本地先测试**：在添加到 CI 前，先在本地运行测试
2. **使用 headed 模式调试**：遇到问题时使用 `--headed` 查看实际执行过程
3. **查看测试报告**：失败时查看 HTML 报告获取详细信息
4. **定期运行**：建议在修改文件上传相关代码后运行这些测试

