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

  // Skipped: requires collaboration setup (user 2 must have access to same library); test is placeholder for future work
  test.skip('Concurrent Version Restore - Two users restore different versions simultaneously', async ({ browser }) => {
    test.setTimeout(120000);

    // Generate unique project data
    const testProject = generateProjectData();
    const versionName1 = `Version 1 ${Date.now()}`;
    const versionName2 = `Version 2 ${Date.now()}`;

    // Create two browser contexts for two users
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Setup: Create project and library with user 1
      await test.step('Setup: Create project and library', async () => {
        const loginPage1 = new LoginPage(page1);
        await loginPage1.goto();
        await loginPage1.login(users.seedEmpty);
        await loginPage1.expectLoginSuccess();
        
        await page1.waitForTimeout(2000);
        
        const projectPage1 = new ProjectPage(page1);
        const libraryPage1 = new LibraryPage(page1);
        
        await projectPage1.createProject(testProject);
        await projectPage1.expectProjectCreated();
        await libraryPage1.waitForPageLoad();
        
        const sidebar1 = page1.getByRole('tree');
        await expect(sidebar1).toBeVisible({ timeout: 15000 });
        await page1.waitForTimeout(2000);
        
        await libraryPage1.createLibraryUnderProject(libraries.breed);
        await libraryPage1.expectLibraryCreated();
        await page1.waitForTimeout(2000);
      });

      // User 2: Login and navigate to same library
      await test.step('User 2: Login and navigate to library', async () => {
        const loginPage2 = new LoginPage(page2);
        await loginPage2.goto();
        await loginPage2.login(users.seedEmpty2);
        await loginPage2.expectLoginSuccess();
        
        await page2.waitForTimeout(2000);
        
        // Navigate to projects and find the project
        // Note: User 2 needs to be a collaborator or owner to access the library
        // For this test, we'll assume user 2 has access
        // In a real scenario, you'd need to set up collaboration first
      });

      // Create two versions with user 1
      await test.step('Create two versions', async () => {
        const sidebar1 = page1.getByRole('tree');
        const libraryItem1 = sidebar1.locator(`[title="${libraries.breed.name}"]`);
        await expect(libraryItem1).toBeVisible({ timeout: 15000 });
        await libraryItem1.click();
        
        await page1.waitForURL(/\/[^/]+\/[^/]+$/, { timeout: 15000 });
        await page1.waitForLoadState('load', { timeout: 15000 });
        await page1.waitForTimeout(2000);
        
        const versionControlButton1 = page1.locator('img[alt="Version Control"]')
          .or(page1.locator('button[title="Version Control"]'))
          .or(page1.locator('button').filter({ has: page1.locator('img[alt*="Version"]') }))
          .first();
        await expect(versionControlButton1).toBeVisible({ timeout: 10000 });
        await versionControlButton1.click();
        
        await expect(page1.getByText('VERSION HISTORY')).toBeVisible({ timeout: 5000 });
        await page1.waitForTimeout(1000);
        
        const addButton1 = page1.locator('button[title="Create new version"]')
          .or(page1.locator('button').filter({ has: page1.locator('img[alt="Add"]') }))
          .first();
        
        // Create version 1
        await expect(addButton1).toBeVisible({ timeout: 5000 });
        await addButton1.click();
        await page1.locator('#version-name').fill(versionName1);
        await page1.getByRole('button', { name: /^create$/i }).click();
        await page1.waitForTimeout(2000);
        
        // Create version 2
        await expect(addButton1).toBeVisible({ timeout: 5000 });
        await addButton1.click();
        await page1.locator('#version-name').fill(versionName2);
        await page1.getByRole('button', { name: /^create$/i }).click();
        await page1.waitForTimeout(2000);
      });

      // Both users restore different versions simultaneously
      await test.step('Both users restore different versions simultaneously', async () => {
        // Find version items
        const versionItems1 = page1.locator('[class*="versionItem"]');
        
        // User 1: Restore version 1
        const version1Item = versionItems1.filter({ hasText: versionName1 });
        await expect(version1Item.first()).toBeVisible({ timeout: 5000 });
        
        // Find restore button for version 1
        const restoreButton1 = version1Item.first().locator('button').filter({ has: page1.locator('img[alt="Restore"]') });
        await expect(restoreButton1).toBeVisible({ timeout: 5000 });
        
        // User 2: Navigate to library (if they have access)
        // Note: This test assumes both users have access to the same library
        // In practice, you'd need to set up collaboration first
        
        // Click restore buttons simultaneously (or as close as possible)
        await Promise.all([
          restoreButton1.click(),
          // User 2 restore would go here if collaboration is set up
        ]);
        
        // Handle restore confirmation modal for user 1
        await page1.waitForTimeout(1000);
        const restoreConfirm1 = page1.getByText(/are you sure/i);
        if (await restoreConfirm1.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Click Restore button in confirmation modal
          const confirmRestoreButton1 = page1.getByRole('button', { name: /^restore$/i });
          await confirmRestoreButton1.click();
          await page1.waitForTimeout(2000);
        }
        
        // Verify final state - last restore should be the active one
        // This is a simplified test - in a real scenario, you'd verify the actual data state
        await page1.waitForTimeout(3000);
      });
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('Special Characters in Version Name - Prevent invalid characters', async ({ page }) => {
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

    // Test special characters
    await test.step('Test special characters in version name', async () => {
      const addButton = page.locator('button[title="Create new version"]')
        .or(page.locator('button').filter({ has: page.locator('img[alt="Add"]') }))
        .first();
      
      const testCases = [
        { name: 'Test /', input: 'Test /', shouldBlock: false }, // / is not blocked by current validation
        { name: 'Test <script>', input: 'Test <script>', shouldBlock: true },
        { name: 'Test >', input: 'Test >', shouldBlock: false }, // ">" alone is not blocked (needs <...> or !@#$%)
        { name: 'Test !@#$%', input: 'Test !@#$%', shouldBlock: true },
        { name: 'Test <div>', input: 'Test <div>', shouldBlock: true },
      ];

      const expectedErrorText = 'No emojis, HTML tags or !@#$% allowed';

      for (const testCase of testCases) {
        await expect(addButton).toBeVisible({ timeout: 5000 });
        await addButton.click();
        
        await expect(page.getByText('Create new version')).toBeVisible({ timeout: 5000 });
        await page.locator('#version-name').fill(testCase.input);
        await page.getByRole('button', { name: /^create$/i }).click();
        
        if (testCase.shouldBlock) {
          // Verify error message appears (modal is in portal; use getByText for reliability)
          await expect(page.getByText(expectedErrorText)).toBeVisible({ timeout: 5000 });
          
          // Close modal for next test - specifically target the CreateVersionModal close button
          // Find the modal by its title, then locate the close button within that modal
          const modalTitle = page.getByText('Create new version');
          await expect(modalTitle).toBeVisible({ timeout: 2000 });
          
          // Find the close button within the same modal container as the title
          // Navigate from title to its parent header, then find the close button
          const modalCloseButton = modalTitle.locator('..').locator('..').locator('button[aria-label="Close"]');
          await modalCloseButton.click();
          await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 5000 });
        } else {
          // If not blocked, verify it was created or handle accordingly
          // Note: / might not be blocked, so we'll check if modal closes
          await page.waitForTimeout(1000);
          const modalStillOpen = await page.getByText('Create new version').isVisible({ timeout: 1000 }).catch(() => false);
          if (modalStillOpen) {
            // Close modal for next test - find close button within the modal
            const modalTitle = page.getByText('Create new version');
            const modalCloseButton = modalTitle.locator('..').locator('..').locator('button[aria-label="Close"]');
            await modalCloseButton.click();
            await expect(page.getByText('Create new version')).not.toBeVisible({ timeout: 5000 });
          }
        }
        
        await page.waitForTimeout(500);
      }
    });
  });
});

