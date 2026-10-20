import type { SupabaseClient } from '@supabase/supabase-js';

const getSupabaseServiceRoleClient = jest.fn();
const read = jest.fn();
const validate = jest.fn();
const mergeYjsState = jest.fn();
const markdownToYjsState = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient }));
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: { read } }));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { validate, markdownToYjsState }, mergeYjsState,
}));

import { replaceDocumentAsAgent } from '@/lib/server/documentAgentEditService';

const projectId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const libraryId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const fingerprint = 'a'.repeat(32);

it('routes origin Script edits to the CAS wrapper with the complete operation set', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: [{
    collab_epoch: 1, collab_revision: 3, yjs_state: 'replacement',
    content: 'Ada：Updated', updated_at: '2026-09-28T00:00:00Z',
  }], error: null });
  getSupabaseServiceRoleClient.mockReturnValue({ rpc } as unknown as SupabaseClient);
  read.mockResolvedValue({ documentId, projectId, markdown: 'Ada：Hello', yjsStateBase64: 'current',
    updateTail: [], token: { epoch: 1, revision: 2 } });
  mergeYjsState.mockReturnValue('current');
  markdownToYjsState.mockResolvedValue('replacement');

  await replaceDocumentAsAgent({
    actorUserId: userId, projectId, documentId,
    expected: { epoch: 1, revision: 2 }, expectedUpdateIds: [],
    markdown: 'Ada：Updated',
    derivedTableOperations: [{ libraryId, type: 'edit' } as never],
    originScript: { libraryId, expectedFingerprint: fingerprint },
  }, { current: await read() });

  expect(rpc).toHaveBeenCalledWith('replace_document_with_markdown_and_sync_origin_script', expect.objectContaining({
    p_origin_script_library_id: libraryId,
    p_expected_origin_fingerprint: fingerprint,
    p_derived_table_operations: [{ libraryId, type: 'edit' }],
  }));
});
