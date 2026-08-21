import { replaceEvidenceAtomically } from './lib/atomic-evidence';
import { createMcpRpcClient, MCP_PROTOCOL_VERSION, structuredToolResult, type McpRpcClient } from './lib/mcp-json-rpc';

const READ_TOOLS = ['list_documents', 'list_project_structure', 'query_table_rows', 'read_document',
  'read_story_graph', 'semantic_search'];
const WRITE_TOOLS = ['add_table_field', 'complete_image_upload', 'complete_image_uploads', 'create_document',
  'create_folder', 'create_image_upload', 'create_table', 'create_table_row', 'prepare_image_uploads',
  'update_document', 'update_table_row', 'edit_table_field',
  'delete_table_field', 'delete_table_row', 'update_table', 'reorder_table_fields', 'delete_table',
  'bulk_update_table_rows', 'upsert_table_rows'];
const GDS_TOOLS = ['list_game_design_systems', 'read_game_design_system', 'read_project_game_design_system',
  'get_game_design_system_generation', 'create_game_design_system', 'generate_game_design_system',
  'create_game_design_system_version', 'set_project_game_design_system', 'clear_project_game_design_system'];
const MAP_READ_TOOLS = ['list_maps', 'read_map', 'get_map_generation'];
const MAP_WRITE_TOOLS = ['create_map_draft', 'update_map_draft', 'prepare_map_generation',
  'start_map_generation', 'retry_map_generation'];
const PROJECT_WRITE_TOOLS = [...WRITE_TOOLS, ...MAP_WRITE_TOOLS];
const LEGACY_TOOLS = ['keco_connection_probe', ...READ_TOOLS, ...WRITE_TOOLS, ...GDS_TOOLS,
  ...MAP_READ_TOOLS, ...MAP_WRITE_TOOLS].sort();
const ACCOUNT_BASE_TOOLS = ['keco_connection_probe', 'list_projects', ...READ_TOOLS, ...GDS_TOOLS,
  ...MAP_READ_TOOLS].sort();
const LEGACY_RESOURCES = ['keco://documents', 'keco://project', 'keco://tables'].sort();
const LEGACY_TEMPLATES = ['keco://documents/{documentId}', 'keco://project/structure',
  'keco://tables/{tableId}/rows{?limit,cursor}', 'keco://tables/{tableId}/schema'].sort();
const ACCOUNT_RESOURCES = ['keco://projects'];
const ACCOUNT_TEMPLATES = ['keco://projects/{projectId}', 'keco://projects/{projectId}/documents/{documentId}',
  'keco://projects/{projectId}/structure', 'keco://projects/{projectId}/tables/{tableId}/rows{?limit,cursor}',
  'keco://projects/{projectId}/tables/{tableId}/schema'].sort();
const PROMPTS = ['analyze_project', 'build_tables_from_document', 'update_project_data'].sort();

type McpMode = 'account' | 'legacy';

function modeFor(mcpUrl: string): McpMode {
  const url = new URL(mcpUrl);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('MCP URL is not an account or legacy endpoint.');
  }
  if (/^\/(?:functions\/v1\/)?mcp$/.test(url.pathname)) return 'account';
  if (/^\/(?:functions\/v1\/)?mcp\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.pathname)) return 'legacy';
  throw new Error('MCP URL is not an account or legacy endpoint.');
}

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
    throw new Error(`${label} capability set does not match the account MCP contract.`);
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

function accountToolSet(tools: string[]): { writableToolAdvertisement: boolean } {
  const base = tools.filter(name => !PROJECT_WRITE_TOOLS.includes(name));
  exact(base, ACCOUNT_BASE_TOOLS, 'Account tool');
  const writes = tools.filter(name => PROJECT_WRITE_TOOLS.includes(name));
  if (writes.length !== 0 && JSON.stringify(writes) !== JSON.stringify([...PROJECT_WRITE_TOOLS].sort())) {
    throw new Error('Account write Tool advertisement is incomplete.');
  }
  return { writableToolAdvertisement: writes.length > 0 };
}

