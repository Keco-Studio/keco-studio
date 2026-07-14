import { test, expect } from '@playwright/test';
import path from 'node:path';
import { ProjectPage } from '../pages/project.page';
import { LoginPage } from '../pages/login.page';
import { generateProjectData } from '../fixures/projects';
import { users } from '../fixures/users';

/**
 * Document authoring E2E (Phase 1).
 *
 * Covers the Phase 1 authoring and sidebar CRUD paths. The viewer UI test
 * intercepts only the role response; real viewer write rejection is covered by
 * tests/unit/database/documents.rls.behavior.test.ts against local Postgres.
 */

test.describe('Document authoring - Phase 1', () => {
  let projectPage: ProjectPage;

  test.beforeEach(async ({ page }) => {
    projectPage = new ProjectPage(page);
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(users.seedEmpty2);
    await loginPage.expectLoginSuccess();
  });

  test('create -> edit -> image -> autosave -> reload -> viewer', async ({ page }) => {
    test.setTimeout(180000);

    const project = generateProjectData();
    const documentName = `Design Notes ${Date.now()}`;
    const bodyText = 'Autosaved world-building notes.';
    const imageAlt = `Document image ${Date.now()}`;

    await test.step('Create a project', async () => {
      await projectPage.createProject(project);
      await projectPage.expectProjectCreated();
    });

    await test.step('Create a document from the sidebar', async () => {
      const sidebar = page.locator('aside');
      const addButton = sidebar.locator(
        'button[title="Add new folder, library, or document"]'
      );
      await expect(addButton).toBeVisible({ timeout: 20000 });
      await addButton.click();

      await page.getByRole('button', { name: /create new document/i }).click();

      const nameInput = page.locator('input:visible').last();
      await nameInput.fill(documentName);
      await page.getByRole('button', { name: /^create$/i }).click();

      await page.waitForURL(/\/doc\//, { timeout: 20000 });
    });

    await test.step('Edit the document and wait for autosave', async () => {
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await editor.click();
      await editor.pressSequentially(bodyText, { delay: 10 });

      // Phase 1 persists after 1.5 seconds of idle time.
      await expect(page.getByText(/^saved /i)).toBeVisible({ timeout: 20000 });
    });

    await test.step('Upload and render an image', async () => {
      await page.getByRole('button', { name: /insert image/i }).click();
      const dialog = page.getByRole('dialog', { name: /upload an image/i });
      await expect(dialog).toBeVisible();
      await dialog.locator('input[type="file"]').setInputFiles(
        path.resolve(process.cwd(), 'src/assets/images/projectEmptyIcon_2.png')
      );
      await dialog.locator('input[name="altText"]').fill(imageAlt);
      await dialog.getByRole('button', { name: /^save$/i }).click();
      await expect(page.getByRole('img', { name: imageAlt })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(/^saved /i)).toBeVisible({ timeout: 20000 });
    });

    await test.step('Reload and confirm content persisted', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(editor).toContainText(bodyText, { timeout: 20000 });
      await expect(page.getByRole('img', { name: imageAlt })).toBeVisible({ timeout: 20000 });
    });

    await test.step('Render the same document read-only for a viewer role', async () => {
      await page.route('**/api/projects/*/role', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ role: 'viewer', isOwner: false }),
        });
      });
      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page.getByText('View only')).toBeVisible({ timeout: 30000 });
      const viewerEditor = page.locator('[contenteditable="false"]').first();
      await expect(viewerEditor).toContainText(bodyText);
      await expect(page.getByRole('button', { name: /insert image/i })).toHaveCount(0);
    });
  });

  test('create in folder -> rename -> move -> delete', async ({ page }) => {
    test.setTimeout(180000);

    const project = generateProjectData();
    const folderName = `Lore Folder ${Date.now()}`;
    const documentName = `Lore Draft ${Date.now()}`;
    const renamedDocument = `${documentName} Renamed`;
    const sidebar = page.locator('aside');

    await projectPage.createProject(project);
    await projectPage.expectProjectCreated();

    await test.step('Create a folder', async () => {
      await sidebar.locator(
        'button[title="Add new folder, library, or document"]'
      ).click();
      await page.getByRole('button', { name: /create new folder/i }).click();
      const input = page.getByPlaceholder('Enter folder name');
      await input.fill(folderName);
      await input.locator('xpath=ancestor::div[contains(@class,"modal")][1]')
        .getByRole('button', { name: /^create$/i })
        .click();
      await expect(sidebar.locator(`[title="${folderName}"]`)).toBeVisible({ timeout: 20000 });
    });

    await test.step('Create a document from the folder context menu', async () => {
      await sidebar.locator(`[title="${folderName}"]`).click({ button: 'right' });
      await page.getByRole('button', { name: /^new document$/i }).click();
      const input = page.getByPlaceholder('Enter document name');
      await input.fill(documentName);
      await input.locator('xpath=ancestor::div[contains(@class,"modal")][1]')
        .getByRole('button', { name: /^create$/i })
        .click();
      await page.waitForURL(/\/doc\//, { timeout: 20000 });
      await expect(sidebar.locator(`[title="${documentName}"]`)).toBeVisible({ timeout: 20000 });
    });

    await test.step('Rename the document', async () => {
      await sidebar.locator(`[title="${documentName}"]`).click({ button: 'right' });
      await page.getByRole('button', { name: /^rename$/i }).click();
      const renameInput = sidebar.getByRole('textbox', { name: 'Rename' });
      await renameInput.fill(renamedDocument);
      await renameInput.press('Enter');
      await expect(sidebar.locator(`[title="${renamedDocument}"]`)).toBeVisible({ timeout: 20000 });
    });

    await test.step('Move the document to the project root', async () => {
      await sidebar.locator(`[title="${renamedDocument}"]`).click({ button: 'right' });
      await page.getByRole('button', { name: /move to/i }).click();
      const dialog = page.getByRole('dialog', { name: /move document/i });
      await dialog.locator('.ant-select-selector').click();
      await page.getByText('Project root (no folder)', { exact: true }).click();
      await dialog.getByRole('button', { name: /^move$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20000 });
    });

    await test.step('Delete the document', async () => {
      await sidebar.locator(`[title="${renamedDocument}"]`).click({ button: 'right' });
      await page.getByRole('button', { name: /^delete$/i }).click();
      const dialog = page.getByRole('alertdialog', { name: /confirm deletion/i });
      await dialog.getByRole('button', { name: /^delete$/i }).click();
      await expect(sidebar.locator(`[title="${renamedDocument}"]`)).toHaveCount(0, {
        timeout: 20000,
      });
    });
  });
});
