import type { DataNode } from 'antd/es/tree';
import {
  canDragSidebarNode,
  getParentKeyInTree,
  resolveSidebarDrop,
} from '@/components/layout/sidebarTreeDnD';

const treeData: DataNode[] = [
  {
    key: 'folder-f1',
    children: [
      { key: 'document-d1' },
      { key: 'library-l1' },
    ],
  },
  { key: 'document-d2' },
  { key: 'library-l2' },
  {
    key: 'document-d3',
    children: [{ key: 'library-derived' }],
  },
];

describe('getParentKeyInTree', () => {
  it('returns folder parent for nested items', () => {
    expect(getParentKeyInTree(treeData, 'document-d1')).toBe('folder-f1');
    expect(getParentKeyInTree(treeData, 'library-l1')).toBe('folder-f1');
  });

  it('returns null for root-level items', () => {
    expect(getParentKeyInTree(treeData, 'document-d2')).toBeNull();
    expect(getParentKeyInTree(treeData, 'folder-f1')).toBeNull();
  });

  it('returns document parent for derived library', () => {
    expect(getParentKeyInTree(treeData, 'library-derived')).toBe('document-d3');
  });
});

describe('canDragSidebarNode', () => {
  it('blocks viewers', () => {
    expect(canDragSidebarNode({ key: 'document-d1', _nodeType: 'document' }, false)).toBe(false);
    expect(canDragSidebarNode({ key: 'folder-f1', _nodeType: 'folder' }, false)).toBe(false);
  });

  it('allows folders, documents, and libraries', () => {
    expect(canDragSidebarNode({ key: 'folder-f1', _nodeType: 'folder' }, true)).toBe(true);
    expect(canDragSidebarNode({ key: 'document-d1', _nodeType: 'document' }, true)).toBe(true);
    expect(
      canDragSidebarNode({ key: 'library-l1', _nodeType: 'library', _isDerived: false }, true)
    ).toBe(true);
    expect(
      canDragSidebarNode({ key: 'library-derived', _nodeType: 'library', _isDerived: true }, true)
    ).toBe(true);
  });
});

describe('resolveSidebarDrop', () => {
  it('drops onto folder as child', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'document-d2',
        dropKey: 'folder-f1',
        dropToGap: false,
        treeData,
      })
    ).toEqual({ kind: 'folder', folderId: 'f1' });
  });

  it('libraries-root drop target moves to project root', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'folder-f2',
        dropKey: 'libraries-root',
        dropToGap: true,
        treeData: [{ key: 'folder-f1', children: [{ key: 'folder-f2' }] }],
      })
    ).toEqual({ kind: 'root' });

    expect(
      resolveSidebarDrop({
        dragKey: 'document-d1',
        dropKey: 'libraries-root',
        dropToGap: true,
        treeData,
      })
    ).toEqual({ kind: 'root' });
  });

  it('gap-drop on a folder row targets that folder (not root)', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'document-d2',
        dropKey: 'folder-f1',
        dropToGap: true,
        treeData,
      })
    ).toEqual({ kind: 'folder', folderId: 'f1' });
  });

  it('folder gap-drop next to root folder returns to project root', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'folder-f2',
        dropKey: 'folder-f1',
        dropToGap: true,
        treeData: [
          { key: 'folder-f1', children: [{ key: 'folder-f2' }] },
        ],
      })
    ).toEqual({ kind: 'root' });
  });

  it('folder drop onto folder nests inside', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'folder-f2',
        dropKey: 'folder-f1',
        dropToGap: false,
        treeData: [
          { key: 'folder-f1', children: [] },
          { key: 'folder-f2', children: [] },
        ],
      })
    ).toEqual({ kind: 'folder', folderId: 'f1' });
  });

  it('gap-drop at root targets root', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'document-d1',
        dropKey: 'document-d2',
        dropToGap: true,
        treeData,
      })
    ).toEqual({ kind: 'root' });
  });

  it('gap-drop next to item in folder stays in folder', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'document-d2',
        dropKey: 'library-l1',
        dropToGap: true,
        treeData,
      })
    ).toEqual({ kind: 'folder', folderId: 'f1' });
  });

  it('rejects dropping a table or document onto another leaf node', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'library-l2',
        dropKey: 'document-d2',
        dropToGap: false,
        treeData,
      })
    ).toEqual({ kind: 'invalid', reason: 'Documents and tables cannot contain items' });
    expect(
      resolveSidebarDrop({
        dragKey: 'document-d2',
        dropKey: 'library-l2',
        dropToGap: false,
        treeData,
      })
    ).toEqual({ kind: 'invalid', reason: 'Documents and tables cannot contain items' });
  });

  it('rejects legacy gaps whose parent is a document leaf', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'library-l2',
        dropKey: 'library-derived',
        dropToGap: true,
        treeData,
      })
    ).toEqual({ kind: 'invalid', reason: 'Documents and tables cannot contain items' });
  });

  it('detaches derived library to folder or root', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'library-derived',
        dropKey: 'folder-f1',
        dropToGap: false,
        dragIsDerived: true,
        treeData,
      })
    ).toEqual({ kind: 'folder', folderId: 'f1' });

    expect(
      resolveSidebarDrop({
        dragKey: 'library-derived',
        dropKey: 'document-d2',
        dropToGap: true,
        dragIsDerived: true,
        treeData,
      })
    ).toEqual({ kind: 'root' });
  });

  it('nests folder under folder and rejects cycles', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'folder-f2',
        dropKey: 'folder-f1',
        dropToGap: false,
        treeData: [
          { key: 'folder-f1', children: [] },
          { key: 'folder-f2', children: [] },
        ],
      })
    ).toEqual({ kind: 'folder', folderId: 'f1' });

    expect(
      resolveSidebarDrop({
        dragKey: 'folder-f1',
        dropKey: 'folder-f2',
        dropToGap: false,
        treeData: [
          {
            key: 'folder-f1',
            children: [{ key: 'folder-f2' }],
          },
        ],
      }).kind
    ).toBe('invalid');
  });

  it('does not nest a document under another document', () => {
    expect(
      resolveSidebarDrop({
        dragKey: 'document-d2',
        dropKey: 'document-d3',
        dropToGap: false,
        treeData,
      })
    ).toEqual({ kind: 'invalid', reason: 'Documents and tables cannot contain items' });
  });
});
