import type { McpServer } from '@mcp/server/mcp.js';
import { ErrorCode, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema,
  McpError, ReadResourceRequestSchema } from '@mcp/types.js';
import type { AccountMcpRequestContext, McpRequestContext,
  ProjectMcpRequestContext } from './context.ts';
import { authorizeAccountProject, listAccessibleProjects } from './account-projects.ts';
import { McpDomainError, asPublicMcpError } from './errors.ts';
import { getTableSchema, listDocuments, listProjectStructure, queryTableRows,
  readDocument } from './operations.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = 'application/json';

function invalid(): never {
  throw new McpDomainError('INVALID_RESOURCE_URI', 'The Keco Resource URI is invalid.');
}

function parseUri(value: string): URL {
  if (value.length > 8192 || value.includes('\\') || /%2f|%5c|%2e/i.test(value)) invalid();
  let uri: URL;
  try { uri = new URL(value); } catch { invalid(); }
  if (uri.protocol !== 'keco:' || uri.username || uri.password || uri.port || uri.hash) invalid();
  return uri;
}

function pageOptions(uri: URL) {
  const values: Record<string, string> = {};
  for (const [key, value] of uri.searchParams) {
    if (!['limit', 'cursor'].includes(key) || key in values || !value) invalid();
    values[key] = value;
  }
  let limit: number | undefined;
  if (values.limit !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(values.limit)) invalid();
    limit = Number(values.limit);
    if (limit > 200) invalid();
  }
  if (values.cursor && values.cursor.length > 4096) invalid();
  return { limit, cursor: values.cursor };
}

function content(uri: string, value: unknown) {
  return { contents: [{ uri, mimeType: MIME, text: JSON.stringify(value) }] };
}

async function dispatch(context: ProjectMcpRequestContext, uriValue: string) {
  const uri = parseUri(uriValue);
  let callback: () => Promise<unknown>;
  if (uri.hostname === 'project' && uri.pathname === '' && !uri.search) {
    callback = async () => {
      const structure = await listProjectStructure(context);
      return { project: structure.project };
    };
  } else if (uri.hostname === 'project' && uri.pathname === '/structure' && !uri.search) {
    callback = () => listProjectStructure(context);
  } else if (uri.hostname === 'tables' && uri.pathname === '' && !uri.search) {
    callback = async () => {
      const structure = await listProjectStructure(context);
      return { tables: structure.tables ?? [] };
    };
  } else if (uri.hostname === 'documents' && uri.pathname === '') {
    callback = () => listDocuments(context, pageOptions(uri));
  } else {
    const table = /^\/([0-9a-f-]+)\/(schema|rows)$/i.exec(uri.pathname);
    const document = /^\/([0-9a-f-]+)$/i.exec(uri.pathname);
    if (uri.hostname === 'tables' && table && UUID.test(table[1])) {
      if (table[2] === 'schema') {
        if (uri.search) invalid();
        callback = () => getTableSchema(context, table[1]);
      } else {
        callback = () => queryTableRows(context, { tableId: table[1], ...pageOptions(uri) });
      }
    } else if (uri.hostname === 'documents' && document && UUID.test(document[1]) && !uri.search) {
      callback = () => readDocument(context, { documentId: document[1] });
    } else invalid();
  }
  const value = await callback();
  return content(uri.href, value);
}

async function dispatchAccount(
  context: AccountMcpRequestContext,
  uriValue: string,
) {
  const uri = parseUri(uriValue);
  if (uri.hostname === 'projects' && uri.pathname === '' && !uri.search) {
    return content(uri.href, await listAccessibleProjects(context));
  }

  const project = /^\/([0-9a-f-]+)(?:\/(structure))?$/i.exec(uri.pathname);
  const table = /^\/([0-9a-f-]+)\/tables\/([0-9a-f-]+)\/(schema|rows)$/i.exec(uri.pathname);
  const document = /^\/([0-9a-f-]+)\/documents\/([0-9a-f-]+)$/i.exec(uri.pathname);
  const projectId = project?.[1] ?? table?.[1] ?? document?.[1];
  if (uri.hostname !== 'projects' || !projectId || !UUID.test(projectId)) invalid();

  let callback: (projectContext: ProjectMcpRequestContext) => Promise<unknown>;
  if (project) {
    if (uri.search) invalid();
    callback = project[2]
      ? (projectContext) => listProjectStructure(projectContext)
      : async (projectContext) => {
        const structure = await listProjectStructure(projectContext);
        return { project: structure.project };
      };
  } else if (table && UUID.test(table[2])) {
    if (table[3] === 'schema') {
      if (uri.search) invalid();
      callback = (projectContext) => getTableSchema(projectContext, table[2]);
    } else {
      callback = (projectContext) => queryTableRows(projectContext, {
        tableId: table[2],
        ...pageOptions(uri),
      });
    }
  } else if (document && UUID.test(document[2]) && !uri.search) {
    callback = (projectContext) => readDocument(projectContext, { documentId: document[2] });
  } else invalid();

  const projectContext = await authorizeAccountProject(context, projectId, 'read');
  return content(uri.href, await callback(projectContext));
}

const legacyResources = [
  { uri: 'keco://project', name: 'project', mimeType: MIME },
  { uri: 'keco://tables', name: 'tables', mimeType: MIME },
  { uri: 'keco://documents', name: 'documents', mimeType: MIME },
];

const legacyTemplates = [
  { uriTemplate: 'keco://project/structure', name: 'project-structure', mimeType: MIME },
  { uriTemplate: 'keco://tables/{tableId}/schema', name: 'table-schema', mimeType: MIME },
  { uriTemplate: 'keco://tables/{tableId}/rows{?limit,cursor}', name: 'table-rows', mimeType: MIME },
  { uriTemplate: 'keco://documents/{documentId}', name: 'document', mimeType: MIME },
];

const accountResources = [
  { uri: 'keco://projects', name: 'projects', mimeType: MIME },
];

const accountTemplates = [
  { uriTemplate: 'keco://projects/{projectId}', name: 'project', mimeType: MIME },
  { uriTemplate: 'keco://projects/{projectId}/structure', name: 'project-structure', mimeType: MIME },
  { uriTemplate: 'keco://projects/{projectId}/tables/{tableId}/schema', name: 'table-schema', mimeType: MIME },
  { uriTemplate: 'keco://projects/{projectId}/tables/{tableId}/rows{?limit,cursor}', name: 'table-rows', mimeType: MIME },
  { uriTemplate: 'keco://projects/{projectId}/documents/{documentId}', name: 'document', mimeType: MIME },
];

export function registerResources(server: McpServer, context: McpRequestContext): void {
  const account = context.mode === 'account';
  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [
    ...(account ? accountResources : legacyResources),
  ] }));
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: account ? accountTemplates : legacyTemplates,
  }));
  server.server.setRequestHandler(ReadResourceRequestSchema, async (request: { params: { uri: string } }) => {
    try {
      return await (account
        ? dispatchAccount(context, request.params.uri)
        : dispatch(context, request.params.uri));
    }
    catch (error) {
      const safe = asPublicMcpError(error);
      throw new McpError(ErrorCode.InvalidParams, safe.code + ': ' + safe.message);
    }
  });
}
