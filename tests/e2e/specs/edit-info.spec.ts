import { test, expect, type Page } from '@playwright/test';
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
 * 1. Project: Create with Foundation data -> verify Library -> edit in Settings
 * 2. Library: Right-click library -> Click [Library Info] -> inline rename
 * 3. Folder: Right-click folder -> Click [Rename] -> inline rename
 * 
 * Architecture:
 * - Pure business flow - no selectors in test file
 * - All UI interactions delegated to Page Objects
 * - All test data from fixtures
 * - Follows Page Object Model (POM) pattern
 */

async function openProjectInfoFromSelector(page: Page, projectName: string) {
  const trigger = page.getByTestId('project-selector-trigger');
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();

  const projectItem = page.getByRole('menuitemradio').filter({ hasText: projectName }).first();
  await expect(projectItem).toBeVisible({ timeout: 15000 });
  await projectItem.click({ button: 'right' });

  const contextMenu = page.locator('[class*="contextMenu"]');
  await expect(contextMenu).toBeVisible({ timeout: 5000 });
  await contextMenu.getByRole('button', { name: /^project info$/i }).click();
}

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

  test('Project Info - Create project, verify Library foundation, and edit only in Settings', async ({ page }) => {
    test.setTimeout(60000);

    const projectName = generateProjectData().name;
    const renamedProject = `${projectName} (edited)`;

    await projectPage.createProject({
      name: projectName,
      description: 'A cooperative mystery.',
      genres: ['RPG'],
      designPhilosophies: ['Player Agency'],
    });
    await expect(page.getByTestId('project-selector-trigger')).toContainText(projectName);
    await expect(page.getByRole('tree')).toContainText('Resources Folder');
    const projectId = new URL(page.url()).pathname.split('/')[1];

    // Project info routes to Settings, never a modal.
    await openProjectInfoFromSelector(page, projectName);
    await expect(page).toHaveURL(new RegExp(`/${projectId}/admin$`));
    await expect(page.getByText('Edit Project')).toHaveCount(0);

    await page.getByLabel('Project name').fill(renamedProject);
    await page.getByLabel('Description').fill('An updated cooperative mystery.');
    await page.getByRole('button', { name: 'Strategy' }).click();
    await page.getByRole('button', { name: 'Readable Systems' }).click();
    await page.getByRole('button', { name: 'Save project information' }).click();
    await expect(page.getByTestId('project-selector-trigger')).toContainText(renamedProject);
    await page.getByTestId('project-selector-trigger').click();
    await expect(page.getByRole('menuitemradio').filter({ hasText: renamedProject }).first()).toBeVisible();
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

});
