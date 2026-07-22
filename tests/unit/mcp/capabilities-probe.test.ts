import { describe, expect, it, jest } from '@jest/globals';
import { runCapabilitiesProbe } from '../../../scripts/probe-mcp-capabilities';

const endpoint = 'https://example.supabase.co/functions/v1/mcp/11111111-1111-4111-8111-111111111111';
const tools = ['create_document', 'create_table', 'create_table_row', 'keco_connection_probe',
  'list_documents', 'list_project_structure', 'query_table_rows', 'read_document',
  'semantic_search', 'update_document', 'update_table_row'];

function rpcResult(id: number, result: Record<string, unknown>) {
  return Response.json({ jsonrpc: '2.0', id, result });
}

it('validates all capability families and bounded reads without exposing the token', async () => {
  const token = 'header.payload.signature';
  const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
    const message = JSON.parse(String(init?.body)) as { id: number; method: string;
      params: Record<string, unknown> };
    const byMethod: Record<string, Record<string, unknown>> = {
      initialize: { capabilities: { tools: {}, resources: {}, prompts: {} } },
      'tools/list': { tools: tools.map(name => ({ name })) },
      'resources/list': { resources: ['keco://project', 'keco://tables', 'keco://documents']
        .map(uri => ({ uri })) },
      'resources/templates/list': { resourceTemplates: [
        'keco://project/structure', 'keco://tables/{tableId}/schema',
        'keco://tables/{tableId}/rows{?limit,cursor}', 'keco://documents/{documentId}',
      ].map(uriTemplate => ({ uriTemplate })) },
      'prompts/list': { prompts: ['analyze_project', 'build_tables_from_document',
        'update_project_data'].map(name => ({ name })) },
    };
    if (message.method !== 'tools/call') return rpcResult(message.id, byMethod[message.method]);
    const call = message.params as { name: string };
    const structuredContent = call.name === 'list_project_structure'
      ? { ok: true, project: {}, tables: [] }
      : call.name === 'list_documents' ? { ok: true, items: [] }
      : { ok: true, searchMode: 'text_fuzzy' };
    return rpcResult(message.id, { structuredContent });
  });
  const evidence = await runCapabilitiesProbe({ mcpUrl: endpoint, accessToken: token,
    fetchImpl: fetchMock as typeof fetch });
  expect(evidence.passed).toBe(true);
  expect(evidence.capabilities).toEqual({ tools: 11, resources: 3, resourceTemplates: 4, prompts: 3 });
  expect(evidence.reads.searchMode).toBe('text_fuzzy');
  expect(JSON.stringify(evidence)).not.toContain(token);
});

describe('capability mismatch handling', () => {
  it('fails closed on an incomplete tool list', async () => {
    const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const message = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = message.method === 'initialize'
        ? { capabilities: { tools: {}, resources: {}, prompts: {} } }
        : message.method === 'tools/list' ? { tools: [] } : {};
      return rpcResult(message.id, result);
    });
    await expect(runCapabilitiesProbe({ mcpUrl: endpoint, accessToken: 'token',
      fetchImpl: fetchMock as typeof fetch })).rejects.toThrow('Tool capability set');
  });
});
