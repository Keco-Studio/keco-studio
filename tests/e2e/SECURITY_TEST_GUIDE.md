# 安全策略测试指南

## 📋 测试目标

验证代码级别的安全策略是否有效，确保：
1. 用户只能访问自己的数据
2. 用户无法访问其他用户的数据
3. 所有增删改查操作都经过权限校验

## ⚠️ 重要说明

**不需要删除 migrations！** 
- `supabase/migrations/` 下的 SQL 文件是数据库结构定义（表结构、约束等）
- 这些文件定义了数据库的 schema，不应该删除
- 我们只需要清空**测试数据**（projects, libraries, folders, assets 等）

## 🧹 第一步：清空测试数据

### 方法一：使用清理脚本（推荐）

#### 如果是远程 Supabase：

**⚠️ 重要：首先配置环境变量**

在 `.env.local` 文件中添加以下环境变量：

```bash
# Supabase 项目 URL（应该已经有了）
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co

# Supabase Anon Key（应该已经有了）
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# ⭐ 需要添加：Service Role Key（用于管理员权限操作）
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**如何获取 Service Role Key：**
1. 打开 Supabase Dashboard
2. 进入你的项目
3. 点击左侧菜单的 **Settings** → **API**
4. 在 **Project API keys** 部分找到 **`service_role`** key
5. 复制这个 key（⚠️ 注意：这个 key 有管理员权限，不要提交到 Git！）

**然后运行清理脚本：**

有两种方式运行清理脚本：

**方式 1：使用 npm 脚本（推荐）**

```bash
# 使用 npm 脚本运行（会自动使用项目中的 tsx）
npm run clean:test-data
```

**方式 2：直接使用 npx**

```bash
# 使用 npx 运行（如果 tsx 未全局安装）
npx tsx scripts/clean-remote-test-data.ts
```

**如果遇到 "tsx command not found" 错误：**

1. 确保已安装项目依赖：
   ```bash
   npm install
   ```

2. 然后使用 npm 脚本运行：
   ```bash
   npm run clean:test-data
   ```

**前提条件总结：**
- ✅ `NEXT_PUBLIC_SUPABASE_URL` - 你的 Supabase 项目 URL（通常已有）
- ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Anon key（通常已有）
- ⭐ **`SUPABASE_SERVICE_ROLE_KEY`** - Service role key（**需要添加**）

**验证环境变量是否设置正确：**

```bash
# 使用 npm 脚本检查环境变量
npm run check-env
```

或者使用 npx：
```bash
npx tsx scripts/check-env.ts
```

这个脚本会检查所有必需的环境变量，并显示哪些已设置、哪些缺失。

#### 如果是本地 Supabase：

```bash
# 在 Supabase CLI 中执行 SQL
supabase db execute --file supabase/clean-test-data.sql
```

### 方法二：手动在 Supabase Dashboard 中清空

1. 打开 Supabase Dashboard
2. 进入 SQL Editor
3. 执行以下 SQL（按依赖关系顺序删除）：

```sql
-- 清空所有测试数据（保留用户）
BEGIN;

-- 删除所有项目（级联删除会处理相关的 folders, libraries, assets）
DELETE FROM projects;

-- 或者只删除测试用户的数据
DELETE FROM projects 
WHERE owner_id IN (
  SELECT id FROM auth.users 
  WHERE email LIKE '%@mailinator.com'
);

COMMIT;
```

## 👥 第二步：创建两个测试用户

### 方法一：通过应用注册（推荐）

1. **创建用户 A：**
   - 访问应用注册页面
   - 注册邮箱：`test-user-a@mailinator.com`
   - 密码：`TestPassword123!`
   - 用户名：`testusera`

2. **创建用户 B：**
   - 退出用户 A
   - 访问应用注册页面
   - 注册邮箱：`test-user-b@mailinator.com`
   - 密码：`TestPassword123!`
   - 用户名：`testuserb`

### 方法二：使用 seed 脚本（如果已有）

如果已经有 seed 脚本，可以使用现有的测试用户：
- `seed-empty@mailinator.com` / `Password123!` (用户 A)
- `seed-empty-2@mailinator.com` / `Password123!` (用户 B)

## 🧪 第三步：编写 Playwright 测试脚本

创建一个新的测试文件来验证安全策略：

### 测试场景

1. **用户隔离测试：**
   - 用户 A 创建项目
   - 用户 B 登录后看不到用户 A 的项目
   - 用户 B 尝试直接访问用户 A 的项目 ID（应该被拒绝）

2. **权限验证测试：**
   - 用户 A 创建项目，获取项目 ID
   - 用户 B 尝试访问该项目（应该失败）
   - 用户 B 尝试删除该项目（应该失败）
   - 用户 B 尝试修改该项目（应该失败）

3. **数据创建验证：**
   - 用户 A 创建项目，验证 `owner_id` 正确
   - 用户 B 创建项目，验证 `owner_id` 正确

## 📝 测试脚本示例

创建文件：`tests/e2e/specs/cross-user-security.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';

