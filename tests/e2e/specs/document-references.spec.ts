import { spawnSync } from 'node:child_process';
import path from 'node:path';
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

async function readDurableDocumentMarkdown(
  admin: SupabaseClient,
  documentId: string
): Promise<string> {
  const { data: document, error: documentError } = await admin
    .from('documents')
    .select('yjs_state, collab_epoch')
    .eq('id', documentId)
    .single();
  if (documentError || !document) {
    throw documentError ?? new Error('Document state was not found');
  }

  const { data: updates, error: updatesError } = await admin
    .from('document_yjs_updates')
    .select('update_data')
    .eq('document_id', documentId)
    .eq('epoch', document.collab_epoch)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (updatesError) throw updatesError;

  const probe = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      path.join(process.cwd(), 'tests/helpers/documentCodecProbe.ts'),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DOCUMENT_CODEC_COMMONJS: '1' },
      input: JSON.stringify({
        mode: 'state',
        snapshot: document.yjs_state,
        updates: (updates ?? []).map((update) => update.update_data),
      }),
    }
  );
  if (probe.status !== 0) {
    throw new Error(probe.stderr || 'Document codec probe failed');
  }
  return (JSON.parse(probe.stdout) as { markdown: string }).markdown;
}

async function insertTableReference(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Insert reference' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert reference' });
  await expect(dialog).toBeVisible();

  // Dev-mode Fast Refresh re-renders the page mid-test, so the antd Select
  // dropdown option keeps re-animating and never becomes click-stable. Drive
  // the searchable combobox by keyboard instead: typing filters to the target
  // and Enter commits it internally, independent of dropdown visual jitter.
  const tableSelect = dialog.getByRole('combobox', { name: 'Table', exact: true });
  await tableSelect.click();
  await tableSelect.fill(TABLE_NAME);
  await tableSelect.press('Enter');
  await dialog.getByRole('option', { name: `Row: ${ROW_NAME}` }).click();
  const fieldSelect = dialog.getByRole('combobox', { name: 'Display field', exact: true });
  await fieldSelect.click();
  await fieldSelect.fill(FIELD_NAME);
  await fieldSelect.press('Enter');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function insertDocumentReference(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Insert reference' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert reference' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('tab', { name: 'Document' }).click();
  const documentSelect = dialog.getByRole('combobox', { name: 'Document', exact: true });
  await documentSelect.click();
  await documentSelect.fill(SOURCE_DOCUMENT_NAME);
  await documentSelect.press('Enter');
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

    await insertTableReference(page);
    await expect(page.getByRole('link', { name: `${TABLE_NAME} / ${ROW_NAME} / ${FIELD_NAME}: ${TABLE_LABEL}` }))
      .toHaveText(TABLE_LABEL);

    await editor.click();
    await editor.press('End');
    await insertDocumentReference(page);

    const tableReference = page.getByRole('link', {
      name: `${TABLE_NAME} / ${ROW_NAME} / ${FIELD_NAME}: ${TABLE_LABEL}`,
    });
    const documentReference = page.getByRole('link', {
      name: `${SOURCE_DOCUMENT_NAME} / ${SOURCE_HEADING}: ${SOURCE_PARAGRAPH}`,
    });
    await expect(documentReference).toHaveText(SOURCE_PARAGRAPH);

    await expect.poll(async () => {
      const markdown = await readDurableDocumentMarkdown(
        admin,
        fixture.referencingDocumentId
      );
      return {
        tableReference: markdown.includes(fixture.assetId),
        documentReference: markdown.includes(sourceBlockId!),
      };
    }, {
      timeout: 30_000,
      intervals: [200, 500, 1_000],
    }).toEqual({ tableReference: true, documentReference: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(tableReference).toHaveText(TABLE_LABEL, { timeout: 30_000 });
    await expect(documentReference).toHaveText(SOURCE_PARAGRAPH, { timeout: 30_000 });

    await tableReference.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
      .toBe(`/${projectId}/${fixture.libraryId}`);
    expect(new URL(page.url()).searchParams.get('asset')).toBe(fixture.assetId);
    const targetRow = page.locator(`tr[data-row-id="${fixture.assetId}"]`);
    await expect(targetRow).toHaveClass(/referencedRowHighlight/, { timeout: 30_000 });

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
