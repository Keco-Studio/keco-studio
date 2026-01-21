import { test, expect } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { LoginPage } from '../pages/login.page';

import { projects, generateProjectData } from '../fixures/projects';
import { libraries } from '../fixures/libraries';
import { folders } from '../fixures/folders';
import { users } from '../fixures/users';

/**
 * Name Validation E2E Tests
 * 
 * Test Scenarios:
 * 1. Empty name validation: Delete all characters in rename modal and click save, expect error message
 * 2. Special characters validation: Input emoji 😊, HTML tag <script>, special symbols !@#$%, expect error message
 * 3. Duplicate name validation: Rename to an existing name in the same directory, expect error message
 * 
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 */

test.describe('Name Validation Tests', () => {
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

  test.describe('Empty Name Validation', () => {
    test('Project - Empty name validation in rename modal', async ({ page }) => {
      test.setTimeout(60000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project
      await test.step('Create test project', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated();
        await libraryPage.waitForPageLoad();
      });

      // Open Project Info modal
      await test.step('Open Project Info modal', async () => {
        const sidebar = page.locator('aside');
        const projectItem = sidebar.locator(`[title="${testProject.name}"]`);
        
        await expect(projectItem).toBeVisible({ timeout: 15000 });
        await projectItem.click({ button: 'right' });
        
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

      // Open Library Info modal
      await test.step('Open Library Info modal', async () => {
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);
        
        const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
        await expect(libraryItem).toBeVisible({ timeout: 15000 });
        await libraryItem.click({ button: 'right' });
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const libraryInfoButton = contextMenu.getByRole('button', { name: /^library info$/i });
        await expect(libraryInfoButton).toBeVisible({ timeout: 5000 });
        await libraryInfoButton.click();
        
        const libraryNameInput = page.locator('#library-name');
        await expect(libraryNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test empty name validation
      await test.step('Test empty name validation', async () => {
        const libraryNameInput = page.locator('#library-name');
        
        // Clear all characters
        await libraryNameInput.clear();
        await libraryNameInput.fill('');
        
        // Click save button
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        // Verify error message appears
        const errorMessage = page.locator('[class*="error"]').filter({ hasText: /library name is required/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('Library name is required');
      });
    });

    test('Folder - Empty name validation in rename modal', async ({ page }) => {
      test.setTimeout(60000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and folder
      await test.step('Create test project and folder', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated();
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        await libraryPage.createFolderUnderProject(folders.directFolder);
        await libraryPage.expectFolderCreated();
        await page.waitForTimeout(2000);
      });

      // Open Folder Rename modal
      await test.step('Open Folder Rename modal', async () => {
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);
        
        const folderItem = sidebar.locator(`[title="${folders.directFolder.name}"]`);
        await expect(folderItem).toBeVisible({ timeout: 15000 });
        await folderItem.click({ button: 'right' });
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const renameButton = contextMenu.getByRole('button', { name: /^rename$/i });
        await expect(renameButton).toBeVisible({ timeout: 5000 });
        await renameButton.click();
        
        const folderNameInput = page.getByPlaceholder(/enter folder name/i)
          .or(page.locator('label:has-text("Folder Name")').locator('..').locator('input'));
        await expect(folderNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test empty name validation
      await test.step('Test empty name validation', async () => {
        const folderNameInput = page.getByPlaceholder(/enter folder name/i)
          .or(page.locator('label:has-text("Folder Name")').locator('..').locator('input'));
        
        // Clear all characters
        await folderNameInput.clear();
        await folderNameInput.fill('');
        
        // Click save button
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        // Verify error message appears
        const errorMessage = page.locator('[class*="error"]').filter({ hasText: /folder name is required/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('Folder name is required');
      });
    });
  });

  test.describe('Special Characters Validation', () => {
    test('Project - Special characters validation (emoji, HTML tag, special symbols)', async ({ page }) => {
      test.setTimeout(60000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project
      await test.step('Create test project', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated();
        await libraryPage.waitForPageLoad();
      });

      // Open Project Info modal
      await test.step('Open Project Info modal', async () => {
        const sidebar = page.locator('aside');
        const projectItem = sidebar.locator(`[title="${testProject.name}"]`);
        
        await expect(projectItem).toBeVisible({ timeout: 15000 });
        await projectItem.click({ button: 'right' });
        
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

      // Open Library Info modal
      await test.step('Open Library Info modal', async () => {
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);
        
        const libraryItem = sidebar.locator(`[title="${libraries.breed.name}"]`);
        await expect(libraryItem).toBeVisible({ timeout: 15000 });
        await libraryItem.click({ button: 'right' });
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const libraryInfoButton = contextMenu.getByRole('button', { name: /^library info$/i });
        await expect(libraryInfoButton).toBeVisible({ timeout: 5000 });
        await libraryInfoButton.click();
        
        const libraryNameInput = page.locator('#library-name');
        await expect(libraryNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test special characters validation
      await test.step('Test special characters validation', async () => {
        const libraryNameInput = page.locator('#library-name');
        
        // Test with emoji
        await libraryNameInput.clear();
        await libraryNameInput.fill('Test 😊');
        
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        let errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
        
        // Test with HTML tag
        await libraryNameInput.clear();
        await libraryNameInput.fill('Test <script>');
        
        await saveButton.click();
        errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
        
        // Test with special symbols
        await libraryNameInput.clear();
        await libraryNameInput.fill('Test !@#$%');
        
        await saveButton.click();
        errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
      });
    });

    test('Folder - Special characters validation (emoji, HTML tag, special symbols)', async ({ page }) => {
      test.setTimeout(60000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and folder
      await test.step('Create test project and folder', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated();
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        await libraryPage.createFolderUnderProject(folders.directFolder);
        await libraryPage.expectFolderCreated();
        await page.waitForTimeout(2000);
      });

      // Open Folder Rename modal
      await test.step('Open Folder Rename modal', async () => {
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);
        
        const folderItem = sidebar.locator(`[title="${folders.directFolder.name}"]`);
        await expect(folderItem).toBeVisible({ timeout: 15000 });
        await folderItem.click({ button: 'right' });
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const renameButton = contextMenu.getByRole('button', { name: /^rename$/i });
        await expect(renameButton).toBeVisible({ timeout: 5000 });
        await renameButton.click();
        
        const folderNameInput = page.getByPlaceholder(/enter folder name/i)
          .or(page.locator('label:has-text("Folder Name")').locator('..').locator('input'));
        await expect(folderNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test special characters validation
      await test.step('Test special characters validation', async () => {
        const folderNameInput = page.getByPlaceholder(/enter folder name/i)
          .or(page.locator('label:has-text("Folder Name")').locator('..').locator('input'));
        
        // Test with emoji
        await folderNameInput.clear();
        await folderNameInput.fill('Test 😊');
        
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        let errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
        
        // Test with HTML tag
        await folderNameInput.clear();
        await folderNameInput.fill('Test <script>');
        
        await saveButton.click();
        errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
        
        // Test with special symbols
        await folderNameInput.clear();
        await folderNameInput.fill('Test !@#$%');
        
        await saveButton.click();
        errorMessage = page.locator('[class*="error"]').filter({ hasText: /no emojis/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('No emojis, HTML tags or !@#$% allowed');
      });
    });
  });

  test.describe('Duplicate Name Validation', () => {
    test('Project - Duplicate name validation', async ({ page }) => {
      test.setTimeout(60000);

      // Generate unique project data
      const testProject1 = generateProjectData();
      const testProject2 = generateProjectData();

      // Create two test projects
      await test.step('Create two test projects', async () => {
        await projectPage.createProject(testProject1);
        await projectPage.expectProjectCreated();
        await libraryPage.waitForPageLoad();
        
        // Navigate back to projects page to create second project
        await projectPage.goto();
        await projectPage.createProject(testProject2);
        await projectPage.expectProjectCreated();
        await libraryPage.waitForPageLoad();
      });

      // Open Project Info modal for second project
      await test.step('Open Project Info modal for second project', async () => {
        const sidebar = page.locator('aside');
        const projectItem = sidebar.locator(`[title="${testProject2.name}"]`);
        
        await expect(projectItem).toBeVisible({ timeout: 15000 });
        await projectItem.click({ button: 'right' });
        
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
        const errorMessage = page.locator('[class*="error"]').filter({ hasText: /already exists/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('already exists');
      });
    });

    test('Library - Duplicate name validation', async ({ page }) => {
      test.setTimeout(60000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and two libraries
      await test.step('Create test project and two libraries', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated();
        await libraryPage.waitForPageLoad();
        
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        
        // Create first library
        await libraryPage.createLibrary(libraries.breed);
        await libraryPage.expectLibraryCreated();
        await page.waitForTimeout(2000);
        
        // Create second library with different name
        const secondLibrary = { ...libraries.breed, name: `${libraries.breed.name} 2` };
        await libraryPage.createLibrary(secondLibrary);
        await libraryPage.expectLibraryCreated();
        await page.waitForTimeout(2000);
      });

      // Open Library Info modal for second library
      await test.step('Open Library Info modal for second library', async () => {
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);
        
        const secondLibraryName = `${libraries.breed.name} 2`;
        const libraryItem = sidebar.locator(`[title="${secondLibraryName}"]`);
        await expect(libraryItem).toBeVisible({ timeout: 15000 });
        await libraryItem.click({ button: 'right' });
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const libraryInfoButton = contextMenu.getByRole('button', { name: /^library info$/i });
        await expect(libraryInfoButton).toBeVisible({ timeout: 5000 });
        await libraryInfoButton.click();
        
        const libraryNameInput = page.locator('#library-name');
        await expect(libraryNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test duplicate name validation
      await test.step('Test duplicate name validation', async () => {
        const libraryNameInput = page.locator('#library-name');
        
        // Change name to match first library
        await libraryNameInput.clear();
        await libraryNameInput.fill(libraries.breed.name);
        
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        // Verify error message appears
        const errorMessage = page.locator('[class*="error"]').filter({ hasText: /already exists/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('already exists');
      });
    });

    test('Folder - Duplicate name validation', async ({ page }) => {
      test.setTimeout(60000);

      // Generate unique project data
      const testProject = generateProjectData();

      // Create a test project and two folders
      await test.step('Create test project and two folders', async () => {
        await projectPage.createProject(testProject);
        await projectPage.expectProjectCreated();
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

      // Open Folder Rename modal for second folder
      await test.step('Open Folder Rename modal for second folder', async () => {
        const sidebar = page.getByRole('tree');
        await expect(sidebar).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);
        
        const secondFolderName = `${folders.directFolder.name} 2`;
        const folderItem = sidebar.locator(`[title="${secondFolderName}"]`);
        await expect(folderItem).toBeVisible({ timeout: 15000 });
        await folderItem.click({ button: 'right' });
        
        const contextMenu = page.locator('[class*="contextMenu"]');
        await expect(contextMenu).toBeVisible({ timeout: 5000 });
        
        const renameButton = contextMenu.getByRole('button', { name: /^rename$/i });
        await expect(renameButton).toBeVisible({ timeout: 5000 });
        await renameButton.click();
        
        const folderNameInput = page.getByPlaceholder(/enter folder name/i)
          .or(page.locator('label:has-text("Folder Name")').locator('..').locator('input'));
        await expect(folderNameInput).toBeVisible({ timeout: 5000 });
      });

      // Test duplicate name validation
      await test.step('Test duplicate name validation', async () => {
        const folderNameInput = page.getByPlaceholder(/enter folder name/i)
          .or(page.locator('label:has-text("Folder Name")').locator('..').locator('input'));
        
        // Change name to match first folder
        await folderNameInput.clear();
        await folderNameInput.fill(folders.directFolder.name);
        
        const saveButton = page.getByRole('button', { name: /^save$/i });
        await expect(saveButton).toBeVisible();
        await saveButton.click();
        
        // Verify error message appears
        const errorMessage = page.locator('[class*="error"]').filter({ hasText: /already exists/i });
        await expect(errorMessage).toBeVisible({ timeout: 5000 });
        await expect(errorMessage).toContainText('already exists');
      });
    });
  });
});

