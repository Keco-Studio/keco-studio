import type { McpServer } from '@mcp/server/mcp.js';
import { ErrorCode, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema,
  McpError, ReadResourceRequestSchema } from '@mcp/types.js';
import type { McpRequestContext } from './context.ts';
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

async function dispatch(context: McpRequestContext, uriValue: string) {
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

export function registerResources(server: McpServer, context: McpRequestContext): void {
  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [
    { uri: 'keco://project', name: 'project', mimeType: MIME },
    { uri: 'keco://tables', name: 'tables', mimeType: MIME },
    { uri: 'keco://documents', name: 'documents', mimeType: MIME },
  ] }));
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      { uriTemplate: 'keco://project/structure', name: 'project-structure', mimeType: MIME },
      { uriTemplate: 'keco://tables/{tableId}/schema', name: 'table-schema', mimeType: MIME },
      { uriTemplate: 'keco://tables/{tableId}/rows{?limit,cursor}', name: 'table-rows', mimeType: MIME },
      { uriTemplate: 'keco://documents/{documentId}', name: 'document', mimeType: MIME },
    ],
  }));
  server.server.setRequestHandler(ReadResourceRequestSchema, async (request: { params: { uri: string } }) => {
    try { return await dispatch(context, request.params.uri); }
    catch (error) {
      const safe = asPublicMcpError(error);
      throw new McpError(ErrorCode.InvalidParams, safe.code + ': ' + safe.message);
    }
  });
}
