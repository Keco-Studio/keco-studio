import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { users } from '../fixures/users';
import { generateProjectData } from '../fixures/projects';
import { generateLibraryData } from '../fixures/libraries';

async function login(page: Page): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(users.seedEmpty);
  await loginPage.expectLoginSuccess();
}

async function createBaseLibrary(page: Page): Promise<{ sourceLibraryName: string }> {
  const projectPage = new ProjectPage(page);
  const libraryPage = new LibraryPage(page);
  const project = generateProjectData();
  const library = generateLibraryData();

  await projectPage.createProject(project);
  await projectPage.expectProjectCreated();
  await libraryPage.waitForPageLoad();

  await libraryPage.createLibraryUnderProject(library);
  await libraryPage.expectLibraryCreated();

  return { sourceLibraryName: library.name };
}

async function openDuplicateLibraryModal(page: Page, libraryName: string): Promise<void> {
  const sidebarTree = page.getByRole('tree');
  const libraryItem = sidebarTree.locator(`[title="${libraryName}"]`).first();
  await expect(libraryItem).toBeVisible({ timeout: 15000 });
  await libraryItem.click({ button: 'right' });

  const contextMenu = page.locator('[class*="contextMenu"]');
  await expect(contextMenu).toBeVisible({ timeout: 5000 });
  await contextMenu.getByRole('button', { name: /^duplicate$/i }).click();

  const duplicateModal = page
    .locator('[class*="modal"]')
    .filter({ has: page.getByText('Duplicate Library') })
    .first();
  await expect(duplicateModal).toBeVisible({ timeout: 5000 });
}

test.describe('Library duplicate', () => {
  test('Duplicate full library (with data option off) should create "(Copy)" library', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await login(page);
    const { sourceLibraryName } = await createBaseLibrary(page);

    await openDuplicateLibraryModal(page, sourceLibraryName);

    // Default is checked (copy headers only). Turn it off for full duplicate.
    const copyHeadersSwitch = page.getByRole('switch').first();
    await expect(copyHeadersSwitch).toHaveAttribute('aria-checked', 'true');
    await copyHeadersSwitch.click();
    await expect(copyHeadersSwitch).toHaveAttribute('aria-checked', 'false');

    const duplicateButton = page.getByRole('button', { name: /^duplicate$/i });
    await expect(duplicateButton).toBeVisible({ timeout: 5000 });
    await duplicateButton.click();

    const copiedLibraryName = `${sourceLibraryName} (Copy)`;
    await expect(page.getByRole('tree').locator(`[title="${copiedLibraryName}"]`).first()).toBeVisible({
      timeout: 30000,
    });
  });

  test('Copy headers only should create "(Copy headers)" library', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    const { sourceLibraryName } = await createBaseLibrary(page);

    await openDuplicateLibraryModal(page, sourceLibraryName);

    const copyHeadersSwitch = page.getByRole('switch').first();
    await expect(copyHeadersSwitch).toHaveAttribute('aria-checked', 'true');

    const duplicateButton = page.getByRole('button', { name: /^duplicate$/i });
    await expect(duplicateButton).toBeVisible({ timeout: 5000 });
    await duplicateButton.click();

    const copiedHeadersLibraryName = `${sourceLibraryName} (Copy headers)`;
    await expect(
      page.getByRole('tree').locator(`[title="${copiedHeadersLibraryName}"]`).first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test('Cancel duplicate should close modal without creating a new library', async ({ page }) => {
    test.setTimeout(120000);

    await login(page);
    const { sourceLibraryName } = await createBaseLibrary(page);

    await openDuplicateLibraryModal(page, sourceLibraryName);

    const duplicateModal = page
      .locator('[class*="modal"]')
      .filter({ has: page.getByText('Duplicate Library') })
      .first();
    await expect(duplicateModal).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(duplicateModal).not.toBeVisible({ timeout: 10000 });

    await expect(
      page.getByRole('tree').locator(`[title="${sourceLibraryName} (Copy)"]`).first(),
    ).toHaveCount(0);
    await expect(
      page.getByRole('tree').locator(`[title="${sourceLibraryName} (Copy headers)"]`).first(),
    ).toHaveCount(0);
  });
});

