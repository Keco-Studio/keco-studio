import { describe, expect, it } from '@jest/globals';
import { buildScriptSidebarTree } from '@/components/script-system/scriptSidebarTree';

describe('buildScriptSidebarTree', () => {
  it('shows shared folders as one level and groups only Script workspace documents', () => {
    const tree = buildScriptSidebarTree(
      [
        { id: 'folder-root', name: 'Resources Folder', parent_folder_id: null },
        { id: 'folder-nested', name: 'Chapter One', parent_folder_id: 'folder-root' },
      ],
      [
        { documentId: 'doc-root', importedAt: '2026-01-01', title: 'Overview', folderId: null },
        { documentId: 'doc-nested', importedAt: '2026-01-02', title: 'Opening', folderId: 'folder-nested' },
      ],
    );

    expect(tree.rootDocuments.map((document) => document.documentId)).toEqual(['doc-root']);
    expect(tree.folders).toEqual([
      expect.objectContaining({
        id: 'folder-root',
        name: 'Resources Folder',
        documents: [],
      }),
      expect.objectContaining({
        id: 'folder-nested',
        name: 'Chapter One',
        documents: [expect.objectContaining({ documentId: 'doc-nested' })],
      }),
    ]);
    expect(tree.folders.every((folder) => !('folders' in folder))).toBe(true);
  });

  it('keeps a Script document visible at the root when its shared folder is unavailable', () => {
    const tree = buildScriptSidebarTree([], [
      {
        documentId: 'doc-orphan',
        importedAt: '2026-01-01',
        title: 'Imported story',
        folderId: 'missing-folder',
      },
    ]);

    expect(tree.rootDocuments.map((document) => document.documentId)).toEqual(['doc-orphan']);
  });

  it('keeps the default Resources Folder pinned first', () => {
    const tree = buildScriptSidebarTree(
      [
        { id: 'folder-other', name: 'Notes', parent_folder_id: null },
        { id: 'folder-root', name: 'Resources Folder', parent_folder_id: null },
      ],
      [],
    );

    expect(tree.folders.map((folder) => folder.name)).toEqual([
      'Resources Folder',
      'Notes',
    ]);
  });
});
