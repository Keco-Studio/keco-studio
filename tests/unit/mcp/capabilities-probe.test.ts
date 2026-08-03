import { describe, expect, it, jest } from '@jest/globals';
import { capabilitiesProbeOptions, runCapabilitiesProbe } from '../../../scripts/probe-mcp-capabilities';

const accountEndpoint = 'https://example.supabase.co/functions/v1/mcp';
const legacyEndpoint = 'https://example.supabase.co/functions/v1/mcp/11111111-1111-4111-8111-111111111111';
const readTools = ['list_documents', 'list_project_structure', 'query_table_rows', 'read_document', 'semantic_search'];
const writeTools = ['add_table_field', 'complete_image_upload', 'create_document', 'create_image_upload',
  'create_table', 'create_table_row', 'update_document', 'update_table_row', 'edit_table_field',
  'delete_table_field', 'delete_table_row', 'update_table', 'reorder_table_fields', 'delete_table',
  'bulk_update_table_rows', 'upsert_table_rows'];

it('keeps the documented minimal CLI invocation out of the optional viewer branch', () => {
  expect(capabilitiesProbeOptions(
    ['--mcp-url', accountEndpoint, '--output', '/tmp/evidence.json'],
    { MCP_ACCESS_TOKEN: 'account-token' },
  )).toEqual(expect.objectContaining({
    accessToken: 'account-token',
    viewerAccessToken: undefined,
    viewerProjectId: undefined,
  }));
});

it('uses the account token for viewer denial only when a viewer project is explicit', () => {
  expect(capabilitiesProbeOptions(
    ['--mcp-url', accountEndpoint, '--output', '/tmp/evidence.json',
      '--viewer-project-id', '11111111-1111-4111-8111-111111111111'],
    { MCP_ACCESS_TOKEN: 'account-token' },
  )).toEqual(expect.objectContaining({
    viewerAccessToken: 'account-token',
    viewerProjectId: '11111111-1111-4111-8111-111111111111',
  }));
});

function rpcResult(id: number, result: Record<string, unknown>) {
  return Response.json({ jsonrpc: '2.0', id, result });
}

it('records account discovery, role counts, and generated labels without exposing the token or project data', async () => {
  const token = 'header.payload.signature';
  const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
    const message = JSON.parse(String(init?.body)) as { id: number; method: string };
    if (message.method === 'initialize') return rpcResult(message.id, { capabilities: { tools: {}, resources: {}, prompts: {} } });
    if (message.method === 'tools/list') return rpcResult(message.id, { tools: ['keco_connection_probe', 'list_projects', ...readTools].map(name => ({ name })) });
    if (message.method === 'resources/list') return rpcResult(message.id, { resources: [{ uri: 'keco://projects' }] });
    if (message.method === 'resources/templates/list') return rpcResult(message.id, { resourceTemplates: [
      'keco://projects/{projectId}', 'keco://projects/{projectId}/documents/{documentId}',
      'keco://projects/{projectId}/structure', 'keco://projects/{projectId}/tables/{tableId}/rows{?limit,cursor}',
      'keco://projects/{projectId}/tables/{tableId}/schema',
    ].map(uriTemplate => ({ uriTemplate })) });
    if (message.method === 'prompts/list') return rpcResult(message.id, { prompts: ['analyze_project', 'build_tables_from_document', 'update_project_data'].map(name => ({ name })) });
    return rpcResult(message.id, { structuredContent: { ok: true, items: [
      { projectId: '11111111-1111-4111-8111-111111111111', name: 'Private Game Design', createdAt: '2026-07-23T00:00:00.000Z', role: 'admin', capabilities: { read: true, create: true, update: true } },
      { projectId: '22222222-2222-4222-8222-222222222222', name: 'Private Game Design', createdAt: '2026-07-22T00:00:00.000Z', role: 'viewer', capabilities: { read: true, create: false, update: false } },
    ] } });
  });
  const evidence = await runCapabilitiesProbe({ mcpUrl: accountEndpoint, accessToken: token, fetchImpl: fetchMock as typeof fetch });
  expect(evidence).toEqual(expect.objectContaining({ mode: 'account', capabilities: expect.objectContaining({ tools: 7, writableToolAdvertisement: false }),
    projects: { count: 2, roles: { admin: 1, viewer: 1 }, duplicateNameGroups: 1, labels: ['project-1', 'project-2'] },
    timings: expect.objectContaining({ listProjectsMs: expect.any(Number) }),
  }));
  expect(JSON.stringify(evidence)).not.toContain(token);
  expect(JSON.stringify(evidence)).not.toContain('Private Game Design');
  expect(JSON.stringify(evidence)).not.toContain('11111111-1111-4111-8111-111111111111');
});

