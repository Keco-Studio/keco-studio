import type { SupabaseClient } from '@supabase/supabase-js';
import { DocumentStateConflictError } from '@/lib/documents/documentStateTypes';

const read = jest.fn();
const rpc = jest.fn();
const prepareScriptDialogueLibraryReconciliation = jest.fn();
const getSupabaseServiceRoleClient = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read },
}));
jest.mock('./scriptDialogueDerivedTableSyncService', () => ({
  prepareScriptDialogueLibraryReconciliation,
}));
jest.mock('./supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient,
}));

import { reconcileScriptLibrariesFromDocument } from './scriptDocumentReconciliationService';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const LIBRARY_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const ROW_ID = '55555555-5555-4555-8555-555555555555';
const BLOCK_ID = '66666666-6666-4666-8666-666666666666';
const INSERTED_BLOCK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const plotPlan = {
  version: 2 as const,
  entryPlotNodeId: 'Opening',
  storyNodeOrder: ['LineA'],
  nodes: [{ id: 'Opening', title: 'Opening', storyNodeIds: ['LineA'] }],
  edges: [],
};
const editOperation = {
  type: 'edit' as const,
  libraryId: LIBRARY_ID,
  typeFieldId: '77777777-7777-4777-8777-777777777777',
  nameFieldId: '88888888-8888-4888-8888-888888888888',
  contentFieldId: '99999999-9999-4999-8999-999999999999',
  actionRowId: null,
  speechRowId: ROW_ID,
  speaker: 'Ada',
  action: '',
  dialogue: 'Changed',
  speechType: '1' as const,
};

function markdown(text: string): string {
  return `<BlockAnchor id="${BLOCK_ID}" />${text}`;
}

function adminClient(libraries = [{ id: LIBRARY_ID, plot_plan: plotPlan }]) {
  const result = Promise.resolve({ data: libraries, error: null });
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    then: result.then.bind(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    from: jest.fn().mockReturnValue(query),
    rpc,
  };
}

function reconcile(overrides: Partial<Parameters<typeof reconcileScriptLibrariesFromDocument>[0]> = {}) {
  return reconcileScriptLibrariesFromDocument({
    supabase: {} as SupabaseClient,
    actorUserId: USER_ID,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    expected: { epoch: 3, revision: 4 },
    previousMarkdown: markdown('Ada：Hello'),
    markdown: markdown('Ada：Changed'),
    ...overrides,
  });
}

describe('reconcileScriptLibrariesFromDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    read.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      markdown: markdown('Ada：Changed'),
      token: { epoch: 3, revision: 4 },
    });
    prepareScriptDialogueLibraryReconciliation.mockResolvedValue({
      operation: editOperation,
      currentOrderIds: [ROW_ID],
    });
    rpc.mockResolvedValue({ error: null });
    getSupabaseServiceRoleClient.mockReturnValue(adminClient());
  });

  it('applies one prepared mutation and plot plan through the guarded RPC', async () => {
    await expect(reconcile()).resolves.toEqual({
      updatedLibraries: 1,
      updatedLibraryIds: [LIBRARY_ID],
      ambiguous: false,
    });

    expect(prepareScriptDialogueLibraryReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: LIBRARY_ID,
        access: {
          userId: USER_ID,
          cache: expect.any(Map),
        },
      }),
    );
    expect(rpc).toHaveBeenCalledWith('reconcile_script_library_from_document', {
      p_document_id: DOCUMENT_ID,
      p_actor_user_id: USER_ID,
      p_expected_epoch: 3,
      p_expected_revision: 4,
      p_script_library_id: LIBRARY_ID,
      p_operation: expect.objectContaining({ type: 'edit', speechRowId: ROW_ID }),
      p_plot_plan: plotPlan,
    });
  });

  it('does not access linked libraries for a no-op or ambiguous change', async () => {
    read.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      markdown: markdown('Ada：Hello'),
      token: { epoch: 3, revision: 4 },
    });
    await expect(reconcile({ markdown: markdown('Ada：Hello') })).resolves.toEqual({
      updatedLibraries: 0,
      updatedLibraryIds: [],
      ambiguous: false,
    });
    const ambiguousMarkdown = [
      markdown('Ada：Changed'),
      '<BlockAnchor id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />Ben：Changed',
    ].join('\n\n');
    read.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      markdown: ambiguousMarkdown,
      token: { epoch: 3, revision: 4 },
    });
    await expect(reconcile({
      previousMarkdown: [markdown('Ada：Hello'), '<BlockAnchor id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />Ben：Wait'].join('\n\n'),
      markdown: ambiguousMarkdown,
    })).resolves.toEqual({ updatedLibraries: 0, updatedLibraryIds: [], ambiguous: true });
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it('rejects stale snapshots and project mismatches before elevated access', async () => {
    read.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      markdown: markdown('Ada：Changed again'),
      token: { epoch: 3, revision: 5 },
    });
    await expect(reconcile()).rejects.toBeInstanceOf(DocumentStateConflictError);

    read.mockResolvedValueOnce({
      projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      markdown: markdown('Ada：Changed'),
      token: { epoch: 3, revision: 4 },
    });
    await expect(reconcile()).rejects.toThrow('FORBIDDEN');
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it('maps a guarded RPC race to a document conflict', async () => {
    rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'document changed' } });

    await expect(reconcile()).rejects.toBeInstanceOf(DocumentStateConflictError);
  });

  it('maps a guarded RPC permission failure to the public forbidden error', async () => {
    rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'private detail' } });

    await expect(reconcile()).rejects.toThrow('FORBIDDEN');
  });

  it('allocates stable row IDs and patches the plot plan for an insertion', async () => {
    const insertedMarkdown = [
      markdown('Ada：Hello'),
      `<BlockAnchor id="${INSERTED_BLOCK_ID}" />Ben：Wait`,
    ].join('\n\n');
    read.mockResolvedValueOnce({
      projectId: PROJECT_ID,
      markdown: insertedMarkdown,
      token: { epoch: 3, revision: 4 },
    });
    prepareScriptDialogueLibraryReconciliation.mockResolvedValueOnce({
      operation: {
        type: 'insert',
        libraryId: LIBRARY_ID,
        typeFieldId: '77777777-7777-4777-8777-777777777777',
        nameFieldId: '88888888-8888-4888-8888-888888888888',
        contentFieldId: '99999999-9999-4999-8999-999999999999',
        afterRowId: ROW_ID,
        insertAtStart: false,
        speaker: 'Ben',
        action: '',
        dialogue: 'Wait',
        speechType: '1',
      },
      currentOrderIds: [ROW_ID],
    });

    await expect(reconcile({ markdown: insertedMarkdown })).resolves.toEqual({
      updatedLibraries: 1,
      updatedLibraryIds: [LIBRARY_ID],
      ambiguous: false,
    });

    const args = rpc.mock.calls[0][1];
    expect(args.p_operation).toEqual(expect.objectContaining({
      type: 'insert',
      expectedOrderIds: [ROW_ID],
      nextOrderIds: [ROW_ID, expect.any(String), expect.any(String)],
      actionRowId: expect.any(String),
      speechRowId: expect.any(String),
    }));
    expect(args.p_plot_plan.storyNodeOrder).toHaveLength(3);
    expect(args.p_plot_plan.nodes).toEqual([
      expect.objectContaining({ storyNodeIds: args.p_plot_plan.storyNodeOrder }),
    ]);
  });
});
