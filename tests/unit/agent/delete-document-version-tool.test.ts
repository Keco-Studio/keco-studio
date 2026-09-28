import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { needsConfirmation } from '@/lib/agent/conversation-meta';
import { deleteDocumentVersionTool } from '@/lib/agent/tools/delete-document-version';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const preview = {
  project_id: id(1), document_name: 'Current Document',
  version_name: 'Draft 1', version_type: 'manual',
  document_epoch: 4, document_revision: 9,
  state_fingerprint: 'a'.repeat(64), version_fingerprint: 'b'.repeat(64),
};

function setup() {
  const rpc = jest.fn().mockImplementation(async (name: string) => name === 'prepare_document_version_delete'
    ? { data: [preview], error: null }
    : { data: id(5), error: null });
  const ctx: ToolContext = { projectId: id(1), userId: id(2), conversationId: id(3),
    workspace: 'studio', supabase: { rpc } as unknown as SupabaseClient };
  return { ctx, rpc };
}

beforeEach(() => jest.clearAllMocks());

it('always confirms an exact target and executes the atomic CAS RPC', async () => {
  const { ctx, rpc } = setup();
  expect(needsConfirmation(deleteDocumentVersionTool, { autoExecute: true })).toBe(true);
  const prepared = await deleteDocumentVersionTool.prepareConfirmation!({ documentId: id(4), versionId: id(5) }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: {
    type: 'document_version_delete', documentName: 'Current Document',
    versionName: 'Draft 1', currentToken: { epoch: 4, revision: 9 },
  } });
  if (!prepared.success) throw new Error(prepared.error);
  expect(await deleteDocumentVersionTool.execute(prepared.args, ctx)).toMatchObject({
    success: true, data: { versionId: id(5), deleted: true },
    invalidations: [{ type: 'documents', projectId: id(1), documentId: id(4) }],
  });
  expect(rpc).toHaveBeenCalledWith('delete_document_version_if_unchanged', {
    p_document_id: id(4), p_version_id: id(5), p_expected_project_id: id(1),
    p_expected_epoch: 4, p_expected_revision: 9,
    p_expected_state_fingerprint: 'a'.repeat(64),
    p_expected_version_fingerprint: 'b'.repeat(64),
  });
});

it('rejects raw execution and a project mismatch before deletion', async () => {
  const { ctx, rpc } = setup();
  expect((await deleteDocumentVersionTool.execute({ documentId: id(4), versionId: id(5) }, ctx)).success).toBe(false);
  const prepared = await deleteDocumentVersionTool.prepareConfirmation!({ documentId: id(4), versionId: id(5) }, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  expect((await deleteDocumentVersionTool.execute(prepared.args, { ...ctx, projectId: id(99) })).success).toBe(false);
  expect(rpc.mock.calls.filter((call) => call[0] === 'delete_document_version_if_unchanged')).toHaveLength(0);
});

it('rejects cross-project previews, audit targets, and a stale DB snapshot', async () => {
  const { ctx, rpc } = setup();
  rpc.mockResolvedValueOnce({ data: [{ ...preview, project_id: id(99) }], error: null });
  expect((await deleteDocumentVersionTool.prepareConfirmation!({ documentId: id(4), versionId: id(5) }, ctx)).success).toBe(false);
  rpc.mockResolvedValueOnce({ data: [{ ...preview, version_type: 'restore' }], error: null });
  expect((await deleteDocumentVersionTool.prepareConfirmation!({ documentId: id(4), versionId: id(5) }, ctx)).success).toBe(false);
  const prepared = await deleteDocumentVersionTool.prepareConfirmation!({ documentId: id(4), versionId: id(5) }, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'changed' } });
  expect(await deleteDocumentVersionTool.execute(prepared.args, ctx)).toMatchObject({
    success: false, error: 'Document or version changed after approval. Preview deletion again.',
  });
});
