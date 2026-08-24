'use client';

import Image from 'next/image';
import { useMemo, type MouseEvent } from 'react';
import type { DataNode } from 'antd/es/tree';
import type { Folder } from '@/lib/services/folderService';
import type { Library } from '@/lib/services/libraryService';
import type { DocumentSummary } from '@/lib/services/documentService';
import { truncateText } from '@/lib/utils/truncateText';
import paperIcon from '@/assets/images/paper.svg';
import tableIcon from '@/assets/images/table.svg';
import FolderAddLibIcon from '@/assets/images/FolderAddLibIcon.svg';
import { beginSidebarInlineRename } from '../sidebarScrollReset';
import styles from '../Sidebar.module.css';

export type SidebarCurrentIds = {
  projectId: string | null;
  libraryId: string | null;
  folderId: string | null;
  assetId: string | null;
  documentId: string | null;
  isLibraryPage: boolean;
  isPredefinePage: boolean;
};

export type UseSidebarTreeContext = {
  router: { push: (path: string) => void };
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onContextMenu: (e: MouseEvent, type: 'project' | 'library' | 'folder' | 'asset' | 'document', id: string) => void;
  onFolderAddClick: (folderId: string, anchor: HTMLElement) => void;
  setSelectedFolderId: (id: string | null) => void;
  setError: (msg: string | null) => void;
  setEditingKey: (key: string | null) => void;
  onSaveRename: (key: string, newName: string) => void | Promise<void>;
};

/**
 * Builds Ant Design Tree data and selected keys from folders, documents, and tables.
 */