async function exerciseLegacyWrites(client: McpRpcClient) {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const table = dataRows(await callTool(client, 'create_table', {
    name: `MCP capability probe ${suffix}`,
    fields: [{ label: 'Name', dataType: 'string', required: true }],
  }))[0];
  if (typeof table?.table_id !== 'string') throw new Error('create_table omitted table_id.');
  const field = dataRows(await callTool(client, 'add_table_field', {
    tableId: table.table_id, field: { label: 'Image', dataType: 'image' },
  }))[0];
  if (typeof field?.field_id !== 'string' || field.data_type !== 'image') {
    throw new Error('add_table_field omitted image field metadata.');
  }
  const row = dataRows(await callTool(client, 'create_table_row', {
    tableId: table.table_id, values: { Name: 'Created by capability probe' },
  }))[0];
  if (typeof row?.row_id !== 'string') throw new Error('create_table_row omitted row_id.');
  await callTool(client, 'update_table_row', { tableId: table.table_id, rowId: row.row_id,
    values: { Name: 'Updated by capability probe' } });
  const document = dataRows(await callTool(client, 'create_document', {
    name: `MCP capability probe ${suffix}.md`, markdown: '# Capability probe\n\nDisposable acceptance data.',
  }))[0];
  if (typeof document?.document_id !== 'string') throw new Error('create_document omitted document_id.');
  const stateToken = { epoch: document.collab_epoch, revision: document.collab_revision, updateIds: document.update_ids };
  await callTool(client, 'update_document', { documentId: document.document_id,
    markdown: '# Capability probe\n\nUpdated.', stateToken });
  structuredToolResult(await client.call('tools/call', { name: 'update_document', arguments: {
    documentId: document.document_id, markdown: '# Capability probe\n\nStale conflict.', stateToken,
  } }), 'DOCUMENT_CONFLICT');
  return { tableCreate: true, fieldAdd: true, rowCreate: true, rowUpdate: true, documentCreate: true,
    documentUpdate: true, staleConflict: true };
}

function projectEvidence(items: unknown): { count: number; roles: Record<string, number>; duplicateNameGroups: number; labels: string[] } {
  if (!Array.isArray(items)) throw new Error('list_projects omitted items.');
  const roles: Record<string, number> = {};
  const names = new Map<string, number>();
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error('list_projects returned an invalid item.');
    const value = item as Record<string, unknown>;
    const capabilities = value.capabilities as Record<string, unknown> | null;
    if (typeof value.projectId !== 'string' || typeof value.name !== 'string' ||
        typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) ||
        !['admin', 'editor', 'viewer'].includes(String(value.role)) || !capabilities ||
        capabilities.read !== true || typeof capabilities.create !== 'boolean' ||
        typeof capabilities.update !== 'boolean') {
      throw new Error('list_projects omitted a project, name, creation date, role, or capabilities.');
    }
    roles[String(value.role)] = (roles[String(value.role)] ?? 0) + 1;
    names.set(value.name, (names.get(value.name) ?? 0) + 1);
  }
  return { count: items.length, roles, duplicateNameGroups: [...names.values()].filter(count => count > 1).length,
    labels: items.map((_, index) => `project-${index + 1}`) };
}

async function replayDenial(mcpUrl: string, accessToken: string, fetchImpl?: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await (fetchImpl ?? fetch)(mcpUrl, {
      method: 'POST', headers: { accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json', 'mcp-protocol-version': MCP_PROTOCOL_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'keco-mcp-replay-probe', version: '1' },
      } }),
    });
  } catch { throw new Error('Cross-resource replay request failed.'); }
  if (response.status !== 403) throw new Error(`Cross-resource replay expected HTTP 403, received ${response.status}.`);
}

