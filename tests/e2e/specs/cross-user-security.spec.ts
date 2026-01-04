import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';

/**
 * 跨用户安全测试
 * 验证用户无法访问其他用户的数据
 * 
 * 测试场景：
 * 1. 用户 A 创建项目，用户 B 无法访问
 * 2. 用户 A 和用户 B 各自创建项目，数据互不干扰
 * 3. 用户 B 尝试通过 API 访问用户 A 的项目（应该失败）
 */

// 定义测试用户
// 注意：这些用户需要在数据库中已存在
// 可以通过应用注册或使用 seed 脚本创建
const userA = {
  email: 'seed-empty@mailinator.com',
  password: 'Password123!',
};

const userB = {
  email: 'seed-empty-2@mailinator.com',
  password: 'Password123!',
};

test.describe('跨用户数据隔离测试', () => {
  test.beforeEach(async ({ page, context }) => {
    // 确保每次测试前都是干净的状态
    // 先导航到页面，这样 localStorage 才能访问
    await page.goto('/');
    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('用户 A 创建项目，用户 B 无法访问', async ({ page }) => {
    // 增加超时时间，因为涉及多个用户切换和项目创建
    test.setTimeout(120000); // 2 minutes
    
    const loginPage = new LoginPage(page);
    const projectPage = new ProjectPage(page);
    let userAProjectId: string;

    // ==========================================
    // 步骤 1: 用户 A 登录并创建项目
    // ==========================================
    await test.step('用户 A 登录并创建项目', async () => {
      await loginPage.goto();
      await loginPage.login(userA);
      await loginPage.expectLoginSuccess();

      // 等待认证状态稳定（参考 happy-path.spec.ts）
      await page.waitForFunction(
        () => {
          try {
            const keys = Object.keys(sessionStorage);
            for (const key of keys) {
              if (key.includes('sb-') && key.includes('auth-token')) {
                const value = sessionStorage.getItem(key);
                if (value) {
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && parsed.access_token && parsed.access_token.length > 10) {
                      return true;
                    }
                  } catch {
                    if (value.length > 10) {
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          } catch {
            return false;
          }
        },
        { timeout: 30000 }
      );
      
      // 额外等待确保 Supabase 客户端完全初始化
      await page.waitForTimeout(2000);

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
        console.log('✅ 用户 A 的项目 ID:', userAProjectId);
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
      // 确保在登录页面
      await loginPage.goto();
      await loginPage.login(userB);
      await loginPage.expectLoginSuccess();
      
      // 等待认证状态稳定
      await page.waitForFunction(
        () => {
          try {
            const keys = Object.keys(sessionStorage);
            for (const key of keys) {
              if (key.includes('sb-') && key.includes('auth-token')) {
                const value = sessionStorage.getItem(key);
                if (value) {
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && parsed.access_token && parsed.access_token.length > 10) {
                      return true;
                    }
                  } catch {
                    if (value.length > 10) {
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          } catch {
            return false;
          }
        },
        { timeout: 30000 }
      );
      
      await page.waitForTimeout(2000);
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
      await page.waitForTimeout(3000);

      // 应该出现以下情况之一：
      // 1. 显示 403 Forbidden 错误
      // 2. 显示 404 Not Found（避免泄露项目存在信息）
      // 3. 重定向回项目列表页
      // 4. 显示未授权访问的错误信息

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
        '用户 B 应该无法访问用户 A 的项目。当前 URL: ' + page.url()
      ).toBeTruthy();
    });
  });

  test('用户 A 和用户 B 各自创建项目，数据互不干扰', async ({ page }) => {
    // 增加超时时间
    test.setTimeout(120000); // 2 minutes
    
    const loginPage = new LoginPage(page);
    const projectPage = new ProjectPage(page);

    // ==========================================
    // 步骤 1: 用户 A 创建项目
    // ==========================================
    await test.step('用户 A 创建项目', async () => {
      await loginPage.goto();
      await loginPage.login(userA);
      await loginPage.expectLoginSuccess();

      // 等待认证状态稳定
      await page.waitForFunction(
        () => {
          try {
            const keys = Object.keys(sessionStorage);
            for (const key of keys) {
              if (key.includes('sb-') && key.includes('auth-token')) {
                const value = sessionStorage.getItem(key);
                if (value) {
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && parsed.access_token && parsed.access_token.length > 10) {
                      return true;
                    }
                  } catch {
                    if (value.length > 10) {
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          } catch {
            return false;
          }
        },
        { timeout: 30000 }
      );
      
      await page.waitForTimeout(2000);

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
      } else {
        const userMenu = page.locator('[data-testid="user-menu"]')
          .or(page.getByRole('button', { name: /user|account|用户|账户/i }));
        if (await userMenu.isVisible()) {
          await userMenu.click();
          await page.getByRole('button', { name: /logout|sign out|退出/i }).click();
        }
      }

      await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });

      // 用户 B 登录
      await loginPage.login(userB);
      await loginPage.expectLoginSuccess();
      
      // 等待认证状态稳定
      await page.waitForFunction(
        () => {
          try {
            const keys = Object.keys(sessionStorage);
            for (const key of keys) {
              if (key.includes('sb-') && key.includes('auth-token')) {
                const value = sessionStorage.getItem(key);
                if (value) {
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && parsed.access_token && parsed.access_token.length > 10) {
                      return true;
                    }
                  } catch {
                    if (value.length > 10) {
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          } catch {
            return false;
          }
        },
        { timeout: 30000 }
      );
      
      await page.waitForTimeout(2000);
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
    // 增加超时时间
    test.setTimeout(120000); // 2 minutes
    
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

      // 等待认证状态稳定
      await page.waitForFunction(
        () => {
          try {
            const keys = Object.keys(sessionStorage);
            for (const key of keys) {
              if (key.includes('sb-') && key.includes('auth-token')) {
                const value = sessionStorage.getItem(key);
                if (value) {
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && parsed.access_token && parsed.access_token.length > 10) {
                      return true;
                    }
                  } catch {
                    if (value.length > 10) {
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          } catch {
            return false;
          }
        },
        { timeout: 30000 }
      );
      
      await page.waitForTimeout(2000);

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
        console.log('✅ 用户 A 的项目 ID (API测试):', userAProjectId);
      }
    });

    // ==========================================
    // 步骤 2: 用户 A 退出，用户 B 登录
    // ==========================================
    await test.step('切换到用户 B', async () => {
      const logoutButton = page.getByRole('button', { name: /logout|sign out|退出/i });
      if (await logoutButton.isVisible()) {
        await logoutButton.click();
      } else {
        const userMenu = page.locator('[data-testid="user-menu"]')
          .or(page.getByRole('button', { name: /user|account|用户|账户/i }));
        if (await userMenu.isVisible()) {
          await userMenu.click();
          await page.getByRole('button', { name: /logout|sign out|退出/i }).click();
        }
      }

      await loginPage.goto();
      await loginPage.login(userB);
      await loginPage.expectLoginSuccess();
      
      // 等待认证状态稳定
      await page.waitForFunction(
        () => {
          try {
            const keys = Object.keys(sessionStorage);
            for (const key of keys) {
              if (key.includes('sb-') && key.includes('auth-token')) {
                const value = sessionStorage.getItem(key);
                if (value) {
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed && parsed.access_token && parsed.access_token.length > 10) {
                      return true;
                    }
                  } catch {
                    if (value.length > 10) {
                      return true;
                    }
                  }
                }
              }
            }
            return false;
          } catch {
            return false;
          }
        },
        { timeout: 30000 }
      );
      
      await page.waitForTimeout(2000);
    });

    // ==========================================
    // 步骤 3: 用户 B 尝试通过 API 访问用户 A 的项目
    // ==========================================
    await test.step('用户 B 尝试通过 API 访问用户 A 的项目', async () => {
      if (!userAProjectId) {
        test.skip();
        return;
      }

      // 获取用户 B 的认证 token（从 sessionStorage）
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
        console.warn('⚠️ 无法获取认证 token，跳过 API 测试');
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

      const status = response.status();
      console.log(`📊 API 响应状态码: ${status}`);

      // 应该返回 401 Unauthorized 或 403 Forbidden
      expect(
        [401, 403].includes(status),
        `API 应该拒绝访问，但返回了状态码: ${status}`
      ).toBeTruthy();
    });
  });
});

