import type { McpServer } from '@mcp/server/mcp.js';
import { GetPromptRequestSchema, ListPromptsRequestSchema, McpError,
  ErrorCode } from '@mcp/types.js';
import { z } from 'zod';
import type { McpRequestContext } from './context.ts';

const uuid = z.string().uuid();
const definitions = [
  {
    name: 'analyze_project',
    description: 'Analyze the bound project using bounded source reads.',
    schema: z.object({}).strict(),
    arguments: undefined,
    message: 'Inspect the project structure, then read only bounded table rows and documents needed for the analysis. Summarize findings with stable source IDs.',
  },
  {
    name: 'build_tables_from_document',
    description: 'Build non-destructive tables from a project document.',
    schema: z.object({ documentId: uuid }).strict(),
    arguments: [{ name: 'documentId', required: true }],
    message: 'Read document {documentId}, propose a schema, and then use explicit non-destructive table creation calls. Do not delete or overwrite existing tables.',
  },
  {
    name: 'update_project_data',
    description: 'Update bounded project table rows explicitly.',
    schema: z.object({ tableId: uuid }).strict(),
    arguments: [{ name: 'tableId', required: true }],
    message: 'Inspect table {tableId}, its schema, and the bounded target rows before making explicit row updates. Do not perform deletes or bulk imports.',
  },
] as const;

export function registerPrompts(server: McpServer, _context: McpRequestContext): void {
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: definitions.map(({ name, description, arguments: promptArguments }) => ({
      name, description, arguments: promptArguments,
    })),
  }));
  server.server.setRequestHandler(GetPromptRequestSchema, async (request: {
    params: { name: string; arguments?: Record<string, string> };
  }) => {
    const definition = definitions.find(item => item.name === request.params.name);
    if (!definition) throw new McpError(ErrorCode.InvalidParams, 'Prompt not found.');
    const parsed = definition.schema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) throw new McpError(ErrorCode.InvalidParams, 'Invalid prompt arguments.');
    const values = parsed.data as Record<string, string>;
    const text = definition.message.replace(/\{(\w+)\}/g,
      (_match, key: string) => values[key] ?? '');
    return { description: definition.description,
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
  });
}
