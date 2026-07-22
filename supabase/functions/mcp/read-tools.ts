import type { McpServer } from '@mcp/server/mcp.js';
import { z } from 'zod';
import type { McpRequestContext } from './context.ts';
import { toolFailure, toolSuccess } from './results.ts';
import { listDocuments, listProjectStructure, queryTableRows, readDocument,
  semanticSearch } from './operations.ts';
import { runMcpOperation, type McpOperationClass } from './telemetry.ts';

const uuid = z.string().uuid();
const annotations = { readOnlyHint: true, destructiveHint: false,
  idempotentHint: true, openWorldHint: false };

async function run(
  context: McpRequestContext,
  name: string,
  operationClass: McpOperationClass,
  input: unknown,
  summary: string,
  operation: () => Promise<Record<string, unknown>>,
) {
  try {
    const value = await runMcpOperation(context, name, operationClass, input, operation);
    return toolSuccess(summary, { ok: true, ...value });
  } catch (error) { return toolFailure(error); }
}

export function registerReadTools(server: McpServer, context: McpRequestContext): void {
  server.registerTool('list_project_structure', {
    description: 'List project metadata, folders, table schemas, and bounded document summaries.',
    inputSchema: z.object({}).strict(), annotations,
  }, async (input: Record<string, never>) => run(context, 'list_project_structure', 'read', input,
    'Project structure loaded.', () => listProjectStructure(context)));

  const queryRowsSchema = z.object({ tableId: uuid,
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).max(4096).optional(),
    rowIndex: z.number().int().min(1).optional(),
    fields: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
  }).strict().refine(value => !(value.cursor && value.rowIndex !== undefined),
    'rowIndex cannot be combined with cursor.');
  server.registerTool('query_table_rows', {
    description: 'Read one bounded table page using semantic field labels.',
    inputSchema: queryRowsSchema, annotations,
  }, async (input: z.infer<typeof queryRowsSchema>) => run(context, 'query_table_rows', 'read', input,
    'Table rows loaded.', () => queryTableRows(context, input)));

  const listDocumentsSchema = z.object({ limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).max(4096).optional() }).strict();
  server.registerTool('list_documents', {
    description: 'List a deterministic bounded page of project document metadata.',
    inputSchema: listDocumentsSchema, annotations,
  }, async (input: z.infer<typeof listDocumentsSchema>) => run(context, 'list_documents', 'read', input,
    'Documents loaded.', () => listDocuments(context, input)));

  const readDocumentSchema = z.object({ documentId: uuid,
    mode: z.enum(['full', 'outline', 'heading', 'lines']).optional(),
    heading: z.string().min(1).max(500).optional(),
    lineStart: z.number().int().min(1).optional(),
    lineEnd: z.number().int().min(1).optional(),
  }).strict().superRefine((value, issue) => {
    const mode = value.mode ?? 'full';
    if (mode === 'heading' && !value.heading) issue.addIssue({ code: 'custom', message: 'heading is required.' });
    if (mode !== 'heading' && value.heading) issue.addIssue({ code: 'custom', message: 'heading requires heading mode.' });
    if (mode === 'lines' && (!value.lineStart || !value.lineEnd)) {
      issue.addIssue({ code: 'custom', message: 'lineStart and lineEnd are required.' });
    }
    if (mode !== 'lines' && (value.lineStart || value.lineEnd)) {
      issue.addIssue({ code: 'custom', message: 'line bounds require lines mode.' });
    }
  });
  server.registerTool('read_document', {
    description: 'Read authoritative document Markdown in full, outline, heading, or line mode.',
    inputSchema: readDocumentSchema, annotations,
  }, async (input: z.infer<typeof readDocumentSchema>) => run(context, 'read_document', 'read', input,
    'Document loaded.', () => readDocument(context, input)));

  const searchSchema = z.object({ query: z.string().min(1).max(4000),
    limit: z.number().int().min(1).max(30).optional(),
    source: z.enum(['all', 'tables', 'documents']).optional() }).strict();
  server.registerTool('semantic_search', {
    description: 'Search project tables and documents with explicit semantic or text/fuzzy mode.',
    inputSchema: searchSchema, annotations,
  }, async (input: z.infer<typeof searchSchema>) => run(context, 'semantic_search', 'search', input,
    'Search completed.', () => semanticSearch(context, input)));
}
