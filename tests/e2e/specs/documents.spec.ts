import { test, expect } from '@playwright/test';
import { ProjectPage } from '../pages/project.page';
import { LoginPage } from '../pages/login.page';
import { generateProjectData } from '../fixures/projects';
import { users } from '../fixures/users';

/**
 * Document authoring E2E (Phase 1).
 *
 * Covers the acceptance path: create a document from the sidebar, edit it in the
 * MDXEditor, let it autosave, reload, and confirm the content persisted.
 *
 * Viewer read-only enforcement is proven at the database level by the RLS
 * behavior test (tests/unit/database/documents.rls.behavior.test.ts); the UI
 * viewer gating is covered separately and is skipped here because it needs a
 * seeded viewer collaborator on the project.
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

  test('create -> edit -> autosave -> reload keeps content', async ({ page }) => {
    test.setTimeout(120000);

    const project = generateProjectData();
    const documentName = `Design Notes ${Date.now()}`;
    const bodyText = 'Autosaved world-building notes.';

    await test.step('Create a project', async () => {
      await projectPage.createProject(project);
      await projectPage.expectProjectCreated();
    });

    await test.step('Create a document from the sidebar', async () => {
      const sidebar = page.locator('aside');
      const addButton = sidebar.getByRole('button', {
        name: /add new folder, library, or document/i,
      });
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

      // Collab persist (~1.5s idle) then a "Saved" indicator appears.
      await expect(page.getByText(/^saved /i)).toBeVisible({ timeout: 20000 });
    });

    await test.step('Reload and confirm content persisted', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expect(editor).toContainText(bodyText, { timeout: 20000 });
    });
  });

  // Requires a project shared with a seeded viewer collaborator. The database
  // read-only guarantee is covered by the documents RLS behavior test.
  test.skip('viewer opens a document read-only', async () => {});
});
