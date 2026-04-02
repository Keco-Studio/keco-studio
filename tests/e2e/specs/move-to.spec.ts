import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { users } from '../fixures/users';

/**
 * Move library (Move to…) — E2E coverage for product scenarios 1, 2, 5, 6.
 *
 * 1 — Move library to a sibling folder under the same project
 * 2 — Move library out of a folder to become an independent library (project root)
 * 5 — Already an independent library: turning “independent” on cannot complete a move
 * 6 — Cross-project move is not offered (only current project folders in the modal)
 */

// ============================================================================
// Helpers
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

async function selectFolderInMoveModal(page: Page, folderName: string): Promise<void> {
  const folderButton = page
    .locator('[class*="moveToFolderItem"]')
    .filter({ hasText: folderName })
    .first();
  await expect(folderButton).toBeVisible({ timeout: 5000 });
  await folderButton.click();
}

/**
 * The sidebar renders the whole tree; a moved library stays visible under its new parent.
 * Only assert it is not nested under the given folder’s tree branch.
 */
async function expectLibraryNotUnderFolderInTree(
  sidebar: ReturnType<Page['locator']>,
  folderTitle: string,
  libraryTitle: string,
): Promise<void> {
  const folderBranch = sidebar
    .getByRole('treeitem')
    .filter({ has: sidebar.locator(`[title="${folderTitle}"]`) })
    .first();
  await expect(folderBranch.locator(`[title="${libraryTitle}"]`)).toHaveCount(0);
}

async function toggleIndependentLibrarySwitch(page: Page): Promise<void> {
  const modal = getMoveToModal(page);
  const switchEl = modal.getByRole('switch', { name: /independent library/i });
  await expect(switchEl).toBeVisible({ timeout: 5000 });
  await switchEl.click();
  await page.waitForTimeout(300);
}

async function closeMoveModal(page: Page): Promise<void> {
  const cancelButton = getCancelButton(page);
  if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cancelButton.click();
  }
  await expect(getMoveToModal(page)).not.toBeVisible({ timeout: 5000 });
}

async function openLibraryMoveToModal(page: Page, libraryName: string): Promise<void> {
  const sidebar = page.locator('aside');
  const libraryItem = sidebar.locator(`[title="${libraryName}"]`).first();
  await expect(libraryItem).toBeVisible({ timeout: 15000 });
  await libraryItem.click({ button: 'right' });
  const contextMenu = page.locator('[class*="contextMenu"]');
  await expect(contextMenu).toBeVisible({ timeout: 5000 });
  await contextMenu.getByRole('button', { name: /move to/i }).click();
  await expect(getMoveToModal(page)).toBeVisible({ timeout: 5000 });
}

// ============================================================================
// Case 1 — Move library to a sibling folder
// ============================================================================

test.describe('Move to: Case 1 — library to sibling folder', () => {
  test('library moves from source folder to target folder; sidebar updates', async ({ page }) => {
    test.setTimeout(240000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const projectName = `MT P1 ${stamp}`;
    const sourceFolderName = `MT Src ${stamp}`;
    const targetFolderName = `MT Tgt ${stamp}`;
    const libraryName = `MT Lib ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    await projectPage.createProject({ name: projectName, description: `mt1-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createFolderUnderProject({ name: sourceFolderName });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    await libraryPage.createFolderUnderProject({ name: targetFolderName });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    const sidebar = page.locator('aside');
    const sourceFolder = sidebar.locator(`[title="${sourceFolderName}"]`).first();
    await expect(sourceFolder).toBeVisible({ timeout: 15000 });
    await sourceFolder.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);

    await libraryPage.createLibrary({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await page.waitForTimeout(800);

    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    await sourceFolder.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);

    await openLibraryMoveToModal(page, libraryName);
    await selectFolderInMoveModal(page, targetFolderName);

    const moveBtn = getMoveButton(page);
    await expect(moveBtn).toBeEnabled({ timeout: 5000 });
    await moveBtn.click();

    await expect(getMoveToModal(page)).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    // Library no longer nested under source folder (it remains visible elsewhere in the tree)
    await sourceFolder.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);
    await expectLibraryNotUnderFolderInTree(sidebar, sourceFolderName, libraryName);

    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1000);

    const targetFolder = sidebar.locator(`[title="${targetFolderName}"]`).first();
    await expect(targetFolder).toBeVisible({ timeout: 15000 });
    await targetFolder.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);

    await expect(sidebar.locator(`[title="${libraryName}"]`).first()).toBeVisible({ timeout: 15000 });
  });
});

