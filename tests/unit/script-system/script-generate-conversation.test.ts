/* eslint-disable react-hooks/globals -- harness captures hook return for imperative test calls */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockPush = jest.fn();
const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);
const mockGetSession = jest.fn();
const mockFetchDocumentExportSource = jest.fn();
const mockRunDocumentDerivedImport = jest.fn();
const mockNotifyProgress = jest.fn();
const mockInvalidateLibraryData = jest.fn().mockResolvedValue(undefined);
const mockShowErrorToast = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => ({
    auth: { getSession: mockGetSession },
  }),
}));

jest.mock('@/lib/documents/startDocumentExport', () => ({
  fetchDocumentExportSource: (...args: unknown[]) =>
    mockFetchDocumentExportSource(...args),
}));

jest.mock('@/lib/documents/runDocumentDerivedImport', () => ({
  runDocumentDerivedImport: (...args: unknown[]) =>
    mockRunDocumentDerivedImport(...args),
}));

jest.mock('@/lib/documents/documentDerivedImportProgress', () => ({
  notifyDocumentDerivedImportProgress: (...args: unknown[]) =>
    mockNotifyProgress(...args),
}));

jest.mock('@/lib/queryInvalidation', () => ({
  invalidateLibraryData: (...args: unknown[]) =>
    mockInvalidateLibraryData(...args),
}));

jest.mock('@/lib/utils/toast', () => ({
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
  showSuccessToast: jest.fn(),
}));

jest.mock('@/lib/services/documentService', () => ({
  updateDocumentName: jest.fn(),
}));

jest.mock('@/lib/services/libraryService', () => ({
  deleteLibrary: jest.fn(),
  updateLibrary: jest.fn(),
}));

import { useScriptSidebarActions } from '@/components/script-system/useScriptSidebarActions';

const source = {
  documentId: 'doc-1',
  documentName: 'Story',
  projectId: 'proj-1',
  folderId: 'folder-1',
  markdown: '# Hello',
  token: { epoch: 1, revision: 2 },
  snapshotToken: 'snap',
};

describe('Script generate conversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'token-abc' } },
      error: null,
    });
    mockFetchDocumentExportSource.mockResolvedValue(source);
    mockRunDocumentDerivedImport.mockResolvedValue({
      libraryId: 'lib-new',
      rowCount: 3,
      fieldCount: 5,
    });
  });

  function getHandleAction(opts: {
    userRole: 'admin' | 'editor' | 'viewer' | null;
    onExpandDocument?: (documentId: string) => void;
    onRefreshWorkspace?: () => Promise<unknown> | unknown;
  }) {
    let handleAction: ((action: 'generate-conversation') => void) | undefined;
    function Harness() {
      handleAction = useScriptSidebarActions({
        projectId: 'proj-1',
        userRole: opts.userRole,
        target: { type: 'document', id: 'doc-1', name: 'Story' },
        onStartRename: jest.fn(),
        onRefreshWorkspace: opts.onRefreshWorkspace ?? jest.fn(),
        onExpandDocument: opts.onExpandDocument,
        requestDeleteConfirm: jest.fn(),
      }).handleAction;
      return null;
    }
    renderToStaticMarkup(React.createElement(Harness));
    return handleAction!;
  }

  it('runs script export pipeline and navigates to script child route', async () => {
    const onExpandDocument = jest.fn();
    const onRefreshWorkspace = jest.fn().mockResolvedValue(undefined);
    const handleAction = getHandleAction({
      userRole: 'admin',
      onExpandDocument,
      onRefreshWorkspace,
    });

    handleAction('generate-conversation');

    expect(mockNotifyProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        documentId: 'doc-1',
        exportType: 'script',
        phase: 'preparing',
      })
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/script-system/proj-1/doc/doc-1'
    );

    await new Promise((r) => setImmediate(r));

    expect(mockFetchDocumentExportSource).toHaveBeenCalledWith(
      'doc-1',
      'token-abc'
    );
    expect(mockRunDocumentDerivedImport).toHaveBeenCalledWith({
      source,
      exportType: 'script',
      accessToken: 'token-abc',
    });
    expect(mockRunDocumentDerivedImport).not.toHaveBeenCalledWith(
      expect.objectContaining({ exportType: 'table' })
    );
    expect(mockInvalidateLibraryData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'proj-1',
        libraryId: 'lib-new',
        refetchActiveFoldersLibraries: true,
      })
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['script-workspace', 'proj-1'],
    });
    expect(onRefreshWorkspace).toHaveBeenCalled();
    expect(onExpandDocument).toHaveBeenCalledWith('doc-1');
    expect(mockPush).toHaveBeenLastCalledWith(
      '/script-system/proj-1/script/lib-new'
    );
  });

  it('does not run pipeline for non-admin', async () => {
    const handleAction = getHandleAction({ userRole: 'editor' });
    handleAction('generate-conversation');
    await new Promise((r) => setImmediate(r));
    expect(mockFetchDocumentExportSource).not.toHaveBeenCalled();
    expect(mockRunDocumentDerivedImport).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.stringContaining('/script/')
    );
  });
});
