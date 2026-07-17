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
import { captureRealtimeErrors } from '../utils/realtime-errors';

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
  navigationDocumentId: string;
  navigationDocumentName: string;
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
      content: [
        '# Collaborative seed',
        '',
        '## Structure heading',
        '',
        'Owner lane',
        '',
        'Editor lane',
        '',
        'Overlap lane',
        '',
        '- List alpha',
        '- List beta',
        '',
        '> Quote lane',
        '',
        '[Fixture link](https://example.com)',
        '',
        '![Fixture image](https://localhost:3000/document-fixture.png)',
        '',
        '| Column A | Column B |',
        '| --- | --- |',
        '| Table owner | Table editor |',
        '',
        '```text',
        'code-seed',
        '```',
        '',
      ].join('\n'),
      created_by: owner.userId,
    })
    .select('id')
    .single();
  if (documentError || !document?.id) {
    throw documentError ?? new Error('Document fixture was not created');
  }

  const navigationDocumentName = `Navigation target ${suffix}`;
  const { data: navigationDocument, error: navigationDocumentError } =
    await owner.client
      .from('documents')
      .insert({
        project_id: projectId,
        name: navigationDocumentName,
        content: '# Navigation target\n',
        created_by: owner.userId,
      })
      .select('id')
      .single();
  if (navigationDocumentError || !navigationDocument?.id) {
    throw (
      navigationDocumentError ??
      new Error('Navigation document fixture was not created')
    );
  }

  return {
    documentId: document.id,
    navigationDocumentId: navigationDocument.id,
    navigationDocumentName,
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
): Promise<{
  context: BrowserContext;
  page: Page;
  realtimeErrors: readonly string[];
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const realtimeErrors = captureRealtimeErrors(page, credentials.email);
  const login = new LoginPage(page);
  await login.goto();
  await login.login(credentials);
  await login.expectLoginSuccess();
  await page.goto(`/${fixture.projectId}/doc/${fixture.documentId}`, {
    waitUntil: 'domcontentloaded',
  });
  return { context, page, realtimeErrors };
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

async function appendToNode(
  page: Page,
  locator: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  await locator.click();
  await locator.press('End');
  await page.keyboard.insertText(text);
}

async function ensureEditable(page: Page): Promise<void> {
  const editable = page.locator('[contenteditable="true"]').first();
  if (await editable.isVisible()) return;

  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(editable.or(retry)).toBeVisible({ timeout: 30_000 });
  if (await retry.isVisible()) await retry.click();
  await expect(editable).toBeVisible({ timeout: 30_000 });
}

async function insertInsideTextNode(
  page: Page,
  locator: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  await locator.evaluate((element) => {
    const editable = element.closest<HTMLElement>('[contenteditable="true"]');
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      textNode = node as Text;
    }
    if (!editable || !textNode || textNode.data.length === 0) {
      throw new Error('Editable text node is not available');
    }
    editable.focus();
    const range = document.createRange();
    range.setStart(textNode, textNode.data.length - 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.insertText(text);
}

async function insertAtTextStart(
  page: Page,
  locator: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  await locator.evaluate((element) => {
    const editable = element.closest<HTMLElement>('[contenteditable="true"]');
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode() as Text | null;
    if (!editable || !textNode) {
      throw new Error('Editable text node is not available');
    }
    editable.focus();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.insertText(text);
}

async function markerEndPosition(
  locator: ReturnType<Page['locator']>,
  marker: string
): Promise<{ x: number; y: number }> {
  return locator.evaluate((element, expectedMarker) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      const markerIndex = textNode.data.indexOf(expectedMarker);
      if (markerIndex === -1) continue;
      const range = document.createRange();
      range.setStart(textNode, markerIndex + expectedMarker.length);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    }
    throw new Error(`Marker not found in paragraph: ${expectedMarker}`);
  }, marker);
}

type StructureExpectations = {
  heading: string | RegExp;
  list: string;
  quote: string;
  link: string | RegExp;
  table: string;
  code: string;
};

const initialStructure: StructureExpectations = {
  heading: 'Structure heading',
  list: 'List alpha',
  quote: 'Quote lane',
  link: 'Fixture link',
  table: 'Table owner',
  code: 'code-seed',
};

async function expectStructureFixture(
  page: Page,
  expected: StructureExpectations = initialStructure
): Promise<void> {
  const editor = page.locator('.mdxeditor-root-contenteditable').first();
  await expect(editor.getByRole('heading', { name: expected.heading })).toBeVisible();
  await expect(editor.locator('li', { hasText: expected.list })).toBeVisible();
  await expect(editor.locator('blockquote', { hasText: expected.quote })).toBeVisible();
  await expect(editor.getByRole('link', { name: expected.link })).toHaveAttribute(
    'href',
    'https://example.com/'
  );
  await expect(editor.locator('table')).toContainText(expected.table);
  await expect(page.locator('.cm-content', { hasText: expected.code })).toBeVisible();
}

async function expectFixtureImage(page: Page): Promise<void> {
  await expect(page.getByRole('img', { name: 'Fixture image' })).toBeVisible();
}

async function expectDurableFixture(page: Page): Promise<void> {
  const content = page.locator('[contenteditable]').first();
  await expect(content).toContainText('pending-retry', { timeout: 45_000 });
  for (const durableText of [
    'owner-heading',
    'editor-list',
    'owner-quote',
    'editor-link',
    'owner-table',
    'editor-code',
    'owner-overlap',
    'editor-overlap',
    'WIDE-PREFIX-',
  ]) {
    await expect(content).toContainText(durableText);
  }
  await expect(page.getByRole('img', { name: 'Fixture image' })).toHaveCount(0);
  await expectStructureFixture(page, {
    heading: /owner-heading/,
    list: 'editor-list',
    quote: 'owner-quote',
    link: /editor-link/,
    table: 'owner-table',
    code: 'editor-code',
  });
}

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let settled = false;
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    },
  };
}

