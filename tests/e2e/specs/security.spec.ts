import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { users } from '../fixures/users';

/**
 * Security & Authorization E2E Test Suite
 * 
 * Tests critical security aspects including:
 * - Unauthenticated user access protection
 * - Resource creation authorization
 * - Session management after logout
 * - Cross-user access control
 * - API endpoint security
 * 
 * These tests ensure that:
 * 1. Unauthenticated users cannot access protected resources
 * 2. Unauthenticated users cannot create projects or libraries
 * 3. Sessions are properly invalidated after logout
 * 4. Users can only access their own resources
 */

// Detect whether we are running against a real Supabase instance
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isRealSupabase =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('example.supabase.co') &&
  !/dummy/i.test(supabaseAnonKey);

test.describe('Unauthenticated Access Protection', () => {
  
  test.beforeEach(async ({ page, context }) => {
    // Clear all authentication state to ensure user is logged out
    // Step 1: Navigate to the app first (so localStorage is accessible)
    await page.goto('/');
    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('should redirect to login when accessing root path without authentication', async ({ page }) => {
    // Attempt to access the root path
    await page.goto('/');
    
    // Should show login form (AuthForm component)
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    
    // Should NOT show the projects dashboard
    await expect(page.getByRole('heading', { name: /projects/i })).not.toBeVisible();
  });

  test('should redirect to login when accessing projects page without authentication', async ({ page }) => {
    // Attempt to access the projects page directly
    await page.goto('/projects');
    
    // Should be redirected to login or show login form
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    
    // Should NOT show the projects list
    const projectsHeading = page.getByRole('heading', { name: /projects/i });
    await expect(projectsHeading).not.toBeVisible();
  });

  test('should redirect to login when accessing a specific project without authentication', async ({ page }) => {
    // Try to access a specific project page
    const fakeProjectId = 'fake-project-id-12345';
    await page.goto(`/${fakeProjectId}`);
    
    // Should show login form instead of project details
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
  });

  test('should not show "New Project" button without authentication', async ({ page }) => {
    // Access the projects page
    await page.goto('/projects');
    
    // Wait for login form to appear
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    
    // "New Project" button should not be visible
    const newProjectButton = page.getByRole('button', { name: /new project/i });
    await expect(newProjectButton).not.toBeVisible();
  });

  test('should not show sidebar navigation without authentication', async ({ page }) => {
    // Access the app
    await page.goto('/');
    
    // Wait for login form
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    
    // Sidebar (which contains projects/libraries tree) should not be visible
    const sidebar = page.locator('aside');
    await expect(sidebar).not.toBeVisible();
  });
});

test.describe('Resource Creation Authorization', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase instance to test API authorization');

  test.beforeEach(async ({ context }) => {
    // Ensure user is logged out
    // For API tests, we only need to clear cookies
    // localStorage/sessionStorage are not used in API requests
    await context.clearCookies();
  });

    test('should prevent creating project without authentication via API', async ({ request }) => {
        const response = await request.post('/api/projects', {
            data: { name: 'Unauthorized Project', description: 'Test' },
            failOnStatusCode: false
        });

        // 🔍 print detailed information
        const status = response.status();
        const body = await response.text();
        // console.log('=== API Response Debug ===');
        // console.log('Status:', status);
        // console.log('Body:', body);
        // console.log('========================');

        // API should return 401 Unauthorized
        expect(status).toBe(401);
    });

  test('should prevent creating library without authentication via API', async ({ request }) => {
    const fakeProjectId = 'fake-project-id-12345';
    
    // Attempt to create a library without authentication
    const response = await request.post(`/api/projects/${fakeProjectId}/libraries`, {
      data: {
        name: 'Unauthorized Library',
        description: 'This should fail due to lack of authentication'
      },
      failOnStatusCode: false
    });
    
    // Should return 401 Unauthorized
    expect(response.status()).toBe(401);
  });

  test('should prevent listing projects without authentication via API', async ({ request }) => {
    // Attempt to list projects without authentication
    const response = await request.get('/api/projects', {
      failOnStatusCode: false
    });
    
    // Should return 401 Unauthorized
    expect(response.status()).toBe(401);
  });

});

test.describe('Session Management', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase credentials for login/logout');

  test('should invalidate session after logout', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    // Step 1: Login successfully
    await loginPage.goto();
    await loginPage.login(users.seedEmpty);
    await loginPage.expectLoginSuccess();
    
    // Step 2: Verify user is logged in
    // The projects page has no heading; instead verify the user avatar (data-testid="user-menu")
    // which only appears in TopBar when the user is authenticated
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10000 });
    
    // Step 3: Logout
    // The logout button is inside a dropdown that opens when clicking the user avatar
    const userMenuButton = page.getByTestId('user-menu');
    await userMenuButton.click();
    
    // Wait for the dropdown to appear, then click "Logout"
    const logoutButton = page.getByRole('button', { name: /^logout$/i });
    await expect(logoutButton).toBeVisible({ timeout: 5000 });
    await logoutButton.click();
    
    // Step 4: Should be redirected to login page
    await expect(page.getByTestId('user-menu')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    
    // Step 5: Try to access projects page - should be blocked
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
  });

  test('should require re-authentication after logout', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    // Login, logout, and try to access protected resource
    await loginPage.goto();
    await loginPage.login(users.seedEmpty);
    await loginPage.expectLoginSuccess();
    
    // Logout via user avatar dropdown
    const userMenuButton = page.getByTestId('user-menu');
    await userMenuButton.click();
    const logoutButton = page.getByRole('button', { name: /^logout$/i });
    await expect(logoutButton).toBeVisible({ timeout: 5000 });
    await logoutButton.click();
    
    // Should be logged out
    await expect(page.getByTestId('user-menu')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 15000 });
    
    // Try to access projects - should show login
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('user-menu')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 15000 });
    
    // Should be able to login again
    await loginPage.login(users.seedEmpty);
    await loginPage.expectLoginSuccess();
  });
});