it('checks viewer denial and both cross-resource replay directions without recording either token', async () => {
  const accountToken = 'account.header.signature';
  const legacyToken = 'legacy.header.signature';
  const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get('authorization');
    const message = JSON.parse(String(init?.body)) as { id: number; method: string; params?: { name?: string } };
    if (authorization === `Bearer ${legacyToken}` || (authorization === `Bearer ${accountToken}` && String(_url) === legacyEndpoint)) return new Response('', { status: 403 });
    if (message.method === 'initialize') return rpcResult(message.id, { capabilities: { tools: {}, resources: {}, prompts: {} } });
    if (message.method === 'tools/list') return rpcResult(message.id, { tools: ['keco_connection_probe', 'list_projects', ...readTools, ...writeTools].map(name => ({ name })) });
    if (message.method === 'resources/list') return rpcResult(message.id, { resources: [{ uri: 'keco://projects' }] });
    if (message.method === 'resources/templates/list') return rpcResult(message.id, { resourceTemplates: [
      'keco://projects/{projectId}', 'keco://projects/{projectId}/documents/{documentId}',
      'keco://projects/{projectId}/structure', 'keco://projects/{projectId}/tables/{tableId}/rows{?limit,cursor}',
      'keco://projects/{projectId}/tables/{tableId}/schema',
    ].map(uriTemplate => ({ uriTemplate })) });
    if (message.method === 'prompts/list') return rpcResult(message.id, { prompts: ['analyze_project', 'build_tables_from_document', 'update_project_data'].map(name => ({ name })) });
    if (message.params?.name === 'create_document') return rpcResult(message.id, { isError: true, structuredContent: { ok: false, error: { code: 'PROJECT_WRITE_FORBIDDEN' } } });
    return rpcResult(message.id, { structuredContent: { ok: true, items: [] } });
  });
  const evidence = await runCapabilitiesProbe({ mcpUrl: accountEndpoint, accessToken: accountToken,
    viewerAccessToken: accountToken, viewerProjectId: '11111111-1111-4111-8111-111111111111',
    legacyMcpUrl: legacyEndpoint, legacyAccessToken: legacyToken, fetchImpl: fetchMock as typeof fetch });
  expect(evidence.capabilities.tools).toBe(23);
  expect(evidence.roleEnforcement.viewerWriteDenial).toBe('succeeded');
  expect(evidence.crossResourceReplay).toBe('succeeded');
  expect(JSON.stringify(evidence)).not.toContain(accountToken);
  expect(JSON.stringify(evidence)).not.toContain(legacyToken);
});

it('preserves the exact legacy capability surface', async () => {
  const tools = ['keco_connection_probe', ...readTools, ...writeTools];
  const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const message = JSON.parse(String(init?.body)) as { id: number; method: string; params: Record<string, unknown> };
    const result: Record<string, Record<string, unknown>> = {
      initialize: { capabilities: { tools: {}, resources: {}, prompts: {} } },
      'tools/list': { tools: tools.map(name => ({ name })) },
      'resources/list': { resources: ['keco://project', 'keco://tables', 'keco://documents'].map(uri => ({ uri })) },
      'resources/templates/list': { resourceTemplates: ['keco://project/structure', 'keco://tables/{tableId}/schema', 'keco://tables/{tableId}/rows{?limit,cursor}', 'keco://documents/{documentId}'].map(uriTemplate => ({ uriTemplate })) },
      'prompts/list': { prompts: ['analyze_project', 'build_tables_from_document', 'update_project_data'].map(name => ({ name })) },
    };
    if (message.method !== 'tools/call') return rpcResult(message.id, result[message.method]);
    const name = (message.params as { name: string }).name;
    const structuredContent = name === 'list_project_structure' ? { ok: true, project: {}, tables: [] }
      : name === 'list_documents' ? { ok: true, items: [] } : { ok: true, searchMode: 'text_fuzzy' };
    return rpcResult(message.id, { structuredContent });
  });
  const evidence = await runCapabilitiesProbe({ mcpUrl: legacyEndpoint, accessToken: 'token', fetchImpl: fetchMock as typeof fetch });
  expect(evidence).toEqual(expect.objectContaining({ mode: 'legacy', capabilities: expect.objectContaining({ tools: 22, resources: 3, resourceTemplates: 4, prompts: 3 }) }));
});

