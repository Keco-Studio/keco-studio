import { expect, test, type Page, type Route } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Document, Packer, Paragraph } from 'docx';
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

  test('renders markdown and one expandable reasoning summary', async ({ page }) => {
    await page.route('**/api/agent-chat', async (route) => {
      await fulfillAgentStream(route, crypto.randomUUID(), [
        { type: 'reasoning_delta', content: '   ' },
        { type: 'reasoning_delta', content: '先检查项目。' },
        { type: 'tool_call_start', tool: 'list_project_structure', args: '{}' },
        { type: 'tool_call_end' },
        {
          type: 'tool_result',
          tool: 'list_project_structure',
          success: true,
          data: { ok: true },
        },
        { type: 'reasoning_delta', content: '正在汇总结果。' },
        {
          type: 'text_delta',
          content: '**完成**\n\n| 功能 | 状态 |\n| --- | --- |\n| 文档 | OK |',
        },
      ]);
    });

    const agent = await openProject(page);
    await agent.send('Show Markdown status');

    const assistant = page.getByTestId('agent-message-assistant');
    await expect(assistant).toHaveCount(1);
    await expect(assistant.locator('strong')).toHaveText('完成');
    await expect(assistant.locator('table')).toContainText('文档');
    const reasoning = assistant.getByRole('button');
    await expect(reasoning).toContainText('正在汇总结果');
    await reasoning.click();
    await expect(assistant).toContainText('先检查项目。');
    await expect(assistant).toContainText('正在汇总结果。');
  });

  test('routes a DOCX chat attachment to analysis intent', async ({ page }) => {
    const docx = await Packer.toBuffer(new Document({
      sections: [{ children: [new Paragraph('Visible DOCX content')] }],
    }));

    await page.route('**/api/agent-chat', async (route) => {
      const body = route.request().postDataJSON() as { message?: string };
      expect(body.message).toContain('[Document attachment]');
      expect(body.message).toContain('[Document intent]\nanalyze');
      expect(body.message).toContain('[User instructions]\nWhat is in this file?');
      expect(body.message).toContain('Visible DOCX content');
      expect(body.message).not.toContain('First call list_project_structure and list_field_types');
      await fulfillAgentStream(route, crypto.randomUUID(), [
        { type: 'text_delta', content: 'The file contains visible DOCX content.' },
      ]);
    });

    const agent = await openProject(page);
    await agent.panel.locator('input[type="file"]').setInputFiles({
      name: 'visible.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docx,
    });
    await agent.send('What is in this file?');

    await expect(page.getByTestId('agent-message-assistant')).toContainText(
      'The file contains visible DOCX content.'
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

    // Ant Design Tree does not expose data-node-key; document rows use title=name.
    const secondDocument = page.locator('aside').locator('[title="Agent Current Document Two"]');
    await expect(secondDocument).toBeVisible({ timeout: 20000 });
    await secondDocument.click();
    await expect(page).toHaveURL(`/${projectId}/doc/${secondDocumentId}`);
    await expect(agent.panel).toBeVisible();
    await agent.send('Second document turn');
    await expect(
      page.getByTestId('agent-message-assistant').filter({ hasText: 'Reply 2' })
    ).toBeVisible();

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

  test('keeps current document A while explicitly targeting document B', async ({ page }) => {
    const prompt = 'Read Agent Current Document Two explicitly';
    await page.route('**/api/agent-chat', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        projectId,
        currentDocumentId: firstDocumentId,
        message: prompt,
      });
      await fulfillAgentStream(route, crypto.randomUUID(), [
        {
          type: 'tool_call_start',
          tool: 'read_document',
          args: JSON.stringify({ documentId: secondDocumentId }),
        },
        { type: 'tool_call_end' },
        {
          type: 'tool_result',
          tool: 'read_document',
          success: true,
          displayHint: 'text',
          data: {
            documentId: secondDocumentId,
            name: 'Agent Current Document Two',
            markdown: '# Explicit B',
          },
        },
      ]);
    });

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(owner);
    await loginPage.expectLoginSuccess();
    await page.goto(`/${projectId}/doc/${firstDocumentId}`);
    const agent = new AgentPage(page);
    await agent.open();
    await agent.send(prompt);

    const result = agent.toolResult('read_document', 'success');
    await result.click();
    await expect(result).toContainText(secondDocumentId);
    await expect(result).toContainText('Agent Current Document Two');
    await expect(page).toHaveURL(`/${projectId}/doc/${firstDocumentId}`);
  });

  test('renders duplicate document candidates and stops the tool', async ({ page }) => {
    await page.route('**/api/agent-chat', async (route) => {
      await fulfillAgentStream(route, crypto.randomUUID(), [
        {
          type: 'tool_call_start',
          tool: 'read_document',
          args: JSON.stringify({ documentName: 'Duplicate Guide' }),
        },
        { type: 'tool_call_end' },
        {
          type: 'tool_result',
          tool: 'read_document',
          success: false,
          error: 'Multiple documents named "Duplicate Guide" were found in this project.',
          data: {
            candidates: [
              { id: firstDocumentId, name: 'Duplicate Guide', folderName: 'Lore' },
              { id: secondDocumentId, name: 'Duplicate Guide', folderName: 'Archive' },
            ],
          },
        },
      ]);
    });

    const agent = await openProject(page);
    await agent.send('Read Duplicate Guide');

    const result = agent.toolResult('read_document', 'failure');
    await result.click();
    await expect(result).toContainText('Multiple documents named');
    await expect(result).toContainText('Lore');
    await expect(result).toContainText('Archive');
  });

  test('renders an Auto-mode document edit result', async ({ page }) => {
    await page.route('**/api/agent-chat', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        projectId,
        autoExecute: true,
        message: 'Append the approved note',
      });
      await fulfillAgentStream(route, crypto.randomUUID(), [
        {
          type: 'tool_call_start',
          tool: 'propose_document_edit',
          args: JSON.stringify({
            documentId: firstDocumentId,
            operation: { type: 'append', content: 'Approved note' },
          }),
        },
        { type: 'tool_call_end' },
        {
          type: 'tool_result',
          tool: 'propose_document_edit',
          success: true,
          displayHint: 'text',
          data: { documentId: firstDocumentId, token: { epoch: 1, revision: 2 } },
        },
        {
          type: 'cache_invalidated',
          invalidations: [{ type: 'documents', projectId, documentId: firstDocumentId }],
        },
        { type: 'text_delta', content: 'The document edit was applied.' },
      ]);
    });

    const agent = await openProject(page);
    await agent.enableAutoMode();
    await agent.send('Append the approved note');

    await expect(agent.toolResult('propose_document_edit', 'success')).toBeVisible();
    await expect(
      page
        .getByTestId('agent-message-assistant')
        .filter({ hasText: 'The document edit was applied.' })
    ).toBeVisible();
  });

  test('keeps Auto-mode document deletion behind mandatory confirmation', async ({ page }) => {
    const actionId = crypto.randomUUID();
    await page.route('**/api/agent-chat', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        projectId,
        autoExecute: true,
        message: 'Delete Agent Current Document One',
      });
      await fulfillAgentStream(route, crypto.randomUUID(), [{
        type: 'confirmation_request',
        actionId,
        tool: 'delete_document',
        args: { documentId: firstDocumentId },
        confirmationMode: 'post_preview',
        preview: {
          type: 'document_delete',
          documentId: firstDocumentId,
          projectId,
          name: 'Agent Current Document One',
          folderName: null,
          updatedAt: '2026-07-17T00:00:00.000Z',
        },
      }]);
    });

    const agent = await openProject(page);
    await agent.enableAutoMode();
    await agent.send('Delete Agent Current Document One');

    const confirmation = page.getByTestId('agent-confirmation');
    await expect(confirmation).toContainText('Confirm: Delete document permanently');
    await expect(confirmation).toContainText('Agent Current Document One');
    await expect(confirmation).toContainText('cannot be undone');
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