test.describe('API Endpoint Security', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase instance to test API security');

  test('should protect critical API endpoints from unauthenticated access', async ({ request }) => {
    const protectedEndpoints = [
      { method: 'GET', url: '/api/projects', description: 'List projects' },
      { method: 'POST', url: '/api/projects', description: 'Create project', data: { name: 'test' } },
      { method: 'GET', url: '/api/projects/test-id/libraries', description: 'List project libraries' },
      { method: 'POST', url: '/api/projects/test-id/libraries', description: 'Create library', data: { name: 'test' } },
      { method: 'GET', url: '/api/libraries/test-id', description: 'Get library details' },
      { method: 'DELETE', url: '/api/projects/test-id/delete', description: 'Delete project' },
    ];

    for (const endpoint of protectedEndpoints) {
      const response =
        endpoint.method === 'GET'
          ? await request.get(endpoint.url, { failOnStatusCode: false })
          : endpoint.method === 'POST'
            ? await request.post(endpoint.url, {
                data: endpoint.data ?? { name: 'test' },
                failOnStatusCode: false,
              })
            : await request.delete(endpoint.url, { failOnStatusCode: false });

      expect(
        [401, 403].includes(response.status()),
        `${endpoint.method} ${endpoint.url} (${endpoint.description}) should be protected. Got status: ${response.status()}`
      ).toBeTruthy();
    }
  });
});

test.describe('Data Isolation & Access Control', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase credentials and multiple users');

  test('should prevent users from accessing other users projects', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const outsiderContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();
      const ownerLogin = new LoginPage(ownerPage);
      const ownerProjects = new ProjectPage(ownerPage);
      const projectName = `IDOR Project ${Date.now()}`;

      await ownerLogin.goto();
      await ownerLogin.login(users.seedEmpty3);
      await ownerLogin.expectLoginSuccess();
      await ownerProjects.createProject({
        name: projectName,
        description: 'Created by user A for IDOR isolation coverage',
      });
      await ownerProjects.expectProjectCreated(projectName);

      const projectId = new URL(ownerPage.url()).pathname.slice(1);
      expect(projectId).toMatch(/^[0-9a-f-]{36}$/i);

      const outsiderPage = await outsiderContext.newPage();
      const outsiderLogin = new LoginPage(outsiderPage);
      await outsiderLogin.goto();
      await outsiderLogin.login(users.seedEmpty4);
      await outsiderLogin.expectLoginSuccess();
      await outsiderPage.goto(`/${projectId}`, { waitUntil: 'domcontentloaded' });

      await expect(outsiderPage.getByText(projectName, { exact: true })).not.toBeVisible({
        timeout: 15000,
      });

      await expect
        .poll(
          async () => {
            const url = outsiderPage.url();
            const bodyText = await outsiderPage.locator('body').innerText().catch(() => '');
            return (
              url.includes('/projects') ||
              /not found|unable to load|login|unauthorized|access denied/i.test(bodyText)
            );
          },
          { timeout: 45000, intervals: [500, 1000, 2000] }
        )
        .toBe(true);
    } finally {
      await ownerContext.close();
      await outsiderContext.close();
    }
  });
});

test.describe('Input Validation & Security', () => {
  test.skip(!isRealSupabase, 'Requires real Supabase credentials');

  test('should prevent XSS attacks in project names', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const projectPage = new ProjectPage(page);
    const dialogs: string[] = [];

    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    await loginPage.goto();
    await loginPage.login(users.seedEmpty2);
    await loginPage.expectLoginSuccess();
    await projectPage.goto();

    const xssPayload = '<script>alert("XSS")</script>';
    await projectPage.createProjectButton.first().click();
    await expect(projectPage.projectNameInput).toBeVisible({ timeout: 5000 });
    await projectPage.projectNameInput.fill(xssPayload);
    await projectPage.submitProjectButton.click();

    await expect
      .poll(async () => dialogs, { timeout: 5000, intervals: [250, 500] })
      .not.toContain('XSS');
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10000 });
  });

  test('should sanitize SQL injection attempts in search inputs', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const projectPage = new ProjectPage(page);
    const sqlPayloads = ["'; DROP TABLE projects; --", "1' OR '1'='1", "admin'--"];

    await loginPage.goto();
    await loginPage.login(users.seedEmpty);
    await loginPage.expectLoginSuccess();
    await projectPage.goto();

    const searchInput = page.getByPlaceholder(/Search for\.\.\.|Find in cell values\.\.\.|search/i).first();
    const hasSearch = await searchInput.isVisible({ timeout: 10000 }).catch(() => false);

    if (hasSearch) {
      for (const payload of sqlPayloads) {
        await searchInput.fill(payload);
        await searchInput.press('Enter');

        await expect
          .poll(
            async () => {
              const bodyText = await page.locator('body').innerText().catch(() => '');
              return /database error|sql error|syntax error/i.test(bodyText);
            },
            { timeout: 5000, intervals: [500, 1000] }
          )
          .toBe(false);
      }
    }

    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 10000 });
  });
});
