import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { LoginPage } from '../pages/login.page';
import { users } from '../fixures/users';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type AuthenticatedClient = {
  client: SupabaseClient;
  userId: string;
};

type Fixture = {
  projectId: string;
  documentId: string;
  owner: AuthenticatedClient;
  editor: AuthenticatedClient;
  viewer: AuthenticatedClient;
  service: SupabaseClient;
};

function makeClient(key: string): SupabaseClient {
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  return createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function authenticate(credentials: { email: string; password: string }) {
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required');
  const client = makeClient(anonKey);
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error || !data.user) throw error ?? new Error('Authentication failed');
  return { client, userId: data.user.id };
}

async function createFixture(): Promise<Fixture> {
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const [owner, editor, viewer] = await Promise.all([
    authenticate(users.seedEmpty2),
    authenticate(users.seedEmpty3),
    authenticate(users.seedEmpty4),
  ]);
  const service = makeClient(serviceRoleKey);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const projectResult = await owner.client.rpc('create_project_with_default_resource', {
    p_name: `Document Versions ${suffix}`,
    p_description: 'Document version history browser gate',
  });
  if (projectResult.error) throw projectResult.error;
  const projectId = String(
    (projectResult.data as { project_id?: unknown } | null)?.project_id ?? ''
  );
  if (!projectId) throw new Error('Project fixture did not return an id');

  const acceptedAt = new Date().toISOString();
  const membership = await service.from('project_collaborators').upsert(
    [
      {
        project_id: projectId,
        user_id: editor.userId,
        role: 'editor',
        invited_by: owner.userId,
        accepted_at: acceptedAt,
      },
      {
        project_id: projectId,
        user_id: viewer.userId,
        role: 'viewer',
        invited_by: owner.userId,
        accepted_at: acceptedAt,
      },
    ],
    { onConflict: 'user_id,project_id' }
  );
  if (membership.error) throw membership.error;

  const documentResult = await owner.client
    .from('documents')
    .insert({
      project_id: projectId,
      name: `Versioned document ${suffix}`,
      content: '# Collaborative seed\n\nOwner lane\n\nEditor lane\n',
      created_by: owner.userId,
    })
    .select('id')
    .single();
  if (documentResult.error || !documentResult.data) {
    throw documentResult.error ?? new Error('Document fixture failed');
  }
  return {
    projectId,
    documentId: documentResult.data.id as string,
    owner,
    editor,
    viewer,
    service,
  };
}

