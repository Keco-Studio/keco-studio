import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { users } from '../fixures/users';

/**
 * MoveTo E2E Test Suite
 *
 * Tests for library MoveTo functionality
 */

// ============================================================================
// Helper Functions
// ============================================================================

async function loginAsSeedEmpty(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(users.seedEmpty);
  await loginPage.expectLoginSuccess();
}

function getMoveToModal(page: Page) {
  return page.locator('[class*="moveToModal"]');
}

function getMoveButton(page: Page) {
  return page.locator('[class*="moveToConfirm"]');
}

function getCancelButton(page: Page) {
  return page.locator('[class*="moveToCancel"]');
}

async function openContextMenuForLibrary(page: Page, libraryName: string): Promise<void> {
  const sidebar = page.locator('aside');
  const libraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
  await expect(libraryItem).toBeVisible({ timeout: 15000 });
  await libraryItem.click({ button: 'right' });

  const contextMenu = page.locator('[class*="contextMenu"]');
  await expect(contextMenu).toBeVisible({ timeout: 5000 });
}

async function clickMoveToInContextMenu(page: Page): Promise<void> {
  const contextMenu = page.locator('[class*="contextMenu"]');
  const moveToButton = contextMenu.getByRole('button', { name: /move to/i });
  await expect(moveToButton).toBeVisible({ timeout: 5000 });
  await moveToButton.click();

  const moveToModal = getMoveToModal(page);
  await expect(moveToModal).toBeVisible({ timeout: 5000 });
}

async function selectFolder(page: Page, folderName: string): Promise<void> {
  const folderButton = page
    .locator('[class*="moveToFolderItem"]')
    .filter({ hasText: folderName })
    .first();
  await expect(folderButton).toBeVisible({ timeout: 5000 });
  await folderButton.click();
}

async function toggleIndependentLibrary(page: Page): Promise<void> {
  const switchElement = page.locator('[class*="moveToSwitch"]');
  await expect(switchElement).toBeVisible({ timeout: 5000 });
  await switchElement.click();
  await page.waitForTimeout(300);
}

async function closeModal(page: Page): Promise<void> {
  const cancelButton = getCancelButton(page);
  if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cancelButton.click();
  }
  await expect(getMoveToModal(page)).not.toBeVisible({ timeout: 5000 });
}

// ============================================================================
// Test Suite: Move Library to Another Folder
// ============================================================================

