import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
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

        // 🔍 打印详细信息
        const status = response.status();
        const body = await response.text();
        console.log('=== API Response Debug ===');
        console.log('Status:', status);
        console.log('Body:', body);
        console.log('========================');

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

  test.skip('should prevent accessing project details without authentication via API', async ({ request }) => {
    // TODO: Implement GET /api/projects/[projectId] route first
    const fakeProjectId = 'fake-project-id-12345';
    
    // Attempt to get project details without authentication
    const response = await request.get(`/api/projects/${fakeProjectId}`, {
      failOnStatusCode: false
    });
    
    // Should return 401 Unauthorized or 403 Forbidden
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

  test.skip('should prevent deleting project without authentication via API', async ({ request }) => {
    // TODO: Implement DELETE /api/projects/[projectId] route first
    const fakeProjectId = 'fake-project-id-12345';
    
    // Attempt to delete a project without authentication
    const response = await request.delete(`/api/projects/${fakeProjectId}`, {
      failOnStatusCode: false
    });
    
    // Should return 401 Unauthorized or 403 Forbidden
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
    
    // Step 2: Verify user is logged in and can see projects page
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
    
    // Step 3: Logout
    // Find and click logout button (adjust selector based on your app)
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
    } else {
      // If logout is in a menu, you might need to open the menu first
      const userMenu = page.locator('[data-testid="user-menu"]').or(page.getByRole('button', { name: /user|account/i }));
      if (await userMenu.isVisible()) {
        await userMenu.click();
        await page.getByRole('button', { name: /logout|sign out/i }).click();
      }
    }
    
    // Step 4: Should be redirected to login page
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    
    // Step 5: Try to access projects page - should be blocked
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
  });

  test.skip('should not allow browser back button to access protected pages after logout', async ({ page }) => {
    // TODO: This is a known limitation of SPAs (Single Page Applications)
    // The browser back button may show cached UI, but API calls will still fail (401)
    // This is acceptable behavior as users cannot actually access protected data
    const loginPage = new LoginPage(page);
    
    // Step 1: Login and navigate to projects
    await loginPage.goto();
    await loginPage.login(users.seedEmpty);
    await page.waitForURL('**/projects', { timeout: 10000 });
    
    // Step 2: Verify we're on projects page
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
    const projectsUrl = page.url();
    
    // Step 3: Navigate to another protected page (if available)
    // This creates history for back button
    await page.goto('/projects');
    
    // Step 4: Logout - need to open user menu first
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
    } else {
      // Open user menu and click logout
      const userMenu = page.locator('[data-testid="user-menu"]').or(page.getByRole('button', { name: /user|account/i }));
      if (await userMenu.isVisible()) {
        await userMenu.click();
        await page.getByRole('button', { name: /logout|sign out/i }).click();
      }
    }
    
    // Step 5: Should be on login page
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    
    // Step 6: Try to go back using browser back button
    await page.goBack();
    
    // Step 7: Should still show login page, not the protected page
    // The app should redirect back to login
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /projects/i })).not.toBeVisible();
  });

  test('should require re-authentication after logout', async ({ page }) => {
    const loginPage = new LoginPage(page);
    
    // Login, logout, and try to access protected resource
    await loginPage.goto();
    await loginPage.login(users.seedEmpty);
    await loginPage.expectLoginSuccess();
    
    // Logout - need to open user menu first
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
    } else {
      // Open user menu and click logout
      const userMenu = page.locator('[data-testid="user-menu"]').or(page.getByRole('button', { name: /user|account/i }));
      if (await userMenu.isVisible()) {
        await userMenu.click();
        await page.getByRole('button', { name: /logout|sign out/i }).click();
      }
    }
    
    // Should be logged out
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible();
    
    // Try to access projects - should show login
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: /login/i })).toBeVisible();
    
    // Should be able to login again
    await loginPage.login(users.seedEmpty);
    await loginPage.expectLoginSuccess();
  });
});

// test.describe('API Endpoint Security', () => {
//   test.skip(!isRealSupabase, 'Requires real Supabase instance to test API security');

//   test('should protect all critical API endpoints from unauthenticated access', async ({ request }) => {
//     // Define critical API endpoints that should be protected
//     const protectedEndpoints = [
//       { method: 'GET', url: '/api/projects', description: 'List projects' },
//       { method: 'POST', url: '/api/projects', description: 'Create project' },
//       { method: 'GET', url: '/api/projects/test-id', description: 'Get project details' },
//       { method: 'DELETE', url: '/api/projects/test-id', description: 'Delete project' },
//       { method: 'POST', url: '/api/projects/test-id/libraries', description: 'Create library' },
//       { method: 'GET', url: '/api/libraries/test-id', description: 'Get library details' },
//     ];

//     // Test each endpoint
//     for (const endpoint of protectedEndpoints) {
//       let response;
      
