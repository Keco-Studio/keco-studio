import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { LoginPage, type UserCredentials } from '../pages/login.page';
import { users } from '../fixures/users';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type AuthenticatedClient = {
  client: SupabaseClient;
  accessToken: string;
  userId: string;
};

type CollaborationFixture = {
  documentId: string;
  projectId: string;
  owner: AuthenticatedClient;
  editor: AuthenticatedClient;
  viewer: AuthenticatedClient;
  outsider: AuthenticatedClient;
  service: SupabaseClient;
};

function client(key: string): SupabaseClient {
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  return createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function authenticate(
  credentials: UserCredentials
): Promise<AuthenticatedClient> {
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required');
  const authenticated = client(anonKey);
  const { data, error } =
    await authenticated.auth.signInWithPassword(credentials);
  if (error || !data.session?.access_token || !data.user?.id) {
    throw error ?? new Error(`Could not authenticate ${credentials.email}`);
  }
  await authenticated.realtime.setAuth(data.session.access_token);
  return {
    client: authenticated,
    accessToken: data.session.access_token,
    userId: data.user.id,
  };
}

async function createFixture(): Promise<CollaborationFixture> {
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const [owner, editor, viewer, outsider] = await Promise.all([
    authenticate(users.seedEmpty2),
    authenticate(users.seedEmpty3),
    authenticate(users.seedEmpty4),
    authenticate(users.seedEmpty),
  ]);
  const service = client(serviceRoleKey);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: projectData, error: projectError } = await owner.client.rpc(
    'create_project_with_default_resource',
    {
      p_name: `Document Collaboration ${suffix}`,
      p_description: 'Playwright realtime collaboration release gate',
    }
  );
  if (projectError) throw projectError;
  const projectId = String(
    (projectData as { project_id?: unknown } | null)?.project_id ?? ''
  );
  if (!projectId) throw new Error('Project fixture did not return project_id');

  const acceptedAt = new Date().toISOString();
  const { error: membershipError } = await service
    .from('project_collaborators')
    .upsert(
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
  if (membershipError) throw membershipError;

  const { data: document, error: documentError } = await owner.client
    .from('documents')
    .insert({
      project_id: projectId,
      name: `Shared Design ${suffix}`,
      content: '# Collaborative seed\n\nOwner lane\n\nEditor lane\n',
      created_by: owner.userId,
    })
    .select('id')
    .single();
  if (documentError || !document?.id) {
    throw documentError ?? new Error('Document fixture was not created');
  }

  return {
    documentId: document.id,
    projectId,
    owner,
    editor,
    viewer,
    outsider,
    service,
  };
}

function waitForChannelStatus(channel: RealtimeChannel): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out subscribing to ${channel.topic}`)),
      15_000
    );
    channel.subscribe((status) => {
      if (
        status === 'SUBSCRIBED' ||
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT'
      ) {
        clearTimeout(timer);
        resolve(status);
      }
    });
  });
}

async function loginAndOpen(
  browser: Browser,
  credentials: UserCredentials,
  fixture: CollaborationFixture
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.goto();
  await login.login(credentials);
  await login.expectLoginSuccess();
  await page.goto(`/${fixture.projectId}/doc/${fixture.documentId}`, {
    waitUntil: 'domcontentloaded',
  });
  return { context, page };
}

async function appendText(
  page: Page,
  text: string,
  lane = 'Owner lane',
  delay = 15
): Promise<void> {
  const paragraph = page
    .locator('[contenteditable="true"] p', { hasText: lane })
    .first();
  await paragraph.click();
  await paragraph.press('End');
  await page
    .locator('[contenteditable="true"]')
    .first()
    .pressSequentially(text, { delay });
}

test.describe.serial('Document realtime collaboration', () => {
  test.setTimeout(240_000);
  let fixture: CollaborationFixture;

  test.beforeAll(async () => {
    fixture = await createFixture();
  });

  test.afterAll(async () => {
    if (!fixture) return;
    await Promise.all([
      fixture.owner.client.removeAllChannels(),
      fixture.editor.client.removeAllChannels(),
      fixture.viewer.client.removeAllChannels(),
      fixture.outsider.client.removeAllChannels(),
    ]);
    await fixture.service.from('projects').delete().eq('id', fixture.projectId);
  });

  test('authorizes the private document channel by project role', async () => {
    const topic = `doc-collab:${fixture.documentId}`;
    const receivedSenders: string[] = [];
    const makeChannel = (authenticated: AuthenticatedClient) =>
      authenticated.client.channel(topic, {
        config: { private: true, broadcast: { self: false } },
      });
    const ownerChannel = makeChannel(fixture.owner);
    ownerChannel.on(
      'broadcast',
      { event: 'authorization-probe' },
      ({ payload }) => {
        const sender = (payload as { sender?: unknown }).sender;
        if (typeof sender === 'string') receivedSenders.push(sender);
      }
    );
    const editorChannel = makeChannel(fixture.editor);
    const viewerChannel = makeChannel(fixture.viewer);
    const outsiderChannel = makeChannel(fixture.outsider);

    expect(await waitForChannelStatus(ownerChannel)).toBe('SUBSCRIBED');
    expect(await waitForChannelStatus(editorChannel)).toBe('SUBSCRIBED');
    expect(await waitForChannelStatus(viewerChannel)).toBe('SUBSCRIBED');
    expect(await waitForChannelStatus(outsiderChannel)).not.toBe('SUBSCRIBED');

    const probe = (sender: string) => ({
      type: 'broadcast' as const,
      event: 'authorization-probe',
      payload: { documentId: fixture.documentId, sender },
    });
    expect(await editorChannel.send(probe('editor'))).toBe('ok');
    await expect
      .poll(() => receivedSenders, { timeout: 10_000 })
      .toContain('editor');

    await viewerChannel.send(probe('viewer'));
    await viewerChannel.track({
      documentId: fixture.documentId,
      sender: 'viewer',
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(receivedSenders).not.toContain('viewer');
    expect(ownerChannel.presenceState()).toEqual({});

    await Promise.all([
      fixture.owner.client.removeChannel(ownerChannel),
      fixture.editor.client.removeChannel(editorChannel),
      fixture.viewer.client.removeChannel(viewerChannel),
      fixture.outsider.client.removeChannel(outsiderChannel),
    ]);
  });

  test('converges editors, cursors, IME, Undo/Redo, viewer, and durable recovery', async ({
    browser,
  }) => {
    const owner = await loginAndOpen(browser, users.seedEmpty2, fixture);
    const contexts: BrowserContext[] = [owner.context];
    try {
      await expect(owner.page.getByText('Live', { exact: true })).toBeVisible({
        timeout: 45_000,
      });
      const editor = await loginAndOpen(browser, users.seedEmpty3, fixture);
      contexts.push(editor.context);
      await expect(editor.page.getByText('Live', { exact: true })).toBeVisible({
        timeout: 45_000,
      });
      for (const page of [owner.page, editor.page]) {
        await expect(page.locator('.document-collab-cursors')).toHaveCount(1);
        await expect(page.locator('[contenteditable]').first()).toContainText(
          'Collaborative seed'
        );
        await expect(page.locator('[contenteditable]').first()).toContainText(
          'Owner lane'
        );
        await expect(page.locator('[contenteditable]').first()).toContainText(
          'Editor lane'
        );
      }

      const appendPattern = '**/rest/v1/rpc/append_document_yjs_updates';
      let releaseAppends!: () => void;
      let markOwnerAppendSeen!: () => void;
      let markEditorAppendSeen!: () => void;
      const appendRelease = new Promise<void>((resolve) => {
        releaseAppends = resolve;
      });
      const ownerAppendSeen = new Promise<void>((resolve) => {
        markOwnerAppendSeen = resolve;
      });
      const editorAppendSeen = new Promise<void>((resolve) => {
        markEditorAppendSeen = resolve;
      });
      await owner.page.route(appendPattern, async (route) => {
        markOwnerAppendSeen();
        await appendRelease;
        await route.continue();
      });
      await editor.page.route(appendPattern, async (route) => {
        markEditorAppendSeen();
        await appendRelease;
        await route.continue();
      });

      const ownerAppend = owner.page.waitForResponse(
        (response) =>
          response.url().includes('/rpc/append_document_yjs_updates') &&
          response.ok()
      );
      const editorAppend = editor.page.waitForResponse(
        (response) =>
          response.url().includes('/rpc/append_document_yjs_updates') &&
          response.ok()
      );
      await appendText(owner.page, ' owner-concurrent', 'Owner lane', 0);
      await ownerAppendSeen;
      await appendText(editor.page, ' editor-concurrent', 'Editor lane', 0);
      await editorAppendSeen;
      releaseAppends();
      await Promise.all([ownerAppend, editorAppend]);
      await Promise.all([
        owner.page.unroute(appendPattern),
        editor.page.unroute(appendPattern),
      ]);
      for (const page of [owner.page, editor.page]) {
        const content = page.locator('[contenteditable]').first();
        await expect(content).toContainText('owner-concurrent', {
          timeout: 30_000,
        });
        await expect(content).toContainText('editor-concurrent', {
          timeout: 30_000,
        });
      }

      await owner.page.locator('[contenteditable="true"]').first().click();
      await expect(
        editor.page
          .locator('.document-collab-cursors')
          .filter({ hasText: /\S+/ })
      ).toBeVisible({ timeout: 20_000 });

      await appendText(owner.page, ' undo-local');
      await expect(
        editor.page.locator('[contenteditable]').first()
      ).toContainText('undo-local', { timeout: 20_000 });
      await owner.page.keyboard.press('Control+z');
      await expect(
        editor.page.locator('[contenteditable]').first()
      ).not.toContainText('undo-local', { timeout: 20_000 });
      await owner.page.keyboard.press('Control+Shift+z');
      await expect(
        editor.page.locator('[contenteditable]').first()
      ).toContainText('undo-local', { timeout: 20_000 });

      const ownerEditor = owner.page
        .locator('[contenteditable="true"] p', { hasText: 'Owner lane' })
        .first();
      await ownerEditor.click();
      await ownerEditor.press('End');
      const ownerContentEditable = owner.page
        .locator('[contenteditable="true"]')
        .first();
      await ownerContentEditable.evaluate((element) => {
        element.dispatchEvent(
          new CompositionEvent('compositionstart', {
            bubbles: true,
            data: '',
          })
        );
      });
      await owner.page.keyboard.insertText('han');
      await owner.page.waitForTimeout(150);
      await expect(ownerContentEditable).toContainText('han');
      await expect(
        editor.page.locator('[contenteditable]').first()
      ).not.toContainText('han');
      await owner.page.keyboard.press('Shift+ArrowLeft');
      await owner.page.keyboard.press('Shift+ArrowLeft');
      await owner.page.keyboard.press('Shift+ArrowLeft');
      await owner.page.keyboard.insertText('汉');
      await ownerContentEditable.evaluate((element) => {
        element.dispatchEvent(
          new CompositionEvent('compositionend', {
            bubbles: true,
            data: '',
          })
        );
      });
      await expect(
        editor.page.locator('[contenteditable]').first()
      ).toContainText('汉', {
        timeout: 20_000,
      });
      const remoteText = await editor.page
        .locator('[contenteditable]')
        .first()
        .innerText();
      expect(remoteText.match(/汉/g)).toHaveLength(1);

      const viewer = await loginAndOpen(browser, users.seedEmpty4, fixture);
      contexts.push(viewer.context);
      await expect(viewer.page.getByText('View only - Live')).toBeVisible({
        timeout: 45_000,
      });
      await expect(
        viewer.page.locator('[contenteditable="false"]').first()
      ).toContainText('owner-concurrent');
      await expect(viewer.page.locator('[contenteditable="true"]')).toHaveCount(
        0
      );

      await editor.context.setOffline(true);
      const durableOnlyText = ` durable-catch-up-${Date.now()}`;
      const durableAppend = owner.page.waitForResponse(
        (response) =>
          response.url().includes('/rpc/append_document_yjs_updates') &&
          response.ok()
      );
      await appendText(owner.page, durableOnlyText);
      await durableAppend;
      await editor.context.setOffline(false);
      await editor.page.bringToFront();
      await editor.page.evaluate(() =>
        window.dispatchEvent(new Event('online'))
      );
      await expect(
        editor.page.locator('[contenteditable]').first()
      ).toContainText(durableOnlyText.trim(), { timeout: 30_000 });

      await owner.page.route(
        '**/rest/v1/rpc/append_document_yjs_updates',
        (route) => route.abort('failed')
      );
      await appendText(owner.page, ' pending-retry', 'Owner lane', 0);
      await expect(
        owner.page.getByRole('alert').getByText(/connection interrupted/i)
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        owner.page.locator('[contenteditable="false"]').first()
      ).toBeVisible();
      await owner.page.unroute('**/rest/v1/rpc/append_document_yjs_updates');
      await owner.page.getByRole('button', { name: 'Retry' }).click();
      await expect(owner.page.getByText('Live', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        editor.page.locator('[contenteditable]').first()
      ).toContainText('pending-retry', { timeout: 30_000 });

      await Promise.all([
        owner.page.reload(),
        editor.page.reload(),
        viewer.page.reload(),
      ]);
      for (const page of [owner.page, editor.page, viewer.page]) {
        await expect(page.locator('[contenteditable]').first()).toContainText(
          'pending-retry',
          { timeout: 45_000 }
        );
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
