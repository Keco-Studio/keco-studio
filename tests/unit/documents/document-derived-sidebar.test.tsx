/* eslint-disable react/display-name, react-hooks/globals */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/image', () => ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) =>
  React.createElement('img', { ...props, src, alt })
);
jest.mock('../../../src/components/layout/Sidebar.module.css', () =>
  new Proxy({}, { get: (_target, property) => String(property) }),
  { virtual: true }
);
for (const asset of ['LibraryBookIcon.svg', 'FolderAddLibIcon.svg', 'FolderCloseIcon.svg']) {
  jest.mock(`../../../src/assets/images/${asset}`, () => asset, { virtual: true });
}

import { useSidebarTree } from '@/components/layout/hooks/useSidebarTree';
import { useSidebarContextMenuActions } from '@/components/layout/hooks/useSidebarContextMenuActions';

jest.mock('@/lib/services/documentService', () => ({ deleteDocument: jest.fn().mockResolvedValue(undefined) }));

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('document-derived sidebar tree', () => {
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
        { router: { push: jest.fn() }, userRole: 'admin', onContextMenu: jest.fn(), openNewLibrary: jest.fn(), setSelectedFolderId: jest.fn(), setError: jest.fn(), setEditingKey: jest.fn(), onSaveRename: jest.fn() }
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
        { router: { push: jest.fn() }, userRole: 'admin', onContextMenu: jest.fn(), openNewLibrary: jest.fn(), setSelectedFolderId: jest.fn(), setError: jest.fn(), setEditingKey: jest.fn(), onSaveRename: jest.fn() }
      ).treeData;
      return null;
    }
    renderToStaticMarkup(React.createElement(EmptyHarness));
    expect(emptyTree[0].isLeaf).toBe(true);
    expect(emptyTree[0].children).toBeUndefined();
  });

  it('renders derived library context menus without Move to', () => {
    const source = read('src/components/layout/ContextMenu.tsx');
    expect(source).toContain('isDerivedLibrary?: boolean');
    expect(source).toMatch(/isDerivedLibrary[\s\S]*canMoveLibrary/);
  });

  it('guards stale derived-library move actions and counts document cascades', () => {
    const actions = read('src/components/layout/hooks/useSidebarContextMenuActions.ts');
    const sidebar = read('src/components/layout/Sidebar.tsx');
    expect(actions).toContain('source_document_id');
    expect(sidebar).toContain('DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT');
    expect(actions).toContain('will also be deleted');

    const openMoveLibrary = jest.fn();
    const closeContextMenu = jest.fn();
    const requestDeleteConfirm = jest.fn();
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
        openMoveDocument: jest.fn(), openNewDocumentInFolder: jest.fn(), startInlineRename: jest.fn(), userRole: 'admin', requestDeleteConfirm,
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
        supabase: {} as any, queryClient: { invalidateQueries: jest.fn().mockResolvedValue(undefined) } as any,
        currentIds: { projectId: 'project', libraryId: null, folderId: null, assetId: null, documentId: null },
        libraries: [
          { id: 'derived', project_id: 'project', folder_id: null, name: 'Table', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'table' },
          { id: 'script', project_id: 'project', folder_id: null, name: 'Script', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'script' },
          { id: 'table2', project_id: 'project', folder_id: null, name: 'Table 2', description: null, created_at: '', updated_at: '', updated_by: null, source_document_id: 'doc', document_export_type: 'table' },
        ],
        setError: jest.fn(), assets: {}, fetchAssets: jest.fn(), onProjectDeleteViaAPI: jest.fn(), openMoveLibrary: jest.fn(), openMoveDocument: jest.fn(), openNewDocumentInFolder: jest.fn(), startInlineRename: jest.fn(), userRole: 'admin', requestDeleteConfirm,
      }).handleContextMenuAction;
      return null;
    }
    renderToStaticMarkup(React.createElement(DeleteHarness));
    handleAction?.('delete');
    expect(requestDeleteConfirm).toHaveBeenCalledWith(expect.objectContaining({ content: 'Delete this document permanently? 2 tables and 1 script will also be deleted.' }));
  });
});