/**
 * 跨用户安全测试
 * 验证用户无法访问其他用户的数据
 */

// 定义测试用户
const userA = {
  email: 'test-user-a@mailinator.com',
  password: 'TestPassword123!',
};

const userB = {
  email: 'test-user-b@mailinator.com',
  password: 'TestPassword123!',
};

test.describe('跨用户数据隔离测试', () => {
  let userAProjectId: string;

  test('用户 A 创建项目，用户 B 无法访问', async ({ page, context }) => {
    const loginPage = new LoginPage(page);
    const projectPage = new ProjectPage(page);

    // ==========================================
    // 步骤 1: 用户 A 登录并创建项目
    // ==========================================
    await test.step('用户 A 登录并创建项目', async () => {
      await loginPage.goto();
      await loginPage.login(userA);
      await loginPage.expectLoginSuccess();

      // 创建项目
      await projectPage.createProject({
        name: '用户A的私有项目',
        description: '这个项目只有用户A可以访问',
      });
      await projectPage.expectProjectCreated();

      // 获取项目 ID（从 URL 中提取）
      const url = page.url();
      const match = url.match(/\/([a-f0-9-]{36})/);
      if (match) {
        userAProjectId = match[1];
        console.log('用户 A 的项目 ID:', userAProjectId);
      } else {
        throw new Error('无法从 URL 中提取项目 ID');
      }
    });

    // ==========================================
    // 步骤 2: 用户 A 退出登录
    // ==========================================
    await test.step('用户 A 退出登录', async () => {
      // 找到并点击退出按钮
      const logoutButton = page.getByRole('button', { name: /logout|sign out|退出/i });
      if (await logoutButton.isVisible()) {
        await logoutButton.click();
      } else {
        // 如果在菜单中，先打开菜单
        const userMenu = page.locator('[data-testid="user-menu"]')
          .or(page.getByRole('button', { name: /user|account|用户|账户/i }));
        if (await userMenu.isVisible()) {
          await userMenu.click();
          await page.getByRole('button', { name: /logout|sign out|退出/i }).click();
        }
      }

      // 验证已退出登录
      await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    });

    // ==========================================
    // 步骤 3: 用户 B 登录
    // ==========================================
    await test.step('用户 B 登录', async () => {
      await loginPage.login(userB);
      await loginPage.expectLoginSuccess();
    });

    // ==========================================
    // 步骤 4: 验证用户 B 看不到用户 A 的项目
    // ==========================================
    await test.step('验证用户 B 的项目列表中不包含用户 A 的项目', async () => {
      // 导航到项目列表页
      await page.goto('/projects');
      await page.waitForTimeout(2000);

      // 验证项目列表中不包含用户 A 的项目名称
      const projectName = page.getByText('用户A的私有项目');
      await expect(projectName).not.toBeVisible();
    });

    // ==========================================
    // 步骤 5: 用户 B 尝试直接访问用户 A 的项目（应该被拒绝）
    // ==========================================
    await test.step('用户 B 尝试直接访问用户 A 的项目 ID', async () => {
      if (!userAProjectId) {
        test.skip();
        return;
      }

      // 尝试直接访问用户 A 的项目
      await page.goto(`/${userAProjectId}`);

      // 应该出现以下情况之一：
      // 1. 显示 403 Forbidden 错误
      // 2. 显示 404 Not Found（避免泄露项目存在信息）
      // 3. 重定向回项目列表页
      // 4. 显示未授权访问的错误信息

      await page.waitForTimeout(2000);

      // 检查是否显示了错误信息或重定向
      const isForbidden = await page.getByText(/forbidden|access denied|unauthorized|未授权|禁止访问/i)
        .isVisible()
        .catch(() => false);
      
      const isNotFound = await page.getByText(/not found|未找到|404/i)
        .isVisible()
        .catch(() => false);
      
      const redirectedToProjects = page.url().includes('/projects');
      
      const showsError = await page.locator('[role="alert"], .error, .error-message')
        .isVisible()
        .catch(() => false);

      // 至少应该满足以下条件之一：显示错误、404、或重定向
      expect(
        isForbidden || isNotFound || redirectedToProjects || showsError,
        '用户 B 应该无法访问用户 A 的项目'
      ).toBeTruthy();
    });
  });

  test('用户 A 和用户 B 各自创建项目，数据互不干扰', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const projectPage = new ProjectPage(page);

    // ==========================================
    // 步骤 1: 用户 A 创建项目
    // ==========================================
    await test.step('用户 A 创建项目', async () => {
      await loginPage.goto();
      await loginPage.login(userA);
      await loginPage.expectLoginSuccess();

      await projectPage.createProject({
        name: '用户A的项目',
        description: '用户A的项目描述',
      });
      await projectPage.expectProjectCreated();
    });

    // ==========================================
    // 步骤 2: 用户 A 退出，用户 B 登录
    // ==========================================
    await test.step('切换到用户 B', async () => {
      // 退出用户 A
      const logoutButton = page.getByRole('button', { name: /logout|sign out|退出/i });
      if (await logoutButton.isVisible()) {
        await logoutButton.click();
      }

      await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });

      // 用户 B 登录
      await loginPage.login(userB);
      await loginPage.expectLoginSuccess();
    });

    // ==========================================
    // 步骤 3: 用户 B 创建自己的项目
    // ==========================================
    await test.step('用户 B 创建项目', async () => {
      await projectPage.createProject({
        name: '用户B的项目',
        description: '用户B的项目描述',
      });
      await projectPage.expectProjectCreated();
    });

    // ==========================================
    // 步骤 4: 验证用户 B 只能看到自己的项目
    // ==========================================
    await test.step('验证用户 B 的项目列表', async () => {
      await page.goto('/projects');
      await page.waitForTimeout(2000);

      // 应该能看到用户 B 的项目
      await expect(page.getByText('用户B的项目')).toBeVisible();

      // 不应该看到用户 A 的项目
      await expect(page.getByText('用户A的项目')).not.toBeVisible();
    });
  });

  test('用户 B 尝试通过 API 访问用户 A 的项目（应该失败）', async ({ page, request }) => {
    const loginPage = new LoginPage(page);
    const projectPage = new ProjectPage(page);
    let userAProjectId: string;

    // ==========================================
    // 步骤 1: 用户 A 创建项目
    // ==========================================
    await test.step('用户 A 创建项目', async () => {
      await loginPage.goto();
      await loginPage.login(userA);
      await loginPage.expectLoginSuccess();

      await projectPage.createProject({
        name: 'API测试项目',
        description: '用于API测试',
      });
      await projectPage.expectProjectCreated();

      // 获取项目 ID
      const url = page.url();
      const match = url.match(/\/([a-f0-9-]{36})/);
      if (match) {
        userAProjectId = match[1];
      }
    });

    // ==========================================
    // 步骤 2: 用户 A 退出，用户 B 登录
    // ==========================================
    await test.step('切换到用户 B', async () => {
      const logoutButton = page.getByRole('button', { name: /logout|sign out|退出/i });
      if (await logoutButton.isVisible()) {
        await logoutButton.click();
      }

      await loginPage.login(userB);
      await loginPage.expectLoginSuccess();
    });

    // ==========================================
    // 步骤 3: 用户 B 尝试通过 API 访问用户 A 的项目
    // ==========================================
    await test.step('用户 B 尝试通过 API 访问用户 A 的项目', async () => {
      if (!userAProjectId) {
        test.skip();
        return;
      }

      // 获取用户 B 的认证 token（从 localStorage 或 sessionStorage）
      const token = await page.evaluate(() => {
        // 尝试从 sessionStorage 获取 Supabase token
        const keys = Object.keys(sessionStorage);
        for (const key of keys) {
          if (key.includes('sb-') && key.includes('auth-token')) {
            const value = sessionStorage.getItem(key);
            if (value) {
              try {
                const parsed = JSON.parse(value);
                return parsed.access_token;
              } catch {
                return value;
              }
            }
          }
        }
        return null;
      });

      if (!token) {
        console.warn('无法获取认证 token，跳过 API 测试');
        test.skip();
        return;
      }

      // 尝试访问用户 A 的项目（使用用户 B 的 token）
      const response = await request.get(`/api/projects/${userAProjectId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        failOnStatusCode: false,
      });

      // 应该返回 401 Unauthorized 或 403 Forbidden
      expect(
        [401, 403].includes(response.status()),
        `API 应该拒绝访问，但返回了状态码: ${response.status()}`
      ).toBeTruthy();
    });
  });
});
```

## 🚀 第四步：运行测试

### 运行安全测试

```bash
# 运行跨用户安全测试
npx playwright test tests/e2e/specs/cross-user-security.spec.ts --project=chromium

# 或者运行所有安全相关测试
npx playwright test tests/e2e/specs/security.spec.ts tests/e2e/specs/cross-user-security.spec.ts --project=chromium
```

### 查看测试报告

```bash
# 生成并查看 HTML 报告
npx playwright show-report
```

### 调试模式

```bash
# 以调试模式运行（可以看到浏览器操作）
npx playwright test tests/e2e/specs/cross-user-security.spec.ts --debug
```

## ✅ 测试检查清单

完成以下测试场景：

- [ ] **用户隔离**
  - [ ] 用户 A 创建项目后，用户 B 登录看不到该项目
  - [ ] 用户 B 尝试直接访问用户 A 的项目 ID 被拒绝

- [ ] **数据创建验证**
  - [ ] 用户 A 创建的项目 `owner_id` 正确
  - [ ] 用户 B 创建的项目 `owner_id` 正确

- [ ] **权限验证**
  - [ ] 用户 B 无法删除用户 A 的项目
  - [ ] 用户 B 无法修改用户 A 的项目
  - [ ] 用户 B 无法查看用户 A 的项目详情

- [ ] **API 安全**
  - [ ] 用户 B 通过 API 访问用户 A 的项目返回 401/403

## 📊 验证数据库中的数据

在 Supabase Dashboard 的 SQL Editor 中执行：

```sql
-- 查看所有项目及其所有者
SELECT 
  p.id,
  p.name,
  p.owner_id,
  u.email as owner_email
FROM projects p
JOIN auth.users u ON p.owner_id = u.id
ORDER BY p.created_at DESC;

-- 验证每个项目的 owner_id 都不为空
SELECT 
  COUNT(*) as total_projects,
  COUNT(owner_id) as projects_with_owner,
  COUNT(*) - COUNT(owner_id) as projects_without_owner
FROM projects;

-- 应该返回：projects_without_owner = 0
```

## 🎯 预期结果

所有测试应该通过，证明：

1. ✅ **代码级别的安全策略有效**：用户无法访问其他用户的数据
2. ✅ **数据隔离正确**：每个用户只能看到自己的数据
3. ✅ **权限校验生效**：所有增删改查操作都经过验证

## 📝 给老板的报告模板

```
安全策略测试报告

测试环境：开发/测试环境
测试时间：[日期]

测试内容：
1. 清空测试数据，确保干净环境
2. 创建两个测试用户（用户A、用户B）
3. 验证用户数据隔离
4. 验证权限校验机制

测试结果：
✅ 用户A创建的项目，用户B无法访问
✅ 用户B无法通过直接URL访问用户A的项目
✅ 用户B无法通过API访问用户A的项目
✅ 所有项目的owner_id都正确设置
✅ 代码级别的安全策略在所有增删改查操作中生效

结论：
安全策略实现正确，用户数据完全隔离，权限校验有效。
```

## 🔍 常见问题

### Q: 为什么要清空数据？
A: 确保测试环境干净，避免历史数据干扰测试结果。特别是如果之前有数据是在实现安全策略之前创建的，可能没有正确的 `owner_id`。

### Q: 需要删除 migrations 吗？
A: **不需要！** migrations 是数据库结构定义，不应该删除。只需要清空数据。

### Q: 手动测试还是自动化测试？
A: 建议使用 Playwright 自动化测试，因为：
- 可以重复执行
- 测试结果可追溯
- 可以集成到 CI/CD
- 测试场景更全面

### Q: 如果测试失败怎么办？
A: 
1. 检查 `authorizationService.ts` 中的权限校验逻辑
2. 检查 `projectService.ts` 等 service 是否调用了权限校验
3. 查看测试报告中的错误信息
4. 检查数据库中的 `owner_id` 是否正确设置

