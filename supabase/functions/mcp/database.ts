import type { McpRequestContext } from './context.ts';
import { McpDomainError } from './errors.ts';

export async function rpc<T>(context: McpRequestContext, name: string,
  parameters: Record<string, unknown>): Promise<T> {
  const { data, error } = await context.supabase.rpc(name, parameters);
  if (!error) return data as T;
  const code = error.code === '42501' ? 'PROJECT_ACCESS_REVOKED'
    : error.code === 'PT409' ? 'DOCUMENT_CONFLICT'
    : error.code === 'P0002' && name === 'mcp_update_table_row' ? 'ROW_NOT_FOUND'
    : error.code === 'P0002' ? 'TABLE_NOT_FOUND'
    : error.code === '22023' || error.code === '23503' || error.code === '23505'
    ? 'FIELD_VALIDATION_FAILED' : 'INTERNAL_ERROR';
  const message = code === 'PROJECT_ACCESS_REVOKED' ? 'Project access has been revoked.'
    : code === 'DOCUMENT_CONFLICT' ? 'The target changed; read it again before updating.'
    : code === 'ROW_NOT_FOUND' ? 'Row not found.'
    : code === 'TABLE_NOT_FOUND' ? 'Table not found.'
    : code === 'FIELD_VALIDATION_FAILED' ? 'The supplied field values are invalid.'
    : 'The Keco database operation failed.';
  throw new McpDomainError(code, message);
}