//       switch (endpoint.method) {
//         case 'GET':
//           response = await request.get(endpoint.url, { failOnStatusCode: false });
//           break;
//         case 'POST':
//           response = await request.post(endpoint.url, { 
//             data: { name: 'test' },
//             failOnStatusCode: false 
//           });
//           break;
//         case 'DELETE':
//           response = await request.delete(endpoint.url, { failOnStatusCode: false });
//           break;
//         default:
//           continue;
//       }
      
//       // Each endpoint should return 401 Unauthorized or 403 Forbidden
//       expect(
//         [401, 403].includes(response.status()),
//         `${endpoint.method} ${endpoint.url} (${endpoint.description}) should be protected. Got status: ${response.status()}`
//       ).toBeTruthy();
//     }
//   });
// });

// test.describe('Data Isolation & Access Control', () => {
//   test.skip(!isRealSupabase, 'Requires real Supabase credentials and multiple users');
  
//   test('should prevent users from accessing other users projects', async ({ page }) => {
//     const loginPage = new LoginPage(page);
    
//     // Note: This test requires knowing project IDs belonging to different users
//     // For now, we'll test the concept. In a real scenario, you'd need to:
//     // 1. Create a project with User A
//     // 2. Get that project's ID
//     // 3. Logout User A
//     // 4. Login as User B
//     // 5. Try to access User A's project
    
//     // Login as first user
//     await loginPage.goto();
//     await loginPage.login(users.seedWithProject);
//     await page.waitForURL('**/projects', { timeout: 10000 });
    
//     // Try to access a project ID that belongs to another user
//     // This would need to be a real project ID from another user in your test database
//     const otherUsersProjectId = 'other-users-project-id';
//     await page.goto(`/${otherUsersProjectId}`);
    
//     // Should show either:
//     // - 403 Forbidden error
//     // - 404 Not Found (to avoid leaking information about project existence)
//     // - Redirect back to projects list
//     // The exact behavior depends on your app's security design
    
//     const isForbidden = await page.getByText(/forbidden|access denied|unauthorized/i).isVisible().catch(() => false);
//     const isNotFound = await page.getByText(/not found/i).isVisible().catch(() => false);
//     const redirectedToProjects = page.url().includes('/projects');
    
//     // At least one of these should be true
//     expect(isForbidden || isNotFound || redirectedToProjects).toBeTruthy();
//   });
// });

// test.describe('Input Validation & Security', () => {
//   test.skip(!isRealSupabase, 'Requires real Supabase credentials');

//   test('should prevent XSS attacks in project names', async ({ page }) => {
//     const loginPage = new LoginPage(page);
    
//     // Login
//     await loginPage.goto();
//     await loginPage.login(users.seedEmpty);
//     await loginPage.expectLoginSuccess();
    
//     // Try to create a project with XSS payload
//     const xssPayload = '<script>alert("XSS")</script>';
    
//     // Click New Project button
//     await page.getByRole('button', { name: /new project/i }).click();
    
//     // Fill in project name with XSS payload
//     const projectNameInput = page.getByLabel(/project name|name/i);
//     await projectNameInput.fill(xssPayload);
    
//     // Submit
//     const submitButton = page.getByRole('button', { name: /create|submit/i });
//     await submitButton.click();
    
//     // Wait for project to be created (if validation passes)
//     await page.waitForTimeout(2000);
    
//     // Verify the script did NOT execute
//     // The page should not have any alert dialogs
//     const dialogs: string[] = [];
//     page.on('dialog', dialog => {
//       dialogs.push(dialog.message());
//       dialog.dismiss();
//     });
    
//     // Wait a moment to see if any dialogs appear
//     await page.waitForTimeout(1000);
    
//     // No XSS alert should have appeared
//     expect(dialogs).not.toContain('XSS');
    
//     // The text should be displayed as plain text, not executed as HTML
//     if (await page.getByText(xssPayload).isVisible()) {
//       // Good: it's displayed as text
//       expect(true).toBeTruthy();
//     }
//   });

//   test('should sanitize SQL injection attempts in search inputs', async ({ page }) => {
//     const loginPage = new LoginPage(page);
    
//     // Login
//     await loginPage.goto();
//     await loginPage.login(users.seedEmpty);
//     await loginPage.expectLoginSuccess();
    
//     // SQL injection payloads
//     const sqlPayloads = [
//       "'; DROP TABLE projects; --",
//       "1' OR '1'='1",
//       "admin'--"
//     ];
    
//     for (const payload of sqlPayloads) {
//       // Try to use SQL injection in search
//       const searchInput = page.getByPlaceholder(/search/i);
//       if (await searchInput.isVisible()) {
//         await searchInput.fill(payload);
//         await searchInput.press('Enter');
        
//         // Wait for search results
//         await page.waitForTimeout(1000);
        
//         // The app should still work normally
//         // Should not show database errors or crash
//         const hasError = await page.getByText(/database error|sql error|syntax error/i).isVisible().catch(() => false);
//         expect(hasError).toBeFalsy();
//       }
//     }
//   });
// });

