import { expect, test, type Page } from '@playwright/test';
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

type ReferenceFixture = {
  libraryId: string;
  assetId: string;
  displayFieldId: string;
  sourceDocumentId: string;
  referencingDocumentId: string;
};

const TABLE_NAME = 'Reference smoke table';
const ROW_NAME = 'Reference smoke row';
const FIELD_NAME = 'Current label';
const TABLE_LABEL = 'Compact table label';
const SOURCE_DOCUMENT_NAME = 'Reference smoke source';
const SOURCE_HEADING = 'Reference smoke heading';
const SOURCE_PARAGRAPH = 'Reference smoke paragraph';
const REFERENCING_DOCUMENT_NAME = 'Reference smoke links';

async function insertTableReference(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Insert reference' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert reference' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Table').click();
  await page.getByRole('option', { name: TABLE_NAME, exact: true }).click();
  await dialog.getByRole('option', { name: `Row: ${ROW_NAME}` }).click();
  await dialog.getByLabel('Display field').click();
  await page.getByRole('option', { name: FIELD_NAME, exact: true }).click();
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function insertDocumentReference(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Insert reference' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert reference' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('tab', { name: 'Document' }).click();
  await dialog.getByLabel('Document').click();
  await page.getByRole('option', { name: SOURCE_DOCUMENT_NAME, exact: true }).click();
  await dialog
    .getByRole('option', { name: `Paragraph: ${SOURCE_PARAGRAPH}` })
    .click();
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.describe.serial('Document references smoke', () => {
  test.setTimeout(180_000);

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId = '';
  let fixture: ReferenceFixture;

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'document-reference-owner');
    projectId = await createProjectFixture(admin, owner.id);

    const { data: library, error: libraryError } = await admin
      .from('libraries')
      .insert({ project_id: projectId, name: TABLE_NAME })
      .select('id')
      .single();
    if (libraryError || !library) {
      throw libraryError ?? new Error('Reference smoke table was not created');
    }

    const { data: field, error: fieldError } = await admin
      .from('library_field_definitions')
      .insert({
        library_id: library.id,
        section_id: `${library.id}:General`,
        section: 'General',
        label: FIELD_NAME,
        data_type: 'string',
        order_index: 0,
        required: false,
      })
      .select('id')
      .single();
    if (fieldError || !field) {
      throw fieldError ?? new Error('Reference smoke display field was not created');
    }

    const { data: asset, error: assetError } = await admin
      .from('library_assets')
      .insert({ library_id: library.id, name: ROW_NAME, row_index: 0 })
      .select('id')
      .single();
    if (assetError || !asset) {
      throw assetError ?? new Error('Reference smoke row was not created');
    }

    const { error: valueError } = await admin.from('library_asset_values').insert({
      asset_id: asset.id,
      field_id: field.id,
      value_json: TABLE_LABEL,
    });
    if (valueError) throw valueError;

    const { data: documents, error: documentsError } = await admin
      .from('documents')
      .insert([
        {
          project_id: projectId,
          name: SOURCE_DOCUMENT_NAME,
          content: `# ${SOURCE_HEADING}\n\n${SOURCE_PARAGRAPH}\n`,
          created_by: owner.id,
        },
        {
          project_id: projectId,
          name: REFERENCING_DOCUMENT_NAME,
          content: '',
          created_by: owner.id,
        },
      ])
      .select('id, name');
    if (documentsError || !documents || documents.length !== 2) {
      throw documentsError ?? new Error('Reference smoke documents were not created');
    }

    fixture = {
      libraryId: library.id as string,
      assetId: asset.id as string,
      displayFieldId: field.id as string,
      sourceDocumentId: documents.find((document) => document.name === SOURCE_DOCUMENT_NAME)!.id,
      referencingDocumentId: documents.find(
        (document) => document.name === REFERENCING_DOCUMENT_NAME
      )!.id,
    };
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('inserts, persists, and follows table and document block references', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    const login = new LoginPage(page);
    await login.goto();
    await login.login(owner);
    await login.expectLoginSuccess();

    const normalization = page.waitForResponse(
      (response) =>
        response.url().includes('/rpc/initialize_document_collab_state') &&
        response.ok()
    );
    await page.goto(`/${projectId}/doc/${fixture.sourceDocumentId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 45_000 });
    const sourceBlock = page.locator(
      `[data-document-block-type="paragraph"]:has-text("${SOURCE_PARAGRAPH}")`
    );
    await expect(sourceBlock).toBeVisible({ timeout: 30_000 });
    const sourceBlockId = await sourceBlock.getAttribute('data-document-block-id');
    expect(sourceBlockId).toMatch(/^[0-9a-f-]{36}$/i);
    await normalization;

    await page.goto(`/${projectId}/doc/${fixture.referencingDocumentId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 45_000 });
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible();
    await editor.click();

    const tableAppend = page.waitForResponse(
      (response) =>
        response.url().includes('/rpc/append_document_yjs_updates') && response.ok()
    );
    await insertTableReference(page);
    await tableAppend;
    await expect(page.getByRole('link', { name: `${TABLE_NAME} / ${ROW_NAME} / ${FIELD_NAME}: ${TABLE_LABEL}` }))
      .toHaveText(TABLE_LABEL);

    await editor.click();
    await editor.press('End');
    const documentAppend = page.waitForResponse(
      (response) =>
        response.url().includes('/rpc/append_document_yjs_updates') && response.ok()
    );
    await insertDocumentReference(page);
    await documentAppend;

    const tableReference = page.getByRole('link', {
      name: `${TABLE_NAME} / ${ROW_NAME} / ${FIELD_NAME}: ${TABLE_LABEL}`,
    });
    const documentReference = page.getByRole('link', {
      name: `${SOURCE_DOCUMENT_NAME} / ${SOURCE_HEADING}: ${SOURCE_PARAGRAPH}`,
    });
    await expect(documentReference).toHaveText(SOURCE_PARAGRAPH);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(tableReference).toHaveText(TABLE_LABEL, { timeout: 30_000 });
    await expect(documentReference).toHaveText(SOURCE_PARAGRAPH, { timeout: 30_000 });

    await tableReference.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
      .toBe(`/${projectId}/${fixture.libraryId}/${fixture.assetId}`);
    expect(new URL(page.url()).searchParams.get('field')).toBe(fixture.displayFieldId);
    const targetField = page.locator(`[data-field-id="${fixture.displayFieldId}"]`);
    await expect(targetField).toHaveClass(/referencedFieldHighlight/, { timeout: 30_000 });

    await page.goto(`/${projectId}/doc/${fixture.referencingDocumentId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(documentReference).toBeVisible({ timeout: 30_000 });
    await documentReference.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
      .toBe(`/${projectId}/doc/${fixture.sourceDocumentId}`);
    expect(new URL(page.url()).hash).toBe(`#block-${sourceBlockId}`);
    const targetBlock = page.locator(`[data-document-block-id="${sourceBlockId}"]`);
    await expect(targetBlock).toHaveClass(/referencedDocumentBlock/, { timeout: 30_000 });

    expect(pageErrors).toEqual([]);
  });
});
