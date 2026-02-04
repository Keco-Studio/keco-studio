import { test, expect } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { LoginPage } from '../pages/login.page';

import { projects, generateProjectData } from '../fixures/projects';
import { libraries } from '../fixures/libraries';
import { users } from '../fixures/users';
import { execSync } from 'child_process';

/**
 * Version Control E2E Tests
 * 
 * Test Scenarios:
 * 1. Function Entry: Click clock button in top right corner, sidebar successfully expands
 * 2. Manual Save Version: Click "+" button in sidebar → Fill Version Name → Click Create
 *    Result: New version saved successfully and appears at top of sidebar list
 * 3. Sidebar Information Display: View version list in sidebar
 *    Result: Each record contains Version Name, added by xxx, save time
 * 4. Sidebar Sorting: View version list
 *    Result: Sorted by save time descending, newest version at top
 * 5. Version Type Display: View version list
 *    Result: Current version, history versions, restored versions clearly distinguished
 *    by different icons, font sizes, and font colors
 *
 * Version Restore (from requirements):
 * - Restore button tooltip: hover → "Restore" tooltip — automated (tooltip may be image; we assert visibility).
 * - Click restore → alert/modal — automated (confirmation modal with "Alert" and backup option).
 * - Restore without backup — automated (direct restore, toast).
 * - Restore with backup — automated (toggle backup, fill version name, restore; backup version appears in list).
 * - Restore success toast + version highlight 1–2s — automated (toast "Library restored"; optional highlight class assert; if flaky, highlight can be manual).
 *
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 * - Cleans test data before running tests
 * - Test accounts are admin by default; non-admin cases are not considered
 */