// ============================================================================
// Case 2 — Move library out of folder to independent (project root)
// ============================================================================

test.describe('Move to: Case 2 — library out of folder as independent', () => {
  test('library appears at project root and not under original folder', async ({ page }) => {
    test.setTimeout(240000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const projectName = `MT P2 ${stamp}`;
    const folderName = `MT F ${stamp}`;
    const libraryName = `MT Ind ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    await projectPage.createProject({ name: projectName, description: `mt2-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createFolderUnderProject({ name: folderName });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    const sidebar = page.locator('aside');
    const folderItem = sidebar.locator(`[title="${folderName}"]`).first();
    await expect(folderItem).toBeVisible({ timeout: 15000 });
    await folderItem.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);

    await libraryPage.createLibrary({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await page.waitForTimeout(800);

    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    await folderItem.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);

    await openLibraryMoveToModal(page, libraryName);
    await toggleIndependentLibrarySwitch(page);

    const moveBtn = getMoveButton(page);
    await expect(moveBtn).toBeEnabled({ timeout: 5000 });
    await moveBtn.click();

    await expect(getMoveToModal(page)).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    await expect(sidebar.locator(`[title="${libraryName}"]`).first()).toBeVisible({ timeout: 15000 });

    await folderItem.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);
    await expectLibraryNotUnderFolderInTree(sidebar, folderName, libraryName);
  });
});

// ============================================================================
// Case 5 — Already independent: cannot move with “independent” switch on
// ============================================================================

test.describe('Move to: Case 5 — already independent library', () => {
  test('Move stays disabled when independent switch is on (no folder parent)', async ({ page }) => {
    test.setTimeout(180000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const projectName = `MT P5 ${stamp}`;
    const libraryName = `MT Root ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    await projectPage.createProject({ name: projectName, description: `mt5-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createLibraryUnderProject({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    await openLibraryMoveToModal(page, libraryName);

    await toggleIndependentLibrarySwitch(page);

    const moveBtn = getMoveButton(page);
    await expect(moveBtn).toBeDisabled({ timeout: 5000 });

    await closeMoveModal(page);
  });
});

// ============================================================================
// Case 6 — No cross-project targets
// ============================================================================

test.describe('Move to: Case 6 — cross-project move not allowed', () => {
  test('modal only lists folders from the current project', async ({ page }) => {
    test.setTimeout(240000);

    await loginAsSeedEmpty(page);

    const stamp = Date.now();
    const project1Name = `MT A ${stamp}`;
    const project2Name = `MT B ${stamp}`;
    const folderP1Name = `MT F1 ${stamp}`;
    const folderP2Name = `MT F2 ${stamp}`;
    const libraryName = `MT X ${stamp}`;

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    await projectPage.createProject({ name: project1Name, description: `mt6a-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createFolderUnderProject({ name: folderP1Name });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    const sidebar = page.locator('aside');
    const folderP1 = sidebar.locator(`[title="${folderP1Name}"]`).first();
    await expect(folderP1).toBeVisible({ timeout: 15000 });
    await folderP1.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);

    await libraryPage.createLibrary({ name: libraryName });
    await libraryPage.expectLibraryCreated();
    await page.waitForTimeout(800);

    await libraryPage.navigateBackToProject();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1000);

    await projectPage.createProject({ name: project2Name, description: `mt6b-${stamp}` });
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createFolderUnderProject({ name: folderP2Name });
    await libraryPage.expectFolderCreated();
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    await projectPage.openProject(project1Name);
    await libraryPage.waitForPageLoad();
    await page.waitForTimeout(1500);

    await folderP1.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(800);

    await openLibraryMoveToModal(page, libraryName);

    const projectText = page.locator('[class*="moveToProjectText"]');
    await expect(projectText).toBeVisible({ timeout: 5000 });
    await expect(projectText).toContainText(project1Name);

    await expect(
      page.locator('[class*="moveToFolderItem"]').filter({ hasText: folderP1Name }).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('[class*="moveToFolderItem"]').filter({ hasText: folderP2Name }),
    ).toHaveCount(0);

    await closeMoveModal(page);
  });
});