async function waitForDeferred(
  deferred: Deferred,
  description: string,
  timeout = 30_000
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deferred.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${description}`)),
          timeout
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test.describe.serial('Document realtime collaboration', () => {
  test.setTimeout(360_000);
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
        await expect(page.locator('[contenteditable]').first()).toContainText(
          'Overlap lane'
        );
        await expectStructureFixture(page);
        await expectFixtureImage(page);
      }

      const ownerName = users.seedEmpty2.email.split('@')[0];
      const editorName = users.seedEmpty3.email.split('@')[0];
      const ownerRemoteAvatar = owner.page
        .getByLabel('Collaborators currently editing')
        .getByTitle(`${editorName} is editing`);
      const editorRemoteAvatar = editor.page
        .getByLabel('Collaborators currently editing')
        .getByTitle(`${ownerName} is editing`);
      await expect(ownerRemoteAvatar).toBeVisible({ timeout: 20_000 });
      await expect(ownerRemoteAvatar).toHaveText(
        editorName.charAt(0).toUpperCase()
      );
      await expect(editorRemoteAvatar).toBeVisible({ timeout: 20_000 });
      await expect(editorRemoteAvatar).toHaveText(
        ownerName.charAt(0).toUpperCase()
      );

      await appendToNode(
        owner.page,
        owner.page.getByRole('heading', { name: 'Structure heading' }),
        ' owner-heading'
      );
      await expect(editor.page.locator('[contenteditable]').first()).toContainText(
        'owner-heading',
        { timeout: 30_000 }
      );

      await appendToNode(
        editor.page,
        editor.page.locator('li', { hasText: 'List alpha' }).first(),
        ' editor-list'
      );
      await expect(owner.page.locator('[contenteditable]').first()).toContainText(
        'editor-list',
        { timeout: 30_000 }
      );

      await appendToNode(
        owner.page,
        owner.page.locator('blockquote', { hasText: 'Quote lane' }).first(),
        ' owner-quote'
      );
      await expect(editor.page.locator('[contenteditable]').first()).toContainText(
        'owner-quote',
        { timeout: 30_000 }
      );

      await insertInsideTextNode(
        editor.page,
        editor.page.getByRole('link', { name: 'Fixture link' }),
        ' editor-link'
      );
      await expect(owner.page.getByRole('link', { name: /editor-link/ })).toBeVisible({
        timeout: 30_000,
      });

      const ownerTableCell = owner.page
        .locator('table td:not([data-tool-cell="true"]) [contenteditable="true"]', {
          hasText: 'Table owner',
        })
        .first();
      await appendToNode(owner.page, ownerTableCell, ' owner-table');
      await ownerTableCell.press('Tab');
      await expect(editor.page.locator('table')).toContainText('owner-table', {
        timeout: 30_000,
      });

      const editorCode = editor.page.locator('.cm-content', { hasText: 'code-seed' }).first();
      await appendToNode(editor.page, editorCode, ' editor-code');
      await expect(owner.page.locator('.cm-content').first()).toContainText('editor-code', {
        timeout: 30_000,
      });

      const editorImage = editor.page.getByRole('img', { name: 'Fixture image' });
      await editorImage.click();
      await editor.page.keyboard.press('Delete');
      await expect(owner.page.getByRole('img', { name: 'Fixture image' })).toHaveCount(0, {
        timeout: 30_000,
      });

      const appendPattern = '**/rest/v1/rpc/append_document_yjs_updates';
      const appendRelease = createDeferred();
      const ownerAppendSeen = createDeferred();
      const editorAppendSeen = createDeferred();
      try {
        await owner.page.route(appendPattern, async (route) => {
          ownerAppendSeen.resolve();
          await appendRelease.promise;
          await route.continue();
        });
        await editor.page.route(appendPattern, async (route) => {
          editorAppendSeen.resolve();
          await appendRelease.promise;
          await route.continue();
        });
        await appendText(owner.page, ' owner-overlap', 'Overlap lane', 0);
        await waitForDeferred(ownerAppendSeen, 'owner overlap append');
        await appendText(editor.page, ' editor-overlap', 'Overlap lane', 0);
        await waitForDeferred(editorAppendSeen, 'editor overlap append');
        const ownerAppend = owner.page.waitForResponse(
          (response) =>
            response.url().includes('/rpc/append_document_yjs_updates') &&
            response.ok(),
          { timeout: 30_000 }
        );
        const editorAppend = editor.page.waitForResponse(
          (response) =>
            response.url().includes('/rpc/append_document_yjs_updates') &&
            response.ok(),
          { timeout: 30_000 }
        );
        appendRelease.resolve();
        await Promise.all([ownerAppend, editorAppend]);
      } finally {
        appendRelease.resolve();
        await Promise.allSettled([
          owner.page.unroute(appendPattern),
          editor.page.unroute(appendPattern),
        ]);
      }
      for (const page of [owner.page, editor.page]) {
        const content = page.locator('[contenteditable]').first();
        await expect(content).toContainText('owner-overlap', {
          timeout: 30_000,
        });
        await expect(content).toContainText('editor-overlap', {
          timeout: 30_000,
        });
      }

      await appendText(owner.page, ' cursor-anchor', 'Owner lane', 0);
      await expect(editor.page.locator('[contenteditable]').first()).toContainText(
        'cursor-anchor',
        { timeout: 30_000 }
      );
      const remoteOwnerCursor = editor.page
        .locator('.document-collab-cursors > span > span > span')
        .filter({ hasText: ownerName })
        .first();
      await expect(remoteOwnerCursor).toBeVisible({ timeout: 20_000 });
      const remoteOwnerCaret = remoteOwnerCursor.locator('..');
      const caretBefore = await remoteOwnerCaret.boundingBox();
      const markerBefore = await markerEndPosition(
        editor.page
          .locator('[contenteditable="true"] p', { hasText: 'cursor-anchor' })
          .first(),
        'cursor-anchor'
      );
      expect(caretBefore).not.toBeNull();
      expect(Math.abs(caretBefore!.x - markerBefore.x)).toBeLessThan(8);
      const editorCursorLane = editor.page
        .locator('[contenteditable="true"] p', { hasText: 'Owner lane' })
        .first();
      const adjacentPrefix = 'WIDE-PREFIX-';
      await insertAtTextStart(editor.page, editorCursorLane, adjacentPrefix);
      await expect(owner.page.locator('[contenteditable]').first()).toContainText(
        adjacentPrefix,
        { timeout: 30_000 }
      );
      await expect(remoteOwnerCursor).toBeVisible({ timeout: 20_000 });
      const caretAfter = await remoteOwnerCaret.boundingBox();
      const paragraphBounds = await editorCursorLane.boundingBox();
      const markerAfter = await markerEndPosition(editorCursorLane, 'cursor-anchor');
      expect(caretAfter).not.toBeNull();
      expect(paragraphBounds).not.toBeNull();
      expect(Math.abs(markerAfter.x - markerBefore.x)).toBeGreaterThan(20);
      expect(Math.abs(caretAfter!.x - markerAfter.x)).toBeLessThan(8);
      expect(caretAfter!.x).toBeGreaterThanOrEqual(paragraphBounds!.x);
      expect(caretAfter!.x).toBeLessThanOrEqual(
        paragraphBounds!.x + paragraphBounds!.width
      );
      expect(caretAfter!.y).toBeGreaterThanOrEqual(paragraphBounds!.y - 1);
      expect(caretAfter!.y).toBeLessThanOrEqual(
        paragraphBounds!.y + paragraphBounds!.height + 1
      );

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
      await owner.page.keyboard.insertText('\u6c49');
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
      ).toContainText('\u6c49', {
        timeout: 20_000,
      });
      const remoteText = await editor.page
        .locator('[contenteditable]')
        .first()
        .innerText();
      expect(remoteText.match(/\u6c49/g)).toHaveLength(1);

      const viewer = await loginAndOpen(browser, users.seedEmpty4, fixture);
      contexts.push(viewer.context);
      await expect(viewer.page.getByText('View only - Live')).toBeVisible({
        timeout: 45_000,
      });
      await expect(
        viewer.page.locator('[contenteditable="false"]').first()
      ).toContainText('owner-overlap');
      const viewerRoot = viewer.page.locator(
        '.mdxeditor-root-contenteditable [aria-label="editable markdown"]'
      );
      await expect(viewerRoot).toHaveAttribute('contenteditable', 'false');
      await viewerRoot.click();
      await viewer.page.keyboard.insertText(' viewer-root-forbidden');
      await expect(viewerRoot).not.toContainText('viewer-root-forbidden');
      await expect(
        owner.page.locator('[contenteditable]').first()
      ).not.toContainText('viewer-root-forbidden');
      const viewerCode = viewer.page.locator('.cm-content').first();
      await expect(viewerCode).toHaveAttribute('aria-readonly', 'true');
      await viewerCode.click();
      await viewer.page.keyboard.insertText(' viewer-forbidden');
      await expect(viewerCode).not.toContainText('viewer-forbidden');
      await expect(
        owner.page.locator('[contenteditable]').first()
      ).not.toContainText(
        'viewer-forbidden'
      );

      await editor.context.setOffline(true);
      await ensureEditable(owner.page);
      const durableOwnerLane = owner.page
        .locator('[contenteditable="true"] p', { hasText: 'Owner lane' })
        .first();
      await expect(durableOwnerLane).toBeVisible({ timeout: 30_000 });
      const durableOnlyText = ` durable-catch-up-${Date.now()}`;
      const durableAppendRequest = owner.page.waitForRequest(
        (request) => request.url().includes('/rpc/append_document_yjs_updates'),
        { timeout: 30_000 }
      );
      const durableAppend = owner.page.waitForResponse(
        (response) =>
          response.url().includes('/rpc/append_document_yjs_updates'),
        { timeout: 30_000 }
      );
      await appendText(owner.page, durableOnlyText, 'Owner lane');
      await expect(
        owner.page.locator('[contenteditable="true"]').first()
      ).toContainText(durableOnlyText.trim(), { timeout: 20_000 });
      await durableAppendRequest;
      const durableAppendResponse = await durableAppend;
      expect(
        durableAppendResponse.ok(),
        `Durable append returned HTTP ${durableAppendResponse.status()}`
      ).toBe(true);
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
      await appendToNode(
        owner.page,
        owner.page
          .locator('[contenteditable="true"] p', { hasText: 'Owner lane' })
          .first(),
        ' pending-retry'
      );
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
        owner.page.locator('[contenteditable="true"]').first()
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        editor.page.locator('[contenteditable]').first()
      ).toContainText('pending-retry', { timeout: 30_000 });

      const isolatedReloads = [owner, editor, viewer];
      await Promise.all([
        editor.context.setOffline(true),
        viewer.context.setOffline(true),
      ]);
      for (let index = 0; index < isolatedReloads.length; index += 1) {
        const target = isolatedReloads[index];
        if (index > 0) await target.context.setOffline(false);
        await target.page.reload({ waitUntil: 'domcontentloaded' });
        await expectDurableFixture(target.page);
        if (index < isolatedReloads.length - 1) {
          await target.context.setOffline(true);
        }
      }

      await owner.context.setOffline(false);
      await owner.page.evaluate(() => window.dispatchEvent(new Event('online')));
      const ownerLive = owner.page.getByText('Live', { exact: true });
      const ownerRetry = owner.page.getByRole('button', { name: 'Retry' });
      await expect(ownerLive.or(ownerRetry)).toBeVisible({
        timeout: 30_000,
      });
      if (await ownerRetry.isVisible()) await ownerRetry.click();
      await expect(ownerLive).toBeVisible({ timeout: 30_000 });

      const navigationAppendRelease = createDeferred();
      const navigationAppendSeen = createDeferred();
      let navigationClick: Promise<void> | null = null;
      try {
        await owner.page.route(appendPattern, async (route) => {
          navigationAppendSeen.resolve();
          await navigationAppendRelease.promise;
          await route.continue();
        });
        await appendToNode(
          owner.page,
          owner.page
            .locator('[contenteditable="true"] p', { hasText: 'Owner lane' })
            .first(),
          ' navigation-durable'
        );
        await waitForDeferred(navigationAppendSeen, 'navigation append');
        const sourceUrl = owner.page.url();
        navigationClick = owner.page
          .getByRole('tree')
          .locator(`[title="${fixture.navigationDocumentName}"]`)
          .click();
        await navigationClick;
        await expect(owner.page).toHaveURL(sourceUrl);
        await owner.page.waitForTimeout(1_000);
        await expect(owner.page).toHaveURL(sourceUrl);
        const navigationAppend = owner.page.waitForResponse(
          (response) =>
            response.url().includes('/rpc/append_document_yjs_updates') &&
            response.ok(),
          { timeout: 30_000 }
        );
        navigationAppendRelease.resolve();
        await navigationAppend;
        await expect(owner.page).toHaveURL(
          `/${fixture.projectId}/doc/${fixture.navigationDocumentId}`,
          { timeout: 30_000 }
        );
        await owner.page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
        await expect(owner.page.locator('[contenteditable]').first()).toContainText(
          'navigation-durable',
          { timeout: 45_000 }
        );
      } finally {
        navigationAppendRelease.resolve();
        await navigationClick?.catch(() => undefined);
        await owner.page.unroute(appendPattern).catch(() => undefined);
      }

      expect([
        ...owner.realtimeErrors,
        ...editor.realtimeErrors,
        ...viewer.realtimeErrors,
      ]).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});
