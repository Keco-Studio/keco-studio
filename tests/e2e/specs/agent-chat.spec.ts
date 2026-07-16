import { expect, test, type Page, type Route } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AgentPage } from '../pages/agent.page';
import { LoginPage } from '../pages/login.page';
import {
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

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

test.describe('Agent chat', () => {
  test.describe.configure({ mode: 'serial', timeout: 120000 });

  let admin: SupabaseClient;
  let owner: TemporaryUser;
  let projectId: string;
  let firstDocumentId: string;
  let secondDocumentId: string;

  async function openProject(page: Page): Promise<AgentPage> {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(owner);
    await loginPage.expectLoginSuccess();
    await page.goto(`/${projectId}`);
    const agent = new AgentPage(page);
    await agent.open();
    return agent;
  }

  test.beforeAll(async () => {
    admin = getE2EAdminClient();
    owner = await createTemporaryUser(admin, 'agent-chat-owner');
    projectId = await createProjectFixture(admin, owner.id);
    const { data, error } = await admin
      .from('documents')
      .insert([
        { project_id: projectId, name: 'Agent Current Document One', content: '', created_by: owner.id },
        { project_id: projectId, name: 'Agent Current Document Two', content: '', created_by: owner.id },
      ])
      .select('id');
    if (error || !data || data.length !== 2) {
      throw error ?? new Error('Could not create agent document fixtures');
    }
    [firstDocumentId, secondDocumentId] = data.map((row) => row.id);
  });

  test.afterAll(async () => {
    if (projectId) await removeProjectFixture(admin, projectId);
    if (owner) await deleteTemporaryUser(admin, owner);
  });

  test('renders a streamed assistant response', async ({ page }) => {
    await page.route('**/api/agent-chat', async (route) => {
      const body = route.request().postDataJSON() as { projectId?: string; message?: string };
      expect(body).toMatchObject({ projectId, message: 'Give me a status update' });
      await fulfillAgentStream(route, crypto.randomUUID(), [
        { type: 'text_delta', content: 'Project status: ' },
        { type: 'text_delta', content: 'ready for review.' },
      ]);
    });

    const agent = await openProject(page);
    await agent.send('Give me a status update');

    await expect(page.getByTestId('agent-message-assistant')).toContainText(
      'Project status: ready for review.'
    );
  });

  test('sends live document context on every turn without rebinding the conversation', async ({ page }) => {
    const conversationId = crypto.randomUUID();
    const bodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/agent-chat', async (route) => {
      bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await fulfillAgentStream(route, conversationId, [
        { type: 'text_delta', content: `Reply ${bodies.length}` },
      ]);
    });

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(owner);
    await loginPage.expectLoginSuccess();
    await page.goto(`/${projectId}/doc/${firstDocumentId}`);
    const agent = new AgentPage(page);
    await agent.open();
    await agent.send('First document turn');
    await expect(page.getByTestId('agent-message-assistant')).toContainText('Reply 1');

    expect(bodies[0]).toMatchObject({
      projectId,
      currentDocumentId: firstDocumentId,
      message: 'First document turn',
    });

    await page.locator(`[data-node-key="document-${secondDocumentId}"]`).click();
    await expect(page).toHaveURL(`/${projectId}/doc/${secondDocumentId}`);
    await expect(agent.panel).toBeVisible();
    await agent.send('Second document turn');
    await expect(page.getByTestId('agent-message-assistant')).toContainText('Reply 2');

    expect(bodies[1]).toMatchObject({
      conversationId,
      currentDocumentId: secondDocumentId,
      message: 'Second document turn',
    });
    expect(bodies[1]).not.toHaveProperty('projectId');
    expect(bodies[1]).not.toHaveProperty('currentFolderId');
    expect(bodies[1]).not.toHaveProperty('currentFolderName');
    expect(bodies[1]).not.toHaveProperty('currentLibraryId');
    expect(bodies[1]).not.toHaveProperty('currentLibraryName');
    expect(bodies[1]).not.toHaveProperty('currentSectionName');
  });

  test('approves a confirmation and resumes the turn', async ({ page }) => {
    const actionId = crypto.randomUUID();
    await page.route('**/api/agent-chat', async (route) => {
      await fulfillAgentStream(route, crypto.randomUUID(), [{
        type: 'confirmation_request',
        actionId,
        tool: 'create_asset',
        args: { name: 'E2E asset' },
        confirmationMode: 'pre_execute',
      }]);
    });
    await page.route('**/api/agent-chat/confirm', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ actionId, decision: 'approve' });
      await fulfillAgentStream(route, crypto.randomUUID(), [
        { type: 'text_delta', content: 'The asset was created.' },
      ]);
    });

    const agent = await openProject(page);
    await agent.send('Create an asset');
    const confirmation = page.getByTestId('agent-confirmation');
    await expect(confirmation).toContainText('Confirm: Create asset');
    await confirmation.getByTestId('agent-confirm').click();

    await expect(confirmation).toContainText('Approved.');
    await expect(page.getByTestId('agent-message-assistant')).toContainText(
      'The asset was created.'
    );
  });

  test('restores a selected conversation after reload', async ({ page }) => {
    const conversationId = crypto.randomUUID();
    const prompt = 'Remember this conversation';
    const answer = 'This conversation is persisted.';

    await page.route('**/api/agent-chat', async (route) => {
      await fulfillAgentStream(route, conversationId, [{ type: 'text_delta', content: answer }]);
    });
    await page.route(`**/api/agent-chat/conversations/${conversationId}/messages?limit=200`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [
            { id: crypto.randomUUID(), role: 'user', content: { content: prompt } },
            { id: crypto.randomUUID(), role: 'assistant', content: { content: answer } },
          ],
        }),
      });
    });
    await page.route(`**/api/agent-chat/conversations/${conversationId}/meta`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ meta: { autoExecute: false, scope: { level: 'project' } } }),
      });
    });
    await page.route('**/api/agent-chat/conversations?scope=all', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversations: [{
            id: conversationId,
            projectId,
            projectName: 'E2E project',
            title: 'Remembered conversation',
            updatedAt: new Date().toISOString(),
          }],
        }),
      });
    });

    const agent = await openProject(page);
    await agent.send(prompt);
    await expect(page.getByTestId('agent-message-assistant')).toContainText(answer);
    await agent.historyButton.click();
    await page.getByTestId(`agent-conversation-${conversationId}`).click();
    await expect(page.getByTestId('agent-message-assistant')).toContainText(answer);

    await page.reload();
    await agent.open();
    await expect(page.getByTestId('agent-message-user')).toContainText(prompt);
    await expect(page.getByTestId('agent-message-assistant')).toContainText(answer);
  });
});