it('exercises add_table_field in the legacy write acceptance flow', async () => {
  const toolCalls: string[] = [];
  const tools = ['keco_connection_probe', ...readTools, ...writeTools];
  const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const message = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params?: { name?: string };
    };
    if (message.method === 'initialize') {
      return rpcResult(message.id, { capabilities: { tools: {}, resources: {}, prompts: {} } });
    }
    if (message.method === 'tools/list') {
      return rpcResult(message.id, { tools: tools.map(name => ({ name })) });
    }
    if (message.method === 'resources/list') {
      return rpcResult(message.id, { resources: ['keco://project', 'keco://tables', 'keco://documents'].map(uri => ({ uri })) });
    }
    if (message.method === 'resources/templates/list') {
      return rpcResult(message.id, { resourceTemplates: [
        'keco://project/structure', 'keco://tables/{tableId}/schema',
        'keco://tables/{tableId}/rows{?limit,cursor}', 'keco://documents/{documentId}',
      ].map(uriTemplate => ({ uriTemplate })) });
    }
    if (message.method === 'prompts/list') {
      return rpcResult(message.id, { prompts: ['analyze_project', 'build_tables_from_document', 'update_project_data'].map(name => ({ name })) });
    }
    const name = message.params?.name ?? '';
    if (name === 'list_project_structure') {
      return rpcResult(message.id, { structuredContent: { ok: true, project: {}, tables: [] } });
    }
    if (name === 'list_documents') {
      return rpcResult(message.id, { structuredContent: { ok: true, items: [] } });
    }
    if (name === 'semantic_search') {
      return rpcResult(message.id, { structuredContent: { ok: true, searchMode: 'text_fuzzy' } });
    }
    toolCalls.push(name);
    if (name === 'create_table') {
      return rpcResult(message.id, { structuredContent: { ok: true, data: [{ table_id: 'table-id' }] } });
    }
    if (name === 'add_table_field') {
      return rpcResult(message.id, { structuredContent: { ok: true, data: [{ field_id: 'field-id', data_type: 'image' }] } });
    }
    if (name === 'create_table_row') {
      return rpcResult(message.id, { structuredContent: { ok: true, data: [{ row_id: 'row-id' }] } });
    }
    if (name === 'create_document') {
      return rpcResult(message.id, { structuredContent: { ok: true, data: [{
        document_id: 'document-id', collab_epoch: 0, collab_revision: 1, update_ids: [],
      }] } });
    }
    if (name === 'update_document' && toolCalls.filter(call => call === name).length === 2) {
      return rpcResult(message.id, { isError: true, structuredContent: { ok: false, error: { code: 'DOCUMENT_CONFLICT' } } });
    }
    return rpcResult(message.id, { structuredContent: { ok: true, data: [{}] } });
  });

  const evidence = await runCapabilitiesProbe({
    mcpUrl: legacyEndpoint,
    accessToken: 'token',
    exerciseWrites: true,
    fetchImpl: fetchMock as typeof fetch,
  });
  expect(toolCalls).toEqual([
    'create_table',
    'add_table_field',
    'create_table_row',
    'update_table_row',
    'create_document',
    'update_document',
    'update_document',
  ]);
  expect(evidence.writes).toEqual(expect.objectContaining({ fieldAdd: true }));
});
