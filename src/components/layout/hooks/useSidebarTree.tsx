'use client';

import Image from 'next/image';
import { useMemo, type MouseEvent } from 'react';
import { Tooltip } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { Folder } from '@/lib/services/folderService';
import type { Library } from '@/lib/services/libraryService';
import { truncateText } from '@/lib/utils/truncateText';
import libraryBookIcon from '@/assets/images/LibraryBookIcon.svg';
import PredefineNewIcon from '@/assets/images/PredefineNewIcon.svg';
import PredefineNewClick from '@/assets/images/PredefineNewClick.svg';
import FolderAddLibIcon from '@/assets/images/FolderAddLibIcon.svg';
import folderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
import sidebarFolderIcon3 from '@/assets/images/SidebarFloderIcon3.svg';
import styles from '../Sidebar.module.css';

export type SidebarCurrentIds = {
  projectId: string | null;
  libraryId: string | null;
  folderId: string | null;
  assetId: string | null;
  isLibraryPage: boolean;
  isPredefinePage: boolean;
};

export type UseSidebarTreeContext = {
  router: { push: (path: string) => void };
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onContextMenu: (e: MouseEvent, type: 'project' | 'library' | 'folder' | 'asset', id: string) => void;
  openNewLibrary: () => void;
  setSelectedFolderId: (id: string | null) => void;
  setError: (msg: string | null) => void;
  onLibraryPredefineClick: (projId: string, libId: string, e: MouseEvent) => void;
};

/**
 * Builds Ant Design Tree data and selected keys from folders + libraries for the Sidebar.
 */
