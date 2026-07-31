'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Tree } from 'antd';
import type { DataNode, EventDataNode } from 'antd/es/tree';
import FolderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
import FolderOpenIcon from '@/assets/images/FolderOpenIcon.svg';
import folderExpandIcon from '@/assets/images/folderExpandIcon.svg';
import folderCollapseIcon from '@/assets/images/folderCollapseIcon.svg';
import folderIcon from '@/assets/images/folder.svg';
import paperIcon from '@/assets/images/paper.svg';
import tableIcon from '@/assets/images/table.svg';
import FolderAddLibIcon from '@/assets/images/FolderAddLibIcon.svg';
import {
  canDragSidebarNode,
  resolveSidebarDrop,
} from '../sidebarTreeDnD';
import styles from '../Sidebar.module.css';

type SidebarTreeNodeMeta = {
  _titleStr?: string;
  _nodeType?: 'library' | 'folder' | 'document';
  _hasNoLibraries?: boolean;
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
};

function InlineEditRow({
  nodeKey,
  initialValue,
  nodeType,
  hasNoLibraries,
  userRole,
  onSave,
  onCancel,
  setSelectedFolderId,
  onFolderAddClick,
  setError,
  currentProjectId,
  isLibraryUnderFolder,
}: {
  nodeKey: string;
  initialValue: string;
  nodeType: 'library' | 'folder' | 'document';
  hasNoLibraries?: boolean;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onSave: (key: string, newName: string) => void | Promise<void>;
  onCancel: () => void;
  setSelectedFolderId: (id: string | null) => void;
  onFolderAddClick: (folderId: string, anchor: HTMLElement) => void;
  setError: (msg: string | null) => void;
  currentProjectId: string | null;
  isLibraryUnderFolder?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Do not call select() here; it can trigger the browser text-selection toolbar.
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    setIsSaving(true);
    try {
      await Promise.resolve(onSave(nodeKey, trimmed));
      onCancel();
    } catch {
      // Keep inline edit mode on save failure (e.g. duplicate name).
      // Error feedback is handled by upper-level toast/state logic.
    } finally {
      setIsSaving(false);
    }
  }, [value, nodeKey, onSave, onCancel, isSaving]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    },
    [handleSave, onCancel]
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
        {isFolder && hasNoLibraries && (
          <div className={styles.folderIconPlaceholder} aria-hidden>
            <Image src={folderIcon} alt="" width={24} height={24} className="icon-24" />
          </div>
        )}
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
}: SidebarTreeViewProps) {
  const canEditTree = userRole === 'admin' || userRole === 'editor';

  const nodeDraggable = useCallback(
    (node: DataNode) => {
      const meta = node as DataNode & SidebarTreeNodeMeta;
      const key = String(meta.key ?? '');
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
    [canEditTree, userRole]
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
      if (!expanded) {
        return (
          <div className={styles.folderSwitcherIcons}>
            <Image
              src={FolderCloseIcon}
              alt="Closed folder"
              width={24}
              height={24}
              className={`icon-24 ${styles.folderSwitcherBase}`}
            />
            <Image
              src={folderCollapseIcon}
              alt="Collapse"
              width={8}
              height={14}
              className={styles.folderSwitcherHover}
            />
          </div>
        );
      }
      return (
        <div className={styles.folderSwitcherIcons}>
          <Image
            src={FolderOpenIcon}
            alt="Open folder"
            width={24}
            height={24}
            className={`icon-24 ${styles.folderSwitcherBase}`}
          />
          <Image
            src={folderExpandIcon}
            alt="Expand"
            width={14}
            height={8}
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
      const hasNoLibraries = data._hasNoLibraries;
      const isLibraryUnderFolder = data._isLibraryUnderFolder;
      const defaultTitle = data.title;

      if (editingKey === key && titleStr != null && nodeType) {
        return (
          <InlineEditRow
            nodeKey={key}
            initialValue={titleStr}
            nodeType={nodeType}
            hasNoLibraries={hasNoLibraries}
            userRole={userRole}
            onSave={onSaveRename}
            onCancel={() => setEditingKey(null)}
            setSelectedFolderId={setSelectedFolderId}
            onFolderAddClick={onFolderAddClick}
            setError={setError}
            currentProjectId={currentProjectId}
            isLibraryUnderFolder={isLibraryUnderFolder}
          />
        );
      }
      return defaultTitle as React.ReactNode;
    },
    [editingKey, setEditingKey, onSaveRename, setSelectedFolderId, onFolderAddClick, setError, userRole, currentProjectId]
  );

  return (
    <div className={styles.treeWrapper}>
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
          onTreeDrop && onDragStart
            ? (info) => {
                onDragStart(String(info.node.key));
              }
            : undefined
        }
        onDragEnd={
          onTreeDrop && onDragEnd
            ? () => {
                onDragEnd();
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
