import { test, expect } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { LoginPage } from '../pages/login.page';
import { waitForSupabaseAuthStorage } from '../utils/auth-storage';

import { projects, generateProjectData } from '../fixures/projects';
import { libraries } from '../fixures/libraries';
import { folders } from '../fixures/folders';
import { users } from '../fixures/users';

/**
 * Edit Info E2E Tests
 * 
 * Test Scenarios:
 * 1. Project: Right-click project -> Click [Project Info] -> Verify modal appears, can edit project name and description
 * 2. Library: Right-click library -> Click [Library Info] -> inline rename
 * 3. Folder: Right-click folder -> Click [Rename] -> inline rename
 * 4. Loading time: Project modal and library/folder inline rename load within ≤2s
 * 
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 */

test.describe('Edit Info Feature Tests', () => {
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

  test('Project Info - Right-click project and open edit modal, can edit project name and description', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project data to avoid test conflicts
    const testProject = generateProjectData();

    // Create a test project
    await test.step('Create test project', async () => {
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();
      await libraryPage.waitForPageLoad();
    });

    // Right-click project and open Project Info modal
    await test.step('Right-click project and open Project Info modal', async () => {
      const trigger = page.getByTestId('project-selector-trigger');
      await expect(trigger).toBeVisible({ timeout: 15000 });
      await trigger.click();
      const projectItem = page
        .getByRole('menuitemradio')
        .filter({ has: page.locator(`[title="${testProject.name}"]`) })
        .first();

      await expect(projectItem).toBeVisible({ timeout: 15000 });

      // Right-click the project
      await projectItem.click({ button: 'right' });

      // Wait for context menu to appear
      const contextMenu = page.locator('[class*="contextMenu"]');
      await expect(contextMenu).toBeVisible({ timeout: 5000 });

      // Click "Project info" button
      const projectInfoButton = contextMenu.getByRole('button', { name: /^project info$/i });
      await expect(projectInfoButton).toBeVisible({ timeout: 5000 });

      // Record time before modal opens
      const startTime = Date.now();

      await projectInfoButton.click();

      // Wait for modal to appear (by checking if input field is visible)
      const projectNameInput = page.locator('#project-name');
      await expect(projectNameInput).toBeVisible({ timeout: 5000 });

      // Verify modal loading time ≤ 2s
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThanOrEqual(2000);

      // Verify modal title
      const modalTitle = page.getByText('Edit Project');
      await expect(modalTitle).toBeVisible();
    });

    // Verify can edit project name and description
    await test.step('Verify can edit project name and description', async () => {
      const projectNameInput = page.locator('#project-name');
      const projectDescriptionInput = page.locator('#project-description');

      // Verify input fields are filled with original values
      await expect(projectNameInput).toHaveValue(testProject.name);
      await expect(projectDescriptionInput).toHaveValue(testProject.description || '');

      // Edit name
      const newName = `${testProject.name} (edited)`;
      await projectNameInput.clear();
      await projectNameInput.fill(newName);

      // Edit description
      const newDescription = `${testProject.description || ''} - test edit functionality`;
      await projectDescriptionInput.clear();
      await projectDescriptionInput.fill(newDescription);

      // Verify input field values are updated
      await expect(projectNameInput).toHaveValue(newName);
      await expect(projectDescriptionInput).toHaveValue(newDescription);

      // Click save button
      const saveButton = page.getByRole('button', { name: /^save$/i });
      await expect(saveButton).toBeVisible();
      await saveButton.click();

      // Wait for modal to close
      await expect(projectNameInput).not.toBeVisible({ timeout: 10000 });

      // Verify project name is updated (in project selector)
      const trigger = page.getByTestId('project-selector-trigger');
      await expect(trigger).toContainText(newName, { timeout: 10000 });
      await trigger.click();
      const updatedProjectItem = page.locator(`[title="${newName}"]`);
      await expect(updatedProjectItem).toBeVisible({ timeout: 10000 });
      await page.keyboard.press('Escape').catch(() => {});
    });
  });

  test('Library Info - Right-click library and inline rename', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project data to avoid test conflicts
    const testProject = generateProjectData();
    const newName = `${libraries.breed.name} (edited)`;

    // Create a test project and library
    await test.step('Create test project and library', async () => {
      // Create project (will automatically navigate to project detail page)
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();

      // Ensure we're on project detail page (createProject automatically navigates to project page)
      await libraryPage.waitForPageLoad();

      // Ensure sidebar is loaded and Add button is visible
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000); // Wait for sidebar to fully render

      // Create Library directly under project (sidebar Add -> Create new library)
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();

      // Wait for Library to appear in sidebar
      await page.waitForTimeout(2000);
    });

    // Right-click library and rename inline
    await test.step('Right-click library and rename inline', async () => {
      const startTime = Date.now();
      const renameInput = await libraryPage.openInlineRename(libraries.breed.name, /^library info$/i);
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThanOrEqual(2000);

      await expect(renameInput).toHaveValue(libraries.breed.name);
      await renameInput.fill(newName);
      await renameInput.press('Enter');

      await expect(libraryPage.renameInput()).toHaveCount(0, { timeout: 10000 });
      await expect(page.getByRole('tree').locator(`[title="${newName}"]`)).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test('Folder Rename - Right-click folder and inline rename', async ({ page }) => {
    test.setTimeout(60000);

    // Generate unique project data to avoid test conflicts
    const testProject = generateProjectData();
    const newName = `${folders.directFolder.name} (edited)`;

    // Create a test project and folder
    await test.step('Create test project and folder', async () => {
      // Create project (will automatically navigate to project detail page)
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();

      // Ensure we're on project detail page
      await libraryPage.waitForPageLoad();

      // Ensure sidebar is loaded
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000); // Wait for sidebar to fully render

      // Create folder in project page
      await libraryPage.createFolderUnderProject(folders.directFolder);
      await libraryPage.expectFolderCreated();

      // Wait for Folder to appear in sidebar
      await page.waitForTimeout(2000);
    });

    // Right-click folder and rename inline
    await test.step('Right-click folder and rename inline', async () => {
      const startTime = Date.now();
      const renameInput = await libraryPage.openInlineRename(folders.directFolder.name, /^rename$/i);
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThanOrEqual(2000);

      await expect(renameInput).toHaveValue(folders.directFolder.name);
      await renameInput.fill(newName);
      await renameInput.press('Enter');

      await expect(libraryPage.renameInput()).toHaveCount(0, { timeout: 10000 });
      await expect(page.getByRole('tree').locator(`[title="${newName}"]`)).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test('Modal Loading Time Test - Verify project modal and inline rename load within ≤2s', async ({ page }) => {
    test.setTimeout(90000);

    // Generate unique project data to avoid test conflicts
    const testProject = generateProjectData();

    // Create test data
    await test.step('Create test data', async () => {
      // Create project (will automatically navigate to project detail page)
      await projectPage.createProject(testProject);
      await projectPage.expectProjectCreated();

      // Ensure we're on project detail page
      await libraryPage.waitForPageLoad();

      // Ensure sidebar is loaded
      const sidebar = page.getByRole('tree');
      await expect(sidebar).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(2000); // Wait for sidebar to fully render

      // Create Library directly under project (sidebar Add -> Create new library)
      await libraryPage.createLibraryUnderProject(libraries.breed);
      await libraryPage.expectLibraryCreated();
      await page.waitForTimeout(2000);

      // Create Folder
      await libraryPage.createFolderUnderProject(folders.directFolder);
      await libraryPage.expectFolderCreated();
      await page.waitForTimeout(2000);
    });

    // Test Project Info modal loading time
    await test.step('Test Project Info modal loading time', async () => {
      const trigger = page.getByTestId('project-selector-trigger');
      await expect(trigger).toBeVisible({ timeout: 15000 });
      await trigger.click();
      const projectItem = page
        .getByRole('menuitemradio')
        .filter({ has: page.locator(`[title="${testProject.name}"]`) })
        .first();
      await expect(projectItem).toBeVisible({ timeout: 15000 });

      await projectItem.click({ button: 'right' });
      const contextMenu = page.locator('[class*="contextMenu"]');
      await expect(contextMenu).toBeVisible({ timeout: 5000 });

      const projectInfoButton = contextMenu.getByRole('button', { name: /^project info$/i });
      await expect(projectInfoButton).toBeVisible({ timeout: 5000 });

      const startTime = Date.now();
      await projectInfoButton.click();

      const projectNameInput = page.locator('#project-name');
      await expect(projectNameInput).toBeVisible({ timeout: 5000 });

      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThanOrEqual(2000);

      // Close modal
      const closeButton = page.getByRole('button', { name: /close/i }).or(page.locator('button[aria-label="Close"]'));
      await closeButton.click();
      await expect(projectNameInput).not.toBeVisible({ timeout: 5000 });
    });

    // Test Library inline rename loading time
    await test.step('Test Library inline rename loading time', async () => {
      const startTime = Date.now();
      const renameInput = await libraryPage.openInlineRename(libraries.breed.name, /^library info$/i);
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThanOrEqual(2000);
      await renameInput.press('Escape');
      await expect(libraryPage.renameInput()).toHaveCount(0, { timeout: 5000 });
    });

    // Test Folder inline rename loading time
    await test.step('Test Folder inline rename loading time', async () => {
      const startTime = Date.now();
      const renameInput = await libraryPage.openInlineRename(folders.directFolder.name, /^rename$/i);
      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThanOrEqual(2000);
      await renameInput.press('Escape');
      await expect(libraryPage.renameInput()).toHaveCount(0, { timeout: 5000 });
    });
  });
});
