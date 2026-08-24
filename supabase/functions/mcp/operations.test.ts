import { assert, assertEquals, assertRejects } from '@std/assert';
import type { ProjectMcpRequestContext } from './context.ts';
import { McpDomainError } from './errors.ts';
import { listProjectStructure, readDocument, readDocumentTransportState } from './operations.ts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const UPDATE_A = '33333333-3333-4333-8333-333333333333';
const UPDATE_B = '44444444-4444-4444-8444-444444444444';

function okState(content: string, tail: Array<Record<string, unknown>> = [], name = 'Document') {
  return { status: 'ok', head: { id: DOCUMENT_ID, name, content,
    yjs_state: null, collab_epoch: 4, collab_revision: 9,
    updated_at: '2026-07-22T00:00:00.000Z' }, tail };
}

function makeContext(data: unknown) {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const context = { requestId: crypto.randomUUID(), userId: 'user-1', projectId: PROJECT_ID,
    role: 'viewer', clientId: null, bearerToken: 'test-token', supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        return { data, error: null };
      },
      from() { throw new Error('Document transport reads must use only the atomic RPC.'); },
    } } as unknown as ProjectMcpRequestContext;
  return { context, calls };
}

Deno.test('document transport state uses one project-bound RPC and preserves its ordered tail', async () => {
  const tail = [
    { id: UPDATE_A, update_data: 'AAAA', created_at: '2026-07-22T00:00:01.000Z' },
    { id: UPDATE_B, update_data: 'BBBB', created_at: '2026-07-22T00:00:01.000Z' },
  ];
  const { context, calls } = makeContext(okState('# Current', tail));

  const result = await readDocumentTransportState(context, DOCUMENT_ID);

  assertEquals(result.tail.map(row => row.id), [UPDATE_A, UPDATE_B]);
  assertEquals(calls, [{ name: 'mcp_read_document_transport_state', parameters: {
    p_project_id: PROJECT_ID, p_document_id: DOCUMENT_ID,
  } }]);
});

Deno.test('project structure exposes folder project and parent identities', async () => {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const context = { requestId: crypto.randomUUID(), userId: 'user-1', projectId: PROJECT_ID,
    role: 'viewer', clientId: null, bearerToken: 'test-token', supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        return { data: {
          project: { id: PROJECT_ID },
          folders: [{
            id: '55555555-5555-4555-8555-555555555555',
            project_id: PROJECT_ID,
            parent_folder_id: '66666666-6666-4666-8666-666666666666',
            name: 'Child',
            updated_at: '2026-08-24T00:00:00.000Z',
          }],
          tables: [],
          documents: [],
        }, error: null };
      },
    } } as unknown as ProjectMcpRequestContext;

  const result = await listProjectStructure(context);

  assertEquals(result.folders, [{
    id: '55555555-5555-4555-8555-555555555555',
    projectId: PROJECT_ID,
    parentFolderId: '66666666-6666-4666-8666-666666666666',
    name: 'Child',
    updatedAt: '2026-08-24T00:00:00.000Z',
  }]);
  assertEquals(calls, [{
    name: 'mcp_read_project_structure',
    parameters: { p_project_id: PROJECT_ID },
  }]);
});

Deno.test('atomic RPC state includes a tail that arrives during the former head-tail gap', async () => {
  const concurrentTail = {
    id: UPDATE_B, update_data: 'BBBB', created_at: '2026-07-22T00:00:02.000Z',
  };
  const { context, calls } = makeContext(okState('# Current', [concurrentTail]));

  const result = await readDocument(context, { documentId: DOCUMENT_ID, mode: 'outline' });

  assertEquals(result.stateToken.updateIds, [UPDATE_B]);
  assertEquals(calls.length, 1);
});

Deno.test('document transport maps revoked and compaction-required states explicitly', async () => {
  for (const [state, code] of [
    [{ status: 'access_denied' }, 'PROJECT_ACCESS_REVOKED'],
    [{ status: 'payload_too_large', reason: 'compaction_required' }, 'PAYLOAD_TOO_LARGE'],
  ] as const) {
    const { context } = makeContext(state);
    const error = await assertRejects(() => readDocumentTransportState(context, DOCUMENT_ID),
      McpDomainError);
    assertEquals(error.code, code);
  }
});

Deno.test('read_document accepts exactly 100 KiB of Markdown', async () => {
  const prefix = '# Exact\n';
  const markdown = prefix + 'x'.repeat(100 * 1024 - prefix.length);
  const { context } = makeContext(okState(markdown));

  const result = await readDocument(context, DOCUMENT_ID);

  assertEquals(result.document.markdown, markdown);
  assertEquals(result.truncated, false);
});

Deno.test('read_document bounds huge outlines before protocol serialization', async () => {
  const markdown = Array.from({ length: 30_000 }, (_, index) => `# Heading ${index}`).join('\n');
  const { context } = makeContext(okState(markdown));

  const result = await readDocument(context, { documentId: DOCUMENT_ID, mode: 'outline' });

  assertEquals(result.document.markdown, null);
  assertEquals(result.outlineTruncated, true);
  assert(result.outline.length <= 2_000);
  assert(new TextEncoder().encode(JSON.stringify(result.outline)).byteLength <= 128 * 1024);
});

Deno.test('read_document rejects oversized heading and line selections explicitly', async () => {
  const oversized = 'x'.repeat(100 * 1024 + 1);
  for (const [markdown, input] of [
    [`# Large\n${oversized}\n# Next`, { mode: 'heading', heading: 'Large' }],
    [oversized, { mode: 'lines', lineStart: 1, lineEnd: 1 }],
  ] as const) {
    const { context } = makeContext(okState(markdown));
    const error = await assertRejects(() => readDocument(context, {
      documentId: DOCUMENT_ID, ...input,
    }), McpDomainError);
    assertEquals(error.code, 'PAYLOAD_TOO_LARGE');
  }
});

Deno.test('read_document rejects an oversized serialized result before the HTTP guard', async () => {
  const { context } = makeContext(okState('# Small', [], 'x'.repeat(900 * 1024)));

  const error = await assertRejects(() => readDocument(context, {
    documentId: DOCUMENT_ID, mode: 'outline',
  }), McpDomainError);

  assertEquals(error.code, 'PAYLOAD_TOO_LARGE');
});
