import { replaceEvidenceAtomically } from './lib/atomic-evidence';
import { createMcpRpcClient, MCP_PROTOCOL_VERSION, structuredToolResult,
  type McpRpcClient } from './lib/mcp-json-rpc';

const EXPECTED_TOOLS = [
  'create_document', 'create_table', 'create_table_row', 'keco_connection_probe',
  'list_documents', 'list_project_structure', 'query_table_rows', 'read_document',
  'semantic_search', 'update_document', 'update_table_row',
].sort();
const EXPECTED_RESOURCES = ['keco://documents', 'keco://project', 'keco://tables'].sort();
const EXPECTED_TEMPLATES = [
  'keco://documents/{documentId}', 'keco://project/structure',
  'keco://tables/{tableId}/rows{?limit,cursor}', 'keco://tables/{tableId}/schema',
].sort();
const EXPECTED_PROMPTS = ['analyze_project', 'build_tables_from_document', 'update_project_data'].sort();

function array(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${label} response is not an array.`);
  return value as Array<Record<string, unknown>>;
}

function names(items: Array<Record<string, unknown>>, field: string): string[] {
  return items.map(item => {
    if (typeof item[field] !== 'string') throw new Error(`Capability omitted ${field}.`);
    return item[field] as string;
  }).sort();
}

function exact(actual: string[], expected: string[], label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} capability set does not match the Phase 2 contract.`);
  }
}

function dataRows(value: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = value.data;
  return Array.isArray(data) ? data as Array<Record<string, unknown>>
    : data && typeof data === 'object' ? [data as Record<string, unknown>] : [];
}

async function callTool(client: McpRpcClient, name: string, args: Record<string, unknown>) {
  return structuredToolResult(await client.call('tools/call', { name, arguments: args }));
}

async function exerciseWrites(client: McpRpcClient) {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const createdTable = await callTool(client, 'create_table', {
    name: `MCP Phase 2 ${suffix}`, fields: [{ label: 'Name', dataType: 'string', required: true }],
  });
  const table = dataRows(createdTable)[0];
  if (typeof table?.table_id !== 'string') throw new Error('create_table omitted table_id.');
  const createdRow = await callTool(client, 'create_table_row', {
    tableId: table.table_id, values: { Name: 'Created by Phase 2 probe' },
  });
  const row = dataRows(createdRow)[0];
  if (typeof row?.row_id !== 'string') throw new Error('create_table_row omitted row_id.');
  await callTool(client, 'update_table_row', {
    tableId: table.table_id, rowId: row.row_id, values: { Name: 'Updated by Phase 2 probe' },
  });
  const createdDocument = await callTool(client, 'create_document', {
    name: `MCP Phase 2 ${suffix}.md`, markdown: '# Phase 2 probe\n\nDisposable acceptance data.',
  });
  const document = dataRows(createdDocument)[0];
  if (typeof document?.document_id !== 'string') throw new Error('create_document omitted document_id.');
  const stateToken = { epoch: document.collab_epoch, revision: document.collab_revision,
    updateIds: document.update_ids };
  await callTool(client, 'update_document', {
    documentId: document.document_id, markdown: '# Phase 2 probe\n\nUpdated.', stateToken,
  });
  structuredToolResult(await client.call('tools/call', { name: 'update_document', arguments: {
    documentId: document.document_id, markdown: '# Must conflict', stateToken,
  } }), 'DOCUMENT_CONFLICT');
  return { tableCreate: true, rowCreate: true, rowUpdate: true, documentCreate: true,
    documentUpdate: true, staleConflict: true };
}

export async function runCapabilitiesProbe(options: {
  mcpUrl: string; accessToken: string; exerciseWrites?: boolean; fetchImpl?: typeof fetch;
}) {
  const client = createMcpRpcClient(options);
  const initialized = await client.call('initialize', { protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {}, clientInfo: { name: 'keco-mcp-capabilities-probe', version: '1' } });
  const capabilities = initialized.capabilities as Record<string, unknown> | undefined;
  if (!capabilities?.tools || !capabilities.resources || !capabilities.prompts) {
    throw new Error('Initialize omitted a Phase 2 capability family.');
  }
  const tools = array((await client.call('tools/list')).tools, 'tools/list');
  exact(names(tools, 'name'), EXPECTED_TOOLS, 'Tool');
  const resources = array((await client.call('resources/list')).resources, 'resources/list');
  exact(names(resources, 'uri'), EXPECTED_RESOURCES, 'Resource');
  const templates = array((await client.call('resources/templates/list')).resourceTemplates,
    'resources/templates/list');
  exact(names(templates, 'uriTemplate'), EXPECTED_TEMPLATES, 'Resource template');
  const prompts = array((await client.call('prompts/list')).prompts, 'prompts/list');
  exact(names(prompts, 'name'), EXPECTED_PROMPTS, 'Prompt');

  const structure = await callTool(client, 'list_project_structure', {});
  const structureData = structure.project ? structure : structure.data as Record<string, unknown>;
  const tables = Array.isArray(structureData?.tables)
    ? structureData.tables as Array<Record<string, unknown>> : [];
  const documentsResult = await callTool(client, 'list_documents', { limit: 1 });
  const documents = Array.isArray(documentsResult.items)
    ? documentsResult.items as Array<Record<string, unknown>> : [];
  if (tables[0]?.id) await callTool(client, 'query_table_rows', { tableId: tables[0].id, limit: 1 });
  if (documents[0]?.id) await callTool(client, 'read_document', {
    documentId: documents[0].id, mode: 'outline',
  });
  const search = await callTool(client, 'semantic_search', { query: 'project', limit: 1 });
  if (search.searchMode !== 'semantic' && search.searchMode !== 'text_fuzzy') {
    throw new Error('semantic_search omitted its actual searchMode.');
  }
  const writes = options.exerciseWrites ? await exerciseWrites(client) : null;
  return { checkedAt: new Date().toISOString(), passed: true, mcpUrl: options.mcpUrl,
    capabilities: { tools: tools.length, resources: resources.length,
      resourceTemplates: templates.length, prompts: prompts.length },
    reads: { structure: true, boundedTable: tables.length === 0 ? 'not_applicable' : true,
      boundedDocument: documents.length === 0 ? 'not_applicable' : true,
      searchMode: search.searchMode }, writes };
}

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}.`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const output = argument(args, '--output');
  await replaceEvidenceAtomically(output, () => runCapabilitiesProbe({
    mcpUrl: argument(args, '--mcp-url'), accessToken: process.env.MCP_ACCESS_TOKEN ?? '',
    exerciseWrites: args.includes('--exercise-writes'),
  }));
}

if (process.argv[1]?.endsWith('probe-mcp-capabilities.ts')) {
  void main().catch(() => { console.error('MCP capabilities probe failed.'); process.exitCode = 1; });
}
