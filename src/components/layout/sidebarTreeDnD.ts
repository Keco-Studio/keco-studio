import {
  SIDEBAR_MAX_NEST_DEPTH,
  nestingDepthAfterMove,
  wouldCreateIdCycle,
} from './sidebarNesting';
import type { DataNode } from 'antd/es/tree';

export type SidebarDragNodeType = 'library' | 'folder' | 'document';

export type SidebarDropTarget =
  | { kind: 'folder'; folderId: string }
  | { kind: 'root' }
  | { kind: 'invalid'; reason: string };

/** @deprecated Use SidebarDropTarget */
export type SidebarFolderDropTarget = SidebarDropTarget;

type NodeMeta = DataNode & {
  key?: string | number;
  _nodeType?: SidebarDragNodeType;
  _isDerived?: boolean;
};

/** Locate parent key of `childKey` within `nodes`. `null` means root-level (or not found). */
export function getParentKeyInTree(nodes: DataNode[], childKey: string): string | null {
  for (const node of nodes) {
    const key = String(node.key);
    const children = node.children || [];
    if (children.some((c) => String(c.key) === childKey)) {
      return key;
    }
    const nested = getParentKeyInTree(children, childKey);
    if (nested) return nested;
  }
  return null;
}

export function canDragSidebarNode(node: NodeMeta, canEdit: boolean): boolean {
  if (!canEdit) return false;
  const key = String(node.key ?? '');
  const type = node._nodeType;
  if (type === 'folder' || key.startsWith('folder-')) return true;
  if (type === 'library' || key.startsWith('library-')) return true;
  if (type === 'document' || key.startsWith('document-')) return true;
  return false;
}

function folderParentMapFromTree(treeData: DataNode[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const walk = (nodes: DataNode[], parentFolderId: string | null) => {
    for (const node of nodes) {
      const key = String(node.key);
      if (key.startsWith('folder-')) {
        const id = key.slice('folder-'.length);
        map.set(id, parentFolderId);
        walk(node.children || [], id);
      } else if (key.startsWith('document-') || key.startsWith('library-')) {
        walk(node.children || [], parentFolderId);
      }
    }
  };
  walk(treeData, null);
  return map;
}

function resolveParentDropTarget(
  treeData: DataNode[],
  dropKey: string,
  dropToGap: boolean,
  options?: { nestIntoFolderOnGap?: boolean }
): SidebarDropTarget {
  if (dropKey === 'libraries-root') {
    return { kind: 'root' };
  }

  const nestIntoFolderOnGap = options?.nestIntoFolderOnGap ?? true;

  // Documents/tables: dropping on a folder row (center or edge) means "into this folder".
  // Folders themselves use gap drops to become siblings (including project root).
  if (dropKey.startsWith('folder-') && (!dropToGap || nestIntoFolderOnGap)) {
    return { kind: 'folder', folderId: dropKey.slice('folder-'.length) };
  }

  if (!dropToGap) {
    if (dropKey.startsWith('document-') || dropKey.startsWith('library-')) {
      return { kind: 'invalid', reason: 'Documents and tables cannot contain items' };
    }
    return { kind: 'invalid', reason: 'Drop onto a folder' };
  }

  // Gap next to a folder: place as sibling of that folder (root if the folder is root-level).
  if (dropKey.startsWith('folder-')) {
    const parentKey = getParentKeyInTree(treeData, dropKey);
    if (!parentKey) return { kind: 'root' };
    if (parentKey.startsWith('folder-')) {
      return { kind: 'folder', folderId: parentKey.slice('folder-'.length) };
    }
    return { kind: 'invalid', reason: 'Cannot move into this location yet' };
  }

  const parentKey = getParentKeyInTree(treeData, dropKey);
  if (!parentKey) return { kind: 'root' };
  if (parentKey.startsWith('folder-')) {
    return { kind: 'folder', folderId: parentKey.slice('folder-'.length) };
  }
  if (parentKey.startsWith('document-')) {
    return { kind: 'invalid', reason: 'Documents and tables cannot contain items' };
  }
  return { kind: 'invalid', reason: 'Cannot move into this location yet' };
}

/**
 * Resolve a sidebar tree drop. Folders can nest; documents and tables are leaves.
 */
export function resolveSidebarDrop(input: {
  dragKey: string;
  dropKey: string;
  dropToGap: boolean;
  dragIsDerived?: boolean;
  treeData: DataNode[];
}): SidebarDropTarget {
  const { dragKey, dropKey, dropToGap, treeData } = input;

  const isLibrary = dragKey.startsWith('library-');
  const isDocument = dragKey.startsWith('document-');
  const isFolder = dragKey.startsWith('folder-');
  if (!isLibrary && !isDocument && !isFolder) {
    return { kind: 'invalid', reason: 'Only tables, documents, and folders can be moved' };
  }

  if (dragKey === dropKey) {
    return { kind: 'invalid', reason: 'Cannot drop onto itself' };
  }

  const target = resolveParentDropTarget(treeData, dropKey, dropToGap, {
    // Folder drags use gap = sibling (so nested folders can return to project root).
    nestIntoFolderOnGap: !isFolder,
  });
  if (target.kind === 'invalid') return target;

  if (isFolder) {
    const folderId = dragKey.slice('folder-'.length);
    if (target.kind === 'folder') {
      if (target.folderId === folderId) {
        return { kind: 'invalid', reason: 'Cannot drop onto itself' };
      }
      const parentById = folderParentMapFromTree(treeData);
      if (wouldCreateIdCycle(parentById, folderId, target.folderId)) {
        return { kind: 'invalid', reason: 'That would create a folder cycle' };
      }
      if (nestingDepthAfterMove(parentById, folderId, target.folderId) > SIDEBAR_MAX_NEST_DEPTH) {
        return { kind: 'invalid', reason: `Folder nesting exceeds maximum depth of ${SIDEBAR_MAX_NEST_DEPTH}` };
      }
    }
    return target.kind === 'root' ? { kind: 'root' } : target;
  }

  if (isDocument) {
    // Moving a legacy nested document to a folder/root clears parent_document_id.
    return target;
  }

  // Tables move between folders/root; moving a derived table also detaches it.
  return target;
}

/** @deprecated Use resolveSidebarDrop */
export function resolveSidebarFolderDrop(input: {
  dragKey: string;
  dropKey: string;
  dropToGap: boolean;
  dragIsDerived?: boolean;
  treeData: DataNode[];
}): SidebarDropTarget {
  return resolveSidebarDrop(input);
}
