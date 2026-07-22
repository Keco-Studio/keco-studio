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

  async function mockSuccessfulImport(page: Page, libraryName: string): Promise<void> {
    const { data: library, error: libraryError } = await admin
      .from('libraries')
      .insert({
        project_id: projectId,
        folder_id: folder.id,
        name: libraryName,
        description: 'Imported by isolated Playwright fixture',
      })
      .select('id')
      .single();
    if (libraryError || !library) throw libraryError ?? new Error('Failed to create script fixture');

    const { data: fields, error: fieldsError } = await admin
      .from('library_field_definitions')
      .insert(['Label', 'Name', 'Content'].map((label, orderIndex) => ({
        library_id: library.id,
        section_id: `${library.id}:Script`,
        section: 'Script',
        label,
        description: null,
        data_type: 'string',
        formula_expression: null,
        required: false,
        order_index: orderIndex,
        enum_options: null,
        reference_libraries: null,
      })))
      .select('id, order_index');
    if (fieldsError || !fields) throw fieldsError ?? new Error('Failed to create script fields');

    const { data: assets, error: assetsError } = await admin
      .from('library_assets')
      .insert([
        { library_id: library.id, name: 'Start', row_index: 0 },
        { library_id: library.id, name: 'Line1', row_index: 1 },
      ])
      .select('id, row_index');
    if (assetsError || !assets) throw assetsError ?? new Error('Failed to create script rows');

    const fieldId = (orderIndex: number) => fields.find((field) => field.order_index === orderIndex)!.id;
    const assetId = (rowIndex: number) => assets.find((asset) => asset.row_index === rowIndex)!.id;
    const { error: valuesError } = await admin.from('library_asset_values').insert([
      { asset_id: assetId(0), field_id: fieldId(0), value_json: 'Start' },
      { asset_id: assetId(0), field_id: fieldId(1), value_json: 'Guide' },
      { asset_id: assetId(0), field_id: fieldId(2), value_json: 'Welcome to the city.' },
      { asset_id: assetId(1), field_id: fieldId(0), value_json: 'Line1' },
      { asset_id: assetId(1), field_id: fieldId(1), value_json: 'Hero' },
      { asset_id: assetId(1), field_id: fieldId(2), value_json: 'I am ready.' },
    ]);
    if (valuesError) throw valuesError;

    await page.route('**/api/import-script', async (route) => {
      const body = route.request().postDataBuffer()?.toString('utf8') ?? '';
      expect(body).toContain(projectId);
      expect(body).toContain(folder.id);
      expect(body).toContain(libraryName);
      expect(body).toContain(SCRIPT.trim());

      const records = [
        { type: 'progress', progress: { phase: 'source_segmentation', message: 'Segmenting exact story source' } },
        { type: 'progress', progress: { phase: 'database_write', message: 'Writing script library' } },
        { type: 'result', result: { libraryId: library.id, rowCount: 2, fieldCount: 3 } },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
      });
    });
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
    await mockSuccessfulImport(page, libraryName);
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
    await mockSuccessfulImport(page, libraryName);
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

    await expect(page.getByText('No valid content found in script', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('import-script-text')).toHaveAttribute(
      'placeholder',
      'Enter story text...'
    );
    await expect(page.getByText(/standard format|format guide/i)).toHaveCount(0);
  });
});
