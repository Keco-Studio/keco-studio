import { expect, test, type Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { users } from '../fixures/users';

async function createChildFolder(page: Page, parentName: string, childName: string) {
  const parentPath = new URL(page.url()).pathname;
  const tree = page.getByRole('tree');
  const parentItem = tree
    .getByRole('treeitem')
    .filter({ has: page.locator(`[title="${parentName}"]`) })
    .first();
  await expect(parentItem).toBeVisible({ timeout: 15_000 });
  await parentItem.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Create new folder' }).click();

  const input = page.getByPlaceholder('Enter folder name');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(childName);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(input).not.toBeVisible({ timeout: 15_000 });
  await expect(tree.locator(`[title="${childName}"]`).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForURL(
    (url) => url.pathname !== parentPath && /\/folder\/[^/]+$/.test(url.pathname),
    { timeout: 15_000 }
  );
}

test.describe('nested folder creation', () => {
  test('creates and persists child folders from folder actions', async ({ page }) => {
    test.setTimeout(180_000);

    const login = new LoginPage(page);
    await login.goto();
    await login.login(users.seedEmpty);
    await login.expectLoginSuccess();

    const stamp = Date.now();
    const projectName = `Nested folders ${stamp}`;
    const rootName = `World ${stamp}`;
    const childName = `Region ${stamp}`;
    const grandchildName = `Town ${stamp}`;
    const project = new ProjectPage(page);
    const library = new LibraryPage(page);

    await project.createProject({ name: projectName, description: 'Nested folder E2E' });
    await project.expectProjectCreated();
    await library.waitForPageLoad();
    await library.createFolderUnderProject({ name: rootName });

    await createChildFolder(page, rootName, childName);
    await createChildFolder(page, childName, grandchildName);

    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => {});

    const tree = page.getByRole('tree');
    const rootItem = tree
      .getByRole('treeitem')
      .filter({ has: page.locator(`[title="${rootName}"]`) })
      .first();
    const childItem = tree
      .getByRole('treeitem')
      .filter({ has: page.locator(`[title="${childName}"]`) })
      .first();
    const grandchildItem = tree
      .getByRole('treeitem')
      .filter({ has: page.locator(`[title="${grandchildName}"]`) })
      .first();
    await expect(rootItem).toBeVisible({ timeout: 15_000 });
    await expect(childItem).toBeVisible({ timeout: 15_000 });
    await expect(grandchildItem).toBeVisible({ timeout: 15_000 });

    const grandchildPath = new URL(page.url()).pathname;
    await rootItem.locator(`[title="${rootName}"]`).click();
    await page.waitForURL(
      (url) => url.pathname !== grandchildPath && /\/folder\/[^/]+$/.test(url.pathname),
      { timeout: 15_000 }
    );

    const rootPath = new URL(page.url()).pathname;
    await grandchildItem.locator(`[title="${grandchildName}"]`).click();
    await page.waitForURL(
      (url) => url.pathname !== rootPath && /\/folder\/[^/]+$/.test(url.pathname),
      { timeout: 15_000 }
    );
    await expect(page.getByText('Loading folder...', { exact: true })).not.toBeVisible({
      timeout: 15_000,
    });
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('button', { name: rootName, exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(banner.getByRole('button', { name: childName, exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(banner.getByRole('button', { name: grandchildName, exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
