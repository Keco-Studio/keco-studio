import { test, expect } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { LoginPage } from '../pages/login.page';

import { generateProjectData } from '../fixures/projects';
import { generateLibraryData } from '../fixures/libraries';
import { users } from '../fixures/users';

/**
 * Library Description Tooltip E2E Tests
 * 
 * Test Scenarios:
 * 1. Library description > 50 characters:
 *    - Display truncated text (first 50 characters + '...')
 *    - Show full description in tooltip on hover
 * 2. Library description ≤ 50 characters:
 *    - Display full description
 *    - No tooltip on hover
 * 
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 */

test.describe('Library Description Tooltip Tests', () => {
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

    // Additional wait to ensure Supabase client is fully initialized
    await page.waitForTimeout(2000);
  });

  test('Library description > 50 characters - should display truncated text with tooltip on hover', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project and library data
    const testProject = generateProjectData();
    const longDescription = 'This is a very long library description that exceeds fifty characters to test the truncation functionality and tooltip display behavior when hovering over the description text.';
    const testLibrary = {
      name: `Test Library ${Date.now()}`,
      description: longDescription,
    };

    // Create project and library
    await test.step('Create project and library with long description', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();

      // Ensure sidebar is loaded
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });

      // Wait for the user role API call to complete before interacting with role-dependent UI.
      // The sidebar add button is only rendered when userRole === 'admin', which is fetched
      // asynchronously via /api/projects/{projectId}/role after the page loads.
      await page.waitForResponse(
        response => response.url().includes('/role') && response.status() === 200,
        { timeout: 15000 }
      ).catch(() => {});
      // Allow React to re-render with the fetched role
      await page.waitForTimeout(1000);

      // Create library via sidebar Add -> Create new library (works for admin/editor; folder-row button is admin-only)
      await libraryPage.createLibraryUnderProject(testLibrary);
      await libraryPage.expectLibraryCreated();
      
      // Wait for library to appear in sidebar and refresh
      await page.waitForTimeout(3000);
      
      // Verify library appears in sidebar
      const sidebarCheck = page.getByRole('tree');
      await expect(sidebarCheck).toBeVisible({ timeout: 15000 });
      const libraryItemCheck = sidebarCheck.locator(`[title="${testLibrary.name}"]`);
      await expect(libraryItemCheck).toBeVisible({ timeout: 15000 });
    });

    // Navigate to library page
    await test.step('Navigate to library page', async () => {
      // Open library from sidebar (not from main content area)
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      
      // Wait for library to appear in sidebar
      const libraryItem = sidebar.locator(`[title="${testLibrary.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      
      // Click on library in sidebar to navigate to library page
      await libraryItem.click();
      
      // Wait for navigation to library detail page
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      await libraryPage.waitForPageLoad();
      await page.waitForTimeout(2000);
    });

    // Verify truncated description is displayed
    await test.step('Verify truncated description is displayed', async () => {
      // Find the description element in LibraryHeader
      // The description is in the header section, below the library name (h1)
      const truncatedText = `${longDescription.slice(0, 50)}...`;
      
      // Find library name heading first
      const libraryNameHeading = page.getByRole('heading', { name: testLibrary.name });
      await expect(libraryNameHeading).toBeVisible({ timeout: 10000 });
      
      // Find description element - it's a div that follows the h1 heading in the header
      // Use locator with text matching that checks for exact text content
      // The description div should have text content exactly matching the truncated text
      const descriptionElement = page.locator('div').filter({ 
        hasText: new RegExp(`^${truncatedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) 
      }).first();
      
      // If that doesn't work, try finding it near the heading
      const descriptionNearHeading = libraryNameHeading
        .locator('..') // Go to parent (leftSection)
        .locator('div')
        .filter({ hasText: truncatedText })
        .first();
      
      // Try both selectors
      const isNearVisible = await descriptionNearHeading.isVisible({ timeout: 2000 }).catch(() => false);
      const finalElement = isNearVisible ? descriptionNearHeading : descriptionElement;
      
      await expect(finalElement).toBeVisible({ timeout: 10000 });
      
      // Verify it shows truncated text (first 50 characters + '...')
      // Get the inner text (not including child elements)
      const displayedText = await finalElement.innerText();
      expect(displayedText.trim()).toBe(truncatedText);
    });

    // Verify tooltip shows full description on hover
    await test.step('Verify tooltip shows full description on hover', async () => {
      // Find description element using the same method as above
      const truncatedTextForHover = `${longDescription.slice(0, 50)}...`;
      const libraryNameHeading = page.getByRole('heading', { name: testLibrary.name });
      
      const descriptionElement = page.locator('div').filter({ 
        hasText: new RegExp(`^${truncatedTextForHover.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) 
      }).first();
      
      const descriptionNearHeading = libraryNameHeading
        .locator('..')
        .locator('div')
        .filter({ hasText: truncatedTextForHover })
        .first();
      
      const isNearVisible = await descriptionNearHeading.isVisible({ timeout: 2000 }).catch(() => false);
      const finalElement = isNearVisible ? descriptionNearHeading : descriptionElement;
      
      await expect(finalElement).toBeVisible({ timeout: 10000 });
      
      // Hover over the description element
      await finalElement.hover();
      
      // Wait for tooltip to appear (Ant Design Tooltip appears in a portal)
      // Ant Design tooltips have class 'ant-tooltip' and are rendered in a portal
      // The tooltip inner content has class 'ant-tooltip-inner'
      const tooltip = page.locator('.ant-tooltip-inner').filter({ 
        hasText: longDescription 
      });
      
      await expect(tooltip).toBeVisible({ timeout: 5000 });
      
      // Verify tooltip contains the full description
      const tooltipText = await tooltip.textContent();
      expect(tooltipText?.trim()).toBe(longDescription);
    });
  });

  test('Library description ≤ 50 characters - should display full text without tooltip', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project and library data
    const testProject = generateProjectData();
    const shortDescription = 'This is a short description under 50 chars.';
    const testLibrary = {
      name: `Test Library ${Date.now()}`,
      description: shortDescription,
    };

    // Create project and library
    await test.step('Create project and library with short description', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();

      // Ensure sidebar is loaded
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });

      // Wait for the user role API call to complete before interacting with role-dependent UI.
      await page.waitForResponse(
        response => response.url().includes('/role') && response.status() === 200,
        { timeout: 15000 }
      ).catch(() => {});
      // Allow React to re-render with the fetched role
      await page.waitForTimeout(1000);

      // Create library via sidebar Add -> Create new library
      await libraryPage.createLibraryUnderProject(testLibrary);
      await libraryPage.expectLibraryCreated();
      
      // Wait for library to appear in sidebar and refresh
      await page.waitForTimeout(3000);
      
      // Verify library appears in sidebar
      const sidebarCheck = page.getByRole('tree');
      await expect(sidebarCheck).toBeVisible({ timeout: 15000 });
      const libraryItemCheck = sidebarCheck.locator(`[title="${testLibrary.name}"]`);
      await expect(libraryItemCheck).toBeVisible({ timeout: 15000 });
    });

    // Navigate to library page
    await test.step('Navigate to library page', async () => {
      // Open library from sidebar (not from main content area)
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      
      // Wait for library to appear in sidebar
      const libraryItem = sidebar.locator(`[title="${testLibrary.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      
      // Click on library in sidebar to navigate to library page
      await libraryItem.click();
      
      // Wait for navigation to library detail page
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      await libraryPage.waitForPageLoad();
      await page.waitForTimeout(2000);
    });

    // Verify full description is displayed
    await test.step('Verify full description is displayed', async () => {
      // Find the description element in LibraryHeader
      const libraryNameHeading = page.getByRole('heading', { name: testLibrary.name });
      await expect(libraryNameHeading).toBeVisible({ timeout: 10000 });
      
      // Find description element - should be near the library name heading
      const descriptionElement = libraryNameHeading
        .locator('..') // Go to parent (leftSection)
        .locator('div')
        .filter({ hasText: shortDescription })
        .first();
      
      await expect(descriptionElement).toBeVisible({ timeout: 10000 });
      
      // Verify it shows the full text (no truncation)
      // Use innerText to get only the text content of this element
      const displayedText = await descriptionElement.innerText();
      expect(displayedText.trim()).toBe(shortDescription);
      expect(displayedText).not.toContain('...');
    });

    // Verify no tooltip appears on hover
    await test.step('Verify no tooltip appears on hover', async () => {
      const libraryNameHeading = page.getByRole('heading', { name: testLibrary.name });
      const descriptionElement = libraryNameHeading
        .locator('..')
        .locator('div')
        .filter({ hasText: shortDescription })
        .first();
      
      await expect(descriptionElement).toBeVisible({ timeout: 10000 });
      
      // Hover over the description element
      await descriptionElement.hover();
      
      // Wait a bit to ensure tooltip doesn't appear
      await page.waitForTimeout(1000);
      
      // Verify no tooltip is visible
      // Ant Design Tooltip only renders when title prop is provided
      // For short descriptions (≤50 chars), title is undefined, so no tooltip should appear
      const tooltip = page.locator('.ant-tooltip');
      const tooltipCount = await tooltip.count();
      expect(tooltipCount).toBe(0);
    });
  });

  test('Library description exactly 50 characters - should display full text without tooltip', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project and library data
    const testProject = generateProjectData();
    // Create exactly 50 characters description
    const exactDescription = 'A'.repeat(50);
    const testLibrary = {
      name: `Test Library ${Date.now()}`,
      description: exactDescription,
    };

    // Create project and library
    await test.step('Create project and library with exactly 50 character description', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();

      // Ensure sidebar is loaded
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });

      // Wait for the user role API call to complete before interacting with role-dependent UI.
      await page.waitForResponse(
        response => response.url().includes('/role') && response.status() === 200,
        { timeout: 15000 }
      ).catch(() => {});
      // Allow React to re-render with the fetched role
      await page.waitForTimeout(1000);

      // Create library via sidebar Add -> Create new library
      await libraryPage.createLibraryUnderProject(testLibrary);
      await libraryPage.expectLibraryCreated();
      
      // Wait for library to appear in sidebar and refresh
      await page.waitForTimeout(3000);
      
      // Verify library appears in sidebar
      const sidebarCheck = page.getByRole('tree');
      await expect(sidebarCheck).toBeVisible({ timeout: 15000 });
      const libraryItemCheck = sidebarCheck.locator(`[title="${testLibrary.name}"]`);
      await expect(libraryItemCheck).toBeVisible({ timeout: 15000 });
    });

    // Navigate to library page
    await test.step('Navigate to library page', async () => {
      // Open library from sidebar (not from main content area)
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      
      // Wait for library to appear in sidebar
      const libraryItem = sidebar.locator(`[title="${testLibrary.name}"]`);
      await expect(libraryItem).toBeVisible({ timeout: 15000 });
      
      // Click on library in sidebar to navigate to library page
      await libraryItem.click();
      
      // Wait for navigation to library detail page
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      await libraryPage.waitForPageLoad();
      await page.waitForTimeout(2000);
    });

    // Verify full description is displayed (no truncation at exactly 50 chars)
    await test.step('Verify full description is displayed without truncation', async () => {
      // Find the description element in LibraryHeader
      const libraryNameHeading = page.getByRole('heading', { name: testLibrary.name });
      await expect(libraryNameHeading).toBeVisible({ timeout: 10000 });
      
      // Find description element - should be near the library name heading
      const descriptionElement = libraryNameHeading
        .locator('..') // Go to parent (leftSection)
        .locator('div')
        .filter({ hasText: exactDescription })
        .first();
      
      await expect(descriptionElement).toBeVisible({ timeout: 10000 });
      
      // Verify it shows the full text (no truncation, since it's exactly 50 chars)
      // Use innerText to get only the text content of this element
      const displayedText = await descriptionElement.innerText();
      expect(displayedText.trim()).toBe(exactDescription);
      expect(displayedText).not.toContain('...');
      expect(displayedText.trim().length).toBe(50);
    });

    // Verify no tooltip appears on hover
    await test.step('Verify no tooltip appears on hover', async () => {
      const libraryNameHeading = page.getByRole('heading', { name: testLibrary.name });
      const descriptionElement = libraryNameHeading
        .locator('..')
        .locator('div')
        .filter({ hasText: exactDescription })
        .first();
      
      await expect(descriptionElement).toBeVisible({ timeout: 10000 });
      
      // Hover over the description element
      await descriptionElement.hover();
      
      // Wait a bit to ensure tooltip doesn't appear
      await page.waitForTimeout(1000);
      
      // Verify no tooltip is visible (since length is exactly 50, not > 50)
      const tooltip = page.locator('.ant-tooltip');
      const tooltipCount = await tooltip.count();
      expect(tooltipCount).toBe(0);
    });
  });
});

