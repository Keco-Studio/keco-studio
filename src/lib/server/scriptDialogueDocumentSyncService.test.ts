import type { SupabaseClient } from '@supabase/supabase-js';

const read = jest.fn();
const replaceDocumentAsAgent = jest.fn();
const prepareScriptDialogueLibraryReconciliation = jest.fn();
const prepareScriptDialogueDerivedTableOperations = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read },
}));
jest.mock('./documentAgentEditService', () => ({ replaceDocumentAsAgent }));
jest.mock('./scriptDialogueDerivedTableSyncService', () => ({
  prepareScriptDialogueLibraryReconciliation,
  prepareScriptDialogueDerivedTableOperations,
}));

import {
  mapScriptDialogueSyncError,
  syncScriptDialogueDocument,
} from './scriptDialogueDocumentSyncService';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const LIBRARY_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const ROW_A = '55555555-5555-4555-8555-555555555555';
const ROW_B = '66666666-6666-4666-8666-666666666666';

const plotPlan = {
  version: 2 as const,
  entryPlotNodeId: 'Opening',
  storyNodeOrder: ['LineA', 'LineB'],
  nodes: [{ id: 'Opening', title: 'Opening', storyNodeIds: ['LineA', 'LineB'] }],
  edges: [],
};

function originLibraryClient(
  documentExportType: 'script' | 'table',
): SupabaseClient {
  const single = jest.fn().mockResolvedValue({
    data: { id: LIBRARY_ID, document_export_type: documentExportType },
    error: null,
  });
  const eq = jest.fn();
  eq.mockReturnValue({ eq, single });
  return {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ eq }),
    }),
  } as unknown as SupabaseClient;
}

describe('syncScriptDialogueDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    read.mockResolvedValue({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      markdown: [
        '<BlockAnchor id="77777777-7777-4777-8777-777777777777" />Ada：Hello',
        '<BlockAnchor id="88888888-8888-4888-8888-888888888888" />Ben：Wait',
      ].join('\n\n'),
      yjsStateBase64: 'state',
      updateTail: [],
      token: { epoch: 1, revision: 2 },
    });
    prepareScriptDialogueLibraryReconciliation.mockResolvedValue({
      operation: {
        type: 'reorder',
        expectedOrderIds: [ROW_A, ROW_B],
        nextOrderIds: [ROW_B, ROW_A],
      },
      currentOrderIds: [ROW_A, ROW_B],
      flowRows: [
        { Label: 'LineA', Type: '1', Name: 'Ada', Content: 'Hello' },
        { Label: 'LineB', Type: '2', Name: 'Ben', Content: 'Wait' },
      ],
    });
    prepareScriptDialogueDerivedTableOperations.mockResolvedValue([]);
    replaceDocumentAsAgent.mockResolvedValue({
      markdown: 'reordered',
      token: { epoch: 2, revision: 3 },
    });
  });

  it('prepares one atomic Script reorder with the patched plot plan', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: LIBRARY_ID, plot_plan: plotPlan },
      error: null,
    });
    const eq = jest.fn();
    eq.mockReturnValue({ eq, single });
    const supabase = {
      from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq }) }),
    } as unknown as SupabaseClient;

    const result = await syncScriptDialogueDocument({
      supabase,
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      libraryId: LIBRARY_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 1, revision: 2 },
      command: {
        type: 'reorder',
        movingTexts: ['Ben：Wait'],
        targetText: 'Ada：Hello',
        edge: 'before',
      },
    });

    expect(replaceDocumentAsAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptReorder: {
          libraryId: LIBRARY_ID,
          expectedOrderIds: [ROW_A, ROW_B],
          nextOrderIds: [ROW_B, ROW_A],
          plotPlan: expect.objectContaining({ storyNodeOrder: ['LineB', 'LineA'] }),
        },
      }),
      expect.any(Object),
    );
    expect(result.plotPlan?.storyNodeOrder).toEqual(['LineB', 'LineA']);
  });

  it('returns the derived Table IDs updated by a dialogue edit', async () => {
    prepareScriptDialogueDerivedTableOperations.mockResolvedValueOnce([{
      type: 'edit',
      libraryId: LIBRARY_ID,
      typeFieldId: '99999999-9999-4999-8999-999999999999',
      nameFieldId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      contentFieldId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      actionRowId: null,
      speechRowId: ROW_A,
      speaker: 'Ada',
      action: '',
      dialogue: 'Changed',
      speechType: '1',
    }]);

    const result = await syncScriptDialogueDocument({
      supabase: originLibraryClient('script'),
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      libraryId: LIBRARY_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 1, revision: 2 },
      command: {
        type: 'edit',
        role: 'speech',
        previousText: 'Ada：Hello',
        nextText: 'Ada：Changed',
      },
    });

    expect(result.updatedLibraryIds).toEqual([LIBRARY_ID]);
  });

  it('includes the linked Conversation operation when the edit originates in a Table', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: LIBRARY_ID, document_export_type: 'table' },
      error: null,
    });
    const eq = jest.fn();
    eq.mockReturnValue({ eq, single });
    const supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ eq }),
      }),
    } as unknown as SupabaseClient;
    prepareScriptDialogueDerivedTableOperations.mockResolvedValueOnce([{
      type: 'edit',
      libraryId: '55555555-5555-4555-8555-555555555555',
    }, {
      type: 'edit',
      libraryId: '66666666-6666-4666-8666-666666666666',
    }]);

    const result = await syncScriptDialogueDocument({
      supabase,
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      libraryId: LIBRARY_ID,
      documentId: DOCUMENT_ID,
      expected: { epoch: 1, revision: 2 },
      command: {
        type: 'edit',
        role: 'action',
        previousText: '',
        previousDialogue: 'Hello',
        previousSpeaker: 'Ada',
        nextText: '',
        speaker: 'Bea',
        dialogue: 'Changed',
      },
    });

    expect(prepareScriptDialogueDerivedTableOperations).toHaveBeenCalledWith(
      expect.objectContaining({ includeScriptLibraries: true }),
    );
    expect(result.updatedLibraryIds).toEqual([
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ]);
  });
});

describe('mapScriptDialogueSyncError', () => {
  it('maps plain Supabase mapping errors without treating them as generic 500s', () => {
    expect(mapScriptDialogueSyncError({
      code: '22023',
      message: 'DERIVED_TABLE_MAPPING_AMBIGUOUS: dialogue values are invalid',
    })).toEqual({
      code: 'TABLE_MAPPING_AMBIGUOUS',
      status: 409,
      message: 'Unable to determine the matching table row. Regenerate the table and try again.',
    });
  });
});
