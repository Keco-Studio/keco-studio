import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LoginPage } from '../pages/login.page';
import {
  addProjectCollaborator,
  createFolderFixture,
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

const FOLDER_DOCUMENT_MARKDOWN = '# Scene source\n\nNarrator: The gate opens.\n';
const ROOT_SNAPSHOT_MARKDOWN = 'Guide: Frozen opening.\nHero: Frozen reply.\n';
const ROOT_CHANGED_MARKDOWN = 'Guide: Changed after modal opened.\n';

type NamedFixture = { id: string; name: string };

type LifecycleFixture = {
  projectId: string;
  owner: TemporaryUser;
  editor: TemporaryUser;
  viewer: TemporaryUser;
  sourceFolder: NamedFixture;
  destinationFolder: NamedFixture;
  folderDocument: NamedFixture;
  rootDocument: NamedFixture;
};

function sse(...events: Array<Record<string, unknown>>): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

async function fulfillAgentStream(
  route: Route,
  conversationId: string,
  events: Array<Record<string, unknown>>
): Promise<void> {
  await route.fulfill({
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Conversation-Id': conversationId,
    },
    body: sse(...events, { type: 'done' }),
  });
}

async function login(page: Page, user: TemporaryUser): Promise<void> {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(user);
  await loginPage.expectLoginSuccess();
}

