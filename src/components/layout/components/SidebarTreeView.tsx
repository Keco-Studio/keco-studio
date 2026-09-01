'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Tree } from 'antd';
import type { DataNode, EventDataNode } from 'antd/es/tree';
import FolderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
import FolderOpenIcon from '@/assets/images/FolderOpenIcon.svg';
import folderExpandIcon from '@/assets/images/folderExpandIcon.svg';
import folderCollapseIcon from '@/assets/images/folderCollapseIcon.svg';
import paperIcon from '@/assets/images/paper.svg';
import tableIcon from '@/assets/images/table.svg';
import FolderAddLibIcon from '@/assets/images/FolderAddLibIcon.svg';
import {
  canDragSidebarNode,
  resolveSidebarDrop,
} from '../sidebarTreeDnD';
import { snapSidebarHorizontalScroll, focusRenameInputAtEnd } from '../sidebarScrollReset';
import styles from '../Sidebar.module.css';

type SidebarTreeNodeMeta = {
  _titleStr?: string;
  _nodeType?: 'library' | 'folder' | 'document';
  _isLibraryUnderFolder?: boolean;
  _isDerived?: boolean;
};

export type SidebarTreeDropInfo = {
  dragKey: string;
  dropKey: string;
  dropToGap: boolean;
  dragIsDerived: boolean;
};

export type SidebarTreeViewProps = {
  treeData: DataNode[];
  selectedKeys: React.Key[];
  expandedKeys: React.Key[];
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  onSaveRename: (key: string, newName: string) => void | Promise<void>;
  setSelectedFolderId: (id: string | null) => void;
  onFolderAddClick: (folderId: string, anchor: HTMLElement) => void;
  setError: (msg: string | null) => void;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  currentProjectId: string | null;
  onSelect: (keys: React.Key[], info: any) => void;
  onExpand: (expandedKeys: React.Key[], info: { node: EventDataNode }) => void;
  onRightClick?: (info: { event: any; node: EventDataNode }) => void;
  /** P1–P3: document / table / folder DnD onto folder, root, or document */
  onTreeDrop?: (info: SidebarTreeDropInfo) => void | Promise<void>;
  /** Notify parent when a tree drag starts/ends (e.g. Libraries root drop zone). */
  onDragStart?: (dragKey: string) => void;
  onDragEnd?: () => void;
  isDragPending?: (dragKey: string) => boolean;
};

