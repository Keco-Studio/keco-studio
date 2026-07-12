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

const CSV = Buffer.from('Name,Description\nSword,Sharp blade\nShield,Sturdy guard\n');
const TEN_MB = 10 * 1024 * 1024;

test.describe('Spreadsheet library import', () => {
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
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByTestId('import-library-modal')).toBeVisible();
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'library-import-owner');
    projectId = await createProjectFixture(admin, owner.id);
    folder = await createFolderFixture(admin, projectId, 'Library import');
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('previews and imports CSV columns and rows', async ({ page }) => {
    await openImport(page);
    const libraryName = `Imported items ${Date.now()}`;
    await page.getByTestId('import-library-name').fill(libraryName);
    await page.getByTestId('import-library-file').setInputFiles({
      name: 'items.csv',
      mimeType: 'text/csv',
      buffer: CSV,
    });

    await expect(page.getByTestId('import-library-preview')).toContainText('2 columns, 2 rows');
    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/import') && response.request().method() === 'POST'
    );
    await page.getByTestId('import-library-submit').click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page.getByText('Import completed (2 rows)', { exact: true })).toBeVisible();

    const { data: library, error: libraryError } = await admin
      .from('libraries')
      .select('id')
      .eq('project_id', projectId)
      .eq('folder_id', folder.id)
      .eq('name', libraryName)
      .single();
    if (libraryError || !library) throw libraryError ?? new Error('Imported library not found');

    const [{ data: fields }, { data: assets }] = await Promise.all([
      admin
        .from('library_field_definitions')
        .select('id, label, data_type')
        .eq('library_id', library.id)
        .order('order_index'),
      admin
        .from('library_assets')
        .select('id, name, row_index')
        .eq('library_id', library.id)
        .order('row_index'),
    ]);
    expect(fields?.map((field) => [field.label, field.data_type])).toEqual([
      ['Name', 'string'],
      ['Description', 'string'],
    ]);
    expect(assets?.map((asset) => asset.name)).toEqual(['Sword', 'Shield']);

    const { data: values } = await admin
      .from('library_asset_values')
      .select('value_json')
      .in('asset_id', (assets ?? []).map((asset) => asset.id));
    expect(values?.map((value) => value.value_json)).toEqual(
      expect.arrayContaining(['Sword', 'Sharp blade', 'Shield', 'Sturdy guard'])
    );
  });

  test('rejects invalid files and invalid library names', async ({ page }) => {
    await openImport(page);
    const name = page.getByTestId('import-library-name');
    const file = page.getByTestId('import-library-file');
    const submit = page.getByTestId('import-library-submit');

    await expect(submit).toBeDisabled();
    await file.setInputFiles({ name: 'items.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await expect(page.getByText('Please select a .csv or .xlsx file', { exact: true })).toBeVisible();

    await file.setInputFiles({
      name: 'too-large.csv',
      mimeType: 'text/csv',
      buffer: Buffer.alloc(TEN_MB + 1, 'x'),
    });
    await expect(page.getByText('File exceeds 10 MB limit', { exact: true })).toBeVisible();

    await file.setInputFiles({ name: 'items.csv', mimeType: 'text/csv', buffer: CSV });
    await name.fill('Invalid!Name');
    await submit.click();
    await expect(page.getByText('No emojis, HTML tags or !@#$% allowed', { exact: true })).toBeVisible();
  });

  test('surfaces duplicate library names from the API', async ({ page }) => {
    const duplicateName = `Duplicate import ${Date.now()}`;
    const { error } = await admin.from('libraries').insert({
      project_id: projectId,
      folder_id: folder.id,
      name: duplicateName,
      description: null,
    });
    if (error) throw error;

    await openImport(page);
    await page.getByTestId('import-library-name').fill(duplicateName);
    await page.getByTestId('import-library-file').setInputFiles({
      name: 'items.csv',
      mimeType: 'text/csv',
      buffer: CSV,
    });
    await page.getByTestId('import-library-submit').click();
    await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 30000 });
  });
});
