import { test, expect, type Page } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { LoginPage } from '../pages/login.page';
import { waitForSupabaseAuthStorage } from '../utils/auth-storage';

import { projects, generateProjectData } from '../fixures/projects';
import { libraries } from '../fixures/libraries';
import { folders } from '../fixures/folders';
import { users } from '../fixures/users';

function formDialogError(page: Page, text: string | RegExp) {
  return page.locator('[class*="FormDialog"][class*="error"]').filter({ hasText: text }).first();
}

function toastError(page: Page, text: string | RegExp) {
  return page.locator('body > div').filter({ hasText: text }).last();
}

/**
 * Name Validation E2E Tests
 * 
 * Test Scenarios:
 * 1. Empty name: clearing inline rename and pressing Enter is a no-op (library/folder)
 * 2. Special characters validation: emoji / HTML / !@#$% show an error toast on Enter
 * 3. URL validation: https:// / http:// show the same toast
 * 4. Duplicate name validation: renaming onto an existing sibling shows an error toast
 * 
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 */

test.describe('Name Validation Tests', () => {
  // All cases share seedEmpty; serial avoids parallel contention and flaky navigation.
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
    await waitForSupabaseAuthStorage(page, 30000);

    // Additional wait to ensure Supabase client is fully initialized
    await page.waitForTimeout(2000);
  });

  test.describe('Empty Name Validation', () => {
    test('Project - Empty name validation in rename modal', async ({ page }) => {
      test.setTimeout(120000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project
      await test.step('Create test project', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
      });

      // Open Project Info modal
      await test.step('Open Project Info modal', async () => {
        const sidebar = page.locator('aside');
        await projectPage.rightClickSidebarProject(testProject.name);
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const projectInfoButton = contextMenu.getByRole('button', { name: /^project info$/i });
        await expect(projectInfoButton).toBeVisible({ timeout: 5000 });
        await projectInfoButton.click();
        
        const projectNameInput = page.locator('#project-name');
        await expect(projectNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test empty name validation
      await test.step('Test empty name validation', async () => {
        const projectNameInput = page.locator('#project-name');
        
        // Clear all characters
        await projectNameInput.clear();
        await projectNameInput.fill('');
        
        // Click save button
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        // Verify error message appears
        const errorMessage = page.locator('[class*="error"]').filter({ hasText: /project name is required/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('Project name is required');
      });
    });

    test('Library - Empty name validation in rename modal', async ({ page }) => {
      test.setTimeout(120000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and library
      await test.step('Create test project and library', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        await libraryPage.createLibraryUnderProject(libraries.breed);
        await libraryPage.expectLibraryCreated();
        await page.waitForTimeout(2000);
      });

      // Open library inline rename
      await test.step('Open library inline rename', async () => {
        await libraryPage.openInlineRename(libraries.breed.name, /^library info$/i);
      });

      // Empty submit is a no-op for inline rename (keeps editor open, name unchanged).
      await test.step('Test empty name is ignored', async () => {
        const renameInput = libraryPage.renameInput();
        await renameInput.fill('');
        await renameInput.press('Enter');
        await expect(renameInput).toBeVisible({ timeout: 5000 });
        await renameInput.press('Escape');
        await expect(page.getByRole('tree').locator(`[title="${libraries.breed.name}"]`)).toBeVisible({
          timeout: 10000,
        });
      });
    });

    test('Folder - Empty name validation in rename modal', async ({ page }) => {
      test.setTimeout(120000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and folder
      await test.step('Create test project and folder', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        await libraryPage.createFolderUnderProject(folders.directFolder);
        await libraryPage.expectFolderCreated();
        await page.waitForTimeout(2000);
      });

      // Open folder inline rename
      await test.step('Open folder inline rename', async () => {
        await libraryPage.openInlineRename(folders.directFolder.name, /^rename$/i);
      });

      // Empty submit is a no-op for inline rename (keeps editor open, name unchanged).
      await test.step('Test empty name is ignored', async () => {
        const renameInput = libraryPage.renameInput();
        await renameInput.fill('');
        await renameInput.press('Enter');
        await expect(renameInput).toBeVisible({ timeout: 5000 });
        await renameInput.press('Escape');
        await expect(page.getByRole('tree').locator(`[title="${folders.directFolder.name}"]`)).toBeVisible({
          timeout: 10000,
        });
      });
    });
  });

  test.describe('Special Characters Validation', () => {
    test('Project - Special characters validation (emoji, HTML tag, special symbols)', async ({ page }) => {
      test.setTimeout(120000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project
      await test.step('Create test project', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
      });

      // Open Project Info modal
      await test.step('Open Project Info modal', async () => {
        const sidebar = page.locator('aside');
        await projectPage.rightClickSidebarProject(testProject.name);
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const projectInfoButton = contextMenu.getByRole('button', { name: /^project info$/i });
        await expect(projectInfoButton).toBeVisible({ timeout: 5000 });
        await projectInfoButton.click();
        
        const projectNameInput = page.locator('#project-name');
        await expect(projectNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test special characters validation
      await test.step('Test special characters validation', async () => {
        const projectNameInput = page.locator('#project-name');
        
        // Test with emoji
        await projectNameInput.clear();
        await projectNameInput.fill('Test 😊');
        
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        let errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
        
        // Test with HTML tag
        await projectNameInput.clear();
        await projectNameInput.fill('Test <script>');
        
        await saveButton.click();
        errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
        
        // Test with special symbols
        await projectNameInput.clear();
        await projectNameInput.fill('Test !@#$%');
        
        await saveButton.click();
        errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
      });
    });

    test('Library - Special characters validation (emoji, HTML tag, special symbols)', async ({ page }) => {
      test.setTimeout(120000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and library
      await test.step('Create test project and library', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        await libraryPage.createLibraryUnderProject(libraries.breed);
        await libraryPage.expectLibraryCreated();
        await page.waitForTimeout(2000);
      });

      // Open library inline rename
      await test.step('Open library inline rename', async () => {
        await libraryPage.openInlineRename(libraries.breed.name, /^library info$/i);
      });

      // Test special characters validation
      await test.step('Test special characters validation', async () => {
        const renameInput = libraryPage.renameInput();
        const invalidNames = ['Test 😊', 'Test <script>', 'Test !@#$%'];
        for (const invalidName of invalidNames) {
          await renameInput.fill(invalidName);
          await renameInput.press('Enter');
          await expect(toastError(page, /no emojis/i)).toBeVisible({ timeout: 5000 });
          await expect(renameInput).toBeVisible({ timeout: 5000 });
        }
      });
    });

    test('Folder - Special characters validation (emoji, HTML tag, special symbols)', async ({ page }) => {
      test.setTimeout(120000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and folder
      await test.step('Create test project and folder', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        await libraryPage.createFolderUnderProject(folders.directFolder);
        await libraryPage.expectFolderCreated();
        await page.waitForTimeout(2000);
      });

      // Open folder inline rename
      await test.step('Open folder inline rename', async () => {
        await libraryPage.openInlineRename(folders.directFolder.name, /^rename$/i);
      });

      // Test special characters validation
      await test.step('Test special characters validation', async () => {
        const renameInput = libraryPage.renameInput();
        const invalidNames = ['Test 😊', 'Test <script>', 'Test !@#$%'];
        for (const invalidName of invalidNames) {
          await renameInput.fill(invalidName);
          await renameInput.press('Enter');
          await expect(toastError(page, /no emojis/i)).toBeVisible({ timeout: 5000 });
          await expect(renameInput).toBeVisible({ timeout: 5000 });
        }
      });
    });
  });

  test.describe('URL Validation', () => {
    const urlErrorText = 'No emojis, HTML tags or !@#$% allowed';

    test('Project - URL validation (https://, http://)', async ({ page }) => {
      test.setTimeout(120000);

      const testProject = generateProjectData();

      await test.step('Create test project', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
      });

      await test.step('Open Project Info modal', async () => {
        const sidebar = page.locator('aside');
        await projectPage.rightClickSidebarProject(testProject.name);
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        const projectInfoButton = contextMenu.getByRole('button', { name: /^project info$/i });
        await expect(projectInfoButton).toBeVisible({ timeout: 5000 });
        await projectInfoButton.click();
        await expect(page.locator('#project-name')).toBeVisible({ timeout: 5000 });
      });

      await test.step('Test URL validation', async () => {
        const projectNameInput = page.locator('#project-name');
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();

        await projectNameInput.clear();
        await projectNameInput.fill('https://example.com');
        await saveButton.click();
        let errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText(urlErrorText);

        await projectNameInput.clear();
        await projectNameInput.fill('http://test.com');
        await saveButton.click();
        errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText(urlErrorText);
      });
    });

    test('Library - URL validation (https://, http://)', async ({ page }) => {
      test.setTimeout(120000);

      const testProject = generateProjectData();

      await test.step('Create test project and library', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        await libraryPage.createLibraryUnderProject(libraries.breed);
        await libraryPage.expectLibraryCreated();
        await page.waitForTimeout(2000);
      });

      await test.step('Open library inline rename', async () => {
        await libraryPage.openInlineRename(libraries.breed.name, /^library info$/i);
      });

      await test.step('Test URL validation', async () => {
        const renameInput = libraryPage.renameInput();
        for (const invalidName of ['https://example.com', 'http://test.com']) {
          await renameInput.fill(invalidName);
          await renameInput.press('Enter');
          await expect(toastError(page, urlErrorText)).toBeVisible({ timeout: 5000 });
          await expect(renameInput).toBeVisible({ timeout: 5000 });
        }
      });
    });

    test('Folder - URL validation (https://, http://)', async ({ page }) => {
      test.setTimeout(120000);

      const testProject = generateProjectData();

      await test.step('Create test project and folder', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        await libraryPage.createFolderUnderProject(folders.directFolder);
        await libraryPage.expectFolderCreated();
        await page.waitForTimeout(2000);
      });

      await test.step('Open folder inline rename', async () => {
        await libraryPage.openInlineRename(folders.directFolder.name, /^rename$/i);
      });

      await test.step('Test URL validation', async () => {
        const renameInput = libraryPage.renameInput();
        for (const invalidName of ['https://example.com', 'http://test.com']) {
          await renameInput.fill(invalidName);
          await renameInput.press('Enter');
          await expect(toastError(page, urlErrorText)).toBeVisible({ timeout: 5000 });
          await expect(renameInput).toBeVisible({ timeout: 5000 });
        }
      });
    });
  });

  test.describe('Duplicate Name Validation', () => {
    test('Project - Duplicate name validation', async ({ page }) => {
      // Two createProject + goto in CI can exceed 60s; avoid "Target page/browser has been closed"
      test.setTimeout(120000);

      // Generate unique project data
      const testProject1 = generateProjectData();
      const testProject2 = generateProjectData();

      // Create two test projects
      await test.step('Create two test projects', async () => {
        await projectPage.createProject(testProject1);
        await projectPage.expectProjectCreated(testProject1.name);
        await libraryPage.waitForPageLoad();
        
        // Navigate back to projects page to create second project
        await projectPage.goto();
        await projectPage.createProject(testProject2);
        await projectPage.expectProjectCreated(testProject2.name);
        await libraryPage.waitForPageLoad();
      });

      // Open Project Info modal for second project
      await test.step('Open Project Info modal for second project', async () => {
        const sidebar = page.locator('aside');
        await projectPage.rightClickSidebarProject(testProject2.name);
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const projectInfoButton = contextMenu.getByRole('button', { name: /^project info$/i });
        await expect(projectInfoButton).toBeVisible({ timeout: 5000 });
        await projectInfoButton.click();
        
        const projectNameInput = page.locator('#project-name');
        await expect(projectNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test duplicate name validation
      await test.step('Test duplicate name validation', async () => {
        const projectNameInput = page.locator('#project-name');
        
        // Change name to match first project
        await projectNameInput.clear();
        await projectNameInput.fill(testProject1.name);
        
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        // Verify error message appears
        const errorMessage = formDialogError(page, /already exists/i);
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('already exists');
      });
    });

    test('Library - Duplicate name validation', async ({ page }) => {
      test.setTimeout(120000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and two libraries
      await test.step('Create test project and two libraries', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        // Create first library
        await libraryPage.createLibraryUnderProject(libraries.breed);
        await libraryPage.expectLibraryCreated();
        await page.waitForTimeout(2000);
        
        // Create second library with different name
        const secondLibrary = { ...libraries.breed, name: `${libraries.breed.name} 2` };
        await libraryPage.createLibraryUnderProject(secondLibrary);
        await libraryPage.expectLibraryCreated();
        await page.waitForTimeout(2000);
      });

      // Open library inline rename for second library
      await test.step('Open library inline rename for second library', async () => {
        const secondLibraryName = `${libraries.breed.name} 2`;
        await libraryPage.openInlineRename(secondLibraryName, /^library info$/i);
      });

      // Test duplicate name validation
      await test.step('Test duplicate name validation', async () => {
        const renameInput = libraryPage.renameInput();
        await renameInput.fill(libraries.breed.name);
        await renameInput.press('Enter');
        await expect(toastError(page, /already exists/i)).toBeVisible({ timeout: 5000 });
        await expect(renameInput).toBeVisible({ timeout: 5000 });
      });
    });

    test('Folder - Duplicate name validation', async ({ page }) => {
      test.setTimeout(120000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and two folders
      await test.step('Create test project and two folders', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated(testProject.name);
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        // Create first folder
        await libraryPage.createFolderUnderProject(folders.directFolder);
        await libraryPage.expectFolderCreated();
        await page.waitForTimeout(2000);
        
        // Create second folder with different name
        const secondFolder = { ...folders.directFolder, name: `${folders.directFolder.name} 2` };
        await libraryPage.createFolderUnderProject(secondFolder);
        await libraryPage.expectFolderCreated();
        await page.waitForTimeout(2000);
      });

      // Open folder inline rename for second folder
      await test.step('Open folder inline rename for second folder', async () => {
        const secondFolderName = `${folders.directFolder.name} 2`;
        await libraryPage.openInlineRename(secondFolderName, /^rename$/i);
      });

      // Test duplicate name validation
      await test.step('Test duplicate name validation', async () => {
        const renameInput = libraryPage.renameInput();
        await renameInput.fill(folders.directFolder.name);
        await renameInput.press('Enter');
        await expect(toastError(page, /already exists/i)).toBeVisible({ timeout: 5000 });
        await expect(renameInput).toBeVisible({ timeout: 5000 });
      });
    });
  });
});