function InlineEditRow({
  nodeKey,
  initialValue,
  nodeType,
  userRole,
  onSave,
  onCancel,
  setSelectedFolderId,
  onFolderAddClick,
  setError,
  currentProjectId,
  isLibraryUnderFolder,
  skipBlurSaveRef,
  scrollAnchorRef,
}: {
  nodeKey: string;
  initialValue: string;
  nodeType: 'library' | 'folder' | 'document';
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onSave: (key: string, newName: string) => void | Promise<void>;
  onCancel: () => void;
  setSelectedFolderId: (id: string | null) => void;
  onFolderAddClick: (folderId: string, anchor: HTMLElement) => void;
  setError: (msg: string | null) => void;
  currentProjectId: string | null;
  isLibraryUnderFolder?: boolean;
  skipBlurSaveRef: React.MutableRefObject<boolean>;
  scrollAnchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [value, setValue] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    focusRenameInputAtEnd(inputRef.current);
  }, []);

  const exitEditMode = useCallback(() => {
    skipBlurSaveRef.current = true;
    onCancel();
    // Leave rename: show the name from the first character again; reset any tree nudge.
    snapSidebarHorizontalScroll(scrollAnchorRef.current ?? inputRef.current);
  }, [onCancel, scrollAnchorRef, skipBlurSaveRef]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    setIsSaving(true);
    try {
      await Promise.resolve(onSave(nodeKey, trimmed));
      exitEditMode();
    } catch {
      focusRenameInputAtEnd(inputRef.current);
    } finally {
      setIsSaving(false);
    }
  }, [value, nodeKey, onSave, isSaving, exitEditMode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitEditMode();
      }
    },
    [handleSave, exitEditMode]
  );

  const isFolder = nodeType === 'folder';
  const folderId = isFolder ? nodeKey.replace('folder-', '') : null;

  return (
    <div
      className={`${styles.itemRow} ${isFolder ? styles.folderRow : styles.libraryRow} ${!isFolder && !isLibraryUnderFolder ? styles.rootLibraryRow : ''}`}
      data-folder-row={isFolder ? true : undefined}
      data-library-under-folder={!isFolder && isLibraryUnderFolder ? true : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.itemMain}>
        {!isFolder && (
          <div className={styles.libraryIconContainer}>
            <Image
              src={nodeType === 'document' ? paperIcon : tableIcon}
              alt={nodeType === 'document' ? 'Document' : 'Library'}
              width={24}
              height={24}
              className="icon-24"
            />
          </div>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (skipBlurSaveRef.current) {
              skipBlurSaveRef.current = false;
              return;
            }
            void handleSave();
          }}
          onKeyDown={handleKeyDown}
          className={styles.renameInput}
          disabled={isSaving}
          onClick={(e) => e.stopPropagation()}
          aria-label="Rename"
        />
      </div>
      {isFolder && (userRole === 'admin' || userRole === 'editor') && (
        <div className={styles.itemActions}>
          <button
            type="button"
            className={styles.folderAddLibButton}
            aria-label="Folder actions"
            title="Folder actions"
            onClick={(e) => {
              e.stopPropagation();
              if (!currentProjectId) {
                setError('Please select a project first');
                return;
              }
              if (folderId) onFolderAddClick(folderId, e.currentTarget);
            }}
          >
            <Image src={FolderAddLibIcon} alt="" width={24} height={24} className="icon-24" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Renders the Ant Design Tree for folders/libraries in the Sidebar.
 * Switcher icons (folder open/close, expand) are handled inside this component.
 * Double-click node title to enter inline edit; Enter/Blur to save, Esc to cancel.
 */
export function SidebarTreeView({
  treeData,
  selectedKeys,
  expandedKeys,
  editingKey,
  setEditingKey,
  onSaveRename,
  setSelectedFolderId,
  onFolderAddClick,
  setError,
  userRole,
  currentProjectId,
  onSelect,
  onExpand,
  onRightClick,
  onTreeDrop,
  onDragStart,
  onDragEnd,
  isDragPending,
}: SidebarTreeViewProps) {
  const canEditTree = userRole === 'admin' || userRole === 'editor';
  const activeDragKeyRef = useRef<string | null>(null);
  const skipBlurSaveRef = useRef(false);
  const treeWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editingKey) return;

    const commitFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(`.${styles.renameInput}`)) return;

      const input = treeWrapperRef.current?.querySelector('input[aria-label="Rename"]');
      if (input instanceof HTMLInputElement) {
        input.blur();
        return;
      }

      setEditingKey(null);
      snapSidebarHorizontalScroll(treeWrapperRef.current);
    };

    document.addEventListener('pointerdown', commitFromOutside, true);
    return () => document.removeEventListener('pointerdown', commitFromOutside, true);
  }, [editingKey, setEditingKey]);

  const handleNodeDragStart = useCallback(
    (dragKey: string) => {
      activeDragKeyRef.current = dragKey;
      onDragStart?.(dragKey);
    },
    [onDragStart]
  );

  const handleNodeDragEnd = useCallback(() => {
    if (activeDragKeyRef.current === null) return;
    activeDragKeyRef.current = null;
    onDragEnd?.();
  }, [onDragEnd]);

  // rc-tree only forwards `dragend` from a node that is still draggable, and it crashes
  // (`convertNodePropsToEventData(null)`) when its window-level fallback runs with a Tree
  // `onDragEnd` prop. Listen at the window in capture phase instead so the drag state is
  // always cleared and rc-tree never builds that null event.
  useEffect(() => {
    window.addEventListener('dragend', handleNodeDragEnd, true);
    return () => window.removeEventListener('dragend', handleNodeDragEnd, true);
  }, [handleNodeDragEnd]);

  const nodeDraggable = useCallback(
    (node: DataNode) => {
      const meta = node as DataNode & SidebarTreeNodeMeta;
      const key = String(meta.key ?? '');
      // Keep the node being dragged draggable until `dragend`: a pending move marks it
      // immediately, and flipping `draggable` off mid-drag detaches rc-tree's handlers.
      if (key !== activeDragKeyRef.current && isDragPending?.(key)) return false;
      if (
        !canDragSidebarNode(
          { ...meta, key },
          canEditTree
        )
      ) {
        return false;
      }
      // Tables: admin only (same as Move library modal); derived tables may drag to detach (P2).
      if (meta._nodeType === 'library' || key.startsWith('library-')) {
        return userRole === 'admin';
      }
      // Folders: admin only (create/update folder is admin).
      if (meta._nodeType === 'folder' || key.startsWith('folder-')) {
        return userRole === 'admin';
      }
      return true;
    },
    [canEditTree, isDragPending, userRole]
  );

  const allowDrop = useCallback(
    ({
      dragNode,
      dropNode,
      dropPosition,
    }: {
      dragNode: EventDataNode;
      dropNode: EventDataNode;
      dropPosition: number;
    }) => {
      if (!onTreeDrop) return false;
      const dragKey = String(dragNode.key);
      const dropKey = String(dropNode.key);
      const dropToGap = dropPosition !== 0;
      const dragMeta = dragNode as EventDataNode & SidebarTreeNodeMeta;
      const resolved = resolveSidebarDrop({
        dragKey,
        dropKey,
        dropToGap,
        dragIsDerived: Boolean(dragMeta._isDerived),
        treeData,
      });
      if (resolved.kind === 'invalid') return false;
      if (dragKey.startsWith('library-') && userRole !== 'admin') return false;
      if (dragKey.startsWith('folder-') && userRole !== 'admin') return false;
      if (dragKey.startsWith('document-') && userRole !== 'admin' && userRole !== 'editor') {
        return false;
      }
      return true;
    },
    [onTreeDrop, treeData, userRole]
  );

  const handleDrop = useCallback(
    (info: {
      node: EventDataNode;
      dragNode: EventDataNode;
      dropToGap: boolean;
    }) => {
      if (!onTreeDrop) return;
      const dragKey = String(info.dragNode.key);
      const dropKey = String(info.node.key);
      const dragMeta = info.dragNode as EventDataNode & SidebarTreeNodeMeta;
      void onTreeDrop({
        dragKey,
        dropKey,
        dropToGap: info.dropToGap,
        dragIsDerived: Boolean(dragMeta._isDerived),
      });
    },
    [onTreeDrop]
  );

  const switcherIcon = (node: any) => {
    const { expanded, isLeaf, data } = node || {};
    const key = (data?.key ?? node?.key) as string | undefined;

    if (isLeaf || !key) return null;

    if (key.startsWith('folder-')) {
      const children = data?.children ?? node?.children ?? [];
      const isEmpty = !Array.isArray(children) || children.length === 0;
      const showClosedFolder = isEmpty || !expanded;

      return (
        <div className={styles.folderSwitcherIcons}>
          <Image
            src={showClosedFolder ? FolderCloseIcon : FolderOpenIcon}
            alt={showClosedFolder ? 'Closed folder' : 'Open folder'}
            width={24}
            height={24}
            className={`icon-24 ${styles.folderSwitcherBase}`}
          />
          <Image
            src={expanded && !isEmpty ? folderCollapseIcon : folderExpandIcon}
            alt={expanded && !isEmpty ? 'Collapse folder' : 'Expand folder'}
            width={expanded && !isEmpty ? 14 : 14}
            height={expanded && !isEmpty ? 8 : 8}
            className={styles.folderSwitcherHover}
          />
        </div>
      );
    }

    if (key.startsWith('library-')) return null;
    // Document expand/collapse lives in the title row (right of the name).
    if (key.startsWith('document-')) return null;
    return null;
  };

  // rc-tree / Ant Design Tree titleRender passes only the node data object.
  const titleRender = useCallback(
    (data: EventDataNode & SidebarTreeNodeMeta) => {
      if (!data || data.key == null) return null;
      const key = String(data.key);
      const titleStr = data._titleStr;
      const nodeType = data._nodeType;
      const isLibraryUnderFolder = data._isLibraryUnderFolder;
      const defaultTitle = data.title;

      if (editingKey === key && titleStr != null && nodeType) {
        return (
          <InlineEditRow
            nodeKey={key}
            initialValue={titleStr}
            nodeType={nodeType}
            userRole={userRole}
            onSave={onSaveRename}
            onCancel={() => setEditingKey(null)}
            setSelectedFolderId={setSelectedFolderId}
            onFolderAddClick={onFolderAddClick}
            setError={setError}
            currentProjectId={currentProjectId}
            isLibraryUnderFolder={isLibraryUnderFolder}
            skipBlurSaveRef={skipBlurSaveRef}
            scrollAnchorRef={treeWrapperRef}
          />
        );
      }
      return defaultTitle as React.ReactNode;
    },
    [editingKey, setEditingKey, onSaveRename, setSelectedFolderId, onFolderAddClick, setError, userRole, currentProjectId, skipBlurSaveRef]
  );

  return (
    <div className={styles.treeWrapper} ref={treeWrapperRef}>
      <Tree
        className={styles.tree}
        showIcon={false}
        multiple={true}
        treeData={treeData}
        selectedKeys={selectedKeys}
        expandedKeys={expandedKeys}
        onSelect={onSelect}
        onExpand={onExpand}
        onRightClick={onRightClick}
        draggable={
          onTreeDrop
            ? { icon: false, nodeDraggable }
            : false
        }
        allowDrop={onTreeDrop ? allowDrop : undefined}
        dropIndicatorRender={onTreeDrop ? () => null : undefined}
        onDragStart={
          onTreeDrop
            ? (info) => {
                handleNodeDragStart(String(info.node.key));
              }
            : undefined
        }
        onDrop={onTreeDrop ? handleDrop : undefined}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        switcherIcon={switcherIcon}
        titleRender={titleRender}
        motion={false}
      />
    </div>
  );
}
