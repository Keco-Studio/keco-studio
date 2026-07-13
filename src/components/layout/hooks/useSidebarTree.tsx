'use client';

import Image from 'next/image';
import { useMemo, type MouseEvent } from 'react';
import type { DataNode } from 'antd/es/tree';
import type { Folder } from '@/lib/services/folderService';
import type { Library } from '@/lib/services/libraryService';
import type { DocumentSummary } from '@/lib/services/documentService';
import { truncateText } from '@/lib/utils/truncateText';
import libraryBookIcon from '@/assets/images/LibraryBookIcon.svg';
import FolderAddLibIcon from '@/assets/images/FolderAddLibIcon.svg';
import folderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
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
  openNewLibrary: () => void;
  setSelectedFolderId: (id: string | null) => void;
  setError: (msg: string | null) => void;
  setEditingKey: (key: string | null) => void;
  onSaveRename: (key: string, newName: string) => void | Promise<void>;
};

/**
 * Builds Ant Design Tree data and selected keys from folders + libraries for the Sidebar.
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
    openNewLibrary,
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

    // Build a document leaf node. Documents sit next to libraries in the tree.
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
                <Image src={libraryBookIcon} alt="Document" width={24} height={24} className="icon-24" />
              </div>
              <span
                className={styles.itemText}
                title={doc.name}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (canRename) setEditingKey(docKey);
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

      const children: DataNode[] = folderLibraries.map((lib) => {
        const libKey = `library-${lib.id}`;
        return {
          title: (
            <div
              className={`${styles.itemRow} ${styles.libraryRow}`}
              data-library-under-folder
            >
              <div className={styles.itemMain}>
                <div className={styles.libraryIconContainer}>
                  <Image src={libraryBookIcon} alt="Library" width={24} height={24} className="icon-24" />
                </div>
                <span
                  className={styles.itemText}
                  title={lib.name}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (userRole === 'admin') setEditingKey(libKey);
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
          _isLibraryUnderFolder: true,
        } as DataNode & { _titleStr: string; _nodeType: 'library' | 'folder' };
      });

      const folderDocuments = documentsByFolder.get(String(folder.id)) || [];
      folderDocuments.forEach((doc) => {
        children.push(buildDocumentNode(doc, true));
      });

      const hasNoLibraries = folderLibraries.length === 0 && folderDocuments.length === 0;
      const folderKey = `folder-${folder.id}`;
      return {
        title: (
          <div
            className={`${styles.itemRow} ${styles.folderRow}`}
            data-folder-row
          >
            <div className={styles.itemMain}>
              {hasNoLibraries && (
                <div className={styles.folderIconPlaceholder} aria-hidden>
                  <Image src={folderCloseIcon} alt="" width={24} height={24} className="icon-24" />
                </div>
              )}
              <span
                className={styles.itemText}
                style={{ fontWeight: 500 }}
                title={folder.name}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (userRole === 'admin') setEditingKey(folderKey);
                }}
              >
                {truncateText(folder.name, computeMaxChars(20))}
              </span>
            </div>
            <div className={styles.itemActions}>
              {userRole === 'admin' && (
                <button
                  type="button"
                  className={styles.folderAddLibButton}
                  aria-label="Create new library"
                  title="Create new library"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!currentIds.projectId) {
                      setError('Please select a project first');
                      return;
                    }
                    setSelectedFolderId(folder.id);
                    openNewLibrary();
                  }}
                >
                  <Image src={FolderAddLibIcon} alt="" width={24} height={24} className="icon-24" />
                </button>
              )}
            </div>
          </div>
        ),
        key: folderKey,
        isLeaf: children.length === 0,
        children: children.length > 0 ? children : undefined,
        _titleStr: folder.name,
        _nodeType: 'folder',
        _hasNoLibraries: hasNoLibraries,
      } as DataNode & { _titleStr: string; _nodeType: 'library' | 'folder' | 'document'; _hasNoLibraries?: boolean };
    };

    const result: DataNode[] = [];
    projectFolders.forEach((folder) => {
      result.push(buildFolderNode(folder));
    });

    const rootLibraries = librariesByFolder.get('') || [];
    rootLibraries.forEach((lib) => {
      const libKey = `library-${lib.id}`;
      result.push({
        title: (
          <div
            className={`${styles.itemRow} ${styles.libraryRow} ${styles.rootLibraryRow}`}
            onContextMenu={(e) => handleContextMenu(e, 'library', lib.id)}
          >
            <div className={styles.itemMain}>
              <div className={styles.libraryIconContainer}>
                <Image src={libraryBookIcon} alt="Library" width={24} height={24} className="icon-24" />
              </div>
              <span
                className={styles.itemText}
                style={{ fontWeight: 500 }}
                title={lib.name}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (userRole === 'admin') setEditingKey(libKey);
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
        _isLibraryUnderFolder: false,
      } as DataNode & { _titleStr: string; _nodeType: 'library' | 'folder' | 'document' });
    });

    const rootDocuments = documentsByFolder.get('') || [];
    rootDocuments.forEach((doc) => {
      result.push(buildDocumentNode(doc, false));
    });

    return result;
  }, [
    currentIds.projectId,
    currentIds.libraryId,
    currentIds.isLibraryPage,
    currentIds.assetId,
    currentIds.isPredefinePage,
    folders,
    libraries,
    documents,
    handleContextMenu,
    router,
    userRole,
    openNewLibrary,
    setSelectedFolderId,
    setError,
    setEditingKey,
    sidebarWidth,
    userRole,
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
