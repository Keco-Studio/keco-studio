/* eslint-disable react/display-name, react-hooks/globals */
import React from 'react';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('react-dom', () => {
  const actual = jest.requireActual('react-dom');
  return { ...actual, createPortal: (children: React.ReactNode) => children };
});

jest.mock('next/image', () => ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) =>
  React.createElement('img', { ...props, src, alt })
);
jest.mock('../../../src/components/layout/Sidebar.module.css', () =>
  new Proxy({}, { get: (_target, property) => String(property) }),
  { virtual: true }
);
jest.mock('../../../src/components/layout/ContextMenu.module.css', () =>
  new Proxy({}, { get: (_target, property) => String(property) }),
  { virtual: true }
);
for (const asset of [
  'LibraryBookIcon.svg',
  'FolderAddLibIcon.svg',
  'FolderCloseIcon.svg',
  'folderExpandIcon.svg',
  'folderCollapseIcon.svg',
]) {
  jest.mock(`../../../src/assets/images/${asset}`, () => asset, { virtual: true });
}

import { useSidebarTree } from '@/components/layout/hooks/useSidebarTree';
import {
  moveSidebarDocument,
  useSidebarContextMenuActions,
} from '@/components/layout/hooks/useSidebarContextMenuActions';
import { ContextMenu } from '@/components/layout/ContextMenu';
import * as sidebarActions from '@/components/layout/hooks/useSidebarContextMenuActions';
import {
  DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT,
  type DocumentDerivedLibraryCreatedDetail,
} from '@/lib/documents/documentDerivedLibraryEvents';
import { deleteDocument, moveDocument } from '@/lib/services/documentService';

jest.mock('@/lib/services/documentService', () => ({
  deleteDocument: jest.fn().mockResolvedValue(undefined),
  moveDocument: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/documents/projectDocumentChannel', () => ({
  broadcastProjectDocumentUpdate: jest.fn().mockResolvedValue(true),
}));

