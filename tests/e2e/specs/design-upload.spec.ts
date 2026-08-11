import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import {
  addProjectCollaborator,
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

const TEN_MB = 10 * 1024 * 1024;

test.describe('Design document upload', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let editor: TemporaryUser;
  let viewer: TemporaryUser;
  let projectId: string;

  async function login(page: Page, user: TemporaryUser): Promise<void> {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(user);
    await loginPage.expectLoginSuccess();
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'design-upload-owner');
    editor = await createTemporaryUser(admin, 'design-upload-editor');
    viewer = await createTemporaryUser(admin, 'design-upload-viewer');
    projectId = await createProjectFixture(admin, owner.id);
    await addProjectCollaborator(admin, projectId, editor.id, 'editor', owner.id);
    await addProjectCollaborator(admin, projectId, viewer.id, 'viewer', owner.id);
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (viewer) await deleteTemporaryUser(admin, viewer);
    if (editor) await deleteTemporaryUser(admin, editor);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('rejects unsupported, legacy, empty, and oversized files', async ({ page }) => {
    await login(page, owner);
    await page.goto(`/${projectId}/design-upload`);
    const fileInput = page.getByTestId('design-upload-file-input');

    await fileInput.setInputFiles({ name: 'design.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
    await expect(page.getByText('Unsupported file type. Only .txt, .md, and .docx are allowed.')).toBeVisible();

    await fileInput.setInputFiles({ name: 'legacy.doc', mimeType: 'application/msword', buffer: Buffer.from('x') });
    await expect(page.getByText('Legacy .doc is not supported. Please convert it to .docx or .txt.')).toBeVisible();

    await fileInput.setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
    await expect(page.getByText('The file is empty.')).toBeVisible();

    await fileInput.setInputFiles({
      name: 'oversized.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(TEN_MB + 1, 'x'),
    });
    await expect(page.getByText('The file is too large (limit is 10MB).')).toBeVisible();
    await expect(page.getByTestId('design-upload-selected-file')).toHaveCount(0);
  });

  test('warns when a valid document exceeds the soft size threshold', async ({ page }) => {
    await login(page, owner);
    await page.goto(`/${projectId}/design-upload`);
    await page.getByTestId('design-upload-file-input').setInputFiles({
      name: 'long-design.md',
      mimeType: 'text/markdown',
      buffer: Buffer.alloc(101 * 1024, 'a'),
    });

    await expect(page.getByTestId('design-upload-selected-file')).toContainText('long-design.md');
    await expect(page.getByTestId('design-upload-large-warning')).toBeVisible();
  });

  test('allows editors to select a design document', async ({ page }) => {
    await login(page, editor);
    await page.goto(`/${projectId}/design-upload`);

    await expect(page.getByTestId('design-upload-permission-warning')).toHaveCount(0);
    await expect(page.getByTestId('design-upload-file-input')).toBeEnabled();
    await page.getByTestId('design-upload-file-input').setInputFiles({
      name: 'editor-design.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Editor design'),
    });
    await expect(page.getByTestId('design-upload-submit')).toBeEnabled();
  });

  test('keeps viewer submission disabled', async ({ page }) => {
    await login(page, viewer);
    await page.goto(`/${projectId}/design-upload`);

    await expect(page.getByText('requires editor or admin permission')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('design-upload-file-input')).toBeDisabled();
    await expect(page.getByTestId('design-upload-submit')).toBeDisabled();
  });

  test('hands a valid text design back to the project', async ({ page }) => {
    await login(page, owner);
    await page.goto(`/${projectId}/design-upload`);
    // Submit stays disabled until a file is chosen and the project role has loaded.
    await expect(page.getByTestId('design-upload-file-input')).toBeEnabled({ timeout: 20000 });
    await page.getByTestId('design-upload-file-input').setInputFiles({
      name: 'combat-design.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Combat system\nDamage = attack - defense'),
    });
    await page.getByLabel('Additional instructions (optional)').fill('Create combat tables only.');
    await expect(page.getByTestId('design-upload-submit')).toBeEnabled({ timeout: 20000 });
    await page.getByTestId('design-upload-submit').click();

    await expect(page).toHaveURL(new RegExp(`/${projectId}(/recent)?$`), { timeout: 20000 });
  });
});