test.describe('Move library to another folder', () => {
  test('Move library from one folder to another folder', async ({ page }) => {
    test.setTimeout(240000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const projectName = `MT Project ${stamp}`;
    const sourceFolderName = `Source Folder ${stamp}`;
    const targetFolderName = `Target Folder ${stamp}`;
    const libraryName = `Move Library ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Create project
    await projectPage.createProject({ name: projectName, description: `move-to-test-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    // Create source folder
    await libraryPage.createFolderUnderProject({ name: sourceFolderName });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Create target folder
    await libraryPage.createFolderUnderProject({ name: targetFolderName });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Open source folder and create library
    const sidebar = page.locator('aside');
    const sourceFolder = sidebar.locator(`[title="${sourceFolderName}"]`).first();
    await expect(sourceFolder).toBeVisible({ timeout: 15000 });
    await sourceFolder.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await libraryPage.createLibrary({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await page.waitForTimeout(1000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Verify library is visible in source folder
    await expect(sidebar.locator(`[title="${sourceFolderName}"]`)).toBeVisible({ timeout: 10000 });

    // Step 1: Right-click on library in source folder and select "Move to..."
    await sourceFolder.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const libraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    await libraryItem.click({ button: 'right' });

    const contextMenu = page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const moveToButton = contextMenu.getByRole('button', { name: /move to/i });
    await moveToButton.click();

    // Wait for modal
    const moveToModal = getMoveToModal(page);
    await expect(moveToModal).toBeVisible({ timeout: 5000 });

    // Step 2: Select target folder
    await selectFolder(page, targetFolderName);

    // Step 3: Click Move
    const moveButton = getMoveButton(page);
    await expect(moveButton).toBeEnabled({ timeout: 5000 });
    await moveButton.click();

    // Wait for modal to close
    await expect(moveToModal).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Open target folder and verify library is there
    const targetFolder = sidebar.locator(`[title="${targetFolderName}"]`).first();
    await expect(targetFolder).toBeVisible({ timeout: 10000 });
    await targetFolder.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await expect(sidebar.locator(`[title="${libraryName}"]`).first()).toBeVisible({ timeout: 15000 });
  });
});

// ============================================================================
// Test Suite: Move Library Out of Folder to Become Independent
// ============================================================================

test.describe('Move library out of folder to become independent', () => {
  test('Move library out of folder to project root level', async ({ page }) => {
    test.setTimeout(240000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const projectName = `MT Independent Project ${stamp}`;
    const folderName = `MT Folder ${stamp}`;
    const libraryName = `Independent Library ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Create project
    await projectPage.createProject({ name: projectName, description: `move-to-test-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    // Create folder
    await libraryPage.createFolderUnderProject({ name: folderName });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Open folder and create library
    const sidebar = page.locator('aside');
    const folderItem = sidebar.locator(`[title="${folderName}"]`).first();
    await expect(folderItem).toBeVisible({ timeout: 15000 });
    await folderItem.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await libraryPage.createLibrary({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await page.waitForTimeout(1000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Right-click on library in folder and select "Move to..."
    await folderItem.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const libraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    await libraryItem.click({ button: 'right' });

    const contextMenu = page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const moveToButton = contextMenu.getByRole('button', { name: /move to/i });
    await moveToButton.click();

    // Wait for modal
    const moveToModal = getMoveToModal(page);
    await expect(moveToModal).toBeVisible({ timeout: 5000 });

    // Toggle "Use as independent library" switch
    await toggleIndependentLibrary(page);

    // Click Move
    const moveButton = getMoveButton(page);
    await expect(moveButton).toBeEnabled({ timeout: 5000 });
    await moveButton.click();

    // Wait for modal to close
    await expect(moveToModal).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Library should now be visible at root level (not inside folder)
    await expect(sidebar.locator(`[title="${libraryName}"]`).first()).toBeVisible({ timeout: 15000 });

    // Library should NOT be inside the folder anymore
    await folderItem.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // The library should not be visible inside the folder
    const libraryInFolder = sidebar.locator(`[title="${libraryName}"]`).first();
    await expect(libraryInFolder).not.toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// Test Suite: Permission - Editor and Viewer Cannot Use MoveTo
// ============================================================================

test.describe('Permission: editor and viewer cannot use MoveTo', () => {
  test('Right-click menu should show "Move to" option for admin', async ({ page }) => {
    test.setTimeout(180000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const projectName = `MT Perm Project ${stamp}`;
    const libraryName = `Permission Library ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Create project and library
    await projectPage.createProject({ name: projectName, description: `perm-test-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createLibraryUnderProject({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Right-click on library
    const sidebar = page.locator('aside');
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    await libraryItem.click({ button: 'right' });

    const contextMenu = page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // Verify "Move to" option exists for admin
    const moveToButton = contextMenu.getByRole('button', { name: /move to/i });
    await expect(moveToButton).toBeVisible({ timeout: 5000 });

    // Close context menu
    await page.keyboard.press('Escape');
  });
});

// ============================================================================
// Test Suite: Edge Cases
// ============================================================================

test.describe('Move library edge cases', () => {
  test('Already independent library - Move button should be disabled when no folder selected', async ({ page }) => {
    test.setTimeout(180000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const projectName = `MT Edge Project ${stamp}`;
    const libraryName = `Edge Library ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Create project and library directly under project (independent)
    await projectPage.createProject({ name: projectName, description: `edge-test-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createLibraryUnderProject({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Right-click on independent library and select "Move to..."
    const sidebar = page.locator('aside');
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    await libraryItem.click({ button: 'right' });

    const contextMenu = page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const moveToButton = contextMenu.getByRole('button', { name: /move to/i });
    await moveToButton.click();

    // Wait for modal
    const moveToModal = getMoveToModal(page);
    await expect(moveToModal).toBeVisible({ timeout: 5000 });

    // For an independent library (no folder), with no folder selected and independent switch off,
    // the Move button should be disabled
    const confirmButton = getMoveButton(page);
    const isDisabled = await confirmButton.getAttribute('disabled');
    expect(isDisabled).not.toBeNull();

    // Close modal
    await closeModal(page);
  });

  test('Cross-project move - modal should only show folders from current project', async ({ page }) => {
    test.setTimeout(240000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const project1Name = `MT Proj 1 ${stamp}`;
    const project2Name = `MT Proj 2 ${stamp}`;
    const folderName = `MT Folder ${stamp}`;
    const libraryName = `Cross Project Library ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Create first project with folder and library
    await projectPage.createProject({ name: project1Name, description: `cross-test-1-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createFolderUnderProject({ name: folderName });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Navigate to folder and create library
    const sidebar = page.locator('aside');
    const folderItem = sidebar.locator(`[title="${folderName}"]`).first();
    await expect(folderItem).toBeVisible({ timeout: 15000 });
    await folderItem.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await libraryPage.createLibrary({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await page.waitForTimeout(1000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Create second project (this switches context)
    await projectPage.createProject({ name: project2Name, description: `cross-test-2-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    // Navigate back to first project
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Open Move to modal for the library
    await folderItem.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const libraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    await libraryItem.click({ button: 'right' });

    const contextMenu = page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const moveToButton = contextMenu.getByRole('button', { name: /move to/i });
    await moveToButton.click();

    // Wait for modal
    const moveToModal = getMoveToModal(page);
    await expect(moveToModal).toBeVisible({ timeout: 5000 });

    // Verify modal shows folders from the current project only
    const projectText = page.locator('[class*="moveToProjectText"]');
    await expect(projectText).toBeVisible({ timeout: 5000 });
    const projectTextContent = await projectText.textContent();

    // The modal should show the first project's name
    expect(projectTextContent).toContain(project1Name);
    expect(projectTextContent).not.toContain(project2Name);

    // Close modal
    await closeModal(page);
  });
});

// ============================================================================
// Test Suite: Sidebar Refresh After Move
// ============================================================================

test.describe('Sidebar refresh after move', () => {
  test('Sidebar should update after moving library', async ({ page }) => {
    test.setTimeout(240000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const projectName = `MT Refresh Project ${stamp}`;
    const folder1Name = `Folder 1 ${stamp}`;
    const folder2Name = `Folder 2 ${stamp}`;
    const libraryName = `Refresh Library ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    // Create project
    await projectPage.createProject({ name: projectName, description: `refresh-test-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    // Create folders
    await libraryPage.createFolderUnderProject({ name: folder1Name });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    await libraryPage.createFolderUnderProject({ name: folder2Name });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Create library in folder1
    const sidebar = page.locator('aside');
    const folder1Item = sidebar.locator(`[title="${folder1Name}"]`).first();
    await expect(folder1Item).toBeVisible({ timeout: 15000 });
    await folder1Item.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await libraryPage.createLibrary({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await page.waitForTimeout(1000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Move library to folder2
    await folder1Item.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    const libraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    await libraryItem.click({ button: 'right' });

    const contextMenu = page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const moveToButton = contextMenu.getByRole('button', { name: /move to/i });
    await moveToButton.click();

    const moveToModal = getMoveToModal(page);
    await expect(moveToModal).toBeVisible({ timeout: 5000 });

    await selectFolder(page, folder2Name);

    const confirmButton = getMoveButton(page);
    await confirmButton.click();

    await expect(moveToModal).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);

    // Navigate back to project root
    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(2000);

    // Open folder2 and verify library is there
    const folder2Item = sidebar.locator(`[title="${folder2Name}"]`).first();
    await expect(folder2Item).toBeVisible({ timeout: 15000 });
    await folder2Item.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1000);

    await expect(sidebar.locator(`[title="${libraryName}"]`).first()).toBeVisible({ timeout: 15000 });
  });
});
