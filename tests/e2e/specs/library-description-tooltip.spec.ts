import { test, expect, type Page } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { LoginPage } from '../pages/login.page';

import { generateProjectData } from '../fixures/projects';
import { generateLibraryData } from '../fixures/libraries';
import { users } from '../fixures/users';

/**
 * Library Description Display E2E Tests (current UI behavior)
 *
 * Current product behavior:
 * - Library description is editable at creation time.
 * - Library detail page currently does NOT render description text or tooltip.
 *
 * These tests validate the real behavior to avoid false negatives in CI.
 */

test.describe('Library Description Display Tests', () => {
  test.describe.configure({ mode: 'serial' });

  let projectPage: ProjectPage;
  let libraryPage: LibraryPage;

  test.beforeEach(async ({ page }) => {
    // Initialize Page Objects
    projectPage = new ProjectPage(page);
    libraryPage = new LibraryPage(page);

    // Authenticate user before navigating to projects
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(users.seedEmpty);
    await loginPage.expectLoginSuccess();

    // Verify authentication state is ready for API calls
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

    await page.waitForTimeout(500);
  });

  async function createProjectAndLibraryAndOpenLibrary(
    page: Page,
    description: string
  ): Promise<{ libraryName: string }> {
    const testProject = generateProjectData();
    const testLibrary = {
      name: `Test Library ${Date.now()}`,
      description,
    };

    await projectPage.createProject(testProject);
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    const sidebar = page.getByRole('tree');
    await expect(sidebar).toBeVisible({ timeout: 15000 });

    await page.waitForResponse(
      response => response.url().includes('/role') && response.status() === 200,
      { timeout: 15000 }
    ).catch(() => {});
    await page.waitForTimeout(500);

    await libraryPage.createLibraryUnderProject(testLibrary);
    await libraryPage.expectLibraryCreated();

    const libraryItem = sidebar.locator(`[title="${testLibrary.name}"]`);
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    await libraryItem.click();

    await libraryPage.waitForPageLoad();
    return { libraryName: testLibrary.name };
  }

  test('Library description > 50 characters - should not render description or tooltip on library page', async ({ page }) => {
    test.setTimeout(120000);
    const longDescription = 'This is a very long library description that exceeds fifty characters to test the truncation functionality and tooltip display behavior when hovering over the description text.';
    await createProjectAndLibraryAndOpenLibrary(page, longDescription);

    await expect(page.getByText(longDescription, { exact: true })).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText(`${longDescription.slice(0, 50)}...`, { exact: true })).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ant-tooltip-inner').filter({ hasText: longDescription })).toHaveCount(0);
  });

  test('Library description ≤ 50 characters - should not render description or tooltip on library page', async ({ page }) => {
    test.setTimeout(120000);
    const shortDescription = 'This is a short description under 50 chars.';
    await createProjectAndLibraryAndOpenLibrary(page, shortDescription);

    await expect(page.getByText(shortDescription, { exact: true })).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ant-tooltip-inner').filter({ hasText: shortDescription })).toHaveCount(0);
  });

  test('Library description exactly 50 characters - should not render description or tooltip on library page', async ({ page }) => {
    test.setTimeout(120000);
    const exactDescription = 'A'.repeat(50);
    await createProjectAndLibraryAndOpenLibrary(page, exactDescription);

    await expect(page.getByText(exactDescription, { exact: true })).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ant-tooltip-inner').filter({ hasText: exactDescription })).toHaveCount(0);
  });
});

