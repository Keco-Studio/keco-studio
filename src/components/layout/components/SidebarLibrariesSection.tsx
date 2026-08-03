'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';
import type { DataNode } from 'antd/es/tree';
import type { Library } from '@/lib/services/libraryService';
import type { SidebarAssetRow } from '../hooks/useSidebarAssets';
import addProjectIcon from '@/assets/images/addProjectIcon.svg';
import FolderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
import { SidebarTreeView } from './SidebarTreeView';
import type { SidebarTreeDropInfo } from './SidebarTreeView';
import styles from '../Sidebar.module.css';

export type SidebarCurrentIds = {
  projectId: string | null;
  libraryId: string | null;
  assetId: string | null;
};

export type SidebarLibrariesSectionProps = {
  currentIds: SidebarCurrentIds;
  libraries: Library[];
  assets: Record<string, SidebarAssetRow[]>;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  loadingFolders: boolean;
  loadingLibraries: boolean;
  foldersLength: number;
  librariesLength: number;
  treeData: DataNode[];
  selectedKeys: React.Key[];
  expandedKeys: React.Key[];
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  onSaveRename: (key: string, newName: string) => void | Promise<void>;
  setSelectedFolderId: (id: string | null) => void;
  onFolderAddClick: (folderId: string, anchor: HTMLElement) => void;
  setError: (msg: string | null) => void;
  onSelect: (keys: React.Key[], info: any) => void;
  onExpand: (expandedKeys: React.Key[], info: { node: any }) => void;
  onBackToLibrary: () => void;
  onAddNewAsset: () => void;
  onAssetClick: (projectId: string, libraryId: string, assetId: string) => void;
  onContextMenu: (e: React.MouseEvent, type: 'asset', id: string) => void;
  addButtonRef: (el: HTMLButtonElement | null) => void;
  onAddButtonClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onTreeRightClick: (info: { event: any; node: any }) => void;
  onTreeDrop?: (info: SidebarTreeDropInfo) => void | Promise<void>;
  /** Drop onto Libraries title → move to project root. */
  onDropToRoot?: (dragKey: string) => void;
  isDragPending?: (dragKey: string) => boolean;
};

/**
 * Renders the Libraries section: either asset list (when on asset page) or tree + empty state.
 */
export function SidebarLibrariesSection({
  currentIds,
  userRole,
  loadingFolders,
  loadingLibraries,
  foldersLength,
  librariesLength,
  treeData,
  selectedKeys,
  expandedKeys,
  editingKey,
  setEditingKey,
  onSaveRename,
  setSelectedFolderId,
  onFolderAddClick,
  setError,
  onSelect,
  onExpand,
  addButtonRef,
  onAddButtonClick,
  onTreeRightClick,
  onTreeDrop,
  onDropToRoot,
  isDragPending,
}: SidebarLibrariesSectionProps) {
  const canEdit = userRole === 'admin' || userRole === 'editor';
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);

  const handleDragStart = useCallback((dragKey: string) => {
    setDraggingKey(dragKey);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingKey(null);
    setRootDropActive(false);
  }, []);

  const handleRootDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!canEdit || !onDropToRoot || !draggingKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setRootDropActive(true);
    },
    [canEdit, onDropToRoot, draggingKey]
  );

  const handleRootDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setRootDropActive(false);
  }, []);

  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setRootDropActive(false);
      if (!canEdit || !onDropToRoot || !draggingKey) return;
      onDropToRoot(draggingKey);
      setDraggingKey(null);
    },
    [canEdit, onDropToRoot, draggingKey]
  );

  return (
    <>
      <div
        className={`${styles.sectionTitle} ${rootDropActive ? styles.librariesRootDropActive : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
        title={draggingKey ? 'Drop here to move to project root' : undefined}
      >
        <span>Libraries</span>
        {(userRole === 'admin' || userRole === 'editor') && (
          <button
            ref={addButtonRef}
            className={styles.addButton}
            onClick={onAddButtonClick}
            title="Add new folder, library, or document"
          >
            <Image src={addProjectIcon} alt="Add library" width={16} height={16} className="icon-16" />
          </button>
        )}
      </div>
      <div className={styles.sectionList}>
        <SidebarTreeView
          treeData={treeData}
          selectedKeys={selectedKeys}
          expandedKeys={expandedKeys}
          editingKey={editingKey}
          setEditingKey={setEditingKey}
          onSaveRename={onSaveRename}
          setSelectedFolderId={setSelectedFolderId}
          onFolderAddClick={onFolderAddClick}
          setError={setError}
          userRole={userRole}
          currentProjectId={currentIds.projectId}
          onSelect={onSelect}
          onExpand={onExpand}
          onRightClick={onTreeRightClick}
          onTreeDrop={onTreeDrop}
          onDragStart={onDropToRoot ? handleDragStart : undefined}
          onDragEnd={onDropToRoot ? handleDragEnd : undefined}
          isDragPending={isDragPending}
        />
        {!loadingFolders && !loadingLibraries && foldersLength === 0 && librariesLength === 0 && (
          <div className={styles.sidebarEmptyState}>
            <Image
              src={FolderCloseIcon}
              alt="No folders or libraries"
              width={22}
              height={18}
              className={`icon-22 ${styles.emptyIcon}`}
            />
            <div className={styles.sidebarEmptyText}>
              No folder or library in this project yet.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
