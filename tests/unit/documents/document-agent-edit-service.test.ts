import type { SupabaseClient } from '@supabase/supabase-js';

const getSupabaseServiceRoleClient = jest.fn();
const read = jest.fn();
const validate = jest.fn();
const mergeYjsState = jest.fn();
const yjsStateToMarkdown = jest.fn();
const markdownToYjsState = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient }));
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: { read } }));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { validate, yjsStateToMarkdown, markdownToYjsState },
  mergeYjsState,
}));

import { replaceDocumentAsAgent } from '@/lib/server/documentAgentEditService';
import { DocumentStateConflictError } from '@/lib/documents/documentStateTypes';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const UPDATE_ID = '44444444-4444-4444-8444-444444444444';

describe('document Agent edit server command', () => {
  const rpc = jest.fn();
  const admin = { rpc } as unknown as SupabaseClient;

  beforeEach(() => {
    jest.clearAllMocks();
    getSupabaseServiceRoleClient.mockReturnValue(admin);
    read.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      mode: 'collaborative',
      markdown: '# Current',
      yjsStateBase64: 'head-state',
      updateTail: [{ id: UPDATE_ID, updateBase64: 'tail-a' }],
      token: { epoch: 2, revision: 4 },
      updatedAt: '2026-07-15T00:00:00.000Z',
    });
    mergeYjsState.mockReturnValue('merged-state');
    yjsStateToMarkdown.mockResolvedValue('# Current with tail');
    markdownToYjsState.mockResolvedValue('replacement-state');
    rpc.mockResolvedValue({
      data: [{
        collab_epoch: 3,
        collab_revision: 5,
        yjs_state: 'replacement-state',
        content: '# Proposed',
        updated_at: '2026-07-15T00:01:00.000Z',
      }],
      error: null,
    });
  });

  it('derives encoded states server-side and uses only the exact approved tail', async () => {
    await replaceDocumentAsAgent({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [UPDATE_ID],
      markdown: '# Proposed',
    });

    expect(rpc).toHaveBeenCalledWith('replace_document_with_markdown', {
      p_document_id: DOCUMENT_ID,
      p_actor_user_id: USER_ID,
      p_backup_version_id: expect.any(String),
      p_expected_epoch: 2,
      p_expected_revision: 4,
      p_included_update_ids: [UPDATE_ID],
      p_current_yjs_state: 'merged-state',
      p_current_markdown: '# Current with tail',
      p_replacement_yjs_state: 'replacement-state',
      p_replacement_markdown: '# Proposed',
    });
  });

  it('rejects before the RPC when an update was appended after approval', async () => {
    await expect(replaceDocumentAsAgent({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [],
      markdown: '# Proposed',
    })).rejects.toBeInstanceOf(DocumentStateConflictError);
    expect(rpc).not.toHaveBeenCalled();
  });
});
