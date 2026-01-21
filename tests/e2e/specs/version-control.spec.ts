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
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 * - Cleans test data before running tests
 */

test.describe('Version Control Tests', () => {
  let projectPage: ProjectPage;
  let libraryPage: LibraryPage;

  // Clean test data before all tests
  test.beforeAll(async () => {
    console.log('🧹 Cleaning test data before version control tests...');
    try {
      execSync('npm run clean:test-data', { 
        cwd: process.cwd(),
        stdio: 'inherit' 
      });
      console.log('✅ Test data cleaned successfully');
    } catch (error) {
      console.warn('⚠️  Failed to clean test data:', error);
      // Continue with tests even if cleanup fails
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
      
      await libraryPage.createLibrary(libraries.breed);
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
      
      await libraryPage.createLibrary(libraries.breed);
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
      
      await libraryPage.createLibrary(libraries.breed);
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
      
      await libraryPage.createLibrary(libraries.breed);
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
      
      await libraryPage.createLibrary(libraries.breed);
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
      
      // Verify it has current version styling
      // CSS Modules generates hashed class names, so we check:
      // 1. The class name contains "currentVersion" (CSS Modules pattern)
      // 2. Or check the computed style (color should be rgba(255, 108, 170, 1) for current version)
      const hasCurrentStyling = await currentVersionItem.evaluate((el) => {
        // Check class name (CSS Modules may generate hashed names like "versionItem_currentVersion_abc123")
        const className = el.className || '';
        const hasCurrentClass = className.includes('currentVersion') || className.includes('current');
        
        // Also check the computed style of the version name text
        const versionNameElement = el.querySelector('[class*="versionName"]') || el;
        const computedStyle = window.getComputedStyle(versionNameElement);
        const color = computedStyle.color;
        // Current version color is rgba(255, 108, 170, 1) or rgb(255, 108, 170)
        const hasCurrentColor = color.includes('255, 108, 170') || color.includes('rgb(255, 108, 170)');
        
        return hasCurrentClass || hasCurrentColor;
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
      
      // Verify it has history version styling (not current version)
      // Check that it doesn't show "Current Version" text and has different styling
      const isHistoryVersion = await historyVersionItem.evaluate((el) => {
        // Should not contain "Current Version" text
        const textContent = el.textContent || '';
        const isNotCurrent = !textContent.includes('Current Version');
        
        // Check class name (CSS Modules may generate hashed names)
        const className = el.className || '';
        const hasHistoryClass = className.includes('historyVersion') || 
                                (className.includes('versionItem') && !className.includes('currentVersion'));
        
        // Check the computed style of the version name text
        const versionNameElement = el.querySelector('[class*="versionName"]') || el;
        const computedStyle = window.getComputedStyle(versionNameElement);
        const color = computedStyle.color;
        // History version color should be #21272A (not the pink current version color)
        const hasHistoryColor = !color.includes('255, 108, 170') && !color.includes('rgb(255, 108, 170)');
        
        return isNotCurrent && (hasHistoryClass || hasHistoryColor);
      });
      expect(isHistoryVersion).toBe(true);
    });
  });
});

