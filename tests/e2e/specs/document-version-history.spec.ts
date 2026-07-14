import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

async function appendDraft(page: Page): Promise<void> {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.locator('p').first().click();
  await editor.press('End');
  await editor.pressSequentially(' newer-draft', { delay: 15 });
  await expect(editor).toContainText('newer-draft');
}

test.describe.serial('Document version history', () => {
  test.setTimeout(240_000);
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
    const owner = await openDocument(browser, users.seedEmpty2, fixture);
    const editor = await openDocument(browser, users.seedEmpty3, fixture);
    const viewer = await openDocument(browser, users.seedEmpty4, fixture, 'viewer');
    contexts.push(owner.context, editor.context, viewer.context);

    try {
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

      await appendDraft(owner.page);
      await expect(editor.page.locator('[contenteditable="true"]').first()).toContainText(
        'newer-draft',
        { timeout: 30_000 }
      );

      await viewer.page.getByTestId('version-history-toggle').click();
      await expect(viewer.page.getByRole('button', { name: 'Preview' }).first()).toBeVisible();
      await expect(viewer.page.getByRole('button', { name: 'Create version' })).toHaveCount(0);
      await expect(viewer.page.getByRole('button', { name: 'Restore' })).toHaveCount(0);
      await viewer.page.getByRole('button', { name: 'Preview' }).first().click();
      await expect(viewer.page.getByRole('dialog')).toContainText('Collaborative seed');
      await viewer.page.getByRole('button', { name: 'Close' }).last().click();

      await savedRow.getByRole('button', { name: 'Restore' }).click();
      const restoreDialog = owner.page.getByRole('dialog', { name: 'Restore version' });
      await expect(restoreDialog).toContainText('backup');
      await restoreDialog.getByRole('button', { name: 'Restore', exact: true }).click();

      await expect(owner.page.locator('[contenteditable="true"]').first()).not.toContainText(
        'newer-draft',
        { timeout: 30_000 }
      );
      await expect(editor.page.locator('[contenteditable="true"]').first()).not.toContainText(
        'newer-draft',
        { timeout: 30_000 }
      );
      await expect(viewer.page.locator('[contenteditable="false"]').first()).not.toContainText(
        'newer-draft',
        { timeout: 30_000 }
      );

      await owner.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(owner.page.locator('[contenteditable="true"]').first()).toContainText(
        'Collaborative seed',
        { timeout: 30_000 }
      );
      await expect(owner.page.locator('[contenteditable="true"]').first()).not.toContainText(
        'newer-draft'
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
