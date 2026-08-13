import { test, expect } from '@playwright/test';
import path from 'node:path';
import { ProjectPage } from '../pages/project.page';
import { LoginPage } from '../pages/login.page';
import { generateProjectData } from '../fixures/projects';
import { users } from '../fixures/users';
import { expectDocumentLive } from '../utils/document-assertions';

/**
 * Document authoring E2E.
 *
 * Covers the Phase 1 authoring and sidebar CRUD paths. The viewer UI test
 * intercepts only the role response; real viewer write rejection is covered by
 * tests/unit/database/documents.rls.behavior.test.ts against local Postgres.
 */

test.describe('Document authoring', () => {
  let projectPage: ProjectPage;

  test.beforeEach(async ({ page }) => {
    projectPage = new ProjectPage(page);
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(users.seedEmpty2);
    await loginPage.expectLoginSuccess();
  });

  test('create -> edit -> link -> image -> autosave -> reload -> viewer', async ({ page }) => {
    test.setTimeout(180000);

    const project = generateProjectData();
    const documentName = `Design Notes ${Date.now()}`;
    const bodyText = 'Autosaved world-building notes.';
    const linkText = 'world-building';
    const linkUrl = 'example.com';
    const openedLinkUrl = 'https://example.com/';

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

      await page.getByRole('menuitem', { name: /create new document/i }).click();

      const nameInput = page.locator('input:visible').last();
      await nameInput.fill(documentName);
      await page.getByRole('dialog').getByRole('button', { name: /^create$/i }).click();

      await page.waitForURL(/\/doc\//, { timeout: 20000 });
    });

    await test.step('Edit the document and wait for autosave', async () => {
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30000 });
      const durableAppend = page.waitForResponse(
        (response) =>
          response.url().includes('/rpc/append_document_yjs_updates') &&
          response.ok()
      );
      await editor.click();
      await editor.pressSequentially(bodyText, { delay: 10 });

      await durableAppend;
      await expectDocumentLive(page);
    });

    await test.step('Turn selected text into a link and open it on double click', async () => {
      const editor = page.locator('[contenteditable="true"]').first();
      await editor.evaluate((element, selectedText) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const start = node.textContent?.indexOf(selectedText) ?? -1;
          if (start >= 0) {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + selectedText.length);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            document.dispatchEvent(new Event('selectionchange'));
            return;
          }
          node = walker.nextNode();
        }
        throw new Error(`Could not select text: ${selectedText}`);
      }, linkText);

      const createLinkButton = page.getByRole('button', {
        name: 'Create link from selected text',
      });
      await expect(createLinkButton).toBeEnabled();
      await createLinkButton.click();
      await expect(page.locator('input[name="url"]')).toHaveValue('');
      await page.locator('input[name="url"]').fill(linkUrl);
      await expect(page.locator('input[name="title"]')).toHaveCount(0);
      await expect(page.locator('input[name="text"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Set URL' }).click();

      const link = editor.getByRole('link', { name: linkText });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', openedLinkUrl);
      await link.click();
      await page.getByRole('button', { name: 'Edit link URL' }).click();
      await expect(page.locator('input[name="url"]')).toHaveValue(openedLinkUrl);
      await expect(page.locator('input[name="text"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Cancel change' }).click();

      const popupPromise = page.waitForEvent('popup');
      await link.dblclick();
      const popup = await popupPromise;
      expect(popup.url()).toBe(openedLinkUrl);
      await popup.close();
    });

    await test.step('Upload and render an image', async () => {
      const durableAppend = page.waitForResponse(
        (response) =>
          response.url().includes('/rpc/append_document_yjs_updates') &&
          response.ok()
      );
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /^insert image$/i }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(
        path.resolve(process.cwd(), 'src/assets/images/projectEmptyIcon_2.png')
      );
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor.locator('img')).toBeVisible({ timeout: 20000 });
      await durableAppend;
      await expectDocumentLive(page);
    });

    await test.step('Reload and confirm content persisted', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(editor).toContainText(bodyText, { timeout: 20000 });
      await expect(editor.getByRole('link', { name: linkText })).toHaveAttribute(
        'href',
        openedLinkUrl
      );
      await expect(editor.locator('img')).toBeVisible({ timeout: 20000 });
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

      await expectDocumentLive(page, 'View only - Live', 30_000);
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
      await page.getByRole('menuitem', { name: /create new folder/i }).click();
      const input = page.getByPlaceholder('Enter folder name');
      await input.fill(folderName);
      await input.locator('xpath=ancestor::div[contains(@class,"modal")][1]')
        .getByRole('button', { name: /^create$/i })
        .click();
      await expect(sidebar.locator(`[title="${folderName}"]`)).toBeVisible({ timeout: 20000 });
    });

    await test.step('Create a document from the folder plus menu', async () => {
      const folderRow = sidebar.locator(`[title="${folderName}"]`).locator('xpath=ancestor::div[contains(@class,"ant-tree-treenode")][1]');
      await folderRow.hover();
      await folderRow.getByRole('button', { name: 'Folder actions' }).click();
      await page.getByRole('menuitem', { name: /create new document/i }).click();
      const input = page.getByPlaceholder('Enter document name');
      await input.fill(documentName);
      await input.locator('xpath=ancestor::div[contains(@class,"modal")][1]')
        .getByRole('button', { name: /^create$/i })
        .click();
      await page.waitForURL(/\/doc\//, { timeout: 20000 });
      await expect(sidebar.locator(`[title="${documentName}"]`)).toBeVisible({ timeout: 20000 });
    });

    await test.step('Edit document info from context menu', async () => {
      await sidebar.locator(`[title="${documentName}"]`).click({ button: 'right' });
      await page.getByRole('button', { name: /^library info$/i }).click();
      const dialog = page.getByTestId('edit-document-modal');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      const nameInput = dialog.locator('#document-edit-name');
      await expect(nameInput).toBeVisible({ timeout: 20000 });
      await nameInput.fill(renamedDocument);
      await dialog.getByRole('button', { name: /^save$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20000 });
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