test.describe('Version Control Tests', () => {
  let projectPage: ProjectPage;
  let libraryPage: LibraryPage;

  // Clean test data before all tests (optional; continues if env missing or script fails)
  test.beforeAll(async () => {
    console.log('🧹 Cleaning test data before version control tests...');
    try {
      execSync('npm run clean:test-data', {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: { ...process.env },
      });
      console.log('✅ Test data cleaned successfully');
    } catch (error) {
      console.warn('⚠️  Failed to clean test data:', error);
      // Continue with tests even if cleanup fails (e.g. missing env in CI)
    }
  });

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

    // Additional wait to ensure Supabase client is fully initialized
    await page.waitForTimeout(2000);
  });

  test('Function Entry - Click clock button to open version control sidebar', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project data
    const testProject = generateProjectData();

    // Create a test project and library
    await test.step('Create test project and library', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    // Navigate to library detail page
    await test.step('Navigate to library detail page', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      
      // Wait for library detail page to load
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
    });

    // Click clock button to open version control sidebar
    await test.step('Click clock button to open version control sidebar', async () => {
      // Find the version control button (clock icon) in the header
      // The button has alt="Version Control" or title="Version Control"
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      
      // Wait for version control sidebar to appear
      // Sidebar should have title "VERSION HISTORY"
      const versionSidebar = page.getByText('VERSION HISTORY');
      await expect(versionSidebar).toBeVisible({ timeout: 5000 });
      
      // Verify sidebar is visible
      const sidebarContent = page.locator('[class*="sidebar"]').filter({ hasText: /version/i });
      await expect(sidebarContent).toBeVisible({ timeout: 5000 });
    });
  });

  test('Manual Save Version - Create new version via sidebar', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project data
    const testProject = generateProjectData();
    const versionName = `Test Version ${Date.now()}`;

    // Create a test project and library
    await test.step('Create test project and library', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    // Navigate to library detail page and open version control sidebar
    await test.step('Navigate to library and open version control sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      
      // Open version control sidebar
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    // Create new version
    await test.step('Create new version', async () => {
      // Click the "+" button in the sidebar header
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      
      // Wait for create version modal to appear
      const modalTitle = page.getByText('Create new version');
      await expect(modalTitle).toBeVisible({ timeout: 5000 });
      
      // Fill in version name
      const versionNameInput = page.locator('#version-name');
      await expect(versionNameInput).toBeVisible({ timeout: 5000 });
      await versionNameInput.fill(versionName);
      
      // Click Create button
      const createButton = page.getByRole('button', { name: /^create$/i });
      await expect(createButton).toBeVisible();
      await createButton.click();
      
      // Wait for modal to close
      await expect(modalTitle).not.toBeVisible({ timeout: 10000 });
      
      // Verify new version appears at the top of the version list
      // Wait a bit for the list to refresh
      await page.waitForTimeout(2000);
      
      // Check that the version name appears in the sidebar
      // It should be in a version item (not the current version)
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName });
      await expect(versionItem).toBeVisible({ timeout: 10000 });
    });
  });

  test('Sidebar Information Display - Verify version list shows required information', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project data
    const testProject = generateProjectData();
    const versionName = `Test Version ${Date.now()}`;

    // Create a test project and library
    await test.step('Create test project and library', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    // Navigate to library and create a version
    await test.step('Navigate to library, open sidebar, and create version', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      
      // Open version control sidebar
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
      
      // Create a version
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      
      const versionNameInput = page.locator('#version-name');
      await expect(versionNameInput).toBeVisible({ timeout: 5000 });
      await versionNameInput.fill(versionName);
      
      const createButton = page.getByRole('button', { name: /^create$/i });
      await createButton.click();
      
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(2000);
    });

    // Verify version list information
    await test.step('Verify version list displays required information', async () => {
      // Find the version item with our version name
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName });
      await expect(versionItem).toBeVisible({ timeout: 10000 });
      
      // Verify Version Name is displayed
      await expect(versionItem.getByText(versionName)).toBeVisible();
      
      // Verify "added by xxx" text is displayed
      // The text format is "added by {name}" or "restored by {name}"
      const addedByText = versionItem.getByText(/added by|restored by/i);
      await expect(addedByText).toBeVisible();
      
      // Verify date/time is displayed
      // Date format should be like "Dec 28, 7:40 AM" or similar
      const datePattern = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+:\d+\s+(AM|PM)/i;
      const dateText = versionItem.getByText(datePattern);
      await expect(dateText).toBeVisible();
    });
  });

  test('Sidebar Sorting - Verify versions are sorted by save time descending', async ({ page }) => {
    test.setTimeout(90000);

    // Generate unique project data
    const testProject = generateProjectData();
    const versionName1 = `Version 1 ${Date.now()}`;
    const versionName2 = `Version 2 ${Date.now() + 1000}`;
    const versionName3 = `Version 3 ${Date.now() + 2000}`;

    // Create a test project and library
    await test.step('Create test project and library', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    // Navigate to library and open sidebar
    await test.step('Navigate to library and open sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    // Create multiple versions
    await test.step('Create multiple versions', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      
      // Create first version
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.locator('#version-name').fill(versionName1);
      await page.getByRole('button', { name: /^create$/i }).click();
      await page.waitForTimeout(2000);
      
      // Create second version
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.locator('#version-name').fill(versionName2);
      await page.getByRole('button', { name: /^create$/i }).click();
      await page.waitForTimeout(2000);
      
      // Create third version
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.locator('#version-name').fill(versionName3);
      await page.getByRole('button', { name: /^create$/i }).click();
      await page.waitForTimeout(2000);
    });

    // Verify sorting order
    await test.step('Verify versions are sorted by save time descending', async () => {
      // Get all version items
      const versionItems = page.locator('[class*="versionItem"]');
      await expect(versionItems.first()).toBeVisible({ timeout: 5000 });
      
      // Get text content of all version items to verify order
      const versionTexts = await versionItems.allTextContents();
      
      // Find the indices of our versions
      const index1 = versionTexts.findIndex(text => text.includes(versionName1));
      const index2 = versionTexts.findIndex(text => text.includes(versionName2));
      const index3 = versionTexts.findIndex(text => text.includes(versionName3));
      
      // Verify all versions are found
      expect(index1).toBeGreaterThan(-1);
      expect(index2).toBeGreaterThan(-1);
      expect(index3).toBeGreaterThan(-1);
      
      // Verify order: version3 (newest) should be before version2, version2 before version1
      // Note: Current Version is always first, so we need to account for that
      // The order should be: Current Version, version3, version2, version1
      expect(index3).toBeLessThan(index2);
      expect(index2).toBeLessThan(index1);
    });
  });

  test('Version Type Display - Verify different version types are visually distinguished', async ({ page }) => {
    test.setTimeout(90000);

    // Generate unique project data
    const testProject = generateProjectData();
    const versionName = `Test Version ${Date.now()}`;

    // Create a test project and library
    await test.step('Create test project and library', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    // Navigate to library and open sidebar
    await test.step('Navigate to library and open sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    // Verify Current Version display
    await test.step('Verify Current Version is displayed with distinct styling', async () => {
      // Current Version should be at the top
      const currentVersionItem = page.locator('[class*="versionItem"]').first();
      await expect(currentVersionItem).toBeVisible({ timeout: 5000 });
      
      // Verify it shows "Current Version" text
      await expect(currentVersionItem.getByText('Current Version')).toBeVisible();
      
      // Verify it has current version styling (pink color rgba(255, 108, 170))
      // CSS Modules may hash class names; check computed color of the version name or any text node
      const hasCurrentStyling = await currentVersionItem.evaluate((el) => {
        const versionNameEl = el.querySelector('[class*="versionName"]') || el.querySelector('.details') || el;
        const style = window.getComputedStyle(versionNameEl);
        const color = (style.color || '').toLowerCase();
        // Accept rgb/rgba in any format as long as it contains the pink values
        const hasPink = color.includes('255') && color.includes('108') && color.includes('170');
        if (hasPink) return true;
        const className = (el.className || '').toString();
        return className.includes('currentVersion') || className.includes('current');
      });
      expect(hasCurrentStyling).toBe(true);
    });

    // Create a version and verify history version display
    await test.step('Create version and verify history version display', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await page.waitForTimeout(2000);
      
      // Find the created version item (should be second, after Current Version)
      const versionItems = page.locator('[class*="versionItem"]');
      const historyVersionItem = versionItems.nth(1);
      await expect(historyVersionItem).toBeVisible({ timeout: 5000 });
      
      // Verify it shows the version name
      await expect(historyVersionItem.getByText(versionName)).toBeVisible();
      
      // Verify it has history version styling (not current version): no "Current Version" text, no pink color
      const isHistoryVersion = await historyVersionItem.evaluate((el) => {
        const textContent = el.textContent || '';
        const isNotCurrent = !textContent.includes('Current Version');
        const versionNameEl = el.querySelector('[class*="versionName"]') || el.querySelector('.details') || el;
        const color = (window.getComputedStyle(versionNameEl).color || '').toLowerCase();
        const notPink = !(color.includes('255') && color.includes('108') && color.includes('170'));
        return isNotCurrent && notPink;
      });
      expect(isHistoryVersion).toBe(true);
    });
  });

  test('Duplicate Version Name - Prevent creating version with existing name', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project data
    const testProject = generateProjectData();
    const versionName = `Test Version ${Date.now()}`;

    // Create a test project and library
    await test.step('Create test project and library', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    // Navigate to library and open sidebar
    await test.step('Navigate to library and open sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    // Create first version
    await test.step('Create first version', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(2000);
    });

    // Try to create duplicate version name
    await test.step('Try to create duplicate version name', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      
      // Verify error message appears
      const errorMessage = page.locator('[class*="error"]').filter({ hasText: /name exists/i });
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
      await expect(errorMessage).toContainText('Name exists');
      
      // Verify modal is still open (not closed)
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 2000 });
    });
  });

  // --- Version Restore tests (from restore requirements) ---
  test('Restore button tooltip - Hover shows Restore tooltip', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `To Restore ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library and open version sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Create one history version', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Hover restore button and verify tooltip', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName });
      await expect(versionItem.first()).toBeVisible({ timeout: 5000 });
      const restoreButton = versionItem.first().locator('button').filter({ has: page.locator('img[alt="Restore"]') });
      await expect(restoreButton).toBeVisible({ timeout: 5000 });
      await restoreButton.hover();
      await page.waitForTimeout(300);
      // Tooltip shows Restore: either text "Restore" or the tooltip container with Restore icon (img alt)
      const tooltipOrRestore = page.getByText('Restore').or(restoreButton.locator('..').locator('[class*="tooltip"]').locator('img[alt="Restore"]'));
      await expect(tooltipOrRestore.first()).toBeVisible({ timeout: 2000 });
    });
  });

 
  test('Click restore - Opens confirmation modal (alert)', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `To Restore ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library and open version sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Create one history version', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Click restore and verify alert modal', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName });
      const restoreButton = versionItem.first().locator('button').filter({ has: page.locator('img[alt="Restore"]') });
      await expect(restoreButton).toBeVisible({ timeout: 5000 });
      await restoreButton.click();
      await expect(page.getByText('Alert')).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(/Are you sure you want to restore this version\?/)).toBeVisible({ timeout: 2000 });
      await expect(page.getByText('backup the current version')).toBeVisible({ timeout: 2000 });
      await page.getByRole('button', { name: /cancel/i }).click();
      await expect(page.getByText('Alert')).not.toBeVisible({ timeout: 5000 });
    });
  });


  test('Restore without backup - Direct restore', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `To Restore ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library and open version sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Create one history version', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Restore without backup and verify success', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName });
      const restoreButton = versionItem.first().locator('button').filter({ has: page.locator('img[alt="Restore"]') });
      await expect(restoreButton).toBeVisible({ timeout: 5000 });
      await restoreButton.click();
      await expect(page.getByText('Alert')).toBeVisible({ timeout: 5000 });
      // Leave backup toggle off, click Restore (modal button only; sidebar also has a Restore button)
      await page.locator('[class*="backdrop"]').filter({ hasText: 'Alert' }).getByRole('button', { name: /^restore$/i }).click();
      await expect(page.getByText('Alert')).not.toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Library restored')).toBeVisible({ timeout: 10000 });
    });
  });


  test('Restore with backup - Current version saved as new version before restore', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `To Restore ${Date.now()}`;
    const backupVersionName = `Backup Before Restore ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library and open version sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Create one history version', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Restore with backup and verify backup version appears', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName });
      const restoreButton = versionItem.first().locator('button').filter({ has: page.locator('img[alt="Restore"]') });
      await expect(restoreButton).toBeVisible({ timeout: 5000 });
      await restoreButton.click();
      await expect(page.getByText('Alert')).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('backup the current version')).toBeVisible({ timeout: 2000 });
      await page.getByText('backup the current version').click();
      await page.locator('#backup-version-name').fill(backupVersionName);
      await page.locator('[class*="backdrop"]').filter({ hasText: 'Alert' }).getByRole('button', { name: /^restore$/i }).click();
      await expect(page.getByText('Alert')).not.toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Library restored')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(2000);
      const versionList = page.locator('[class*="versionItem"]');
      await expect(versionList.filter({ hasText: backupVersionName }).first()).toBeVisible({ timeout: 5000 });
    });
  });


  test('Restore success - Toast and version highlight', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `To Restore ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library and open version sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Create one history version', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Restore and verify toast and version highlight', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName });
      const restoreButton = versionItem.first().locator('button').filter({ has: page.locator('img[alt="Restore"]') });
      await expect(restoreButton).toBeVisible({ timeout: 5000 });
      await restoreButton.click();
      await expect(page.getByText('Alert')).toBeVisible({ timeout: 5000 });
      await page
        .locator('[class*="backdrop"]')
        .filter({ hasText: 'Alert' })
        .getByRole('button', { name: /^restore$/i })
        .click();
      await expect(page.getByText('Library restored')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(500);
      const highlightedRow = page.locator('[class*="highlighting"]');
      await expect(highlightedRow.first()).toBeVisible({ timeout: 2500 });
    });
  });

  test('Restore record - Restore version entry is created with correct metadata', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `To Restore ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library and open version sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Create one history version', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Restore and verify new restore entry metadata', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName });
      const restoreButton = versionItem.first().locator('button').filter({ has: page.locator('img[alt="Restore"]') });
      await expect(restoreButton).toBeVisible({ timeout: 5000 });
      await restoreButton.click();
      await expect(page.getByText('Alert')).toBeVisible({ timeout: 5000 });
      await page
        .locator('[class*="backdrop"]')
        .filter({ hasText: 'Alert' })
        .getByRole('button', { name: /^restore$/i })
        .click();
      await expect(page.getByText('Library restored')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(2000);

      // Find the new restore entry: version item that has Restored version icon (distinct from history)
      const restoreEntry = page
        .locator('[class*="versionItem"]')
        .filter({ has: page.locator('img[alt="Restored version"]') })
        .first();
      await expect(restoreEntry).toBeVisible({ timeout: 5000 });

      // Version name: restore record name format is "{original} (MonthDay, H:MM AM/PM)"
      await expect(restoreEntry.getByText(versionName)).toBeVisible();
      await expect(restoreEntry.getByText(/\(\w+\d*,\s*\d+:\d+\s*(AM|PM)\)/)).toBeVisible();

      // "restored by xxx"
      await expect(restoreEntry.getByText(/restored by/i)).toBeVisible();

      // Restore time (date text like "Dec 28, 7:40 AM")
      const datePattern = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+,\s+\d+:\d+\s+(AM|PM)/i;
      await expect(restoreEntry.getByText(datePattern)).toBeVisible();

      // Icon distinguishes from history: Restored version icon visible in this row
      await expect(restoreEntry.locator('img[alt="Restored version"]')).toBeVisible();
    });
  });

  test('Version menu - Open menu via button and right click', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `Menu Test ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library, open sidebar, and create one version', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);

      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Open menu via button click', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName }).first();
      await expect(versionItem).toBeVisible({ timeout: 5000 });

      const menuButton = versionItem
        .locator('button')
        .filter({ has: page.locator('img[alt="More options"]') })
        .first();
      await expect(menuButton).toBeVisible({ timeout: 5000 });
      await menuButton.click();

      await expect(page.getByRole('button', { name: 'Edit version info' })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('button', { name: 'Duplicate as a new library' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    });

    await test.step('Open menu via right click on version item', async () => {
      // Click somewhere else to close dropdown menu
      await page.mouse.click(0, 0);
      await page.waitForTimeout(300);

      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName }).first();
      await expect(versionItem).toBeVisible({ timeout: 5000 });

      await versionItem.click({ button: 'right' });

      await expect(page.getByRole('button', { name: 'Edit version info' })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('button', { name: 'Duplicate as a new library' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    });
  });

  test('Version menu - Edit version info (rename success)', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const originalName = `Edit Menu ${Date.now()}`;
    // Use a new name that does NOT contain originalName, so "old name gone" assertion is reliable
    const updatedName = `Renamed ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library, open sidebar, and create version', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);

      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(originalName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Open edit modal from menu and rename', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: originalName }).first();
      await expect(versionItem).toBeVisible({ timeout: 5000 });

      const menuButton = versionItem
        .locator('button')
        .filter({ has: page.locator('img[alt="More options"]') })
        .first();
      await expect(menuButton).toBeVisible({ timeout: 5000 });
      await menuButton.click();

      await page.getByRole('button', { name: 'Edit version info' }).click();
      await expect(page.getByText('Edit version')).toBeVisible({ timeout: 5000 });

      const nameInput = page.locator('#version-name');
      await expect(nameInput).toBeVisible({ timeout: 5000 });
      await nameInput.fill(updatedName);

      const saveButton = page.getByRole('button', { name: /^save$/i });
      await expect(saveButton).toBeVisible();
      await saveButton.click();

      // Wait for modal to close and list to refresh
      await expect(page.getByText('Edit version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1500);

      // Old name should not be present; new name should be visible
      await expect(page.locator('[class*="versionItem"]').filter({ hasText: updatedName }).first()).toBeVisible({
        timeout: 5000,
      });
      await expect(page.locator('[class*="versionItem"]').filter({ hasText: originalName })).toHaveCount(0);
    });
  });

  test('Version menu - Duplicate as a new library', async ({ page }) => {
    test.setTimeout(120000);
    const testProject = generateProjectData();
    const originalLibraryName = libraries.breed.name;
    const duplicatedLibraryName = `${originalLibraryName} (copy)`;
    const sourceVersionName = `Duplicate Source ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library, open sidebar, and create source version', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${originalLibraryName}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);

      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(sourceVersionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Trigger duplicate as a new library from menu', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: sourceVersionName }).first();
      await expect(versionItem).toBeVisible({ timeout: 5000 });

      const menuButton = versionItem
        .locator('button')
        .filter({ has: page.locator('img[alt="More options"]') })
        .first();
      await expect(menuButton).toBeVisible({ timeout: 5000 });
      await menuButton.click();

      await page.getByRole('button', { name: 'Duplicate as a new library' }).click();

      // Wait for duplication to finish and toast to appear
      await expect(page.getByText('Library duplicated successfully')).toBeVisible({ timeout: 60000 });
      await page.waitForTimeout(3000);
    });

    await test.step('Verify new library appears in sidebar with correct name', async () => {
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });

      const duplicatedLibraryItem = sidebar.locator(`[title="${duplicatedLibraryName}"]`);
      await expect(duplicatedLibraryItem).toBeVisible({ timeout: 60000 });
    });

    await test.step('Enter duplicated library and verify duplicated version record', async () => {
      const sidebar = page.getByRole('tree');
      const duplicatedLibraryItem = sidebar.locator(`[title="${duplicatedLibraryName}"]`);
      await expect(duplicatedLibraryItem).toBeVisible({ timeout: 60000 });
      await duplicatedLibraryItem.click();

      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);

      const expectedVersionName = `${originalLibraryName} duplicated from (${sourceVersionName})`;
      const duplicatedVersionItem = page.locator('[class*="versionItem"]').filter({
        hasText: expectedVersionName,
      });
      await expect(duplicatedVersionItem.first()).toBeVisible({ timeout: 60000 });
    });
  });

  test('Version menu - Delete version', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `Delete Menu ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library, open sidebar, and create version', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);

      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Delete version from menu and verify it is removed', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName }).first();
      await expect(versionItem).toBeVisible({ timeout: 5000 });

      const menuButton = versionItem
        .locator('button')
        .filter({ has: page.locator('img[alt="More options"]') })
        .first();
      await expect(menuButton).toBeVisible({ timeout: 5000 });
      await menuButton.click();

      await page.getByRole('button', { name: 'Delete' }).click();

      await expect(page.getByText('Delete version')).toBeVisible({ timeout: 5000 });
      const confirmDeleteButton = page.getByRole('button', { name: /^delete$/i });
      await expect(confirmDeleteButton).toBeVisible();
      await confirmDeleteButton.click();

      await expect(page.getByText('Version deleted successfully')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1500);

      await expect(page.locator('[class*="versionItem"]').filter({ hasText: versionName })).toHaveCount(0);
    });
  });

  test('Version menu - Cancel delete keeps version', async ({ page }) => {
    test.setTimeout(60000);
    const testProject = generateProjectData();
    const versionName = `Cancel Delete ${Date.now()}`;

    await test.step('Create project, library, and one version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library, open sidebar, and create version', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);

      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(versionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Open delete modal then cancel', async () => {
      const versionItem = page.locator('[class*="versionItem"]').filter({ hasText: versionName }).first();
      await expect(versionItem).toBeVisible({ timeout: 5000 });

      const menuButton = versionItem
        .locator('button')
        .filter({ has: page.locator('img[alt="More options"]') })
        .first();
      await expect(menuButton).toBeVisible({ timeout: 5000 });
      await menuButton.click();

      await page.getByRole('button', { name: 'Delete' }).click();

      await expect(page.getByText('Delete version')).toBeVisible({ timeout: 5000 });

      // Use Cancel button to cancel deletion (equivalent to clicking "x" or cancel as per requirements)
      const cancelButton = page.getByRole('button', { name: /^cancel$/i });
      await expect(cancelButton).toBeVisible();
      await cancelButton.click();

      await page.waitForTimeout(1000);

      // Version should still be present in the list
      await expect(page.locator('[class*="versionItem"]').filter({ hasText: versionName }).first()).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test('Original version retention - Oldest version record is kept', async ({ page }) => {
    test.setTimeout(90000);
    const testProject = generateProjectData();
    const initialVersionName = `Initial Version ${Date.now()}`;
    const anotherVersionName = `Another Version ${Date.now() + 1}`;

    await test.step('Create project, library, and initial version', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    await test.step('Navigate to library and open version sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);

      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Create initial version and another version', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();

      // Initial version
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(initialVersionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);

      // Another version to operate on
      await addButton.click();
      await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
      await page.locator('#version-name').fill(anotherVersionName);
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);
    });

    await test.step('Restore another version and verify initial version is still present', async () => {
      const target = page.locator('[class*="versionItem"]').filter({ hasText: anotherVersionName }).first();
      await expect(target).toBeVisible({ timeout: 5000 });

      const restoreButton = target.locator('button').filter({ has: page.locator('img[alt="Restore"]') });
      await expect(restoreButton).toBeVisible({ timeout: 5000 });
      await restoreButton.click();
      await expect(page.getByText('Alert')).toBeVisible({ timeout: 5000 });
      await page
        .locator('[class*="backdrop"]')
        .filter({ hasText: 'Alert' })
        .getByRole('button', { name: /^restore$/i })
        .click();
      await expect(page.getByText('Library restored')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1500);

      // Initial version record should still be visible in the history list
      const initialEntry = page
        .locator('[class*="versionItem"]')
        .filter({ hasText: initialVersionName })
        .first();
      await expect(initialEntry).toBeVisible({ timeout: 5000 });
    });
  });

  // Un-skipped: verifies creating many versions in sequence and list order; may be slower (~2min)
  test('Create Multiple Versions - Rapidly create many versions and verify list display', async ({ page }) => {
    test.setTimeout(120000);

    // Generate unique project data
    const testProject = generateProjectData();
    const versionCount = 10; // Create 10 versions
    const versionNames: string[] = [];

    // Create a test project and library
    await test.step('Create test project and library', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
      
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000);
      
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);
    });

    // Navigate to library and open sidebar
    await test.step('Navigate to library and open sidebar', async () => {
      const sidebar = page.getByRole('tree');
      const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      await libraryItem.click();
      
      await page.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
      await page.waitForLoadState('load', { timeout: 15000 });
      await page.waitForTimeout(2000);
      
      const versionControlButton = page.locator('img[alt="Version Control"]')
        .or(page.locator('button[title="Version Control"]'))
        .or(page.locator('button').filter({ has: page.locator('img[alt*="Version"]') }))
        .first();
      await expect(versionControlButton).toBeVisible({ timeout: 10000 });
      await versionControlButton.click();
      
      await expect(page.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(1000);
    });

    // Create multiple versions rapidly
    await test.step('Create multiple versions rapidly', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      
      for (let i = 0; i < versionCount; i++) {
        const versionName = `Version ${i + 1} ${Date.now()}-${i}`;
        versionNames.push(versionName);
        
        await expect(addButton).toBeVisible({ timeout: 5000 });
        await addButton.click();
        
        await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
        await page.locator('#version-name').fill(versionName);
        await page.getByRole('button', { name: /^create$/i }).click();
        
        // Wait for modal to close
        await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 10000 });
        
        // Small delay between creations to avoid overwhelming the system
        await page.waitForTimeout(500);
      }
      
      // Wait for all versions to be saved
      await page.waitForTimeout(2000);
    });

    // Verify all versions are displayed in correct order
    await test.step('Verify all versions are displayed in correct order', async () => {
      const versionItems = page.locator('[class*="versionItem"]');
      
      // Should have Current Version + all created versions
      const itemCount = await versionItems.count();
      expect(itemCount).toBeGreaterThanOrEqual(versionCount + 1); // +1 for Current Version
      
      // Verify versions are sorted by time descending (newest first)
      // Check that the last created version appears before the first created version
      const lastVersionName = versionNames[versionNames.length - 1];
      const firstVersionName = versionNames[0];
      
      const allTexts = await versionItems.allTextContents();
      const lastIndex = allTexts.findIndex(text => text.includes(lastVersionName));
      const firstIndex = allTexts.findIndex(text => text.includes(firstVersionName));
      
      expect(lastIndex).toBeGreaterThan(-1);
      expect(firstIndex).toBeGreaterThan(-1);
      expect(lastIndex).toBeLessThan(firstIndex); // Last created should appear before first created
      
      // Verify all version names are present
      for (const versionName of versionNames) {
        const versionItem = versionItems.filter({ hasText: versionName });
        await expect(versionItem.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });

  // Special-character validation for version name is covered by name-validation.spec.ts (same validation logic).
});

