'use client';

import Image from 'next/image';
import { Tree } from 'antd';
import type { DataNode, EventDataNode } from 'antd/es/tree';
import FolderOpenIcon from '@/assets/images/FolderOpenIcon.svg';
import FolderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
import folderExpandIcon from '@/assets/images/folderExpandIcon.svg';
import folderCollapseIcon from '@/assets/images/folderCollapseIcon.svg';
import styles from '../Sidebar.module.css';

export type SidebarTreeViewProps = {
  treeData: DataNode[];
  selectedKeys: React.Key[];
  expandedKeys: React.Key[];
  onSelect: (keys: React.Key[], info: any) => void;
  onExpand: (expandedKeys: React.Key[], info: { node: EventDataNode }) => void;
};

/**
 * Renders the Ant Design Tree for folders/libraries in the Sidebar.
 * Switcher icons (folder open/close, expand) are handled inside this component.
 */
export function SidebarTreeView({
  treeData,
  selectedKeys,
  expandedKeys,
  onSelect,
  onExpand,
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
        switcherIcon={switcherIcon}
        motion={false}
      />
    </div>
  );
}
