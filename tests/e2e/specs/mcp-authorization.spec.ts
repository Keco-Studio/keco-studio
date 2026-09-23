import { expect, test, type Page } from '@playwright/test';
import { mcpRpc, type McpRpcSession } from '../helpers/mcp-jsonrpc';
import {
  authorizeMcpInBrowser,
  deleteMcpClient,
  exchangeAuthorizationCode,
  registerMcpClient,
} from '../helpers/mcp-oauth';
import { loginWithCredentials } from '../utils/auth-helpers';
import {
  createMcpAuthorizationFixture,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
  type McpAuthorizationFixture,
  type TemporaryUser,
} from '../utils/supabase-admin';

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!configuredSupabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required for MCP authorization E2E tests');
}

const supabaseUrl = new URL(configuredSupabaseUrl).origin;
const mcpEndpoint = `${supabaseUrl}/functions/v1/mcp`;
const appOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;
const redirectUri = `${appOrigin}/payment/success`;

type ToolListResult = {
  tools?: Array<{ name?: string }>;
};

type ToolCallResult = {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

function toolNames(result: unknown): string[] {
  return ((result as ToolListResult | undefined)?.tools ?? [])
    .map((tool) => tool.name)
    .filter((name): name is string => typeof name === 'string');
}

function toolFailureText(result: unknown): string {
  return ((result as ToolCallResult | undefined)?.content ?? [])
    .map((entry) => entry.text ?? '')
    .join('\n');
}

test.describe('MCP OAuth role authorization', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  const admin = getE2EAdminClient();
  let fixture: McpAuthorizationFixture;
  let clientId = '';

  test.beforeAll(async () => {
    fixture = await createMcpAuthorizationFixture(admin);
    ({ clientId } = await registerMcpClient({
      supabaseUrl,
      redirectUri,
      clientName: `Keco MCP Playwright ${crypto.randomUUID()}`,
    }));
  });

  test.afterAll(async () => {
    if (clientId) await deleteMcpClient(admin, clientId);
    if (!fixture) return;
    await removeProjectFixture(admin, fixture.projectId);
    await Promise.all(
      [fixture.owner, fixture.viewer, fixture.editor, fixture.admin].map((user) =>
        deleteTemporaryUser(admin, user)
      )
    );
  });

  async function authorize(page: Page, user: TemporaryUser): Promise<McpRpcSession> {
    await page.goto(`${appOrigin}/`);
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 });
    await loginWithCredentials(page, user.email, user.password);
    await expect(page).toHaveURL(/\/projects(?:\?|$)/, { timeout: 30_000 });
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 30_000 });

    const authorization = await authorizeMcpInBrowser({
      page,
      supabaseUrl,
      clientId,
      redirectUri,
      resource: mcpEndpoint,
    });
    const accessToken = await exchangeAuthorizationCode({
      supabaseUrl,
      clientId,
      redirectUri,
      code: authorization.code,
      codeVerifier: authorization.codeVerifier,
    });
    return { endpoint: mcpEndpoint, accessToken, nextId: 1 };
  }

  async function initializeAndRead(
    session: McpRpcSession
  ): Promise<string[]> {
    const initialized = await mcpRpc(session, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'keco-playwright', version: '1.0.0' },
    });
    expect(initialized.error).toBeUndefined();

    const listed = await mcpRpc(session, 'tools/list');
    expect(listed.error).toBeUndefined();

    const structure = await mcpRpc(session, 'tools/call', {
      name: 'list_project_structure',
      arguments: { projectId: fixture.projectId },
    });
    expect(structure.error).toBeUndefined();
    expect((structure.result as ToolCallResult).isError).not.toBe(true);
    expect((structure.result as ToolCallResult).structuredContent).toMatchObject({ ok: true });
    return toolNames(listed.result);
  }

  test('viewer exposes reads and rejects an undisclosed table write', async ({ page }) => {
    const session = await authorize(page, fixture.viewer);
    const names = await initializeAndRead(session);
    expect(names).toContain('list_project_structure');
    expect(names).not.toContain('create_table');
    expect(names).not.toContain('add_table_field');
    expect(names).not.toContain('create_folder');

    const tableName = `Viewer forbidden ${crypto.randomUUID()}`;
    const rejected = await mcpRpc(session, 'tools/call', {
      name: 'create_table',
      arguments: {
        projectId: fixture.projectId,
        name: tableName,
        fields: [{ label: 'Name', dataType: 'string' }],
      },
    });
    expect((rejected.result as ToolCallResult).isError).toBe(true);
    expect(toolFailureText(rejected.result)).toContain('Tool create_table not found');

    const { count, error } = await admin
      .from('libraries')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', fixture.projectId)
      .eq('name', tableName);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  test('editor exposes ordinary writes, persists a field, and cannot call create_folder', async ({
    page,
  }) => {
    const session = await authorize(page, fixture.editor);
    const names = await initializeAndRead(session);
    expect(names).toContain('add_table_field');
    expect(names).not.toContain('create_folder');

    const fieldLabel = `Editor field ${crypto.randomUUID()}`;
    const added = await mcpRpc(session, 'tools/call', {
      name: 'add_table_field',
      arguments: {
        projectId: fixture.projectId,
        tableId: fixture.tableId,
        field: { label: fieldLabel, dataType: 'string' },
      },
    });
    expect(added.error).toBeUndefined();
    expect((added.result as ToolCallResult).isError).not.toBe(true);

    const { data: field, error: fieldError } = await admin
      .from('library_field_definitions')
      .select('id, label')
      .eq('library_id', fixture.tableId)
      .eq('label', fieldLabel)
      .single();
    expect(fieldError).toBeNull();
    expect(field?.label).toBe(fieldLabel);

    const folderName = `Editor forbidden ${crypto.randomUUID()}`;
    const rejected = await mcpRpc(session, 'tools/call', {
      name: 'create_folder',
      arguments: { projectId: fixture.projectId, name: folderName },
    });
    expect((rejected.result as ToolCallResult).isError).toBe(true);
    expect(toolFailureText(rejected.result)).toContain('Tool create_folder not found');

    const { count, error } = await admin
      .from('folders')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', fixture.projectId)
      .eq('name', folderName);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  test('admin exposes create_folder and persists the folder', async ({ page }) => {
    const session = await authorize(page, fixture.admin);
    const names = await initializeAndRead(session);
    expect(names).toContain('add_table_field');
    expect(names).toContain('create_folder');

    const folderName = `Admin folder ${crypto.randomUUID()}`;
    const created = await mcpRpc(session, 'tools/call', {
      name: 'create_folder',
      arguments: { projectId: fixture.projectId, name: folderName },
    });
    expect(created.error).toBeUndefined();
    expect((created.result as ToolCallResult).isError).not.toBe(true);
    expect((created.result as ToolCallResult).structuredContent).toMatchObject({ ok: true });

    const { data: folder, error } = await admin
      .from('folders')
      .select('id, name')
      .eq('project_id', fixture.projectId)
      .eq('name', folderName)
      .single();
    expect(error).toBeNull();
    expect(folder?.name).toBe(folderName);
  });
});
