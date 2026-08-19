/* eslint-disable react-hooks/globals -- harness captures hook return for imperative test calls */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const mockDeleteDocument = jest.fn().mockResolvedValue(undefined);
const mockDeleteLibrary = jest.fn().mockResolvedValue(undefined);
const mockDeleteFolder = jest.fn().mockResolvedValue(undefined);
const mockInvalidateLibraryData = jest.fn().mockReturnValue(new Promise(() => {}));
const mockInvalidateFolderData = jest.fn().mockReturnValue(new Promise(() => {}));
const mockInvalidateLibraryAssetsData = jest.fn().mockReturnValue(new Promise(() => {}));
const mockBroadcastProjectDocumentUpdate = jest.fn();

jest.mock('@/lib/services/documentService', () => ({
  deleteDocument: (...args: unknown[]) => mockDeleteDocument(...args),
  moveDocument: jest.fn(),
}));

jest.mock('@/lib/services/libraryService', () => ({
  deleteLibrary: (...args: unknown[]) => mockDeleteLibrary(...args),
}));

jest.mock('@/lib/services/folderService', () => ({
  deleteFolder: (...args: unknown[]) => mockDeleteFolder(...args),
  duplicateFolder: jest.fn(),
}));

jest.mock('@/lib/queryInvalidation', () => ({
  invalidateLibraryData: (...args: unknown[]) => mockInvalidateLibraryData(...args),
  invalidateFolderData: (...args: unknown[]) => mockInvalidateFolderData(...args),
  invalidateLibraryAssetsData: (...args: unknown[]) =>
    mockInvalidateLibraryAssetsData(...args),
}));

jest.mock('@/lib/documents/projectDocumentChannel', () => ({
  broadcastProjectDocumentUpdate: (...args: unknown[]) =>
    mockBroadcastProjectDocumentUpdate(...args),
}));

import { useSidebarContextMenuActions } from '@/components/layout/hooks/useSidebarContextMenuActions';

const neverResolves = () => new Promise<void>(() => {});

async function didSettle(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await new Promise((r) => setImmediate(r));
  return settled;
}

function makeSupabase(assetDelete = { error: null as Error | null }) {
  return {
    from: jest.fn().mockReturnValue({
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue(assetDelete),
      }),
    }),
  };
}

