import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { LoginPage } from '../pages/login.page';
import {
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';
import { expectDocumentLive } from '../utils/document-assertions';

type ClipboardFixture = {
  libraryId: string;
  documentId: string;
  fieldIds: [string, string];
  assetIds: [string, string];
};

function sourceCell(page: Page, assetId: string, fieldId: string) {
  return page.locator(
    `tbody tr[data-row-id="${assetId}"] td[data-property-key="${fieldId}"]`,
  );
}

function isDurableDocumentWrite(response: { url(): string; ok(): boolean }): boolean {
  return response.url().includes('/rpc/append_document_yjs_updates') && response.ok();
}

test.describe('Library table copy into document', () => {
  test.describe.configure({ mode: 'serial', timeout: 240000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;
  let fixture: ClipboardFixture;

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'table-document-copy');
    projectId = await createProjectFixture(admin, owner.id, { addOwnerMembership: true });

    const { data: library, error: libraryError } = await admin
      .from('libraries')
      .insert({ project_id: projectId, name: `Clipboard source ${Date.now()}` })
      .select('id')
      .single();
    if (libraryError || !library) {
      throw libraryError ?? new Error('Failed to create clipboard source library');
    }

    const sectionId = `${library.id}:General`;
    const { data: fields, error: fieldsError } = await admin
      .from('library_field_definitions')
      .insert([
        {
          library_id: library.id,
          section_id: sectionId,
          section: 'General',
          label: 'Source title',
          data_type: 'string',
          order_index: 0,
          required: false,
        },
        {
          library_id: library.id,
          section_id: sectionId,
          section: 'General',
          label: 'Source points',
          data_type: 'string',
          order_index: 1,
          required: false,
        },
      ])
      .select('id, order_index');
    if (fieldsError || !fields) {
      throw fieldsError ?? new Error('Failed to create clipboard source fields');
    }

    const { data: assets, error: assetsError } = await admin
      .from('library_assets')
      .insert([
        { library_id: library.id, name: 'Header-like row', row_index: 0 },
        { library_id: library.id, name: 'Data row', row_index: 1 },
      ])
      .select('id, row_index');
    if (assetsError || !assets) {
      throw assetsError ?? new Error('Failed to create clipboard source rows');
    }

    const fieldIds = [
      fields.find((field) => field.order_index === 0)!.id as string,
      fields.find((field) => field.order_index === 1)!.id as string,
    ] as [string, string];
    const assetIds = [
      assets.find((asset) => asset.row_index === 0)!.id as string,
      assets.find((asset) => asset.row_index === 1)!.id as string,
    ] as [string, string];

    const { error: valuesError } = await admin.from('library_asset_values').insert([
      { asset_id: assetIds[0], field_id: fieldIds[0], value_json: 'Name' },
      { asset_id: assetIds[0], field_id: fieldIds[1], value_json: 'Score' },
      { asset_id: assetIds[1], field_id: fieldIds[0], value_json: 'Alice' },
      { asset_id: assetIds[1], field_id: fieldIds[1], value_json: '10' },
    ]);
    if (valuesError) throw valuesError;

    const { data: documentRow, error: documentError } = await admin
      .from('documents')
      .insert({
        project_id: projectId,
        name: `Clipboard target ${Date.now()}`,
        content: '',
        created_by: owner.id,
      })
      .select('id')
      .single();
    if (documentError || !documentRow) {
      throw documentError ?? new Error('Failed to create clipboard target document');
    }

    fixture = {
      libraryId: library.id as string,
      documentId: documentRow.id as string,
      fieldIds,
      assetIds,
    };
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('uploads a mixed clipboard image before inserting it into the document', async ({
    baseURL,
    browser,
  }) => {
    const context = await browser.newContext();
    await context.grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: new URL(baseURL ?? 'http://localhost:3000').origin },
    );
    const page = await context.newPage();

    try {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login(owner);
      await loginPage.expectLoginSuccess();
      await page.goto(`/${projectId}/doc/${fixture.documentId}`);

      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await expectDocumentLive(page, 'Live', 30_000);

      await page.route('**/storage/v1/object/**', async (route) => {
        if (route.request().method() === 'POST') {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 600));
        }
        await route.continue();
      });

      const pngBase64 = (
        await sharp({
          create: {
            width: 2400,
            height: 320,
            channels: 4,
            background: { r: 22, g: 119, b: 255, alpha: 1 },
          },
        }).png().toBuffer()
      ).toString('base64');
      await page.evaluate(async (encodedPng) => {
        const bytes = Uint8Array.from(atob(encodedPng), (character) =>
          character.charCodeAt(0)
        );
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': new Blob([bytes], { type: 'image/png' }),
            'text/html': new Blob(
              ['<img src="https://external.invalid/copied.png" alt="External image">'],
              { type: 'text/html' },
            ),
            'text/plain': new Blob(['External image'], { type: 'text/plain' }),
          }),
        ]);
      }, pngBase64);

      await editor.click();
      await page.keyboard.press('Control+v');
      await page.keyboard.insertText('Text');

      const pastedImage = editor.getByRole('img', { name: 'image.png' });
      await expect(pastedImage).toBeVisible({ timeout: 20000 });
      await expect(pastedImage).toHaveAttribute(
        'src',
        /\/storage\/v1\/object\/public\/library-media-files\//,
      );
      await expect(pastedImage).not.toHaveAttribute('src', /external\.invalid/);
      await page.keyboard.insertText(' after pasted image');
      const pastedImageUrl = await pastedImage.getAttribute('src');
      expect(pastedImageUrl).toBeTruthy();

      const [imageBox, editorBox] = await Promise.all([
        pastedImage.boundingBox(),
        editor.boundingBox(),
      ]);
      expect(imageBox).not.toBeNull();
      expect(editorBox).not.toBeNull();
      expect(imageBox!.width).toBeLessThanOrEqual(editorBox!.width + 1);
      await expect(
        page.getByText('Connection interrupted', { exact: true }),
      ).toHaveCount(0);

      const followingText = 'Text after pasted image';
      await expect(editor).toContainText(followingText);

      await expect.poll(async () => {
        const { data, error } = await admin
          .from('documents')
          .select('content')
          .eq('id', fixture.documentId)
          .single();
        if (error) throw error;
        const imageIndex = data.content.indexOf(pastedImageUrl!);
        const textIndex = data.content.indexOf(followingText);
        return imageIndex >= 0 && textIndex > imageIndex;
      }, { timeout: 30000 }).toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloadedEditor = page.locator('[contenteditable="true"]').first();
      await expect(reloadedEditor.getByRole('img', { name: 'image.png' })).toHaveAttribute(
        'src',
        pastedImageUrl!,
        { timeout: 20000 },
      );
      await expect(reloadedEditor).toContainText(followingText);
    } finally {
      await context.close();
    }
  });

  test('pastes an editable independent GFM table and persists document edits', async ({
    baseURL,
    browser,
  }) => {
    const context = await browser.newContext();
    await context.grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: new URL(baseURL ?? 'http://localhost:3000').origin },
    );
    const page = await context.newPage();

    try {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login(owner);
      await loginPage.expectLoginSuccess();

      await test.step('copy two source rows with rich clipboard data', async () => {
        await page.goto(`/${projectId}/${fixture.libraryId}`);
        await expect(sourceCell(page, fixture.assetIds[0], fixture.fieldIds[0]))
          .toBeVisible({ timeout: 30000 });

        for (const assetId of fixture.assetIds) {
          const row = page.locator(`tbody tr[data-row-id="${assetId}"]`);
          await row.hover();
          const checkbox = row.getByRole('checkbox');
          await checkbox.check({ force: true });
          await expect(checkbox).toBeChecked();
        }

        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Control+c');
        await expect(page.getByText('Content copied', { exact: true })).toBeVisible();

        await expect.poll(
          async () => page.evaluate(async () => {
            const [item] = await navigator.clipboard.read();
            return item?.types ?? [];
          }),
          { timeout: 10000, intervals: [100, 250, 500] },
        ).toEqual(expect.arrayContaining(['text/plain', 'text/html']));

        const clipboard = await page.evaluate(async () => {
          const [item] = await navigator.clipboard.read();
          const plainText = item.types.includes('text/plain')
            ? await (await item.getType('text/plain')).text()
            : null;
          const html = item.types.includes('text/html')
            ? await (await item.getType('text/html')).text()
            : null;
          return {
            types: item.types,
            plainText,
            html,
          };
        });

        expect(clipboard.types).toEqual(expect.arrayContaining(['text/plain', 'text/html']));
        expect(clipboard.plainText).toBe('Name\tScore\nAlice\t10');
        expect(clipboard.html).toContain('<table>');
        expect(clipboard.html).not.toContain('Source title');
        expect(clipboard.html).not.toContain('Source points');
      });

      await test.step('paste as a native table and edit a data cell', async () => {
        await page.goto(`/${projectId}/doc/${fixture.documentId}`);
        const editor = page.locator('[contenteditable="true"]').first();
        await expect(editor).toBeVisible({ timeout: 30000 });
        await expectDocumentLive(page, 'Live', 30_000);

        const durablePaste = page.waitForResponse(isDurableDocumentWrite, { timeout: 30000 });
        await editor.click();
        await page.keyboard.press('Control+v');

        const table = editor.locator('table').first();
        await expect(table).toBeVisible({ timeout: 30000 });
        const contentRows = table.locator('tbody > tr');
        const headerCells = contentRows
          .first()
          .locator('th:not([data-tool-cell="true"])');
        const dataCells = contentRows
          .nth(1)
          .locator('td:not([data-tool-cell="true"])');
        await expect(headerCells).toHaveCount(2);
        await expect(headerCells.nth(0)).toContainText('Name');
        await expect(headerCells.nth(1)).toContainText('Score');
        await expect(dataCells.nth(0)).toContainText('Alice');
        await expect(dataCells.nth(1)).toContainText('10');
        await durablePaste;

        const aliceCell = dataCells.nth(0);
        await aliceCell.click();
        await aliceCell.evaluate((element) => {
          const textNode = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
          if (!textNode) throw new Error('Alice table cell has no text node');
          const range = document.createRange();
          range.selectNodeContents(textNode);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
        });

        const durableEdit = page.waitForResponse(isDurableDocumentWrite, { timeout: 30000 });
        await page.keyboard.insertText('Alicia in document');
        await expect(aliceCell).toContainText('Alicia in document');
        await page.keyboard.press('Tab');
        await durableEdit;

        await expect.poll(async () => {
          const { data, error } = await admin
            .from('documents')
            .select('content')
            .eq('id', fixture.documentId)
            .single();
          if (error) throw error;
          return data.content;
        }, { timeout: 30000 }).toMatch(
          /\|\s*Name\s*\|\s*Score\s*\|[\s\S]*\|\s*:?-+\s*\|\s*:?-+\s*\|[\s\S]*\|\s*Alicia in document\s*\|\s*10\s*\|/,
        );
      });

      await test.step('reload the document and keep the source table unchanged', async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        const editor = page.locator('[contenteditable="true"]').first();
        await expect(editor).toBeVisible({ timeout: 30000 });
        const table = editor.locator('table').first();
        await expect(table).toBeVisible({ timeout: 30000 });
        await expect(
          table
            .locator('tbody > tr')
            .nth(1)
            .locator('td:not([data-tool-cell="true"])')
            .first(),
        ).toContainText('Alicia in document');

        const { data: sourceValue, error } = await admin
          .from('library_asset_values')
          .select('value_json')
          .eq('asset_id', fixture.assetIds[1])
          .eq('field_id', fixture.fieldIds[0])
          .single();
        if (error) throw error;
        expect(sourceValue?.value_json).toBe('Alice');

        await page.goto(`/${projectId}/${fixture.libraryId}`);
        await expect(sourceCell(page, fixture.assetIds[1], fixture.fieldIds[0]))
          .toContainText('Alice', { timeout: 30000 });
        await expect(sourceCell(page, fixture.assetIds[1], fixture.fieldIds[0]))
          .not.toContainText('Alicia in document');
      });
    } finally {
      await context.close();
    }
  });
});
