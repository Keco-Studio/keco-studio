import { assertEquals, assertRejects } from '@std/assert';
import type { McpRequestContext } from './context.ts';
import { rpc } from './database.ts';
import { McpDomainError } from './errors.ts';

function contextWithError(code: string): McpRequestContext {
  const value = {
    supabase: {
      rpc: () => Promise.resolve({ data: null, error: { code } }),
    },
  };
  return value as unknown as McpRequestContext;
}

Deno.test('database maps table-row and document PT409 conflicts distinctly', async () => {
  const rowError = await assertRejects(
    () => rpc(contextWithError('PT409'), 'mcp_update_table_row', {}),
    McpDomainError,
  );
  assertEquals(rowError.code, 'ROW_CONFLICT');
  assertEquals(rowError.message,
    'The selected row changed; read the table rows again before updating.');

  const documentError = await assertRejects(
    () => rpc(contextWithError('PT409'), 'mcp_replace_document_content', {}),
    McpDomainError,
  );
  assertEquals(documentError.code, 'DOCUMENT_CONFLICT');
});