function getDeleteConfirm(opts: {
  type: 'document' | 'library' | 'folder' | 'asset';
  id: string;
  libraries?: Array<{ id: string; folder_id: string | null }>;
  assets?: Record<string, Array<{ id: string }>>;
  supabase?: ReturnType<typeof makeSupabase>;
}) {
  const requestDeleteConfirm = jest.fn();
  const invalidateQueries = jest.fn().mockReturnValue(neverResolves());
  const router = { push: jest.fn() };
  let handleAction: ((action: string) => void) | undefined;
  function Harness() {
    handleAction = useSidebarContextMenuActions({
      contextMenu: { x: 0, y: 0, type: opts.type, id: opts.id, elementRef: null },
      closeContextMenu: jest.fn(),
      router: router as never,
      openEditProject: jest.fn(),
      openEditLibrary: jest.fn(),
      openDuplicateLibrary: jest.fn(),
      openImportLibrary: jest.fn(),
      openImportScript: jest.fn(),
      openEditFolder: jest.fn(),
      openEditAsset: jest.fn(),
      supabase: (opts.supabase ?? makeSupabase()) as never,
      queryClient: { invalidateQueries } as never,
      currentIds: {
        projectId: 'project-1',
        libraryId: opts.type === 'library' ? opts.id : null,
        folderId: opts.type === 'folder' ? opts.id : null,
        assetId: opts.type === 'asset' ? opts.id : null,
        documentId: opts.type === 'document' ? opts.id : null,
      },
      libraries: (opts.libraries ?? []) as never,
      setError: jest.fn(),
      assets: (opts.assets ?? {}) as never,
      fetchAssets: jest.fn().mockReturnValue(neverResolves()),
      onProjectDeleteViaAPI: jest.fn(),
      openMoveLibrary: jest.fn(),
      openMoveDocument: jest.fn(),
      openNewDocumentInFolder: jest.fn(),
      startInlineRename: jest.fn(),
      startDocumentDerivedImport: jest.fn(),
      userRole: 'admin',
      requestDeleteConfirm,
    }).handleContextMenuAction;
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  handleAction!('delete');
  return {
    onConfirm: requestDeleteConfirm.mock.calls[0][0].onConfirm as () => Promise<void>,
    invalidateQueries,
    router,
  };
}

describe('Studio delete confirm does not block refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteDocument.mockResolvedValue(undefined);
    mockDeleteLibrary.mockResolvedValue(undefined);
    mockDeleteFolder.mockResolvedValue(undefined);
    mockInvalidateLibraryData.mockReturnValue(neverResolves());
    mockInvalidateFolderData.mockReturnValue(neverResolves());
    mockInvalidateLibraryAssetsData.mockReturnValue(neverResolves());
  });

  it('document delete confirm settles after mutation without waiting for cache refresh', async () => {
    const { onConfirm, invalidateQueries } = getDeleteConfirm({
      type: 'document',
      id: 'doc-1',
    });

    expect(await didSettle(onConfirm())).toBe(true);
    expect(mockDeleteDocument).toHaveBeenCalledWith(expect.anything(), 'doc-1');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['documents', 'project-1'],
    });
    expect(mockInvalidateLibraryData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'project-1',
        refetchActiveFoldersLibraries: true,
      })
    );
  });

  it('library delete confirm settles after mutation without waiting for cache refresh', async () => {
    const { onConfirm, router } = getDeleteConfirm({
      type: 'library',
      id: 'lib-1',
      libraries: [{ id: 'lib-1', folder_id: 'folder-1' }],
    });

    expect(await didSettle(onConfirm())).toBe(true);
    expect(mockDeleteLibrary).toHaveBeenCalledWith(expect.anything(), 'lib-1');
    expect(router.push).toHaveBeenCalledWith('/project-1');
    expect(mockInvalidateLibraryData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'project-1',
        folderId: 'folder-1',
        libraryId: 'lib-1',
        refetchActiveFoldersLibraries: true,
      })
    );
  });

  it('folder delete confirm settles after mutation without waiting for cache refresh', async () => {
    const { onConfirm, router } = getDeleteConfirm({
      type: 'folder',
      id: 'folder-1',
    });

    expect(await didSettle(onConfirm())).toBe(true);
    expect(mockDeleteFolder).toHaveBeenCalledWith(expect.anything(), 'folder-1');
    expect(router.push).toHaveBeenCalledWith('/project-1');
    expect(mockInvalidateFolderData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'project-1',
        folderId: 'folder-1',
        refetchActiveFoldersLibraries: true,
      })
    );
  });

  it('asset delete confirm settles after mutation without waiting for cache refresh', async () => {
    const { onConfirm, router } = getDeleteConfirm({
      type: 'asset',
      id: 'asset-1',
      assets: { 'lib-1': [{ id: 'asset-1' }] },
    });

    expect(await didSettle(onConfirm())).toBe(true);
    expect(mockInvalidateLibraryAssetsData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        libraryId: 'lib-1',
        assetId: 'asset-1',
        refetchActiveAssets: true,
      })
    );
    expect(router.push).toHaveBeenCalledWith('/project-1/lib-1');
  });

  it('Sidebar closes the delete dialog before awaiting onConfirm', () => {
    const sidebar = readFileSync(
      path.join(process.cwd(), 'src/components/layout/Sidebar.tsx'),
      'utf8'
    );
    const start = sidebar.indexOf('const handleDeleteConfirm');
    const end = sidebar.indexOf('const handleProjectDelete =');
    const handler = sidebar.slice(start, end);
    expect(handler.indexOf('open: false')).toBeGreaterThan(-1);
    expect(handler.indexOf('open: false')).toBeLessThan(handler.indexOf('await'));
  });

  it('TableHeader closes the delete-column dialog before awaiting schema refresh', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/components/libraries/components/TableHeader.tsx'),
      'utf8'
    );
    const start = source.indexOf('onClick={async () => {');
    const end = source.indexOf("{deleteColumnConfirm.loading ? 'Deleting...' : 'Delete'}");
    const handler = source.slice(start, end);
    expect(handler.indexOf('open: false')).toBeGreaterThan(-1);
    expect(handler.indexOf('open: false')).toBeLessThan(handler.indexOf('await'));
  });
});
