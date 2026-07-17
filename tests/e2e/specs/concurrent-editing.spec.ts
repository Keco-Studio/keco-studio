import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import { captureRealtimeErrors } from '../utils/realtime-errors';
import {
  addProjectCollaborator,
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

type SharedFixture = {
  libraryId: string;
  assetId: string;
  leftFieldId: string;
  rightFieldId: string;
};

function tableCell(page: Page, assetId: string, fieldId: string): Locator {
  return page.locator(`tbody tr[data-row-id="${assetId}"] td[data-property-key="${fieldId}"]`);
}

async function editCell(page: Page, assetId: string, fieldId: string, value: string): Promise<void> {
  const cell = tableCell(page, assetId, fieldId);
  await expect(cell).toBeVisible({ timeout: 30000 });
  await cell.dblclick();
  const editor = cell.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill(value);
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
}

async function expectCellValue(
  page: Page,
  assetId: string,
  fieldId: string,
  expected: string
): Promise<void> {
  await expect.poll(
    async () => (await tableCell(page, assetId, fieldId).innerText()).trim(),
    { timeout: 30000, intervals: [200, 500, 1000] }
  ).toBe(expected);
}

async function openLibrary(
  browser: Browser,
  user: TemporaryUser,
  projectId: string,
  libraryId: string
): Promise<{
  context: BrowserContext;
  page: Page;
  realtimeErrors: readonly string[];
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const realtimeErrors = captureRealtimeErrors(page, user.email);
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(user);
  await loginPage.expectLoginSuccess();
  await page.goto(`/${projectId}/${libraryId}`);
  await expect(page.locator('tbody tr[data-row-id]').first()).toBeVisible({ timeout: 30000 });
  return { context, page, realtimeErrors };
}

test.describe('Concurrent library editing', () => {
  test.describe.configure({ mode: 'serial', timeout: 240000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let editor: TemporaryUser;
  let projectId: string;
  let fixture: SharedFixture;

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'realtime-owner');
    editor = await createTemporaryUser(admin, 'realtime-editor');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });
    await addProjectCollaborator(admin, projectId, editor.id, 'editor', owner.id);

    const { data: library, error: libraryError } = await admin
      .from('libraries')
      .insert({ project_id: projectId, name: `Realtime ${Date.now()}` })
      .select('id')
      .single();
    if (libraryError || !library) throw libraryError ?? new Error('Failed to create realtime library');

    const sectionId = `${library.id}:General`;
    const { data: fields, error: fieldsError } = await admin
      .from('library_field_definitions')
      .insert(['Left value', 'Right value'].map((label, orderIndex) => ({
        library_id: library.id,
        section_id: sectionId,
        section: 'General',
        label,
        data_type: 'string',
        order_index: orderIndex,
        required: false,
      })))
      .select('id, order_index');
    if (fieldsError || !fields) throw fieldsError ?? new Error('Failed to create realtime fields');

    const { data: asset, error: assetError } = await admin
      .from('library_assets')
      .insert({ library_id: library.id, name: 'Shared row', row_index: 0 })
      .select('id')
      .single();
    if (assetError || !asset) throw assetError ?? new Error('Failed to create realtime asset');

    const leftFieldId = fields.find((field) => field.order_index === 0)!.id;
    const rightFieldId = fields.find((field) => field.order_index === 1)!.id;
    const { error: valuesError } = await admin.from('library_asset_values').insert([
      { asset_id: asset.id, field_id: leftFieldId, value_json: 'Left initial' },
      { asset_id: asset.id, field_id: rightFieldId, value_json: 'Right initial' },
    ]);
    if (valuesError) throw valuesError;

    fixture = { libraryId: library.id, assetId: asset.id, leftFieldId, rightFieldId };
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (editor) await deleteTemporaryUser(admin, editor);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('keeps two editors consistent across cell and row changes', async ({ browser }) => {
    const ownerSession = await openLibrary(browser, owner, projectId, fixture.libraryId);
    const editorSession = await openLibrary(browser, editor, projectId, fixture.libraryId);
    const pageA = ownerSession.page;
    const pageB = editorSession.page;

    try {
      await test.step('propagates a cell edit without refresh', async () => {
        await editCell(pageA, fixture.assetId, fixture.leftFieldId, 'From owner');
        await expect.poll(async () => {
          const { data } = await admin
            .from('library_asset_values')
            .select('value_json')
            .eq('asset_id', fixture.assetId)
            .eq('field_id', fixture.leftFieldId)
            .single();
          return data?.value_json;
        }, { timeout: 30000 }).toBe('From owner');
        await expectCellValue(pageB, fixture.assetId, fixture.leftFieldId, 'From owner');
      });

      await test.step('preserves concurrent edits to different cells', async () => {
        await Promise.all([
          editCell(pageA, fixture.assetId, fixture.leftFieldId, 'Owner left'),
          editCell(pageB, fixture.assetId, fixture.rightFieldId, 'Editor right'),
        ]);
        await expect.poll(async () => {
          const { data } = await admin
            .from('library_asset_values')
            .select('field_id, value_json')
            .eq('asset_id', fixture.assetId)
            .in('field_id', [fixture.leftFieldId, fixture.rightFieldId]);
          return Object.fromEntries((data ?? []).map((row) => [row.field_id, row.value_json]));
        }, { timeout: 30000 }).toEqual({
          [fixture.leftFieldId]: 'Owner left',
          [fixture.rightFieldId]: 'Editor right',
        });
        await expectCellValue(pageA, fixture.assetId, fixture.leftFieldId, 'Owner left');
        await expectCellValue(pageA, fixture.assetId, fixture.rightFieldId, 'Editor right');
        await expectCellValue(pageB, fixture.assetId, fixture.leftFieldId, 'Owner left');
        await expectCellValue(pageB, fixture.assetId, fixture.rightFieldId, 'Editor right');
      });

      await test.step('converges on the later edit to the same cell', async () => {
        await editCell(pageA, fixture.assetId, fixture.leftFieldId, 'First write');
        await expect.poll(async () => {
          const { data } = await admin
            .from('library_asset_values')
            .select('value_json')
            .eq('asset_id', fixture.assetId)
            .eq('field_id', fixture.leftFieldId)
            .single();
          return data?.value_json;
        }).toBe('First write');

        await editCell(pageB, fixture.assetId, fixture.leftFieldId, 'Last write');
        await expect.poll(async () => {
          const { data } = await admin
            .from('library_asset_values')
            .select('value_json')
            .eq('asset_id', fixture.assetId)
            .eq('field_id', fixture.leftFieldId)
            .single();
          return data?.value_json;
        }).toBe('Last write');
        await Promise.all([
          expectCellValue(pageA, fixture.assetId, fixture.leftFieldId, 'Last write'),
          expectCellValue(pageB, fixture.assetId, fixture.leftFieldId, 'Last write'),
        ]);
      });

      await test.step('propagates row creation and deletion', async () => {
        const { data: beforeRows } = await admin
          .from('library_assets')
          .select('id')
          .eq('library_id', fixture.libraryId);
        const beforeIds = new Set((beforeRows ?? []).map((row) => row.id));

        await pageA.getByRole('button', { name: 'Add new asset' }).click();
        let createdId = '';
        await expect.poll(async () => {
          const { data } = await admin
            .from('library_assets')
            .select('id')
            .eq('library_id', fixture.libraryId);
          createdId = (data ?? []).find((row) => !beforeIds.has(row.id))?.id ?? '';
          return createdId;
        }, { timeout: 30000 }).not.toBe('');

        await expect(pageB.locator(`tbody tr[data-row-id="${createdId}"]`)).toBeVisible({ timeout: 30000 });

        const createdRow = pageA.locator(`tbody tr[data-row-id="${createdId}"]`);
        await expect(createdRow).toBeVisible({ timeout: 30000 });
        await pageA.mouse.click(5, 5);
        await createdRow.locator('td').first().click({ button: 'right' });
        await expect(pageA.getByText('Insert row above', { exact: true })).toBeVisible();
        await pageA.getByText('Delete', { exact: true }).last().click();
        const dialog = pageA.getByRole('dialog', { name: 'Confirm Delete' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

        await expect(pageB.locator(`tbody tr[data-row-id="${createdId}"]`)).toHaveCount(0, {
          timeout: 30000,
        });
      });

      expect([
        ...ownerSession.realtimeErrors,
        ...editorSession.realtimeErrors,
      ]).toEqual([]);
    } finally {
      await Promise.all([ownerSession.context.close(), editorSession.context.close()]);
    }
  });
});