export async function runCapabilitiesProbe(options: {
  mcpUrl: string; accessToken: string; exerciseWrites?: boolean; fetchImpl?: typeof fetch;
  viewerAccessToken?: string; viewerProjectId?: string; legacyMcpUrl?: string; legacyAccessToken?: string;
}) {
  const mode = modeFor(options.mcpUrl);
  const client = createMcpRpcClient(options);
  const initialized = await client.call('initialize', { protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {}, clientInfo: { name: 'keco-mcp-capabilities-probe', version: '1' } });
  const capabilities = initialized.capabilities as Record<string, unknown> | undefined;
  if (!capabilities?.tools || !capabilities.resources || !capabilities.prompts) {
    throw new Error('Initialize omitted a required capability family.');
  }
  const tools = array((await client.call('tools/list')).tools, 'tools/list');
  const toolNames = names(tools, 'name');
  const resources = array((await client.call('resources/list')).resources, 'resources/list');
  const templates = array((await client.call('resources/templates/list')).resourceTemplates,
    'resources/templates/list');
  const prompts = array((await client.call('prompts/list')).prompts, 'prompts/list');

  let projects: { count: number; roles: Record<string, number>; duplicateNameGroups: number; labels: string[] } | null = null;
  let listProjectsMs: number | null = null;
  let writableToolAdvertisement: boolean | null = null;
  let storyGraphRead: 'succeeded' | 'not_available' | null = null;
  if (mode === 'account') {
    writableToolAdvertisement = accountToolSet(toolNames).writableToolAdvertisement;
    exact(names(resources, 'uri'), ACCOUNT_RESOURCES, 'Account resource');
    exact(names(templates, 'uriTemplate'), ACCOUNT_TEMPLATES, 'Account resource template');
    exact(names(prompts, 'name'), PROMPTS, 'Account prompt');
    const start = performance.now();
    const listed = await callTool(client, 'list_projects', { limit: 100 });
    listProjectsMs = performance.now() - start;
    projects = projectEvidence(listed.items);
  } else {
    exact(toolNames, LEGACY_TOOLS, 'Legacy tool');
    exact(names(resources, 'uri'), LEGACY_RESOURCES, 'Legacy resource');
    exact(names(templates, 'uriTemplate'), LEGACY_TEMPLATES, 'Legacy resource template');
    exact(names(prompts, 'name'), PROMPTS, 'Legacy prompt');
  }

  if (mode === 'legacy') {
    const structure = await callTool(client, 'list_project_structure', {});
    const structureData = structure.project ? structure : structure.data as Record<string, unknown>;
    const tables = Array.isArray(structureData?.tables) ? structureData.tables as Array<Record<string, unknown>> : [];
    const documentsResult = await callTool(client, 'list_documents', { limit: 1 });
    const documents = Array.isArray(documentsResult.items) ? documentsResult.items as Array<Record<string, unknown>> : [];
    if (tables[0]?.id) await callTool(client, 'query_table_rows', { tableId: tables[0].id, limit: 1 });
    if (documents[0]?.id) await callTool(client, 'read_document', { documentId: documents[0].id, mode: 'outline' });
    storyGraphRead = 'not_available';
    for (const table of tables) {
      if (typeof table.id !== 'string') continue;
      const raw = await client.call('tools/call', {
        name: 'read_story_graph', arguments: { libraryId: table.id, limit: 1 },
      });
      const structured = raw.structuredContent as Record<string, unknown> | undefined;
      const error = structured?.error as Record<string, unknown> | undefined;
      if (raw.isError === true) {
        if (error?.code === 'STORY_GRAPH_UNSUPPORTED_LIBRARY') continue;
        throw new Error('read_story_graph returned an unexpected domain error.');
      }
      const value = structuredToolResult(raw);
      const library = value.library as Record<string, unknown> | undefined;
      const graph = value.graph as Record<string, unknown> | undefined;
      if (typeof library?.snapshotId !== 'string' || typeof graph?.entryLabel !== 'string' ||
          !Array.isArray(value.items) || typeof value.hasMore !== 'boolean') {
        throw new Error('read_story_graph omitted bounded graph metadata.');
      }
      storyGraphRead = 'succeeded';
      break;
    }
    const search = await callTool(client, 'semantic_search', { query: 'project', limit: 1 });
    if (search.searchMode !== 'semantic' && search.searchMode !== 'text_fuzzy') throw new Error('semantic_search omitted its actual searchMode.');
  }

  let viewerWriteDenial: 'not_exercised' | 'succeeded' = 'not_exercised';
  if (options.viewerAccessToken || options.viewerProjectId) {
    if (mode !== 'account' || !options.viewerAccessToken || !options.viewerProjectId) {
      throw new Error('Viewer denial requires an account endpoint, token, and project ID.');
    }
    const viewer = createMcpRpcClient({ mcpUrl: options.mcpUrl, accessToken: options.viewerAccessToken, fetchImpl: options.fetchImpl });
    const result = await viewer.call('tools/call', { name: 'create_document', arguments: {
      projectId: options.viewerProjectId, name: 'MCP viewer denial probe', markdown: '# Viewer denial probe',
    } });
    structuredToolResult(result, 'PROJECT_WRITE_FORBIDDEN');
    viewerWriteDenial = 'succeeded';
  }

  let crossResourceReplay: 'not_exercised' | 'succeeded' = 'not_exercised';
  if (options.legacyMcpUrl || options.legacyAccessToken) {
    if (mode !== 'account' || !options.legacyMcpUrl || !options.legacyAccessToken) {
      throw new Error('Replay denial requires an account endpoint, legacy endpoint, and legacy token.');
    }
    if (modeFor(options.legacyMcpUrl) !== 'legacy' || new URL(options.legacyMcpUrl).origin !== new URL(options.mcpUrl).origin) {
      throw new Error('Replay denial requires a same-origin legacy endpoint.');
    }
    await replayDenial(options.mcpUrl, options.legacyAccessToken, options.fetchImpl);
    await replayDenial(options.legacyMcpUrl, options.accessToken, options.fetchImpl);
    crossResourceReplay = 'succeeded';
  }

  if (options.exerciseWrites && mode === 'account') throw new Error('Account write exercise requires a selected project and is not supported by this probe.');
  const writes = options.exerciseWrites ? await exerciseLegacyWrites(client) : null;
  return {
    checkedAt: new Date().toISOString(), passed: true, mode,
    capabilities: { tools: toolNames.length, resources: resources.length,
      resourceTemplates: templates.length, prompts: prompts.length, writableToolAdvertisement },
    storyGraphRead,
    projects: projects && { count: projects.count, roles: projects.roles, duplicateNameGroups: projects.duplicateNameGroups,
      labels: projects.labels },
    timings: { listProjectsMs }, roleEnforcement: { viewerWriteDenial }, crossResourceReplay, writes,
  };
}

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}.`);
  return value;
}

export function capabilitiesProbeOptions(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
) {
  const viewerProjectId = args.includes('--viewer-project-id')
    ? argument(args, '--viewer-project-id')
    : undefined;
  return {
    mcpUrl: argument(args, '--mcp-url'),
    accessToken: environment.MCP_ACCESS_TOKEN ?? '',
    exerciseWrites: args.includes('--exercise-writes'),
    viewerAccessToken: viewerProjectId
      ? environment.MCP_VIEWER_ACCESS_TOKEN ?? environment.MCP_ACCESS_TOKEN
      : undefined,
    viewerProjectId,
    legacyMcpUrl: args.includes('--legacy-mcp-url')
      ? argument(args, '--legacy-mcp-url')
      : undefined,
    legacyAccessToken: environment.MCP_LEGACY_ACCESS_TOKEN,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: npm run probe:mcp-capabilities -- --mcp-url <url> --output <path> [--exercise-writes]\n');
    return;
  }
  const output = argument(args, '--output');
  await replaceEvidenceAtomically(output, () =>
    runCapabilitiesProbe(capabilitiesProbeOptions(args))
  );
}

if (process.argv[1]?.endsWith('probe-mcp-capabilities.ts')) {
  void main().catch(() => { console.error('MCP capabilities probe failed.'); process.exitCode = 1; });
}