async function openDocument(
  page: Page,
  user: TemporaryUser,
  fixture: LifecycleFixture,
  documentId: string
): Promise<void> {
  await login(page, user);
  await page.goto(`/${fixture.projectId}/doc/${documentId}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByTestId('document-export')).toBeVisible({ timeout: 45_000 });
}

async function openDocumentInNewContext(
  browser: Browser,
  user: TemporaryUser,
  fixture: LifecycleFixture,
  documentId: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openDocument(page, user, fixture, documentId);
  return { context, page };
}

async function openExportMenu(page: Page, expectedLabels?: string[]) {
  await page.getByTestId('document-export').click();
  const menu = page.locator('.ant-dropdown:visible .ant-dropdown-menu');
  await expect(menu).toBeVisible();
  if (expectedLabels) {
    await expect.poll(async () =>
      (await menu.locator('.ant-dropdown-menu-item').allTextContents())
        .map((label) => label.trim())
    ).toEqual(expectedLabels);
  }
  return menu;
}

function sidebarTitle(page: Page, name: string) {
  return page.locator('aside').locator(`[title="${name}"]`);
}

async function treeParentTitle(page: Page, childTitle: string): Promise<string | null> {
  return page.locator('aside').evaluate((aside, title) => {
    const rows = Array.from(aside.querySelectorAll<HTMLElement>('.ant-tree-treenode'))
      .filter((row) => row.offsetParent !== null)
      .map((row) => ({
        title: Array.from(row.querySelectorAll<HTMLElement>('[title]'))
          .map((element) => element.getAttribute('title'))
          .find((value) => value?.trim()) ?? null,
        depth: row.querySelectorAll('.ant-tree-indent-unit').length,
      }));
    const index = rows.findIndex((row) => row.title === title);
    if (index < 0) return null;
    const childDepth = rows[index].depth;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (rows[cursor].depth < childDepth) return rows[cursor].title;
    }
    return null;
  }, childTitle);
}

async function expectTreeParent(page: Page, childTitle: string, parentTitle: string): Promise<void> {
  await expect.poll(
    () => treeParentTitle(page, childTitle),
    { timeout: 30_000 }
  ).toBe(parentTitle);
}

async function expandTreeNode(page: Page, title: string): Promise<void> {
  const node = sidebarTitle(page, title)
    .first()
    .locator('xpath=ancestor::div[contains(@class,"ant-tree-treenode")][1]');
  const documentExpand = node.getByRole('button', { name: 'Expand' });
  const documentCollapse = node.getByRole('button', { name: 'Collapse' });
  const switcher = node.locator('.ant-tree-switcher:not(.ant-tree-switcher-noop)');

  // Derived libraries load after the document row; wait for a real expand control
  // instead of the CSS-hidden Ant switcher documents keep in the DOM.
  let mode: 'open' | 'document' | 'switcher' = 'open';
  await expect
    .poll(
      async () => {
        if ((await documentCollapse.count()) > 0) {
          mode = 'open';
          return true;
        }
        if ((await documentExpand.count()) > 0) {
          mode = 'document';
          return true;
        }
        try {
          if (await switcher.isVisible()) {
            mode = 'switcher';
            return true;
          }
        } catch {
          // ignore detached/hidden probe failures while the tree re-renders
        }
        return false;
      },
      { timeout: 30_000 }
    )
    .toBe(true);

  if (mode === 'open') return;

  if (mode === 'document') {
    await documentExpand.click();
    await expect(documentCollapse).toBeVisible({ timeout: 10_000 });
    return;
  }

  await expect(switcher).toBeVisible({ timeout: 15_000 });
  const className = await switcher.getAttribute('class');
  if (!className?.includes('ant-tree-switcher_open')) await switcher.click();
}

async function createDocumentFixture(
  admin: SupabaseClient,
  fixture: Pick<LifecycleFixture, 'projectId' | 'owner'>,
  input: { name: string; folderId: string | null; content: string }
): Promise<NamedFixture> {
  const { data, error } = await admin
    .from('documents')
    .insert({
      project_id: fixture.projectId,
      folder_id: input.folderId,
      name: input.name,
      content: input.content,
      created_by: fixture.owner.id,
    })
    .select('id, name')
    .single();
  if (error || !data) throw error ?? new Error('Failed to create document fixture');
  return { id: data.id as string, name: data.name as string };
}

async function createDerivedLibrary(
  admin: SupabaseClient,
  fixture: LifecycleFixture,
  input: {
    name: string;
    sourceDocumentId: string;
    exportType: 'table' | 'script';
    folderId: string | null;
  }
): Promise<string> {
  const { data, error } = await admin
    .from('libraries')
    .insert({
      project_id: fixture.projectId,
      folder_id: input.folderId,
      name: input.name,
      description: 'Document-derived Playwright fixture',
      source_document_id: input.sourceDocumentId,
      document_export_type: input.exportType,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Failed to create derived library fixture');
  return data.id as string;
}

test.describe.serial('Document-derived library lifecycle', () => {
  test.setTimeout(240_000);

  let admin: SupabaseClient;
  let fixture: LifecycleFixture;
  let tableLibrary: NamedFixture;
  let scriptLibrary: NamedFixture;
  let ownerResource: TemporaryUser | undefined;
  let editorResource: TemporaryUser | undefined;
  let viewerResource: TemporaryUser | undefined;
  let projectResourceId: string | undefined;

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    const owner = await createTemporaryUser(admin, 'document-derived-owner');
    ownerResource = owner;
    const editor = await createTemporaryUser(admin, 'document-derived-editor');
    editorResource = editor;
    const viewer = await createTemporaryUser(admin, 'document-derived-viewer');
    viewerResource = viewer;
    const projectId = await createProjectFixture(admin, owner.id, {
      addOwnerMembership: true,
    });
    projectResourceId = projectId;
    await Promise.all([
      addProjectCollaborator(admin, projectId, editor.id, 'editor', owner.id),
      addProjectCollaborator(admin, projectId, viewer.id, 'viewer', owner.id),
    ]);
    const [sourceFolder, destinationFolder] = await Promise.all([
      createFolderFixture(admin, projectId, 'Derived source'),
      createFolderFixture(admin, projectId, 'Derived destination'),
    ]);
    const partial = { projectId, owner };
    const [folderDocument, rootDocument] = await Promise.all([
      createDocumentFixture(admin, partial, {
        name: `Folder design ${crypto.randomUUID().slice(0, 6)}`,
        folderId: sourceFolder.id,
        content: FOLDER_DOCUMENT_MARKDOWN,
      }),
      createDocumentFixture(admin, partial, {
        name: `Root design ${crypto.randomUUID().slice(0, 6)}`,
        folderId: null,
        content: ROOT_SNAPSHOT_MARKDOWN,
      }),
    ]);
    fixture = {
      projectId,
      owner,
      editor,
      viewer,
      sourceFolder,
      destinationFolder,
      folderDocument,
      rootDocument,
    };
  });

  test.afterAll(async () => {
    const cleanup = async (label: string, action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        // Cleanup must not mask the original beforeAll/test failure.
        console.error(`Document-derived E2E cleanup failed for ${label}:`, error);
      }
    };

    if (projectResourceId) {
      await cleanup('project', () => removeProjectFixture(admin, projectResourceId!));
    }
    if (ownerResource) {
      await cleanup('owner', () => deleteTemporaryUser(admin, ownerResource!));
    }
    if (editorResource) {
      await cleanup('editor', () => deleteTemporaryUser(admin, editorResource!));
    }
    if (viewerResource) {
      await cleanup('viewer', () => deleteTemporaryUser(admin, viewerResource!));
    }
  });

  test('all roles see the same three download items', async ({ browser }) => {
    const expected = ['Download DOCX', 'Download PDF', 'Download Markdown'];
    const roles = [fixture.owner, fixture.editor, fixture.viewer];

    for (const user of roles) {
      const { context, page } = await openDocumentInNewContext(
        browser,
        user,
        fixture,
        fixture.folderDocument.id
      );
      try {
        const menu = await openExportMenu(page, expected);
        const labels = (await menu.locator('.ant-dropdown-menu-item').allTextContents())
          .map((label) => label.trim());
        expect(labels).toEqual(expected);
        await expect(menu.getByText('Export as tables', { exact: true })).toHaveCount(0);
        await expect(menu.getByText('Export as script', { exact: true })).toHaveCount(0);
      } finally {
        await context.close();
      }
    }
  });

  test('table and script results appear once beneath their source document', async ({ page }) => {
    const tableName = `Derived table ${crypto.randomUUID().slice(0, 6)}`;
    const scriptName = `Derived script ${crypto.randomUUID().slice(0, 6)}`;
    let tableRequestBody = '';
    let scriptRequestBody = '';

    await page.route(
      `**/api/documents/${fixture.folderDocument.id}/export-source`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            source: {
              documentId: fixture.folderDocument.id,
              documentName: fixture.folderDocument.name,
              projectId: fixture.projectId,
              folderId: fixture.sourceFolder.id,
              markdown: FOLDER_DOCUMENT_MARKDOWN,
              token: { epoch: 1, revision: 1 },
              snapshotToken: 'test-folder-snapshot-token',
            },
          }),
        });
      }
    );
    await page.route('**/api/import-script', async (route) => {
      const body = route.request().postDataBuffer()?.toString('utf8') ?? '';
      const exportType =
        /documentExportType[\s\S]{0,80}table/.test(body) &&
        !/documentExportType[\s\S]{0,80}script/.test(body)
          ? 'table'
          : 'script';

      if (exportType === 'table') {
        tableRequestBody = body;
        const id = await createDerivedLibrary(admin, fixture, {
          name: tableName,
          sourceDocumentId: fixture.folderDocument.id,
          exportType: 'table',
          folderId: fixture.sourceFolder.id,
        });
        tableLibrary = { id, name: tableName };
        await route.fulfill({
          status: 200,
          contentType: 'application/x-ndjson; charset=utf-8',
          body: `${JSON.stringify({
            type: 'result',
            result: { libraryId: id, rowCount: 2, fieldCount: 3 },
          })}\n`,
        });
        return;
      }

      scriptRequestBody = body;
      const id = await createDerivedLibrary(admin, fixture, {
        name: scriptName,
        sourceDocumentId: fixture.folderDocument.id,
        exportType: 'script',
        folderId: fixture.sourceFolder.id,
      });
      scriptLibrary = { id, name: scriptName };
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: `${JSON.stringify({
          type: 'result',
          result: { libraryId: id, rowCount: 2, fieldCount: 3 },
        })}\n`,
      });
    });

    await openDocument(page, fixture.owner, fixture, fixture.folderDocument.id);

    await sidebarTitle(page, fixture.folderDocument.name).click({ button: 'right' });
    await page.getByRole('button', { name: 'Generate table', exact: true }).click();
    await expect(page.getByTestId('document-derived-import-progress')).toContainText(
      /Table generated|Generating table|Preparing table/,
      { timeout: 45_000 }
    );
    expect(tableRequestBody).toContain(fixture.folderDocument.id);
    await expect(sidebarTitle(page, tableName)).toHaveCount(1, { timeout: 30_000 });

    await sidebarTitle(page, fixture.folderDocument.name).click({ button: 'right' });
    await page.getByRole('button', { name: 'Generate conversation', exact: true }).click();
    await expect(page.getByTestId('document-derived-import-progress')).toContainText(
      /Conversation generated|Generating conversation|Preparing conversation/,
      { timeout: 45_000 }
    );
    expect(scriptRequestBody).toContain(fixture.folderDocument.id);

    await expect(sidebarTitle(page, tableName)).toHaveCount(1, { timeout: 30_000 });
    await expect(sidebarTitle(page, scriptName)).toHaveCount(1, { timeout: 30_000 });
    await expectTreeParent(page, fixture.folderDocument.name, fixture.sourceFolder.name);
    await expectTreeParent(page, tableName, fixture.folderDocument.name);
    await expectTreeParent(page, scriptName, fixture.folderDocument.name);
  });

  test('moving a document moves its complete subtree', async ({ page }) => {
    await openDocument(page, fixture.owner, fixture, fixture.folderDocument.id);
    await expandTreeNode(page, fixture.folderDocument.name);
    await expect(sidebarTitle(page, tableLibrary.name)).toBeVisible();
    await expect(sidebarTitle(page, scriptLibrary.name)).toBeVisible();

    await sidebarTitle(page, fixture.folderDocument.name).click({ button: 'right' });
    await page.getByRole('button', { name: 'Move to...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Move document' });
    await expect(dialog).toBeVisible();
    await dialog.locator('.ant-select-selector').click();
    await page.getByText(fixture.destinationFolder.name, { exact: true }).click();
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    await expectTreeParent(page, fixture.folderDocument.name, fixture.destinationFolder.name);
    await expect(sidebarTitle(page, fixture.folderDocument.name)).toHaveCount(1);
    expect(await treeParentTitle(page, fixture.folderDocument.name)).not.toBe(
      fixture.sourceFolder.name
    );
    await expectTreeParent(page, tableLibrary.name, fixture.folderDocument.name);
    await expectTreeParent(page, scriptLibrary.name, fixture.folderDocument.name);

    const [{ data: documentRow, error: documentError }, { data: libraryRows, error: libraryError }] =
      await Promise.all([
        admin
          .from('documents')
          .select('id, folder_id')
          .eq('id', fixture.folderDocument.id)
          .single(),
        admin
          .from('libraries')
          .select('id, folder_id')
          .in('id', [tableLibrary.id, scriptLibrary.id]),
      ]);
    if (documentError) throw documentError;
    if (libraryError) throw libraryError;
    expect(documentRow?.folder_id).toBe(fixture.destinationFolder.id);
    expect(libraryRows).toHaveLength(2);
    expect(libraryRows?.every((row) => row.folder_id === fixture.destinationFolder.id)).toBe(true);
  });

  test('deleting one child preserves the document and sibling', async ({ page }) => {
    await openDocument(page, fixture.owner, fixture, fixture.folderDocument.id);
    await expandTreeNode(page, fixture.folderDocument.name);
    await sidebarTitle(page, tableLibrary.name).click({ button: 'right' });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Confirm deletion' });
    await expect(dialog).toContainText('Delete this library?');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(sidebarTitle(page, tableLibrary.name)).toHaveCount(0, { timeout: 30_000 });
    const [{ data: table }, { data: document }, { data: script }] = await Promise.all([
      admin.from('libraries').select('id').eq('id', tableLibrary.id).maybeSingle(),
      admin.from('documents').select('id').eq('id', fixture.folderDocument.id).maybeSingle(),
      admin.from('libraries').select('id').eq('id', scriptLibrary.id).maybeSingle(),
    ]);
    expect(table).toBeNull();
    expect(document?.id).toBe(fixture.folderDocument.id);
    expect(script?.id).toBe(scriptLibrary.id);
    await expect(sidebarTitle(page, scriptLibrary.name)).toBeVisible();
    await expectTreeParent(page, scriptLibrary.name, fixture.folderDocument.name);
  });

  test('deleting the document cascades every child', async ({ page }) => {
    const replacementTableName = `Cascade table ${crypto.randomUUID().slice(0, 6)}`;
    const replacementTableId = await createDerivedLibrary(admin, fixture, {
      name: replacementTableName,
      sourceDocumentId: fixture.folderDocument.id,
      exportType: 'table',
      folderId: fixture.destinationFolder.id,
    });

    await openDocument(page, fixture.owner, fixture, fixture.folderDocument.id);
    await expandTreeNode(page, fixture.folderDocument.name);
    await expect(sidebarTitle(page, replacementTableName)).toBeVisible();
    await expect(sidebarTitle(page, scriptLibrary.name)).toBeVisible();

    await sidebarTitle(page, fixture.folderDocument.name).click({ button: 'right' });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Confirm deletion' });
    await expect(dialog).toContainText(
      'Delete this document permanently? 1 table and 1 script will also be deleted.'
    );
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(sidebarTitle(page, fixture.folderDocument.name)).toHaveCount(0, {
      timeout: 30_000,
    });
    const [{ data: document }, { data: children }, { data: replacementTable }] = await Promise.all([
      admin.from('documents').select('id').eq('id', fixture.folderDocument.id).maybeSingle(),
      admin
        .from('libraries')
        .select('id')
        .eq('source_document_id', fixture.folderDocument.id),
      admin.from('libraries').select('id').eq('id', replacementTableId).maybeSingle(),
    ]);
    expect(document).toBeNull();
    expect(children).toEqual([]);
    expect(replacementTable).toBeNull();
  });

  test('a root document exports a script from its frozen snapshot', async ({ page }) => {
    const rootScriptName = `Root script ${crypto.randomUUID().slice(0, 6)}`;
    let importRequestBody = '';
    let rootScriptId = '';

    await page.route(
      `**/api/documents/${fixture.rootDocument.id}/export-source`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            source: {
              documentId: fixture.rootDocument.id,
              documentName: fixture.rootDocument.name,
              projectId: fixture.projectId,
              folderId: null,
              markdown: ROOT_SNAPSHOT_MARKDOWN,
              token: { epoch: 1, revision: 7 },
              snapshotToken: 'test-snapshot-token',
            },
          }),
        });
      }
    );
    await page.route('**/api/import-script', async (route) => {
      importRequestBody = route.request().postDataBuffer()?.toString('utf8') ?? '';
      rootScriptId = await createDerivedLibrary(admin, fixture, {
        name: rootScriptName,
        sourceDocumentId: fixture.rootDocument.id,
        exportType: 'script',
        folderId: null,
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: `${JSON.stringify({
          type: 'result',
          result: { libraryId: rootScriptId, rowCount: 2, fieldCount: 3 },
        })}\n`,
      });
    });

    await openDocument(page, fixture.owner, fixture, fixture.rootDocument.id);

    const { error: updateError } = await admin
      .from('documents')
      .update({ content: ROOT_CHANGED_MARKDOWN })
      .eq('id', fixture.rootDocument.id);
    if (updateError) throw updateError;

    await sidebarTitle(page, fixture.rootDocument.name).click({ button: 'right' });
    await page.getByRole('button', { name: 'Generate conversation', exact: true }).click();
    await expect(page.getByTestId('document-derived-import-progress')).toContainText(
      /Conversation generated|Generating conversation|Preparing conversation/,
      { timeout: 45_000 }
    );

    expect(importRequestBody).toContain(fixture.rootDocument.id);
    expect(importRequestBody).toContain('test-snapshot-token');
    expect(importRequestBody).toContain('script');

    const { data: library, error } = await admin
      .from('libraries')
      .select('id, folder_id, source_document_id, document_export_type')
      .eq('id', rootScriptId)
      .single();
    if (error) throw error;
    expect(library).toMatchObject({
      id: rootScriptId,
      folder_id: null,
      source_document_id: fixture.rootDocument.id,
      document_export_type: 'script',
    });
    await expect(sidebarTitle(page, rootScriptName)).toHaveCount(1, { timeout: 30_000 });
    await expectTreeParent(page, rootScriptName, fixture.rootDocument.name);
  });
});
