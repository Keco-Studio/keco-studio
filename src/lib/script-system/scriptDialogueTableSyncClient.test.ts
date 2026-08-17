import { queryKeys } from '@/lib/utils/queryKeys';
import { synchronizeScriptDialogueTablePlan } from './scriptDialogueTableSyncClient';

const syncScriptDialogueDocumentWithConflictRetry = jest.fn();
const requestLibraryReconciliation = jest.fn();

jest.mock('./scriptDialogueDocumentSyncClient', () => ({
  syncScriptDialogueDocumentWithConflictRetry: (...args: unknown[]) =>
    syncScriptDialogueDocumentWithConflictRetry(...args),
}));
jest.mock('@/lib/realtime/cell-replacement-broadcast', () => ({
  requestLibraryReconciliation: (...args: unknown[]) =>
    requestLibraryReconciliation(...args),
}));

describe('synchronizeScriptDialogueTablePlan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes every synchronized library and the source document state', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { collab_epoch: 4, collab_revision: 7 },
      error: null,
    });
    const eq = jest.fn().mockReturnValue({ single });
    const supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ eq }),
      }),
    };
    const invalidateQueries = jest.fn(async () => undefined);
    syncScriptDialogueDocumentWithConflictRetry.mockResolvedValue({
      state: { token: { epoch: 5, revision: 8 }, markdown: 'changed' },
      updatedLibraryIds: ['table-id', 'conversation-id'],
    });

    await synchronizeScriptDialogueTablePlan({
      supabase: supabase as never,
      queryClient: { invalidateQueries },
      projectId: 'project-id',
      libraryId: 'table-id',
      documentId: 'document-id',
      command: {
        type: 'edit',
        previousText: 'old',
        nextText: 'new',
      },
    });

    expect(syncScriptDialogueDocumentWithConflictRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'table-id',
        expected: { epoch: 4, revision: 7 },
      }),
      expect.any(Function),
    );
    for (const libraryId of ['table-id', 'conversation-id']) {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.libraryAssets(libraryId),
        refetchType: 'all',
      });
    }
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.documentState('document-id'),
      refetchType: 'all',
    });
    expect(requestLibraryReconciliation).toHaveBeenCalledWith([
      'table-id',
      'conversation-id',
    ]);
  });
});
