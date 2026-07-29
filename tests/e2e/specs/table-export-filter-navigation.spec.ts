import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { expect, test, type Download, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import {
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

type TableFixture = {
  libraryId: string;
  libraryName: string;
  fieldIds: Record<'name' | 'category' | 'notes', string>;
  rowIds: Record<'castle' | 'forest' | 'blank', string>;
};

async function createTableFixture(
  admin: SupabaseClient,
  projectId: string
): Promise<TableFixture> {
  const libraryName = `PR Table ${crypto.randomUUID().slice(0, 6)}`;
  const { data: library, error: libraryError } = await admin
    .from('libraries')
    .insert({ project_id: projectId, name: libraryName, description: 'PR table regression fixture' })
    .select('id')
    .single();
  if (libraryError || !library) throw libraryError ?? new Error('Failed to create PR table');

  const sectionId = `${library.id}:Main`;
  const fieldInputs = [
    { key: 'name' as const, label: 'Name' },
    { key: 'category' as const, label: 'Category' },
    { key: 'notes' as const, label: 'Notes' },
  ];
  const { data: fields, error: fieldsError } = await admin
    .from('library_field_definitions')
    .insert(fieldInputs.map((field, orderIndex) => ({
      library_id: library.id,
      section_id: sectionId,
      section: 'Main',
      label: field.label,
      data_type: 'string',
      order_index: orderIndex,
      required: false,
    })))
    .select('id, label');
  if (fieldsError || !fields) throw fieldsError ?? new Error('Failed to create PR table fields');

  const fieldIdByLabel = new Map(fields.map((field) => [field.label as string, field.id as string]));
  const fieldIds = {
    name: fieldIdByLabel.get('Name')!,
    category: fieldIdByLabel.get('Category')!,
    notes: fieldIdByLabel.get('Notes')!,
  };
  const rowInputs = [
    { key: 'castle' as const, name: 'Castle', values: ['Castle', 'Alpha', 'Snowville, "North"'] },
    { key: 'forest' as const, name: 'Forest', values: ['Forest', 'Beta', 'Green'] },
    { key: 'blank' as const, name: 'Blank', values: ['Blank', '', null] },
  ];
  const { data: assets, error: assetsError } = await admin
    .from('library_assets')
    .insert(rowInputs.map((row, rowIndex) => ({
      library_id: library.id,
      name: row.name,
      row_index: rowIndex,
    })))
    .select('id, row_index');
  if (assetsError || !assets) throw assetsError ?? new Error('Failed to create PR table rows');

  const rowIdByIndex = new Map(assets.map((asset) => [asset.row_index as number, asset.id as string]));
  const fieldIdList = [fieldIds.name, fieldIds.category, fieldIds.notes];
  const values = rowInputs.flatMap((row, rowIndex) =>
    row.values.map((value, fieldIndex) => ({
      asset_id: rowIdByIndex.get(rowIndex)!,
      field_id: fieldIdList[fieldIndex],
      value_json: value,
    }))
  );
  const { error: valuesError } = await admin.from('library_asset_values').insert(values);
  if (valuesError) throw valuesError;

  return {
    libraryId: library.id as string,
    libraryName,
    fieldIds,
    rowIds: {
      castle: rowIdByIndex.get(0)!,
      forest: rowIdByIndex.get(1)!,
      blank: rowIdByIndex.get(2)!,
    },
  };
}

async function requireDownloadPath(download: Download): Promise<string> {
  const failure = await download.failure();
  if (failure) throw new Error(`Download failed: ${failure}`);
  const path = await download.path();
  if (!path) throw new Error('Playwright did not provide a download path');
  return path;
}

test.describe.serial('Table export, filter, and navigation PR regression', () => {
  test.setTimeout(180_000);

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;
  let fixture: TableFixture;

  async function loginAndOpen(page: Page): Promise<void> {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();
    await page.goto(`/${projectId}/${fixture.libraryId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`tr[data-row-id="${fixture.rowIds.castle}"]`)).toBeVisible({
      timeout: 30_000,
    });
  }

  async function openExportModal(page: Page): Promise<void> {
    const libraryNode = page.getByRole('tree').locator(`[title="${fixture.libraryName}"]`).first();
    await expect(libraryNode).toBeVisible({ timeout: 30_000 });
    await libraryNode.click({ button: 'right' });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByText('Please select a file type to export', { exact: true })).toBeVisible();
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'table-pr-owner');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });
    fixture = await createTableFixture(admin, projectId);
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('downloads and parses complete XLSX and JSON exports', async ({ page }) => {
    await loginAndOpen(page);

    await openExportModal(page);
    await page.getByLabel('Export as .xlsx', { exact: true }).check();
    const xlsxDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).last().click();
    const xlsxDownload = await xlsxDownloadPromise;
    expect(xlsxDownload.suggestedFilename()).toMatch(/\.xlsx$/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(await requireDownloadPath(xlsxDownload));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Main']);
    const sheet = workbook.getWorksheet('Main');
    expect(sheet?.getRow(1).values).toEqual([
      ,
      'Name (string)',
      'Category (string)',
      'Notes (string)',
    ]);
    expect(sheet?.getCell('C2').value).toBe('Snowville, "North"');
    expect(sheet?.getCell('C4').value).toBeNull();

    await openExportModal(page);
    await page.getByLabel('Export as .json', { exact: true }).check();
    const jsonDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).last().click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);

    const payload = JSON.parse(
      await fs.readFile(await requireDownloadPath(jsonDownload), 'utf8')
    ) as {
      properties: Array<{ name: string }>;
      rows: Array<{ id: string; propertyValues: Record<string, unknown> }>;
    };
    expect(payload.properties.map((property) => property.name)).toEqual(['Name', 'Category', 'Notes']);
    expect(payload.rows).toHaveLength(3);
    expect(payload.rows.find((row) => row.id === fixture.rowIds.castle)?.propertyValues).toMatchObject({
      [fixture.fieldIds.name]: 'Castle',
      [fixture.fieldIds.category]: 'Alpha',
      [fixture.fieldIds.notes]: 'Snowville, "North"',
    });
    expect(payload.rows.find((row) => row.id === fixture.rowIds.blank)?.propertyValues[fixture.fieldIds.notes])
      .toBeNull();
  });

  test('filters rows by a column value and clears the active filter', async ({ page }) => {
    await loginAndOpen(page);

    const categoryHeader = page.locator(
      `[data-property-header-id="${fixture.fieldIds.category}"]`
    );
    await categoryHeader.getByRole('button', { name: 'Filter by values', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Filter by values' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button').filter({ hasText: 'Beta' }).click();
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(page.locator(`tr[data-row-id="${fixture.rowIds.castle}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-row-id="${fixture.rowIds.forest}"]`)).toHaveCount(0);
    await expect(categoryHeader.getByRole('button', { name: 'Column filter active' })).toBeVisible();

    await categoryHeader.getByRole('button', { name: 'Column filter active' }).click();
    const activeDialog = page.getByRole('dialog', { name: 'Filter by values' });
    await activeDialog.getByRole('button').filter({ hasText: 'Beta' }).click();
    await activeDialog.getByRole('button', { name: 'OK', exact: true }).click();

    await expect(page.locator(`tr[data-row-id="${fixture.rowIds.forest}"]`)).toBeVisible();
    await expect(categoryHeader.getByRole('button', { name: 'Filter by values' })).toBeVisible();
  });

  test('moves a selected cell with arrow keys and clamps at table boundaries', async ({ page }) => {
    await loginAndOpen(page);

    const cell = (rowId: string, fieldId: string) =>
      page.locator(`tr[data-row-id="${rowId}"] td[data-property-key="${fieldId}"]`);

    await cell(fixture.rowIds.castle, fixture.fieldIds.category).click();
    await expect(cell(fixture.rowIds.castle, fixture.fieldIds.category)).toHaveClass(/cellSelected/);
    await page.keyboard.press('ArrowRight');
    await expect(cell(fixture.rowIds.castle, fixture.fieldIds.notes)).toHaveClass(/cellSelected/);
    await page.keyboard.press('ArrowDown');
    await expect(cell(fixture.rowIds.forest, fixture.fieldIds.notes)).toHaveClass(/cellSelected/);

    await cell(fixture.rowIds.castle, fixture.fieldIds.name).click();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await expect(cell(fixture.rowIds.castle, fixture.fieldIds.name)).toHaveClass(/cellSelected/);

    await cell(fixture.rowIds.blank, fixture.fieldIds.notes).click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(cell(fixture.rowIds.blank, fixture.fieldIds.notes)).toHaveClass(/cellSelected/);
  });
});
