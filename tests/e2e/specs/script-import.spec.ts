import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import {
  createFolderFixture,
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

const SCRIPT = 'Guide: Welcome to the city.\nHero: I am ready.\n';

test.describe('Script import', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;
  let folder: { id: string; name: string };

  async function login(page: Page): Promise<void> {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(owner);
    await loginPage.expectLoginSuccess();
  }

  async function openImport(page: Page): Promise<void> {
    await login(page);
    await page.goto(`/${projectId}`);
    const folderRow = page.locator('aside').locator(`[title="${folder.name}"]`).first();
    await expect(folderRow).toBeVisible({ timeout: 30000 });
    await folderRow.click({ button: 'right' });
    await page.getByRole('button', { name: 'Import script', exact: true }).click();
    await expect(page.getByTestId('import-script-modal')).toBeVisible();
  }

  async function expectImportedLibrary(name: string): Promise<void> {
    const { data: library, error } = await admin
      .from('libraries')
      .select('id')
      .eq('project_id', projectId)
      .eq('folder_id', folder.id)
      .eq('name', name)
      .single();
    if (error || !library) throw error ?? new Error('Imported script library not found');

    const [{ data: fields }, { data: assets }] = await Promise.all([
      admin
        .from('library_field_definitions')
        .select('label, data_type')
        .eq('library_id', library.id)
        .order('order_index'),
      admin
        .from('library_assets')
        .select('name, row_index')
        .eq('library_id', library.id)
        .order('row_index'),
    ]);
    expect(fields?.every((field) => field.data_type === 'string')).toBe(true);
    expect(fields?.map((field) => field.label)).toEqual(
      expect.arrayContaining(['Label', 'Name', 'Content'])
    );
    expect(assets).toHaveLength(2);
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'script-import-owner');
    projectId = await createProjectFixture(admin, owner.id);
    folder = await createFolderFixture(admin, projectId, 'Script import');
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('previews and imports a script file', async ({ page }) => {
    await openImport(page);
    const libraryName = `File script ${Date.now()}`;
    await page.getByTestId('import-script-name').fill(libraryName);
    await page.getByTestId('import-script-file').setInputFiles({
      name: 'story.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(SCRIPT),
    });

    await expect(page.getByTestId('import-script-preview')).toContainText('2 lines');
    await expect(page.getByTestId('import-script-preview')).toContainText('2 dialogues');
    await page.getByTestId('import-script-submit').click();
    await expect(page.getByText('Script imported (2 rows)', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expectImportedLibrary(libraryName);
  });

  test('previews and imports pasted script text', async ({ page }) => {
    await openImport(page);
    const libraryName = `Text script ${Date.now()}`;
    await page.getByTestId('import-script-name').fill(libraryName);
    await page.getByTestId('import-script-text-mode').click();
    await page.getByTestId('import-script-text').fill(SCRIPT);

    await expect(page.getByTestId('import-script-preview')).toContainText('2 lines');
    await page.getByTestId('import-script-submit').click();
    await expect(page.getByText('Script imported (2 rows)', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expectImportedLibrary(libraryName);
  });

  test('keeps file and text previews isolated when switching modes', async ({ page }) => {
    await openImport(page);
    await page.getByTestId('import-script-file').setInputFiles({
      name: 'story.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(SCRIPT),
    });
    await expect(page.getByTestId('import-script-preview')).toContainText('2 lines');

    await page.getByTestId('import-script-text-mode').click();
    await expect(page.getByTestId('import-script-preview')).toHaveCount(0);
    await page.getByTestId('import-script-text').fill('Narrator: A different scene.');
    await expect(page.getByTestId('import-script-preview')).toContainText('1 lines');

    await page.getByTestId('import-script-file-mode').click();
    await expect(page.getByTestId('import-script-preview')).toContainText('2 lines');
  });

  test('surfaces malformed input errors without advertising a required format', async ({ page }) => {
    await page.route('**/api/import-script', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: `${JSON.stringify({ type: 'error', error: 'No valid content found in script' })}\n`,
      });
    });
    await openImport(page);
    await page.getByTestId('import-script-name').fill(`Malformed script ${Date.now()}`);
    await page.getByTestId('import-script-text-mode').click();
    await page.getByTestId('import-script-text').fill('this is not a parseable script');
    await page.getByTestId('import-script-submit').click();

    await expect(page.getByText('No valid content found in script', { exact: true })).toBeVisible();
    await expect(page.getByTestId('import-script-text')).toHaveAttribute(
      'placeholder',
      'Enter story text...'
    );
    await expect(page.getByText(/standard format|format guide/i)).toHaveCount(0);
  });
});