async function openDocument(
  browser: Browser,
  credentials: { email: string; password: string },
  fixture: Fixture,
  role: 'editor' | 'viewer' = 'editor'
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.login(credentials);
  await login.expectLoginSuccess();
  await page.goto(`/${fixture.projectId}/doc/${fixture.documentId}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    page.getByText(role === 'viewer' ? 'View only - Live' : 'Live', { exact: true })
  ).toBeVisible({ timeout: 45_000 });
  return { page, context };
}

async function appendDraft(page: Page, lane: string, text: string): Promise<void> {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.locator('p', { hasText: lane }).first().click();
  await editor.press('End');
  await editor.pressSequentially(text, { delay: 15 });
  await expect(editor).toContainText(text.trim());
}

const REHYDRATE_PROBE = '__documentVersionRehydrateProbe';

async function installRehydrateProbe(page: Page): Promise<void> {
  await page.evaluate((probeKey) => {
    const rootSelector =
      '.mdxeditor-root-contenteditable [aria-label="editable markdown"]';
    const findLiveRoot = () =>
      [...document.querySelectorAll(rootSelector)].find(
        (root) => !root.closest('[role="dialog"]')
      ) ?? null;
    const initialRoot = findLiveRoot();
    if (!initialRoot) throw new Error('Document editor root is not mounted');
    initialRoot.setAttribute('data-live-document-editor', 'true');
    const probe = { count: 0, currentRoot: initialRoot };
    const seenRoots = new WeakSet<Element>([initialRoot]);
    const markRoot = (nextRoot: Element) => {
      if (!nextRoot.closest('[role="dialog"]') && !seenRoots.has(nextRoot)) {
        probe.currentRoot.removeAttribute('data-live-document-editor');
        nextRoot.setAttribute('data-live-document-editor', 'true');
        probe.currentRoot = nextRoot;
        seenRoots.add(nextRoot);
        probe.count += 1;
      }
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(rootSelector)) markRoot(node);
          node.querySelectorAll(rootSelector).forEach(markRoot);
        }
      }
      const currentRoot = findLiveRoot();
      if (currentRoot) markRoot(currentRoot);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    (window as unknown as Record<string, unknown>)[probeKey] = probe;
  }, REHYDRATE_PROBE);
}

async function rehydrateCount(page: Page): Promise<number> {
  return page.evaluate((probeKey) => {
    const probe = (window as unknown as Record<string, { count?: unknown }>)[
      probeKey
    ];
    return typeof probe?.count === 'number' ? probe.count : -1;
  }, REHYDRATE_PROBE);
}

async function expectExactlyOneRehydrate(pages: Page[]): Promise<void> {
  for (const page of pages) {
    await expect
      .poll(() => rehydrateCount(page), { timeout: 30_000 })
      .toBe(1);
  }
  await Promise.all(pages.map((page) => page.waitForTimeout(1_000)));
  for (const page of pages) {
    expect(await rehydrateCount(page)).toBe(1);
  }
}

function validYjsUpdateBase64(text: string): string {
  const document = new Y.Doc();
  document.getText('stale').insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64');
}

test.describe.serial('Document version history', () => {
  test.setTimeout(360_000);
  let fixture: Fixture;

  test.beforeAll(async () => {
    fixture = await createFixture();
  });

  test.afterAll(async () => {
    if (!fixture) return;
    await Promise.all([
      fixture.owner.client.removeAllChannels(),
      fixture.editor.client.removeAllChannels(),
      fixture.viewer.client.removeAllChannels(),
    ]);
    await fixture.service.from('projects').delete().eq('id', fixture.projectId);
  });

  test('creates, previews, restores, and rehydrates a version across roles', async ({ browser }) => {
    const contexts: BrowserContext[] = [];
    try {
      const owner = await openDocument(browser, users.seedEmpty2, fixture);
      contexts.push(owner.context);
      const editor = await openDocument(browser, users.seedEmpty3, fixture);
      contexts.push(editor.context);
      const viewer = await openDocument(browser, users.seedEmpty4, fixture, 'viewer');
      contexts.push(viewer.context);

      for (const page of [owner.page, editor.page]) {
        await expect(page.locator('[contenteditable="true"]').first()).toContainText(
          'Collaborative seed'
        );
      }

      await owner.page.getByTestId('version-history-toggle').click();
      await owner.page.getByRole('button', { name: 'Create version' }).click();
      await owner.page.getByTestId('version-name-input').fill('Before rewrite');
      await owner.page.getByRole('button', { name: 'Create', exact: true }).click();
      const savedRow = owner.page
        .locator('[data-testid^="document-version-row-"]')
        .filter({ hasText: 'Before rewrite' });
      await expect(savedRow).toBeVisible({ timeout: 30_000 });

      await appendDraft(owner.page, 'Owner lane', ' owner-newer');
      await expect(editor.page.locator('[contenteditable="true"]').first()).toContainText(
        'owner-newer',
        { timeout: 30_000 }
      );
      await appendDraft(editor.page, 'Editor lane', ' editor-newer');
      for (const page of [owner.page, editor.page]) {
        const content = page.locator('[contenteditable="true"]').first();
        await expect(content).toContainText('owner-newer', { timeout: 30_000 });
        await expect(content).toContainText('editor-newer', { timeout: 30_000 });
      }

      await viewer.page.getByTestId('version-history-toggle').click();
      await expect(viewer.page.getByRole('button', { name: 'Preview' }).first()).toBeVisible();
      await expect(viewer.page.getByRole('button', { name: 'Create version' })).toHaveCount(0);
      await expect(viewer.page.getByRole('button', { name: 'Restore' })).toHaveCount(0);
      await viewer.page.getByRole('button', { name: 'Preview' }).first().click();
      await expect(viewer.page.getByRole('dialog')).toContainText('Collaborative seed');
      await viewer.page.getByRole('button', { name: 'Close' }).last().click();

      const oldEpochResult = await fixture.editor.client
        .from('documents')
        .select('collab_epoch')
        .eq('id', fixture.documentId)
        .single();
      if (oldEpochResult.error || !oldEpochResult.data) {
        throw oldEpochResult.error ?? new Error('Could not read pre-restore epoch');
      }
      const oldEpoch = Number(oldEpochResult.data.collab_epoch);
      await Promise.all(
        [owner.page, editor.page, viewer.page].map((page) =>
          installRehydrateProbe(page)
        )
      );

      await savedRow.getByRole('button', { name: 'Restore' }).click();
      const restoreDialog = owner.page.getByRole('dialog', { name: 'Restore version' });
      await expect(restoreDialog).toContainText('backup');
      await restoreDialog.getByRole('button', { name: 'Restore', exact: true }).click();

      await expectExactlyOneRehydrate([owner.page, editor.page, viewer.page]);

      for (const page of [owner.page, editor.page, viewer.page]) {
        const liveRoot = page.locator('[data-live-document-editor="true"]');
        await expect(liveRoot).toContainText('Collaborative seed', {
          timeout: 30_000,
        });
        await expect(liveRoot).not.toContainText('owner-newer', {
          timeout: 30_000,
        });
        await expect(liveRoot).not.toContainText('editor-newer', {
          timeout: 30_000,
        });
      }

      const beforeRestoreRow = owner.page
        .locator('[data-testid^="document-version-row-"]')
        .filter({ hasText: 'Before restore' });
      const restoredAuditRow = owner.page
        .locator('[data-testid^="document-version-row-"]')
        .filter({ hasText: 'Restored: Before rewrite' });
      await expect(beforeRestoreRow).toBeVisible({ timeout: 30_000 });
      await expect(beforeRestoreRow).toContainText('Before restore');
      await expect(restoredAuditRow).toBeVisible({ timeout: 30_000 });
      await expect(restoredAuditRow).toContainText('Restore');

      const staleAppend = await fixture.editor.client.rpc(
        'append_document_yjs_updates',
        {
          p_document_id: fixture.documentId,
          p_epoch: oldEpoch,
          p_updates: [
            {
              id: crypto.randomUUID(),
              updateBase64: validYjsUpdateBase64('stale-newer-content'),
            },
          ],
        }
      );
      expect(staleAppend.data).toBeNull();
      expect(staleAppend.error?.code).toBe('PT409');

      const newEpochResult = await fixture.service
        .from('documents')
        .select('collab_epoch')
        .eq('id', fixture.documentId)
        .single();
      expect(newEpochResult.error).toBeNull();
      expect(Number(newEpochResult.data?.collab_epoch)).toBe(oldEpoch + 1);

      await expect(viewer.page.getByRole('button', { name: 'Preview' }).first()).toBeVisible();
      await expect(viewer.page.getByRole('button', { name: 'Create version' })).toHaveCount(0);
      await expect(viewer.page.getByRole('button', { name: 'Restore' })).toHaveCount(0);

      for (const page of [owner.page, editor.page, viewer.page]) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        const content = page.locator('[contenteditable]').first();
        await expect(content).toContainText('Collaborative seed', {
          timeout: 45_000,
        });
        await expect(content).not.toContainText('owner-newer');
        await expect(content).not.toContainText('editor-newer');
        await expect(content).not.toContainText('stale-newer-content');
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