export function useSidebarTree(
  currentIds: SidebarCurrentIds,
  folders: Folder[],
  libraries: Library[],
  documents: DocumentSummary[],
  context: UseSidebarTreeContext,
  sidebarWidth?: number
): { treeData: DataNode[]; selectedKeys: string[] } {
  const {
    router,
    userRole,
    onContextMenu: handleContextMenu,
    onFolderAddClick,
    setSelectedFolderId,
    setError,
    setEditingKey,
  } = context;

  const treeData: DataNode[] = useMemo(() => {
    if (!currentIds.projectId) return [];

    const projectFolders = folders.filter((f) => f.project_id === currentIds.projectId);
    const projectLibraries = libraries.filter((lib) => lib.project_id === currentIds.projectId);
    const projectDocuments = documents.filter((doc) => doc.project_id === currentIds.projectId);

    // Estimate visible characters based on sidebar width.
    // Example: around 300px shows ~15 chars; around 400px shows ~20 chars.
    const computeMaxChars = (baseChars: number) => {
      if (!sidebarWidth) return baseChars;
      const MIN_WIDTH_FOR_BASE = 267;
      const PX_PER_CHAR = 10; // Roughly one extra character per 10px.

      const extraWidth = Math.max(0, sidebarWidth - MIN_WIDTH_FOR_BASE);
      const extraChars = Math.floor(extraWidth / PX_PER_CHAR);

      return Math.max(8, baseChars + extraChars); // Keep a lower bound for narrow sidebars.
    };

    const librariesByFolder = new Map<string, Library[]>();
    projectLibraries.forEach((lib) => {
      const folderId = lib.folder_id ? String(lib.folder_id) : '';
      if (!librariesByFolder.has(folderId)) {
        librariesByFolder.set(folderId, []);
      }
      librariesByFolder.get(folderId)!.push(lib);
    });

    const documentsByFolder = new Map<string, DocumentSummary[]>();
    projectDocuments.forEach((doc) => {
      const folderId = doc.folder_id ? String(doc.folder_id) : '';
      if (!documentsByFolder.has(folderId)) {
        documentsByFolder.set(folderId, []);
      }
      documentsByFolder.get(folderId)!.push(doc);
    });

    const foldersByParent = new Map<string, Folder[]>();
    projectFolders.forEach((folder) => {
      const parentKey = folder.parent_folder_id ? String(folder.parent_folder_id) : '';
      if (!foldersByParent.has(parentKey)) {
        foldersByParent.set(parentKey, []);
      }
      foldersByParent.get(parentKey)!.push(folder);
    });

    const buildLibraryNode = (
      lib: Library,
      options: { underFolder?: boolean } = {}
    ): DataNode => {
      const { underFolder = false } = options;
      const libKey = `library-${lib.id}`;
      return {
        title: (
          <div
            className={`${styles.itemRow} ${styles.libraryRow} ${underFolder ? '' : styles.rootLibraryRow}`}
            data-library-under-folder={underFolder ? true : undefined}
            onContextMenu={(e) => handleContextMenu(e, 'library', lib.id)}
          >
            <div className={styles.itemMain}>
              <div className={styles.libraryIconContainer}>
                <Image src={tableIcon} alt="Library" width={24} height={24} className="icon-24" />
              </div>
              <span
                className={styles.itemText}
                style={{ fontWeight: underFolder ? undefined : 500 }}
                title={lib.name}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (userRole === 'admin') {
                    beginSidebarInlineRename(() => setEditingKey(libKey));
                  }
                }}
              >
                {truncateText(lib.name, computeMaxChars(15))}
              </span>
            </div>
          </div>
        ),
        key: libKey,
        isLeaf: true,
        children: undefined,
        _titleStr: lib.name,
        _nodeType: 'library',
        _isLibraryUnderFolder: underFolder,
        _isDerived: Boolean(lib.source_document_id),
      } as DataNode & {
        _titleStr: string;
        _nodeType: 'library' | 'folder' | 'document';
        _isLibraryUnderFolder: boolean;
        _isDerived: boolean;
      };
    };

    // Documents and tables are sibling leaves; only folders can contain them.
    const buildDocumentNode = (doc: DocumentSummary, isUnderFolder: boolean): DataNode => {
      const docKey = `document-${doc.id}`;
      const canRename = userRole === 'admin' || userRole === 'editor';
      return {
        title: (
          <div
            className={`${styles.itemRow} ${styles.libraryRow} ${isUnderFolder ? '' : styles.rootLibraryRow}`}
            data-library-under-folder={isUnderFolder ? true : undefined}
            onContextMenu={(e) => handleContextMenu(e, 'document', doc.id)}
          >
            <div className={styles.itemMain}>
              <div className={styles.libraryIconContainer}>
                <Image src={paperIcon} alt="Document" width={24} height={24} className="icon-24" />
              </div>
              <span
                className={styles.itemText}
                title={doc.name}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (canRename) {
                    beginSidebarInlineRename(() => setEditingKey(docKey));
                  }
                }}
              >
                {truncateText(doc.name, computeMaxChars(15))}
              </span>
            </div>
          </div>
        ),
        key: docKey,
        isLeaf: true,
        children: undefined,
        _titleStr: doc.name,
        _nodeType: 'document',
        _isLibraryUnderFolder: isUnderFolder,
      } as DataNode & { _titleStr: string; _nodeType: 'library' | 'folder' | 'document'; _isLibraryUnderFolder: boolean };
    };

    const buildFolderNode = (folder: Folder): DataNode => {
      const folderLibraries = librariesByFolder.get(String(folder.id)) || [];
      const childFolders = foldersByParent.get(String(folder.id)) || [];

      const children: DataNode[] = [
        ...childFolders.map((child) => buildFolderNode(child)),
        ...folderLibraries.map((lib) => buildLibraryNode(lib, { underFolder: true })),
      ];

      const folderDocuments = documentsByFolder.get(String(folder.id)) || [];
      folderDocuments.forEach((doc) => {
        children.push(buildDocumentNode(doc, true));
      });

      const folderKey = `folder-${folder.id}`;
      return {
        title: (
          <div
            className={`${styles.itemRow} ${styles.folderRow}`}
            data-folder-row
          >
            <div className={styles.itemMain}>
              <span
                className={styles.itemText}
                style={{ fontWeight: 500 }}
                title={folder.name}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (userRole === 'admin') {
                    beginSidebarInlineRename(() => setEditingKey(folderKey));
                  }
                }}
              >
                {truncateText(folder.name, computeMaxChars(20))}
              </span>
            </div>
            <div className={styles.itemActions}>
              {(userRole === 'admin' || userRole === 'editor') && (
                <button
                  type="button"
                  className={styles.folderAddLibButton}
                  aria-label="Folder actions"
                  title="Folder actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!currentIds.projectId) {
                      setError('Please select a project first');
                      return;
                    }
                    onFolderAddClick(folder.id, e.currentTarget);
                  }}
                >
                  <Image src={FolderAddLibIcon} alt="" width={24} height={24} className="icon-24" />
                </button>
              )}
            </div>
          </div>
        ),
        key: folderKey,
        // Keep folders expandable/droppable even when empty (P1 DnD into folder).
        // Use [] instead of undefined so rc-tree does not look up a missing child node.
        isLeaf: false,
        children,
        _titleStr: folder.name,
        _nodeType: 'folder',
      } as DataNode & { _titleStr: string; _nodeType: 'library' | 'folder' | 'document' };
    };

    const result: DataNode[] = [];
    const rootFolders = foldersByParent.get('') || [];
    rootFolders.forEach((folder) => {
      result.push(buildFolderNode(folder));
    });

    const rootLibraries = librariesByFolder.get('') || [];
    rootLibraries.forEach((lib) => result.push(buildLibraryNode(lib)));

    const rootDocuments = documentsByFolder.get('') || [];
    rootDocuments.forEach((doc) => {
      result.push(buildDocumentNode(doc, false));
    });

    return result;

  }, [
    currentIds.projectId,
    folders,
    libraries,
    documents,
    handleContextMenu,
    userRole,
    onFolderAddClick,
    setError,
    setEditingKey,
    sidebarWidth,
  ]);

  const selectedKeys = useMemo(() => {
    const keys: string[] = [];
    if (currentIds.documentId) {
      keys.push(`document-${currentIds.documentId}`);
      return keys;
    }
    if (currentIds.folderId && !currentIds.libraryId) {
      keys.push(`folder-${currentIds.folderId}`);
    }
    if (currentIds.libraryId) {
      if (
        currentIds.assetId &&
        currentIds.assetId !== 'new' &&
        currentIds.assetId !== 'predefine'
      ) {
        keys.push(`asset-${currentIds.assetId}`);
        keys.push(`library-${currentIds.libraryId}`);
      } else if (currentIds.isLibraryPage || currentIds.isPredefinePage) {
        keys.push(`library-${currentIds.libraryId}`);
      }
    }
    return keys;
  }, [
    currentIds.folderId,
    currentIds.libraryId,
    currentIds.assetId,
    currentIds.documentId,
    currentIds.isLibraryPage,
    currentIds.isPredefinePage,
  ]);

  return { treeData, selectedKeys };
}