export function useSidebarTree(
  currentIds: SidebarCurrentIds,
  folders: Folder[],
  libraries: Library[],
  context: UseSidebarTreeContext
): { treeData: DataNode[]; selectedKeys: string[] } {
  const {
    router,
    userRole,
    onContextMenu: handleContextMenu,
    openNewLibrary,
    setSelectedFolderId,
    setError,
    onLibraryPredefineClick: handleLibraryPredefineClick,
  } = context;

  const treeData: DataNode[] = useMemo(() => {
    if (!currentIds.projectId) return [];

    const projectFolders = folders.filter((f) => f.project_id === currentIds.projectId);
    const projectLibraries = libraries.filter((lib) => lib.project_id === currentIds.projectId);

    const librariesByFolder = new Map<string, Library[]>();
    projectLibraries.forEach((lib) => {
      const folderId = lib.folder_id ? String(lib.folder_id) : '';
      if (!librariesByFolder.has(folderId)) {
        librariesByFolder.set(folderId, []);
      }
      librariesByFolder.get(folderId)!.push(lib);
    });

    const buildFolderNode = (folder: Folder): DataNode => {
      const folderLibraries = librariesByFolder.get(String(folder.id)) || [];

      const children: DataNode[] = folderLibraries.map((lib) => {
        const libProjectId = lib.project_id;
        const isCurrentLibrary =
          currentIds.libraryId === lib.id &&
          (currentIds.isLibraryPage || !!currentIds.assetId || currentIds.isPredefinePage);
        const showAssetPageIcons = currentIds.libraryId === lib.id && !!currentIds.assetId;
        return {
          title: (
            <div
              className={`${styles.itemRow} ${styles.libraryRow} ${isCurrentLibrary ? (showAssetPageIcons ? styles.libraryItemActiveWithPadding : styles.libraryItemActive) : ''}`}
              data-library-under-folder
              onContextMenu={(e) => handleContextMenu(e, 'library', lib.id)}
            >
              <div className={styles.itemMain}>
                {showAssetPageIcons && (
                  <button
                    className={styles.libraryBackButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (currentIds.projectId) router.push(`/${currentIds.projectId}`);
                    }}
                    title="Back to tree view"
                  >
                    <Image src={sidebarFolderIcon3} alt="Back" width={24} height={24} className="icon-24" />
                  </button>
                )}
                <div className={styles.libraryIconContainer}>
                  <Image src={libraryBookIcon} alt="Library" width={24} height={24} className="icon-24" />
                </div>
                <span className={styles.itemText} title={lib.name}>
                  {truncateText(lib.name, 15)}
                </span>
              </div>
              <div className={styles.itemActions}>
                {userRole === 'admin' && (
                  <Tooltip title="Predefine asset here" placement="top" color="#8B5CF6">
                    <button
                      className={styles.iconButton}
                      aria-label="Library sections"
                      onClick={(e) => handleLibraryPredefineClick(libProjectId, lib.id, e)}
                    >
                      <Image
                        src={
                          currentIds.isPredefinePage && currentIds.libraryId === lib.id
                            ? PredefineNewClick
                            : PredefineNewIcon
                        }
                        alt="Predefine"
                        width={22}
                        height={22}
                        className="icon-22"
                      />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          ),
          key: `library-${lib.id}`,
          isLeaf: true,
          children: undefined,
        };
      });

      const hasNoLibraries = folderLibraries.length === 0;
      return {
        title: (
          <div
            className={`${styles.itemRow} ${styles.folderRow}`}
            data-folder-row
            onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id)}
          >
            <div className={styles.itemMain}>
              {hasNoLibraries && (
                <div className={styles.folderIconPlaceholder} aria-hidden>
                  <Image src={folderCloseIcon} alt="" width={24} height={24} className="icon-24" />
                </div>
              )}
              <span className={styles.itemText} style={{ fontWeight: 500 }} title={folder.name}>
                {truncateText(folder.name, 20)}
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
        key: `folder-${folder.id}`,
        isLeaf: children.length === 0,
        children: children.length > 0 ? children : undefined,
      };
    };

    const result: DataNode[] = [];
    projectFolders.forEach((folder) => {
      result.push(buildFolderNode(folder));
    });

    const rootLibraries = librariesByFolder.get('') || [];
    rootLibraries.forEach((lib) => {
      const libProjectId = lib.project_id;
      const isCurrentLibrary =
        currentIds.libraryId === lib.id &&
        (currentIds.isLibraryPage || !!currentIds.assetId || currentIds.isPredefinePage);
      const showAssetPageIcons = currentIds.libraryId === lib.id && !!currentIds.assetId;
      result.push({
        title: (
          <div
            className={`${styles.itemRow} ${styles.libraryRow} ${styles.rootLibraryRow} ${isCurrentLibrary ? (showAssetPageIcons ? styles.libraryItemActiveWithPadding : styles.libraryItemActive) : ''}`}
            onContextMenu={(e) => handleContextMenu(e, 'library', lib.id)}
          >
            <div className={styles.itemMain}>
              {showAssetPageIcons && (
                <button
                  className={styles.libraryBackButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentIds.projectId) router.push(`/${currentIds.projectId}`);
                  }}
                  title="Back to tree view"
                >
                  <Image src={sidebarFolderIcon3} alt="Back" width={24} height={24} />
                </button>
              )}
              <div className={styles.libraryIconContainer}>
                <Image src={libraryBookIcon} alt="Library" width={24} height={24} className="icon-24" />
              </div>
              <span className={styles.itemText} style={{ fontWeight: 500 }} title={lib.name}>
                {truncateText(lib.name, 15)}
              </span>
            </div>
            <div className={styles.itemActions}>
              {userRole === 'admin' && (
                <Tooltip title="Predefine asset here" placement="top" color="#8B5CF6">
                  <button
                    className={styles.iconButton}
                    aria-label="Library sections"
                    onClick={(e) => handleLibraryPredefineClick(libProjectId, lib.id, e)}
                  >
                    <Image
                      src={
                        currentIds.isPredefinePage && currentIds.libraryId === lib.id
                          ? PredefineNewClick
                          : PredefineNewIcon
                      }
                      alt="Predefine"
                      width={22}
                      height={22}
                      className="icon-22"
                    />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        ),
        key: `library-${lib.id}`,
        isLeaf: true,
        children: undefined,
      });
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
    handleContextMenu,
    handleLibraryPredefineClick,
    router,
    userRole,
    openNewLibrary,
    setSelectedFolderId,
    setError,
  ]);

  const selectedKeys = useMemo(() => {
    const keys: string[] = [];
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
    currentIds.isLibraryPage,
    currentIds.isPredefinePage,
  ]);

  return { treeData, selectedKeys };
}
