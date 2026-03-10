'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Input, Tree } from 'antd';
import type { InputRef } from 'antd/es/input';
import type { DataNode, EventDataNode } from 'antd/es/tree';
import FolderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
import FolderOpenIcon from '@/assets/images/FolderOpenIcon.svg';
import folderExpandIcon from '@/assets/images/folderExpandIcon.svg';
import folderCollapseIcon from '@/assets/images/folderCollapseIcon.svg';
import libraryBookIcon from '@/assets/images/LibraryBookIcon.svg';
import FolderAddLibIcon from '@/assets/images/FolderAddLibIcon.svg';
import styles from '../Sidebar.module.css';

type SidebarTreeNodeMeta = {
  _titleStr?: string;
  _nodeType?: 'library' | 'folder';
  _hasNoLibraries?: boolean;
};

export type SidebarTreeViewProps = {
  treeData: DataNode[];
  selectedKeys: React.Key[];
  expandedKeys: React.Key[];
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  onSaveRename: (key: string, newName: string) => void | Promise<void>;
  setSelectedFolderId: (id: string | null) => void;
  openNewLibrary: () => void;
  setError: (msg: string | null) => void;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  currentProjectId: string | null;
  onSelect: (keys: React.Key[], info: any) => void;
  onExpand: (expandedKeys: React.Key[], info: { node: EventDataNode }) => void;
  onRightClick?: (info: { event: any; node: EventDataNode }) => void;
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
  openNewLibrary,
  setError,
  currentProjectId,
}: {
  nodeKey: string;
  initialValue: string;
  nodeType: 'library' | 'folder';
  hasNoLibraries?: boolean;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onSave: (key: string, newName: string) => void | Promise<void>;
  onCancel: () => void;
  setSelectedFolderId: (id: string | null) => void;
  openNewLibrary: () => void;
  setError: (msg: string | null) => void;
  currentProjectId: string | null;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // 不在此处 select()，避免触发浏览器选区工具栏（弹框）；用户仍可在输入框内手动选中
  }, []);

  const handleSave = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onSave(nodeKey, trimmed);
    }
    onCancel();
  }, [value, nodeKey, onSave, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
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
      className={`${styles.itemRow} ${isFolder ? styles.folderRow : styles.libraryRow} ${!isFolder ? styles.rootLibraryRow : ''}`}
      data-folder-row={isFolder ? true : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.itemMain}>
        {isFolder && hasNoLibraries && (
          <div className={styles.folderIconPlaceholder} aria-hidden>
            <Image src={FolderCloseIcon} alt="" width={24} height={24} className="icon-24" />
          </div>
        )}
        {!isFolder && (
          <div className={styles.libraryIconContainer}>
            <Image src={libraryBookIcon} alt="Library" width={24} height={24} className="icon-24" />
          </div>
        )}
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className={styles.treeNodeInput}
          size="small"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {isFolder && userRole === 'admin' && (
        <div className={styles.itemActions}>
          <button
            type="button"
            className={styles.folderAddLibButton}
            aria-label="Create new library"
            title="Create new library"
            onClick={(e) => {
              e.stopPropagation();
              if (!currentProjectId) {
                setError('Please select a project first');
                return;
              }
              if (folderId) setSelectedFolderId(folderId);
              openNewLibrary();
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
  openNewLibrary,
  setError,
  userRole,
  currentProjectId,
  onSelect,
  onExpand,
  onRightClick,
}: SidebarTreeViewProps) {
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
    return null;
  };

  // rc-tree / Ant Design Tree 的 titleRender 只传入一个参数：节点数据 data（含 key, title, _titleStr 等）
  const titleRender = useCallback(
    (data: EventDataNode & SidebarTreeNodeMeta) => {
      if (!data || data.key == null) return null;
      const key = String(data.key);
      const titleStr = data._titleStr;
      const nodeType = data._nodeType;
      const hasNoLibraries = data._hasNoLibraries;
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
            openNewLibrary={openNewLibrary}
            setError={setError}
            currentProjectId={currentProjectId}
          />
        );
      }
      return defaultTitle as React.ReactNode;
    },
    [editingKey, setEditingKey, onSaveRename, setSelectedFolderId, openNewLibrary, setError, userRole, currentProjectId]
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
