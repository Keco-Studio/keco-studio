import { test, expect, type Locator, type Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { users } from '../fixures/users';
import { generateProjectData } from '../fixures/projects';
import { generateLibraryData } from '../fixures/libraries';
import { generateFolderData } from '../fixures/folders';

async function openFirstColumnEditModal(page: Page): Promise<Locator> {
  const firstPropertyHeaderCell = page
    .locator('thead tr')
    .last()
    .locator('th[class*="propertyHeaderCell"]')
    .first();
  await expect(firstPropertyHeaderCell).toBeVisible({ timeout: 15000 });

  const headerContent = firstPropertyHeaderCell.locator('[class*="propertyHeaderContent"]');
  await expect(headerContent).toBeVisible({ timeout: 10000 });
  await headerContent.click({ button: 'right' });

  const optionMenu = page
    .locator('div[class*="headerContextMenu"]')
    .filter({ has: page.getByRole('button', { name: /edit column/i }) })
    .first();
  await expect(optionMenu).toBeVisible({ timeout: 5000 });
  await optionMenu.getByRole('button', { name: /edit column/i }).click();

  const editModal = page
    .locator('[class*="popup"]')
    .filter({ has: page.getByRole('heading', { name: /edit column/i }) })
    .first();
  await expect(editModal).toBeVisible({ timeout: 5000 });
  return editModal;
}

async function saveEditColumnModal(page: Page, modal: Locator): Promise<void> {
  await modal.getByRole('button', { name: /^save$/i }).click();

  const overwriteButton = page.getByRole('button', { name: /^overwrite$/i });
  if (await overwriteButton.isVisible({ timeout: 1200 }).catch(() => false)) {
    await overwriteButton.click();
  }

  await expect(modal).not.toBeVisible({ timeout: 10000 });
}

async function openAddColumnModal(page: Page): Promise<Locator> {
  const addColumnButton = page.getByRole('button', { name: /add new column/i });
  await expect(addColumnButton).toBeVisible({ timeout: 15000 });
  await addColumnButton.click();

  const addModal = page
    .locator('[class*="popup"]')
    .filter({ has: page.getByRole('heading', { name: /add column/i }) })
    .first();
  await expect(addModal).toBeVisible({ timeout: 5000 });
  return addModal;
}

async function loginAsSeedEmpty(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(users.seedEmpty);
  await loginPage.expectLoginSuccess();
}

async function createAndOpenLibrary(page: Page): Promise<{
  projectName: string;
  libraryName: string;
}> {
  const projectPage = new ProjectPage(page);
  const libraryPage = new LibraryPage(page);

  const project = generateProjectData();
  const library = generateLibraryData();

  await projectPage.createProject(project);
  await projectPage.expectProjectCreated();
  await libraryPage.waitForPageLoad();

  await libraryPage.createLibraryUnderProject(library);
  await libraryPage.expectLibraryCreated();
  // Avoid clicking disabled breadcrumb button with same text in TopBar.
  // Open library strictly from sidebar tree item.
  const sidebarTree = page.getByRole('tree');
  const sidebarLibraryItem = sidebarTree.locator(`[title="${library.name}"]`).first();
  await expect(sidebarLibraryItem).toBeVisible({ timeout: 15000 });
  await sidebarLibraryItem.click();
  await libraryPage.waitForPageLoad();

  return { projectName: project.name, libraryName: library.name };
}

test.describe('Column operations and double-click rename', () => {
  test('Add column validation - header name is required', async ({ page }) => {
    test.setTimeout(120000);

    await loginAsSeedEmpty(page);
    await createAndOpenLibrary(page);

    const addModal = await openAddColumnModal(page);
    await addModal.getByRole('button', { name: /^add$/i }).click();

    await expect(addModal).toBeVisible({ timeout: 5000 });
    await expect(addModal.getByText('Header name is required.')).toBeVisible({ timeout: 5000 });
  });

  test('Add column validation - data type is required', async ({ page }) => {
    test.setTimeout(120000);

    await loginAsSeedEmpty(page);
    await createAndOpenLibrary(page);

    const addModal = await openAddColumnModal(page);
    await addModal.locator('#add-column-name').fill(`Auto Header ${Date.now()}`);
    await addModal.getByRole('button', { name: /^add$/i }).click();

    await expect(addModal).toBeVisible({ timeout: 5000 });
    await expect(addModal.getByText('Data type is required.')).toBeVisible({ timeout: 5000 });
  });

  test('Add column popup closes by outside click when unchanged', async ({ page }) => {
    test.setTimeout(120000);

    await loginAsSeedEmpty(page);
    await createAndOpenLibrary(page);

    const addModal = await openAddColumnModal(page);

    // Unchanged popup should close directly when clicking outside, without discard confirm.
    await page.mouse.click(8, 8);

    await expect(addModal).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText('Are you sure you want to discard the changes?'),
    ).not.toBeVisible({ timeout: 2000 });
  });

  test('Column comment - edit, tooltip display, and clear', async ({ page }) => {
    test.setTimeout(120000);

    await loginAsSeedEmpty(page);
    await createAndOpenLibrary(page);

    const commentText = `Auto comment ${Date.now()}`;
    const firstPropertyHeaderCell = page
      .locator('thead tr')
      .last()
      .locator('th[class*="propertyHeaderCell"]')
      .first();

    // Add description via Edit column modal.
    const editModal = await openFirstColumnEditModal(page);
    const descriptionInput = editModal.locator('#edit-column-desc');
    await expect(descriptionInput).toBeVisible({ timeout: 5000 });
    await descriptionInput.fill(commentText);
    await saveEditColumnModal(page, editModal);

    // Description icon should appear and tooltip should show exact comment.
    const descriptionIcon = firstPropertyHeaderCell.locator('img[src*="descriptionIcon"]').first();
    await expect(descriptionIcon).toBeVisible({ timeout: 10000 });
    await descriptionIcon.hover();
    await expect(page.locator('.ant-tooltip-inner').filter({ hasText: commentText })).toBeVisible({
      timeout: 5000,
    });

    // Clear description and verify icon disappears.
    const editModalAgain = await openFirstColumnEditModal(page);
    const descriptionInputAgain = editModalAgain.locator('#edit-column-desc');
    await expect(descriptionInputAgain).toBeVisible({ timeout: 5000 });
    await descriptionInputAgain.fill('');
    await saveEditColumnModal(page, editModalAgain);
    await expect(firstPropertyHeaderCell.locator('img[src*="descriptionIcon"]')).toHaveCount(0, {
      timeout: 10000,
    });
  });

  test('Column comment length > 250 shows error toast', async ({ page }) => {
    test.setTimeout(120000);

    await loginAsSeedEmpty(page);
    await createAndOpenLibrary(page);

    const editModal = await openFirstColumnEditModal(page);
    const descriptionInput = editModal.locator('#edit-column-desc');
    await expect(descriptionInput).toBeVisible({ timeout: 5000 });

    await descriptionInput.fill('a'.repeat(251));
    await expect(page.getByText('Comment cannot exceed 250 characters.')).toBeVisible({
      timeout: 5000,
    });

    const currentValue = await descriptionInput.inputValue();
    expect(currentValue.length).toBeLessThanOrEqual(250);
  });

  test('Double-click rename works for project, library, and folder', async ({ page }) => {
    test.setTimeout(180000);

    await loginAsSeedEmpty(page);

    const projectPage = new ProjectPage(page);
    const libraryPage = new LibraryPage(page);

    const project = generateProjectData();
    const library = generateLibraryData();
    const folder = generateFolderData();

    await projectPage.createProject(project);
    await projectPage.expectProjectCreated();
    await libraryPage.waitForPageLoad();

    await libraryPage.createLibraryUnderProject(library);
    await libraryPage.expectLibraryCreated();

    await libraryPage.createFolderUnderProject(folder);
    await libraryPage.expectFolderCreated();

    // Project rename by double click.
    const newProjectName = `${project.name} edited`;
    const projectTitle = page
      .locator('aside [class*="projectsListContainer"]')
      .locator(`[title="${project.name}"]`)
      .first();
    await expect(projectTitle).toBeVisible({ timeout: 15000 });
    await projectTitle.dblclick({ force: true });

    const projectRenameInput = page
      .locator('aside [class*="projectsListContainer"] input[class*="renameInput"]')
      .first();
    await expect(projectRenameInput).toBeVisible({ timeout: 10000 });
    await projectRenameInput.fill(newProjectName);
    await projectRenameInput.press('Enter');
    await expect(
      page
        .locator('aside [class*="projectsListContainer"]')
        .locator(`[title="${newProjectName}"]`)
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // Library rename by double click.
    const newLibraryName = `${library.name} edited`;
    const libraryTitle = page.getByRole('tree').locator(`[title="${library.name}"]`).first();
    await expect(libraryTitle).toBeVisible({ timeout: 15000 });
    await libraryTitle.dblclick({ force: true });

    const libraryRenameInput = page.getByRole('tree').locator('input[class*="renameInput"]').first();
    await expect(libraryRenameInput).toBeVisible({ timeout: 5000 });
    await libraryRenameInput.fill(newLibraryName);
    await libraryRenameInput.press('Enter');
    await expect(page.getByRole('tree').locator(`[title="${newLibraryName}"]`).first()).toBeVisible({
      timeout: 15000,
    });

    // Folder rename by double click.
    const newFolderName = `${folder.name} edited`;
    const folderTitle = page.getByRole('tree').locator(`[title="${folder.name}"]`).first();
    await expect(folderTitle).toBeVisible({ timeout: 15000 });
    await folderTitle.dblclick({ force: true });

    const folderRenameInput = page.getByRole('tree').locator('input[class*="renameInput"]').first();
    await expect(folderRenameInput).toBeVisible({ timeout: 5000 });
    await folderRenameInput.fill(newFolderName);
    await folderRenameInput.press('Enter');
    await expect(page.getByRole('tree').locator(`[title="${newFolderName}"]`).first()).toBeVisible({
      timeout: 15000,
    });
  });
});

