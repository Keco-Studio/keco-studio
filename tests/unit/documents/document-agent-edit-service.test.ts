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
const LIBRARY_ID = '55555555-5555-4555-8555-555555555555';

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
      epochReason: 'initialize',
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
    const state = await replaceDocumentAsAgent({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [UPDATE_ID],
      markdown: '# Proposed',
    });

    expect(state.epochReason).toBe('agent');

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

  it('persists an explicit semantic change summary through the Agent RPC', async () => {
    await replaceDocumentAsAgent({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [UPDATE_ID],
      markdown: '# Proposed',
      changeSummary: 'Add combat loop and failure conditions',
    });

    expect(rpc).toHaveBeenCalledWith('replace_document_with_markdown_with_summary', expect.objectContaining({
      p_change_summary: 'Add combat loop and failure conditions',
    }));
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

  it('reuses a previously authorized document read for Script synchronization', async () => {
    const current = await read();
    read.mockClear();

    await replaceDocumentAsAgent({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [UPDATE_ID],
      markdown: '# Proposed',
    }, { current });

    expect(read).not.toHaveBeenCalled();
    expect(yjsStateToMarkdown).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('uses the atomic replacement RPC when derived table operations are supplied', async () => {
    const derivedTableOperations = [{
      type: 'delete',
      libraryId: '55555555-5555-4555-8555-555555555555',
      actionRowId: '66666666-6666-4666-8666-666666666666',
      speechRowId: '77777777-7777-4777-8777-777777777777',
    }];

    await replaceDocumentAsAgent({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [UPDATE_ID],
      markdown: '# Proposed',
      derivedTableOperations,
    });

    expect(rpc).toHaveBeenCalledWith(
      'replace_document_with_markdown_and_sync_tables',
      expect.objectContaining({
        p_document_id: DOCUMENT_ID,
        p_derived_table_operations: derivedTableOperations,
      }),
    );
  });

  it('keeps the plain replacement RPC when derived table operations are empty', async () => {
    await replaceDocumentAsAgent({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [UPDATE_ID],
      markdown: '# Proposed',
      derivedTableOperations: [],
    });

    expect(rpc).toHaveBeenCalledWith(
      'replace_document_with_markdown',
      expect.not.objectContaining({
        p_derived_table_operations: expect.anything(),
      }),
    );
  });

  it('uses the three-way RPC for a Script reorder and plot-plan update', async () => {
    const plotPlan = {
      version: 2 as const,
      entryPlotNodeId: 'Opening',
      storyNodeOrder: ['LineB', 'LineA'],
      nodes: [{ id: 'Opening', title: 'Opening', storyNodeIds: ['LineB', 'LineA'] }],
      edges: [],
    };
    await replaceDocumentAsAgent({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 2, revision: 4 },
      expectedUpdateIds: [UPDATE_ID],
      markdown: '# Proposed',
      scriptReorder: {
        libraryId: LIBRARY_ID,
        expectedOrderIds: [
          '66666666-6666-4666-8666-666666666666',
          '77777777-7777-4777-8777-777777777777',
        ],
        nextOrderIds: [
          '77777777-7777-4777-8777-777777777777',
          '66666666-6666-4666-8666-666666666666',
        ],
        plotPlan,
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      'replace_document_with_markdown_and_reorder_script',
      expect.objectContaining({
        p_script_library_id: LIBRARY_ID,
        p_expected_order_ids: [
          '66666666-6666-4666-8666-666666666666',
          '77777777-7777-4777-8777-777777777777',
        ],
        p_next_order_ids: [
          '77777777-7777-4777-8777-777777777777',
          '66666666-6666-4666-8666-666666666666',
        ],
        p_plot_plan: plotPlan,
      }),
    );
  });
});