describe('document-derived sidebar tree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('groups derived libraries beneath their document and excludes them from roots', () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const documentId = '22222222-2222-4222-8222-222222222222';
    const older = '33333333-3333-4333-8333-333333333333';
    const newer = '44444444-4444-4444-8444-444444444444';
    let treeData: any[] = [];
    function Harness() {
      treeData = useSidebarTree(
        { projectId, libraryId: null, folderId: null, assetId: null, documentId: null, isLibraryPage: false, isPredefinePage: false },
        [],
        [
          { id: older, project_id: projectId, folder_id: null, name: 'Table', description: null, created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null, source_document_id: documentId, document_export_type: 'table' },
          { id: newer, project_id: projectId, folder_id: null, name: 'Script', description: null, created_at: '2026-01-02', updated_at: '2026-01-02', updated_by: null, source_document_id: documentId, document_export_type: 'script' },
        ],
        [{ id: documentId, project_id: projectId, folder_id: null, name: 'Source', created_at: '2026-01-01', updated_at: '2026-01-01' }],
        { router: { push: jest.fn() }, userRole: 'admin', onContextMenu: jest.fn(), onFolderAddClick: jest.fn(), setSelectedFolderId: jest.fn(), setError: jest.fn(), setEditingKey: jest.fn(), onSaveRename: jest.fn(), expandedKeys: [], onToggleDocumentExpand: jest.fn() }
      ).treeData;
      return null;
    }
    renderToStaticMarkup(React.createElement(Harness));
    const documentNode = treeData.find((node) => node.key === `document-${documentId}`);
    expect(documentNode.isLeaf).toBe(false);
    expect(documentNode.children.map((child: any) => child.key)).toEqual([`library-${older}`, `library-${newer}`]);
    expect(treeData.map((node) => node.key)).not.toContain(`library-${older}`);

    let emptyTree: any[] = [];
    function EmptyHarness() {
      emptyTree = useSidebarTree(
        { projectId, libraryId: null, folderId: null, assetId: null, documentId: null, isLibraryPage: false, isPredefinePage: false },
        [], [], [{ id: documentId, project_id: projectId, folder_id: null, name: 'Source', created_at: '2026-01-01', updated_at: '2026-01-01' }],
        { router: { push: jest.fn() }, userRole: 'admin', onContextMenu: jest.fn(), onFolderAddClick: jest.fn(), setSelectedFolderId: jest.fn(), setError: jest.fn(), setEditingKey: jest.fn(), onSaveRename: jest.fn(), expandedKeys: [], onToggleDocumentExpand: jest.fn() }
      ).treeData;
      return null;
    }
    renderToStaticMarkup(React.createElement(EmptyHarness));
    expect(emptyTree[0].isLeaf).toBe(true);
    expect(emptyTree[0].children).toBeUndefined();
  });

  it('refreshes and expands the matching project document on a typed creation event', async () => {
    expect(sidebarActions.useSidebarDocumentDerivedLibraryLifecycle).toEqual(expect.any(Function));
    if (!sidebarActions.useSidebarDocumentDerivedLibraryLifecycle) return;

    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNavigator = globalThis.navigator;
    const documentLike: any = {
      nodeType: 9,
      documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml', style: {} },
      defaultView: null,
      createElement: (tagName: string) => ({
        nodeType: 1,
        tagName: tagName.toUpperCase(),
        nodeName: tagName.toUpperCase(),
        namespaceURI: 'http://www.w3.org/1999/xhtml',
        ownerDocument: documentLike,
        childNodes: [],
        style: {},
        setAttribute: () => undefined,
        getAttribute: () => null,
        appendChild: (child: any) => child,
        removeChild: (child: any) => child,
        insertBefore: (child: any) => child,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      createElementNS: (_namespace: string, tagName: string) => documentLike.createElement(tagName),
      createTextNode: (value: string) => ({ nodeType: 3, nodeValue: value, ownerDocument: documentLike }),
    };
    documentLike.body = documentLike.createElement('body');
    const listeners = new Map<string, Set<(event: Event) => void>>();
    const windowLike: any = {
      document: documentLike,
      addEventListener: (type: string, listener: (event: Event) => void) => {
        const bucket = listeners.get(type) ?? new Set();
        bucket.add(listener);
        listeners.set(type, bucket);
      },
      removeEventListener: (type: string, listener: (event: Event) => void) => {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent: (event: Event) => {
        for (const listener of listeners.get(event.type) ?? []) listener(event);
        return true;
      },
      HTMLIFrameElement: function HTMLIFrameElement() {},
      event: undefined,
    };
    documentLike.addEventListener = windowLike.addEventListener;
    documentLike.removeEventListener = windowLike.removeEventListener;
    documentLike.dispatchEvent = windowLike.dispatchEvent;
    documentLike.defaultView = windowLike;
    const container = documentLike.createElement('div');
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      navigator: { userAgent: 'Node.js Jest' },
      window: windowLike,
      document: documentLike,
    });

    const queryClient = {
      invalidateQueries: jest.fn().mockResolvedValue(undefined),
      refetchQueries: jest.fn().mockResolvedValue(undefined),
    };
    const documents = [{ id: 'document-1', project_id: 'project-1', folder_id: 'folder-1', name: 'Source', created_at: '', updated_at: '' }];
    let expandedKeys: React.Key[] = [];
    let root: Root | undefined;
    function Harness() {
      const [keys, setKeys] = React.useState<React.Key[]>([]);
      expandedKeys = keys;
      const expandFolder = React.useCallback((folderId: string | null | undefined) => {
        if (!folderId) return;
        setKeys((previous) => previous.includes(`folder-${folderId}`) ? previous : [...previous, `folder-${folderId}`]);
      }, []);
      sidebarActions.useSidebarDocumentDerivedLibraryLifecycle({
        currentProjectId: 'project-1',
        documents,
        queryClient: queryClient as never,
        expandFolder,
        setExpandedKeys: setKeys,
      });
      return null;
    }

    try {
      const { createRoot } = await import('react-dom/client');
      root = createRoot(container as never);
      await act(async () => root!.render(React.createElement(Harness)));
      queryClient.invalidateQueries.mockClear();
      queryClient.refetchQueries.mockClear();

      const detail: DocumentDerivedLibraryCreatedDetail = {
        projectId: 'project-1',
        documentId: 'document-1',
        libraryId: 'library-1',
      };
      await act(async () => {
        windowLike.dispatchEvent(new CustomEvent<DocumentDerivedLibraryCreatedDetail>(DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT, { detail }));
        await Promise.resolve();
      });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project', 'project-1', 'libraries'] });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project-1'] });
      expect(queryClient.refetchQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project-1'], type: 'active' });
      expect(expandedKeys).toEqual(expect.arrayContaining(['folder-folder-1', 'document-document-1']));

      queryClient.invalidateQueries.mockClear();
      queryClient.refetchQueries.mockClear();
      await act(async () => {
        windowLike.dispatchEvent(new CustomEvent<DocumentDerivedLibraryCreatedDetail>(DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT, {
          detail: { ...detail, projectId: 'other-project' },
        }));
        await Promise.resolve();
      });
      expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
      expect(queryClient.refetchQueries).not.toHaveBeenCalled();

      await act(async () => root!.render(null));
      queryClient.invalidateQueries.mockClear();
      windowLike.dispatchEvent(new CustomEvent<DocumentDerivedLibraryCreatedDetail>(DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT, { detail }));
      expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    } finally {
      if (root) await act(async () => root!.unmount());
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else globalThis.window = originalWindow;
      if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
      else globalThis.document = originalDocument;
      if (originalNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
      else globalThis.navigator = originalNavigator;
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    }
  });

  it('renders derived library context menus without Move to', () => {
    const originalDocument = globalThis.document;
    Object.assign(globalThis, {
      document: { querySelector: () => null },
    });

    try {
      const markup = renderToStaticMarkup(
        React.createElement(ContextMenu, {
          x: 10,
          y: 10,
          type: 'library',
          userRole: 'admin',
          isDerivedLibrary: true,
          onClose: jest.fn(),
        })
      );
      expect(markup).toContain('Rename');
      expect(markup).toContain('Delete');
      expect(markup).not.toContain('Library info');
      expect(markup).not.toContain('Export');
      expect(markup).not.toContain('Duplicate');
      expect(markup).not.toContain('Move to...');
    } finally {
      if (originalDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        globalThis.document = originalDocument;
      }
    }
  });

  it('guards stale derived-library move actions and executes document delete cascades', async () => {
    const openMoveLibrary = jest.fn();
    const closeContextMenu = jest.fn();
    const deleteSupabase = {} as any;
    let deleteConfirmation: any;
    const deleteQueryClient = {
      invalidateQueries: jest.fn().mockResolvedValue(undefined),
      refetchQueries: jest.fn().mockResolvedValue(undefined),
    };
    const requestDeleteConfirm = jest.fn((options) => {
      deleteConfirmation = options as typeof deleteConfirmation;
    });
    let handleAction: ((action: any) => void) | undefined;
    function Harness() {
      handleAction = useSidebarContextMenuActions({
        contextMenu: { x: 0, y: 0, type: 'library', id: 'derived', elementRef: null },
        closeContextMenu,
        router: { push: jest.fn() } as any,
        openEditProject: jest.fn(), openEditLibrary: jest.fn(), openDuplicateLibrary: jest.fn(), openExportLibrary: jest.fn(),
        openImportLibrary: jest.fn(), openImportScript: jest.fn(), openEditFolder: jest.fn(), openEditAsset: jest.fn(),
        supabase: {} as any, queryClient: {} as any,
        currentIds: { projectId: 'project', libraryId: null, folderId: null, assetId: null, documentId: null },
        libraries: [
          { id: 'derived', project_id: 'project', folder_id: null, name: 'Table', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'table' },
          { id: 'script', project_id: 'project', folder_id: null, name: 'Script', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'script' },
          { id: 'table2', project_id: 'project', folder_id: null, name: 'Table 2', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'table' },
        ],
        setError: jest.fn(), assets: {}, fetchAssets: jest.fn(), onProjectDeleteViaAPI: jest.fn(), openMoveLibrary,
        openMoveDocument: jest.fn(), openNewDocumentInFolder: jest.fn(), startInlineRename: jest.fn(), openDocumentScriptExport: jest.fn(), userRole: 'admin', requestDeleteConfirm,
      }).handleContextMenuAction;
      return null;
    }
    renderToStaticMarkup(React.createElement(Harness));
    handleAction?.('move-to');
    expect(openMoveLibrary).not.toHaveBeenCalled();

    handleAction = undefined;
    function DeleteHarness() {
      handleAction = useSidebarContextMenuActions({
        contextMenu: { x: 0, y: 0, type: 'document', id: 'doc', elementRef: null },
        closeContextMenu, router: { push: jest.fn() } as any,
        openEditProject: jest.fn(), openEditLibrary: jest.fn(), openDuplicateLibrary: jest.fn(), openExportLibrary: jest.fn(), openImportLibrary: jest.fn(), openImportScript: jest.fn(), openEditFolder: jest.fn(), openEditAsset: jest.fn(),
        supabase: deleteSupabase, queryClient: deleteQueryClient as any,
        currentIds: { projectId: 'project', libraryId: null, folderId: null, assetId: null, documentId: null },
        libraries: [
          { id: 'derived', project_id: 'project', folder_id: null, name: 'Table', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'table' },
          { id: 'script', project_id: 'project', folder_id: null, name: 'Script', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'script' },
          { id: 'table2', project_id: 'project', folder_id: null, name: 'Table 2', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'table' },
        ],
        setError: jest.fn(), assets: {}, fetchAssets: jest.fn(), onProjectDeleteViaAPI: jest.fn(), openMoveLibrary: jest.fn(), openMoveDocument: jest.fn(), openNewDocumentInFolder: jest.fn(), startInlineRename: jest.fn(), openDocumentScriptExport: jest.fn(), userRole: 'admin', requestDeleteConfirm,
      }).handleContextMenuAction;
      return null;
    }
    renderToStaticMarkup(React.createElement(DeleteHarness));
    handleAction?.('delete');
    expect(requestDeleteConfirm).toHaveBeenCalledWith(expect.objectContaining({ content: 'Delete this document permanently? 2 tables and 1 script will also be deleted.' }));
    await deleteConfirmation?.onConfirm();
    expect(deleteDocument).toHaveBeenCalledTimes(1);
    expect(deleteDocument).toHaveBeenCalledWith(deleteSupabase, 'doc');
    expect(deleteQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['documents', 'project'] });
    expect(deleteQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project', 'project', 'libraries'] });
    expect(deleteQueryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project'] });
    expect(deleteQueryClient.refetchQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project'], type: 'active' });
  });

  it('moves documents through the production sidebar handler and refreshes dependent data', async () => {
    const supabase = {} as any;
    const queryClient = {
      invalidateQueries: jest.fn().mockResolvedValue(undefined),
      refetchQueries: jest.fn().mockResolvedValue(undefined),
    };
    const expandFolder = jest.fn();
    await moveSidebarDocument({
      supabase,
      documentId: 'doc',
      folderId: 'folder-2',
      projectId: 'project',
      queryClient: queryClient as any,
      expandFolder,
    });
    expect(moveDocument).toHaveBeenCalledTimes(1);
    expect(moveDocument).toHaveBeenCalledWith(supabase, 'doc', { folderId: 'folder-2' });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['documents', 'project'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['project', 'project', 'libraries'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project'] });
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project'], type: 'active' });
    expect(expandFolder).toHaveBeenCalledWith('folder-2');
  });
});
